import { z } from "zod";
import { deepDiff } from "deepjol";
import * as R from "https://deno.land/x/rambda@9.4.2/mod.ts";
import * as moo from "../services/moo.ts";
import {
  DOMParser,
  Element,
  Node,
} from "https://deno.land/x/deno_dom@v0.1.49/deno-dom-wasm.ts";

const { warn } = console;

function toCourseCid(courseid: number) {
  return `C${courseid.toString().padStart(3, "0")}`;
}

function getNodeTextContent(node: Node): string {
  return node.nodeType === Node.TEXT_NODE
    ? node.nodeValue || ""
    : Array.from(node.childNodes).map(getNodeTextContent).join("");
}

if (import.meta.main) {
  const mooCategories = await moo.api.core.course.getCategories()
    .then(moo.buildCategoryTree);

  const mooFilteredCategories = mooCategories.filter((cat) =>
    ["Live-Online Courses", "On-Campus Courses"].includes(cat.name)
  )
    .map((cat) => {
      const getAllCategoryIds = (categories: moo.CategoryTree[]): number[] =>
        R.chain(
          (
            category: moo.CategoryTree,
          ) => [category.id, ...getAllCategoryIds(category.children)],
          categories,
        );

      return getAllCategoryIds([cat]);
    });

  const mooCourses = await moo.api.core.course.getCourses({}).then(
    moo.getCoursesSchema.parse,
  )
    .then((courses) =>
      courses.filter((course) =>
        mooFilteredCategories.flat().includes(course.categoryid)
      )
    )
    .then((courses) =>
      courses.map((course) =>
        moo.api.core.course.getCoursesByField({
          // @ts-ignore - field can be id/s, shortname, idnumber, category
          field: "id",
          value: course.id,
        })
          .then(moo.getCoursesByFieldSchema.parse)
          .then(({ courses }) => courses[0])
          .then((courseDetails) => R.merge(course, courseDetails))
      )
    );

  for await (const course of mooCourses) {
    if (course.id !== 39) continue;

    const courseContents = await moo.api.core.course.getContents({
      courseid: course.id,
    })
      .then(moo.getCourseContentsSchema.parse);

    // ensure mandatory sections are present
    const mandatorySections = ["Introduction", "Table of Contents"];
    const missingSections = mandatorySections.filter((section) =>
      !courseContents.some((c) => c.name === section)
    );
    if (missingSections.length) {
      warn(
        `Course ${course.id}: missing sections`,
        missingSections,
      );
    }

    // ensure mandatory modules are present in Introduction section
    const mandatoryIntroModules = [
      "এই কোর্সটি কেন করবেন?",
      "এই কোর্সে আপনি যা যা পাবেন",
      "কোর্সটি করে যা শিখবেন",
      "এই কোর্সটি যাদের জন্য",
      "এই কোর্স করতে কি কি লাগবে",
    ];
    const introSection = courseContents.find((c) => c.name === "Introduction");
    if (introSection) {
      const missingModules = mandatoryIntroModules.filter((module) =>
        !introSection.modules.some((m) => m.name === module)
      );
      if (missingModules.length) {
        warn(
          `Course ${course.id}: missing modules in ${introSection.name} section`,
          missingModules,
        );
      }
    }

    // ensure mandatory modules are present in Table of Contents section
    const tocSection = courseContents.find((c) =>
      c.name === "Table of Contents"
    );
    const mandatoryTocModules = ["কোর্স ব্রেকডাউন"];
    if (tocSection) {
      const missingModules = mandatoryTocModules.filter((module) =>
        !tocSection.modules.some((m) => m.name === module)
      );
      if (missingModules.length) {
        warn(
          `Course ${course.id}: missing modules in ${tocSection.name} section`,
          missingModules,
        );
      }
    }

    // canonicalize course module as ListModule (having only a title and a list)
    const toListModule = (module: z.infer<typeof moo.courseModuleSchema>) => {
      const { description } = module;
      if (!description) {
        warn(`Course ${course.id}: missing description in ${module.name}`);
        return;
      }
      const dom = new DOMParser().parseFromString(description, "text/html");
      // there should be a single div with no-overflow class
      const noOverflowDiv = dom.querySelector("body > .no-overflow");
      if (!noOverflowDiv) {
        warn(`Course ${course.id}: missing no-overflow div in Introduction`);
        return;
      }

      const title = noOverflowDiv.querySelector(":scope > p > strong")
        ?.innerText;
      const list = Array.from(
        noOverflowDiv.querySelectorAll(":scope > ul > li"),
      )
        .map((li) => li.innerHTML.trim()).filter(R.isNotEmpty);
      return { ...R.pick(["name"], module), title, list };
    };

    if (!introSection) {
      warn(`Course ${course.id}: missing Introduction section`);
      continue;
    }

    const introduction = introSection.modules.map(toListModule);

    if (!tocSection) {
      warn(`Course ${course.id}: missing Table of Contents section`);
      continue;
    }
    const toc = tocSection.modules.map((module) => {
      const { name, description } = module;
      if (!description) {
        warn(`Course ${course.id}: missing description in ${name}`);
        return;
      }
      const dom = new DOMParser().parseFromString(description, "text/html");
      // there should be a single div with no-overflow class
      const noOverflowDiv = dom.querySelector("body > .no-overflow");
      if (!noOverflowDiv) {
        warn(`Course ${course.id}: missing no-overflow div in Introduction`);
        return;
      }

      interface Outline {
        title?: string;
        children?: Outline[];
      }

      function buildOutline(
        parent: Element,
      ): Outline[] | undefined {
        const ul = parent.querySelector(":scope > ul");
        if (!ul) return;

        return Array.from(ul.children).map((li) => {
          const title = li.querySelector(":scope > strong")?.innerText ||
            getNodeTextContent(li);
          const children = buildOutline(li);
          return { title, children };
        });
      }

      const outline = buildOutline(noOverflowDiv);

      return { ...R.pick(["name"], module), outline };
    });

    const canonicalizedCourse = {
      id: course.id,
      name: course.fullname,
      introduction,
      toc,
    };

    // save canonicalized course to a file
    const courseCid = toCourseCid(course.id);
    const coursePath = `./courses/${courseCid}.json`;
    await Deno.writeTextFile(
      coursePath,
      JSON.stringify(canonicalizedCourse, null, 2),
    );
  }
}

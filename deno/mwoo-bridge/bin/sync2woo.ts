import { z } from "zod";
import * as R from "https://deno.land/x/rambda@9.4.2/mod.ts";
import * as moo from "../services/moo.ts";
import { deepDiff } from "deepjol";
import {
  DOMParser,
  Element,
  Node,
} from "https://deno.land/x/deno_dom@v0.1.49/deno-dom-wasm.ts";
import { linter } from "../utils/index.ts";
import {
  woo,
  wooProductSchema,
  wooProductsSchema,
  wooTagSchema,
  wooTagsSchema,
} from "../services/woo.ts";
import { encodeHex } from "jsr:@std/encoding/hex";

const { warn } = console;

const encoder = new TextEncoder();

function toCourseCid(courseid: number) {
  return `C${courseid.toString().padStart(3, "0")}`;
}

function getNodeTextContent(element: Element): string {
  return Array.from(element.childNodes).filter(
    (node) => node.nodeType === Node.TEXT_NODE,
  ).map((node) => node.textContent).join("").trim();
}

async function syncMedia(
  sourceUrl: string,
  name?: string,
  caption?: string,
  description?: string,
): Promise<{ id: number } | undefined> {
  // const apiUrl = "https://staging.jobready.global/wp-json/wp/v2/media";
  const apiUrl = Deno.env.get("WP_URL") + "/wp-json/wp/v2/media";
  const username = Deno.env.get("WP_USERNAME");
  const password = Deno.env.get("WP_PASSWORD");

  const credentials = btoa(`${username}:${password}`);

  const headers = new Headers();
  headers.set("Authorization", `Basic ${credentials}`);

  const imageSlug = await crypto.subtle.digest(
    "SHA-256",
    encoder.encode(sourceUrl),
  )
    .then(encodeHex)
    .then((digest) => `moo_${digest}`);

  const params = new URLSearchParams();
  params.set("slug", imageSlug);
  params.set(
    "_fields",
    "id,title,slug,alt_text,caption,description,date,source_url",
  );

  const existingImage = await fetch(apiUrl + "?" + params.toString(), {
    headers,
  }).then(
    (response) => response.json(),
  ).then(
    (response) => {
      const schema = z.array(z.object({
        slug: z.string(),
        id: z.number(),
      }));
      return schema.parse(response);
    },
  ).then(
    (response) => response.filter((image) => image.slug === imageSlug),
  );

  if (existingImage.length > 0) {
    return existingImage[0];
  }

  // https://developer.wordpress.org/rest-api/reference/media/#create-a-media-item
  const formDataEntries = {
    file: await fetch(sourceUrl).then((response) => response.blob()),
    title: name ?? imageSlug,
    slug: imageSlug,
    status: "publish",
    comment_status: "closed",
    ping_status: "closed",
    alt_text: name ?? caption ?? "",
    caption: caption ?? name ?? "",
    description: description ?? "",
  };
  const formData = new FormData();
  for (const [key, value] of Object.entries(formDataEntries)) {
    formData.append(key, value);
  }

  const response = await fetch(apiUrl, {
    method: "POST",
    headers,
    body: formData,
  });

  if (response.ok) {
    const result = await response.json();
    console.debug("created image:", R.pick(["id"], result));
    return result;
  } else {
    console.error(
      "Failed to create media:",
      response.status,
      await response.text(),
    );
  }
}

if (import.meta.main) {
  const mooCategories = await moo.api.core.course.getCategories();
  const mooCategoryTree = moo.buildCategoryTree(mooCategories);
  const mooCategoriesByIndex = R.indexBy(R.prop("id"), mooCategories);

  const mooFilteredCategories = mooCategoryTree.filter((cat) =>
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

  const wooTags = await Promise.all(
    ["Live-Online", "On-Campus", "Self-Paced"].map(async (tag) => {
      const slug = tag.toLowerCase();

      const existingTag =
        await (woo.get("products/tags", { slug }) as Promise<unknown>)
          .then((response: unknown) => {
            return z.object({ data: wooTagsSchema })
              .parse(response).data[0];
          });

      if (existingTag) return existingTag;

      return await (woo.post("products/tags", {
        name: tag,
        slug,
      }) as Promise<unknown>)
        .then((response: unknown) =>
          z.object({ data: wooTagSchema })
            .parse(response).data
        );
    }),
  );
  const wooTagsBySlug = R.indexBy(R.prop("slug"), wooTags);

  for await (const course of mooCourses) {
    // if (course.id !== 39) continue;

    // // save course in json file
    // Deno.writeTextFile(
    //   `${toCourseCid(course.id)}.json`,
    //   JSON.stringify(course, null, 2),
    // );

    const courseCid = toCourseCid(course.id);

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
        `Course ${courseCid}: missing sections`,
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
          `Course ${courseCid}: missing modules in ${introSection.name} section`,
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
          `Course ${courseCid}: missing modules in ${tocSection.name} section`,
          missingModules,
        );
      }
    }

    interface ListModule {
      name: string;
      title?: string;
      list: string[];
    }
    // canonicalize course module as ListModule (having only a title and a list)
    const toListModule = (
      module: z.infer<typeof moo.courseModuleSchema>,
    ): ListModule | undefined => {
      const { description } = module;
      if (!description) {
        warn(`Course ${courseCid}: missing description in ${module.name}`);
        return;
      }
      const dom = new DOMParser().parseFromString(description, "text/html");
      // there should be a single div with no-overflow class
      const noOverflowDiv = dom.querySelector("body > .no-overflow");
      if (!noOverflowDiv) {
        warn(`Course ${courseCid}: missing no-overflow div in Introduction`);
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
      warn(`Course ${courseCid}: missing Introduction section`);
      continue;
    }
    const introduction = introSection.modules.map(toListModule)
      .filter(R.isNotNil);

    if (!tocSection) {
      warn(`Course ${courseCid}: missing Table of Contents section`);
      continue;
    }

    const toTocModule = (module: z.infer<typeof moo.courseModuleSchema>) => {
      const { name, description } = module;
      if (!description) {
        warn(`Course ${courseCid}: missing description in ${name}`);
        return;
      }
      const dom = new DOMParser().parseFromString(description, "text/html");
      // there should be a single div with no-overflow class
      const noOverflowDiv = dom.querySelector("body > .no-overflow");
      if (!noOverflowDiv) {
        warn(`Course ${courseCid}: missing no-overflow div in Introduction`);
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
    };
    const toc = tocSection.modules.map(toTocModule).filter(R.isNotNil);

    const canonicalizedCourse = {
      id: course.id,
      cid: courseCid,
      name: course.fullname,
      tagline: course.summary,
      summary: introSection.summary.replace(/[\r\n]/g, ""),
      introduction,
      toc,
    };

    const product =
      await (woo.get("products", { sku: courseCid }) as Promise<unknown>)
        .then((response: unknown) =>
          z.object({ data: wooProductsSchema })
            .parse(response).data[0]
        );

    const productimage = await syncMedia(
      course.courseimage,
      name,
      course.shortname,
      course.summary,
    );

    const toAcfRepeater = (
      listModule: ListModule,
      repeaterName: string,
      listName: string,
    ) => {
      return listModule.list.map((item, index) => ({
        key: `${repeaterName}_${index}_${listName}`,
        value: item,
      })).concat({
        key: repeaterName,
        value: listModule.list.length.toString(),
      });
    };

    const why_do_this_course = canonicalizedCourse.introduction
      .find((m) => m.name === "এই কোর্সটি কেন করবেন?");
    const learning_outcomes = canonicalizedCourse.introduction
      .find((m) => m.name === "কোর্সটি করে যা শিখবেন");
    const who_is_this_course_for = canonicalizedCourse.introduction
      .find((m) => m.name === "এই কোর্সটি যাদের জন্য");
    const material_include = canonicalizedCourse.introduction
      .find((m) => m.name === "এই কোর্সে আপনি যা যা পাবেন");
    const prerequisite = canonicalizedCourse.introduction
      .find((m) => m.name === "এই কোর্স করতে কি কি লাগবে");

    const categoryTags = mooCategoriesByIndex[course.categoryid].path.split("/")
      .slice(1)
      .map((cat) => parseInt(cat, 10))
      .map((cat) => mooCategoriesByIndex[cat])
      .filter((cat) => R.isNotEmpty(cat.idnumber))
      .map((cat) => ({
        [cat.idnumber]: { name: cat.name, description: cat.description },
      }))
      .reduce((acc, val) => ({ ...acc, ...val }), {});

    const tags = Object.keys(categoryTags).map((key) =>
      R.pick(["id"], wooTagsBySlug[key])
    );

    const productFields: Partial<z.infer<typeof wooProductSchema>> = {
      name: canonicalizedCourse.name,
      sku: courseCid,
      images: productimage ? [{ id: productimage.id }] : [],
      tags,
      meta_data: [
        ...Object.entries({
          course_description: canonicalizedCourse.summary,
          "sub-headingtagline": canonicalizedCourse.tagline,
        }).map(([key, value]) => ({ key, value })),
        ...why_do_this_course
          ? toAcfRepeater(
            why_do_this_course,
            "why_do_this_course",
            "benefits_from_this_course_list",
          )
          : [],
        ...learning_outcomes
          ? toAcfRepeater(
            learning_outcomes,
            "learning_outcomes",
            "learning_outcome_list",
          )
          : [],
        ...who_is_this_course_for
          ? toAcfRepeater(
            who_is_this_course_for,
            "who_is_this_course_for",
            "list",
          )
          : [],
        ...material_include
          ? toAcfRepeater(
            material_include,
            "material_include",
            "list",
          )
          : [],
        ...prerequisite
          ? toAcfRepeater(
            prerequisite,
            "prerequisite",
            "list",
          )
          : [],
      ],
    };

    if (product) {
      const diff = deepDiff(product, productFields, {
        meta_data: { unique_by: "key" },
        images: { unique_by: "id" },
        tags: { unique_by: "id" },
        default: {
          ignore_missing: true,
        },
      });

      if (R.isNotEmpty(diff)) {
        await (woo.put(`products/${product.id}`, {
          ...productFields,
        }) as Promise<unknown>)
          .then((response: unknown) => {
            return z.object({ data: wooProductSchema })
              .parse(response).data;
          });
        console.info(
          `Course ${courseCid}: updated in WooCommerce with diff`,
          diff,
        );
      } else {
        console.info(`Course ${courseCid}: already up-to-date`);
      }
    } else {
      await (woo.post("products", {
        ...productFields,
        type: "simple",
        status: "private",
        virtual: true,
        sold_individually: true,
      }) as Promise<unknown>)
        .then((response: unknown) =>
          z.object({ data: wooProductsSchema })
            .parse(response).data[0]
        );
      console.info(`Course ${courseCid}: added to WooCommerce`);
    }
  }
}

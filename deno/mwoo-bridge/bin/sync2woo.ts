import { z } from "zod";
import * as R from "@rambda/rambda";
import * as moo from "../services/moo.ts";
import { deepDiff } from "deepjol";
import {
  DOMParser,
  // Element,
  // Node,
} from "https://deno.land/x/deno_dom@v0.1.49/deno-dom-wasm.ts";
import { lintText } from "../utils/index.ts";
import {
  woo,
  wooCategoriesSchema,
  wooCategorySchema,
  wooProductSchema,
  wooProductsSchema,
  wooTagSchema,
  wooTagsSchema,
} from "../services/woo.ts";
import { encodeHex } from "jsr:@std/encoding/hex";
import slugify from "npm:slugify";
import { from, mergeMap } from "rxjs";
import { requireEnv } from "../utils/env.ts";

const { warn } = console;

const encoder = new TextEncoder();

function processInParallel<T, R>(
  items: T[],
  concurrency: number,
  processor: (item: T) => Promise<R>,
) {
  return from(items).pipe(
    mergeMap((item) => from(processor(item)), concurrency),
  );
}

function toCourseCid(courseid: number) {
  return `C${courseid.toString().padStart(3, "0")}`;
}

function toDom(html: string) {
  return new DOMParser().parseFromString(html, "text/html");
}

// function getNodeTextContent(element: Element): string {
//   return Array.from(element.childNodes).filter(
//     (node) => node.nodeType === Node.TEXT_NODE,
//   ).map((node) => node.textContent).join("").trim();
// }

async function syncTag(name: string, slug: string, description: string) {
  const existingTag = await (woo
    .get("products/tags", { slug }) as Promise<unknown>)
    .then((response) =>
      z.object({ data: wooTagsSchema }).parse(response).data[0] || null
    );

  if (existingTag) return existingTag;

  return await (woo
    .post("products/tags", { name, slug, description }) as Promise<
      unknown
    >)
    .then((response) => z.object({ data: wooTagSchema }).parse(response).data);
}

async function syncCategory(name: string, slug: string, description: string) {
  const existingCategory = await (woo
    .get("products/categories", { slug }) as Promise<unknown>)
    .then((response) => {
      return z.object({ data: wooCategoriesSchema }).parse(response).data[0] ||
        null;
    });

  if (existingCategory) return existingCategory;

  return await (woo
    .post("products/categories", { name, slug, description }) as Promise<
      unknown
    >)
    .then((response) =>
      z.object({ data: wooCategorySchema }).parse(response).data
    );
}

async function syncMedia(
  sourceUrl: string,
  name?: string,
  caption?: string,
  description?: string,
): Promise<{ id: number } | null> {
  const apiUrl = requireEnv("WP_URL") + "/wp-json/wp/v2/media";
  const username = requireEnv("WP_USERNAME");
  const password = requireEnv("WP_PASSWORD");

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

  const imageExtension = sourceUrl.split(".").pop();
  if (
    imageExtension &&
    ["jpg", "jpeg", "png", "gif"].includes(imageExtension) === false
  ) {
    console.error(
      `Failed to create media: unsupported image extension ${imageExtension}`,
    );
    return null;
  }

  // https://developer.wordpress.org/rest-api/reference/media/#create-a-media-item
  const formDataEntries = {
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
  formData.append(
    "file",
    await fetch(sourceUrl).then((response) => response.blob()),
    `${imageSlug}.${imageExtension}`,
  );
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
  }
  console.error(
    "Failed to create media:",
    response.status,
    await response.text(),
  );

  return null;
}

interface CourseOutline {
  title: string;
  children?: CourseOutline[];
}

if (import.meta.main) {
  const mooCategories = await moo.api.core.course.getCategories()
    .then(moo.getCategoriesSchema.parse);
  const mooCategoryTree = moo.buildCategoryTree(mooCategories);
  const mooCategoriesByIndex = R.indexBy(R.prop("id"), mooCategories);

  const mooFilteredCategories = mooCategoryTree
    // .filter((cat) => ["Live-Online", "On-Campus"].includes(cat.name))
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

  const mooCourses = await Promise.all(
    mooFilteredCategories.flat().map(async (category) => {
      return await moo.api.core.course.getCoursesByField({
        field: "category",
        value: category,
      })
        .then(moo.getCoursesByFieldSchema.parse)
        .then(({ courses }) => courses);
    }),
  ).then((courses) => courses.flat());

  processInParallel(
    // mooCourses,
    // mooCourses.slice(0, 100),
    mooCourses.filter(({ id }) => id !== 173),
    1,
    async (course) => {
      const courseCid = toCourseCid(course.id);
      console.info(`Syncing course ${courseCid}...`);

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
      const introSection = courseContents.find((c) =>
        c.name === "Introduction"
      );
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
      // const tocSection = courseContents.find((c) =>
      //   c.name === "Table of Contents"
      // );
      // const mandatoryTocModules = ["কোর্স ব্রেকডাউন"];
      // if (tocSection) {
      //   const missingModules = mandatoryTocModules.filter((module) =>
      //     !tocSection.modules.some((m) => m.name === module)
      //   );
      //   if (missingModules.length) {
      //     warn(
      //       `Course ${courseCid}: missing modules in ${tocSection.name} section`,
      //       missingModules,
      //     );
      //   }
      // }

      // ensure mandatory modules are present in Table of Contents section
      const tocSection = courseContents.find((c) =>
        c.name === "Table of Contents"
      );
      // console.log(courseContents);
      // write to file for debugging
      Deno.writeTextFile(
        `./courses/${courseCid}.json`,
        JSON.stringify(courseContents, null, 2),
      );
      const toc = tocSection?.modules.map(({ name, customdata }) => ({
        name,
        modules: courseContents.filter(({ id }) =>
          id === parseInt(
            JSON.parse(customdata)?.sectionid,
            10,
          )
        ).map(({ modules }) => modules.map((m) => m.name)).flat(),
      }));

      // const mandatoryTocModules = ["কোর্স ব্রেকডাউন"];
      // if (tocSection) {
      //   const missingModules = mandatoryTocModules.filter((module) =>
      //     !tocSection.modules.some((m) => m.name === module)
      //   );
      //   if (missingModules.length) {
      //     warn(
      //       `Course ${courseCid}: missing modules in ${tocSection.name} section`,
      //       missingModules,
      //     );
      //   }
      // }

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
        const dom = toDom(description);
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

      const introduction = introSection?.modules.map(toListModule)
        .filter(R.isNotNil);

      // const toTocModule = (module: z.infer<typeof moo.courseModuleSchema>) => {
      //   const { name, description } = module;
      //   if (!description) {
      //     warn(`Course ${courseCid}: missing description in ${name}`);
      //     return;
      //   }
      //   const dom = toDom(description);
      //   // there should be a single div with no-overflow class
      //   const noOverflowDiv = dom.querySelector("body > .no-overflow");
      //   if (!noOverflowDiv) {
      //     warn(`Course ${courseCid}: missing no-overflow div in Introduction`);
      //     return;
      //   }

      //   function buildOutline(
      //     parent: Element,
      //   ): CourseOutline[] | undefined {
      //     const ul = parent.querySelector(":scope > ul");
      //     if (!ul) return;

      //     return Array.from(ul.children).map((li) => {
      //       const title = li.querySelector(":scope > strong")?.innerText ||
      //         getNodeTextContent(li);
      //       const children = buildOutline(li);
      //       return { title, children };
      //     });
      //   }

      //   const outline = buildOutline(noOverflowDiv);

      //   return { ...R.pick(["name"], module), outline };
      // };
      // console.debug(tocSection?.modules);
      // const toc = tocSection?.modules.map(toTocModule).filter(R.isNotNil);

      const canonicalizedCourse = {
        id: course.id,
        cid: courseCid,
        name: course.fullname,
        tagline: toDom(course.summary).querySelector("p")?.innerText,
        summary: introSection?.summary.replace(/[\r\n]/g, ""),
        introduction,
        toc,
      };
      // console.debug(`Course ${courseCid}:`, canonicalizedCourse);

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

      const why_do_this_course = canonicalizedCourse.introduction?.find((m) =>
        m?.name === "এই কোর্সটি কেন করবেন?"
      );
      const learning_outcomes = canonicalizedCourse.introduction?.find((m) =>
        m?.name === "কোর্সটি করে যা শিখবেন"
      );
      const who_is_this_course_for = canonicalizedCourse.introduction?.find(
        (m) => m?.name === "এই কোর্সটি যাদের জন্য",
      );
      const material_include = canonicalizedCourse.introduction?.find((m) =>
        m?.name === "এই কোর্সে আপনি যা যা পাবেন"
      );
      const prerequisite = canonicalizedCourse.introduction?.find((m) =>
        m?.name === "এই কোর্স করতে কি কি লাগবে"
      );

      const mooCategory = mooCategoriesByIndex[course.categoryid];

      const categoryTags = mooCategory.path.split("/")
        .slice(1)
        .map((cat) => parseInt(cat, 10))
        .map((cat) => mooCategoriesByIndex[cat])
        .filter((cat) => R.isNotEmpty(cat.idnumber))
        .map((cat) => ({
          ...cat,
          idnumber: cat.idnumber.replace(":", "-"),
        }))
        .filter((cat) => {
          const [key, value] = cat.idnumber.split("-");
          if (!/^[a-z0-9_]+$/.test(key) || !/^[a-z0-9_]+$/.test(value)) {
            warn(`Course ${courseCid}: invalid idnumber ${cat.idnumber}`);
            return false;
          }
          return true;
        })
        .map((cat) => ({
          [cat.idnumber]: { name: cat.name, description: cat.description },
        }))
        .reduce((acc, val) => ({ ...acc, ...val }), {});
      const tags = await Promise.all(
        Object.entries(categoryTags).map(
          async ([slug, { name, description }]) =>
            await syncTag(name, slug, description),
        ),
      );

      const category = await syncCategory(
        mooCategory.name,
        slugify.default(mooCategory.name),
        mooCategory.description,
      );

      const courseMetaFields = Object.entries({
        course_description: canonicalizedCourse.summary || "",
        "sub-headingtagline": canonicalizedCourse.tagline || "",
        delivery_method: tags.find((tag) =>
          tag.slug.startsWith("delivery_method")
        )?.name || "",
      }).map(([key, value]) => ({ key, value }));

      const courseIntroMetaFields = [
        {
          data: why_do_this_course,
          name: "why_do_this_course",
          key: "benefits_from_this_course_list",
        },
        {
          data: learning_outcomes,
          name: "learning_outcomes",
          key: "learning_outcome_list",
        },
        {
          data: who_is_this_course_for,
          name: "who_is_this_course_for",
          key: "list",
        },
        { data: material_include, name: "material_include", key: "list" },
        { data: prerequisite, name: "prerequisite", key: "list" },
      ].map(({ data, name, key }) =>
        data
          ? data.list.map((item, index) => ({
            key: `${name}_${index}_${key}`,
            value: item,
          })).concat({
            key: name,
            value: data.list.length.toString(),
          })
          : []
      ).flat();

      // const courseOutline = canonicalizedCourse.toc?.find(({ name }) =>
      //   name === "কোর্স ব্রেকডাউন"
      // )?.outline ?? [];
      // const courseOutlineMetaFields = courseOutline.flatMap((module, index) => {
      //   const buildUl = (ul: CourseOutline[]): string => {
      //     return ul.map((li) =>
      //       `<li>${li.title}${
      //         li.children ? `<ul>${buildUl(li.children)}</ul>` : ""
      //       }</li>`
      //     ).join("");
      //   };
      //   const value = `<ul>${buildUl([module])}</ul>`;
      //   return [
      //     {
      //       key: `course_ouline_${index}_module`,
      //       value: module.title,
      //     },
      //     {
      //       key: `course_ouline_${index}_lesson`,
      //       value,
      //     },
      //   ];
      // }).concat({
      //   key: "course_ouline",
      //   value: courseOutline.length.toString(),
      // });

      const courseOutlineMetaFields = canonicalizedCourse.toc?.map(
        ({ name, modules }, index) => {
          const value = `<ul>${
            modules.map((module) => `<li>${module}</li>`).join("")
          }</ul>`;
          return [
            {
              key: `course_ouline_${index}_module`,
              value: name,
            },
            {
              key: `course_ouline_${index}_lesson`,
              value,
            },
          ];
        },
      ).flat().concat({
        key: "course_ouline",
        value: canonicalizedCourse.toc?.length.toString() || "0",
      });

      // console.debug(courseOutlineMetaFields);

      const productFields: Partial<z.infer<typeof wooProductSchema>> = {
        name: canonicalizedCourse.name,
        sku: courseCid,
        images: productimage ? [{ id: productimage.id }] : [],
        tags: tags.map((tag) => ({ id: tag.id })),
        categories: [{ id: category.id }],
        meta_data: courseMetaFields
          .concat(courseIntroMetaFields)
          .concat(courseOutlineMetaFields || []),
      };
      // console.debug(`Course ${courseCid}: product fields`, productFields);
      {
        // lint acf fields of type string
        const issues = await Promise.all(
          productFields.meta_data
            ?.flatMap(({ value, ...rest }) =>
              typeof value === "string" ? [{ ...rest, value }] : []
            )
            .map(async ({ key, value }) => {
              return {
                key,
                issues: await lintText(value, `${courseCid}.html`).catch(
                  (error) => {
                    return { messages: [{ message: error.message }] };
                  },
                ),
              };
            }) ?? [],
        );

        issues.forEach(({ key, issues }) => {
          if (issues.messages.length) {
            warn(
              `Course ${courseCid}: acf field '${key}' issues`,
              issues.messages.map((m) => m.message),
            );
          }
        });
      }

      if (product) {
        Deno.writeTextFile(
          `./products/${courseCid}.json`,
          JSON.stringify(product, null, 2),
        );
        const diff = deepDiff(product, productFields, {
          meta_data: { unique_by: "key" },
          images: { unique_by: "id" },
          tags: { unique_by: "id" },
          categories: { unique_by: "id" },
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
          .then((response: unknown) => {
            return z.object({ data: wooProductSchema })
              .parse(response).data;
          });
        console.info(`Course ${courseCid}: added to WooCommerce`);
      }
    },
  )
    .subscribe({
      error: (error) => {
        console.error("Failed to sync course", error);
      },
      complete: () => {
        console.info("Course sync complete");
      },
    });
}

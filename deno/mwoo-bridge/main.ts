import { moo } from "./services/moo.ts";
import { woo } from "./services/woo.ts";
import { IMoodleCategory } from "npm:@webhare/moodle-webservice";
import {
  mooCourse,
  mooCourseContent,
  wooOrder,
  wooProduct,
  wooProductCategory,
} from "./schema.ts";
import * as R from "https://deno.land/x/rambda@9.4.2/mod.ts";
import z from "npm:zod";
// import { JSDOM } from "npm:jsdom";
import { encodeHex } from "jsr:@std/encoding/hex";
import { DOMParser } from "https://deno.land/x/deno_dom@v0.1.49/deno-dom-wasm.ts";

const encoder = new TextEncoder();

export interface DiffOptions {
  [key: string]: {
    unique_by?: string;
  };
}

function computeDiff(
  leftVal: unknown,
  rightVal: unknown,
  currentKey: string | undefined,
  options: DiffOptions | undefined,
): unknown {
  // Handle arrays
  if (Array.isArray(rightVal)) {
    if (!Array.isArray(leftVal)) {
      // If left is not an array then the whole right array is the diff.
      return rightVal;
    }
    const meta = currentKey && options ? options[currentKey] : undefined;
    if (meta?.unique_by) {
      const uniqueBy = meta.unique_by;
      const leftArray: unknown[] = leftVal;
      const rightArray: unknown[] = rightVal;
      const leftMap = new Map<unknown, unknown>();

      for (const item of leftArray) {
        if (typeof item !== "object" || item === null) {
          throw new Error(
            `Expected object elements in array "${currentKey}" (left).`,
          );
        }
        const objItem = item as Record<string, unknown>;
        const keyValue = objItem[uniqueBy];
        if (keyValue === undefined) {
          throw new Error(
            `unique_by key "${uniqueBy}" not found in an element of left array "${currentKey}".`,
          );
        }
        leftMap.set(keyValue, item);
      }

      const diffArray: unknown[] = [];
      for (const item of rightArray) {
        if (typeof item !== "object" || item === null) {
          throw new Error(
            `Expected object elements in array "${currentKey}" (right).`,
          );
        }
        const objItem = item as Record<string, unknown>;
        const keyValue = objItem[uniqueBy];
        if (keyValue === undefined) {
          throw new Error(
            `unique_by key "${uniqueBy}" not found in an element of right array "${currentKey}".`,
          );
        }
        const leftItem = leftMap.get(keyValue);
        const diffItem = leftItem !== undefined
          ? computeDiff(leftItem, item, currentKey, options)
          : item;
        // If there is any difference (or the element is new) add it to the diff array.
        if (diffItem !== undefined && !R.equals(diffItem, {})) {
          diffArray.push(item);
        }
      }
      return diffArray.length > 0 ? diffArray : undefined;
    } else {
      // If no meta options, compare array elements by index.
      const leftArray: unknown[] = leftVal;
      const rightArray: unknown[] = rightVal;
      if (leftArray.length !== rightArray.length) {
        return rightVal;
      }
      const result: unknown[] = [];
      for (let i = 0; i < rightArray.length; i++) {
        result.push(
          computeDiff(leftArray[i], rightArray[i], currentKey, options),
        );
      }
      if (result.every((el) => el === undefined)) {
        return undefined;
      }
      return result;
    }
  }

  // Handle objects
  if (typeof rightVal === "object" && rightVal !== null) {
    if (typeof leftVal !== "object" || leftVal === null) {
      return rightVal;
    }
    const rightObj = rightVal as Record<string, unknown>;
    const leftObj = leftVal as Record<string, unknown>;
    const diffObj: Record<string, unknown> = {};
    // Only keys present on the right are considered.
    for (const key of Object.keys(rightObj)) {
      const diff = computeDiff(leftObj[key], rightObj[key], key, options);
      if (diff !== undefined) {
        diffObj[key] = diff;
      }
    }
    return Object.keys(diffObj).length > 0 ? diffObj : undefined;
  }

  // Handle primitives and other types.
  if (!R.equals(leftVal, rightVal)) {
    return rightVal;
  }
  return undefined;
}

export function deepDiff<L, R>(
  left: L,
  right: R,
  options?: DiffOptions,
): Record<string, unknown> {
  const diff = computeDiff(left, right, undefined, options);
  return diff === undefined ? {} : (diff as Record<string, unknown>);
}

const syncMedia = async (
  sourceUrl: string,
  name?: string,
  caption?: string,
  description?: string,
): Promise<{ id: number } | undefined> => {
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
  ).then(
    encodeHex,
  ).then(
    (digest) => `moo_${digest}`,
  );

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
  const formData = new FormData();
  formData.append(
    "file",
    await fetch(sourceUrl).then((response) => response.blob()),
    `${imageSlug}.png`,
  );
  formData.append("title", name ?? imageSlug);
  formData.append("slug", imageSlug);
  formData.append("status", "publish");
  formData.append("comment_status", "closed");
  formData.append("ping_status", "closed");
  formData.append("alt_text", name ?? caption ?? "");
  formData.append("caption", caption ?? name ?? "");
  formData.append("description", description ?? "");

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
};

function decodeHtmlEntities(text: string): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(text, "text/html");
  return doc.body.textContent ?? "";
}

function slugify(text: string): string {
  return R.pipe(
    R.toLower,
    R.trim,
    R.replace(/[^a-z0-9\s-]/g, ""),
    R.replace(/\s+/g, "-"),
    R.replace(/-+/g, "-"),
  )(text);
}

// function canonicalizeHTML(html: string): string {
//   const dom = new JSDOM(`<body>${html}</body>`);
//   const bodyContent = dom.window.document.body.innerHTML;

//   const htmlEncode = (text: string): string => {
//     const specialCharsMap = {
//       "-": "&#8211;",
//     } as Record<string, string>;
//     const specialChars = Object.keys(specialCharsMap).join("");
//     const specialCharsRegex = new RegExp(`[${specialChars}]`, "g");
//     const specialCharsReplacer = (match: string) => specialCharsMap[match];
//     return text.replace(specialCharsRegex, specialCharsReplacer);
//   };

//   return decoder.decode(
//     minify(encoder.encode(htmlEncode(bodyContent)), {}),
//   );
// }

type IMoodleCategoryWithChildren = IMoodleCategory & {
  children: IMoodleCategoryWithChildren[];
};

const buildMooCategoryTree = (
  categories: IMoodleCategory[],
  parentId = 0,
): IMoodleCategoryWithChildren[] =>
  categories
    .filter((category) => category.parent === parentId)
    .map((category) => ({
      ...category,
      children: buildMooCategoryTree(categories, category.id),
    }));

if (import.meta.main) {
  const mooCategories = await moo.core.course.getCategories()
    .then(
      buildMooCategoryTree,
    )
    .catch(
      (error: Error) => {
        console.error("failed to get category:", error);
        return [];
      },
    );
  const syncCategores = (
    mooParentCategory: IMoodleCategoryWithChildren | null,
    mooChildCategories: IMoodleCategoryWithChildren[],
  ) => {
    mooChildCategories.forEach(async (child) => {
      const slug = slugify(decodeHtmlEntities(child.name));
      const wooChildCategory = await woo.get("products/categories", {
        slug,
      }).then(
        (response: unknown) => {
          const schema = z.object({
            data: z.array(wooProductCategory),
          });
          return schema.parse(response).data[0] ?? null;
        },
      ).catch(
        (error: Error) => {
          console.error("failed to get category:", error);
          return null;
        },
      );
      const wooParentCategory = mooParentCategory
        ? await woo.get("products/categories", {
          slug: slugify(decodeHtmlEntities(mooParentCategory.name)),
        }).then(
          (response: unknown) => {
            const schema = z.object({
              data: z.array(wooProductCategory),
            });
            return schema.parse(response).data[0] ?? null;
          },
        ).catch(
          (error: Error) => {
            console.error("failed to get parent category:", error);
            return null;
          },
        )
        : null;
      const commonFields = {
        name: child.name,
        description: child.description,
        parent: wooParentCategory?.id ?? 0,
      };
      if (!wooChildCategory) {
        await woo.post("products/categories", {
          ...commonFields,
          slug,
        }).then(
          (_response: unknown) => {
            console.info("created category:", slug);
          },
        ).catch(
          (error: Error) => {
            console.error("failed to create category:", error);
          },
        );
      } else {
        const diff = deepDiff(wooChildCategory, commonFields);
        if (Object.keys(diff).length > 0) {
          console.info("diff:", diff);
          await woo.put(
            `products/categories/${wooChildCategory.id}`,
            commonFields,
          ).catch(
            (error: Error) => {
              console.error("failed to update category:", error);
            },
          );
        }
        console.info("updated category:", slug);
      }
      syncCategores(child, child.children);
    });
  };
  syncCategores(null, mooCategories);

  const { courses, total: totalCourses } = await moo.core.course.searchCourses({
    criterianame: "tagid", // Criteria name (search, modulelist (only admins), blocklist (only admins), tagid).
    criteriavalue: "*",
  }).then(
    (response: unknown) => {
      const schema = z.object({
        total: z.number(),
        courses: z.array(mooCourse),
      });
      return schema.parse(response);
    },
  );
  console.info("total courses found:", totalCourses);
  // get course outline
  // const _mooCourse = await moo.core.course.getContents({
  //   courseid: 66,
  // }).then(
  //   (response: unknown) => {
  //     const schema = z.array(mooCourseContent);
  //     return schema.parse(response);
  //   },
  // ).then(
  //   (response) => {
  //     // console.info("course outline:", response);
  //     // save course outline to file
  //     Deno.writeTextFile(
  //       "course-outline.json",
  //       JSON.stringify(response, null, 2),
  //     );
  //     return response;
  //   },
  // ).catch(
  //   (error: Error) => {
  //     console.error("failed to get course outline:", error);
  //   },
  // );
  // const process_course_content = (
  //   _mooCourse: typeof mooCourseContent[],
  // ): { [key: string]: string | string[] } => {
  //   const nameMap: { [key: string]: string } = {
  //     "কোর্সটি করে যা শিখবেন": "learning_outcomes",
  //     "এই কোর্সটি কেন করবেন?": "why_do_this_course",
  //     "পূর্বশর্ত": "prerequisites",
  //     "মেটেরিয়াল ইনক্লুডস": "includes_material",
  //     "কোর্স সম্পর্কে": "course_description",
  //   };
  //   const mappping = _mooCourse.flatMap((section) => section.modules).filter((
  //     module,
  //   ) =>
  //     module.modname === "label" && Object.keys(nameMap)
  //       .includes(
  //         module.name,
  //       )
  //   ).map((module) => {
  //     // map module name to description
  //     return {
  //       name: nameMap[module.name],
  //       description: module.description,
  //     };
  //   }).reduce((acc, { name, description }) => {
  //     return {
  //       ...acc,
  //       [name]: description,
  //     };
  //   }, {});

  //   const listify = (html: string) => {
  //     const parser = new DOMParser();
  //     const doc = parser.parseFromString(html, "text/html");
  //     const ul = doc.querySelectorAll(".no-overflow > ul");
  //     if (ul.length === 0) return [];
  //     if (ul.length > 1) {
  //       console.warn("multiple top-level ul found in html:", html);
  //       return [];
  //     }
  //     // get html content of each li of the ul (trim and remove empty strings and newlines)
  //     return Array.from(ul[0].children).map((li) =>
  //       li.innerHTML.replace(/\n/g, "").trim()
  //     ).flat();
  //   };
  //   const remove_wrap = (html: string) => {
  //     const parser = new DOMParser();
  //     const doc = parser.parseFromString(html, "text/html");
  //     const wrap = doc.querySelectorAll("div.no-overflow");
  //     if (wrap.length !== 1) {
  //       console.warn("no-overflow div not found in html:", html);
  //       return "";
  //     }
  //     return wrap[0].innerHTML.replace(/\n/g, "").trim();
  //   };
  //   const _mapping = R.evolve({
  //     learning_outcomes: listify,
  //     why_do_this_course: listify,
  //     prerequisites: listify,
  //     includes_material: listify,
  //     course_description: remove_wrap,
  //   }, mappping);
  //   // save mapping to file
  //   Deno.writeTextFile(
  //     "course-mapping.json",
  //     JSON.stringify(_mapping, null, 2),
  //   );
  //   // console.info("mapping:", _mapping);
  //   return _mapping;
  // };

  // get course with C009 sku
  const _wooCourse = await (woo.get("products", {
    sku: "C074",
  }) as Promise<unknown>).then(
    (response: unknown) => {
      const schema = z.object({
        data: z.array(wooProduct),
      });
      return schema.parse(response).data[0];
    },
  ).catch(
    (error: Error) => {
      console.error("failed to get product:", error);
    },
  );
  console.info("product:", _wooCourse);
  // // save _wooCourse to file
  // Deno.writeTextFile(
  //   "product-C066.json",
  //   JSON.stringify(_wooCourse, null, 2),
  // );

  // const courseQueue = courses.slice(50, 51);
  const courseQueue = courses.filter((course) => course.id == 74);
  const concurrency = 10;
  Promise.all(
    Array.from({ length: concurrency }).map(async () => {
      while (courseQueue.length > 0) {
        const course = courseQueue.pop();
        if (!course) break;

        const sku = `C${course.id.toString().padStart(3, "0")}`;
        const product = await (woo.get("products", {
          sku,
        }) as Promise<unknown>).then(
          (response: unknown) => {
            const schema = z.object({
              data: z.array(wooProduct),
            });
            return schema.parse(response).data[0] ?? null;
          },
        ).catch(
          (error: Error) => {
            console.error("failed to get product:", error);
            return null;
          },
        );

        const name = R.trim(course.fullname);
        const image = await syncMedia(
          course.courseimage,
          name,
          course.shortname,
          course.summary,
        );

        const introduction = await (async (courseid: number) => {
          const courseContent = await (moo.core.course.getContents({
            courseid,
          }) as Promise<unknown>).then(
            (response: unknown) => {
              const schema = z.array(mooCourseContent);
              return schema.parse(response);
            },
          ).catch(
            (error: Error) => {
              console.error("failed to get course content:", error);
              return [];
            },
          );

          const modulesNameMap = {
            "কোর্সটি করে যা শিখবেন": "learning_outcomes",
            "এই কোর্সটি কেন করবেন?": "why_do_this_course",
            "পূর্বশর্ত": "prerequisites",
            "মেটেরিয়াল ইনক্লুডস": "material_include",
            "কোর্স সম্পর্কে": "course_description",
          };

          const mappping = courseContent.flatMap((section) => section.modules)
            .filter((module) =>
              module.modname === "label" && Object.keys(modulesNameMap)
                .includes(module.name)
            ).map((module) => {
              return {
                name:
                  modulesNameMap[module.name as keyof typeof modulesNameMap],
                description: module.description,
              };
            }).reduce((acc, { name, description }) => {
              return {
                ...acc,
                [name]: description,
              };
            }, {});

          const listify = (html: string) => {
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, "text/html");
            const ul = doc.querySelectorAll(".no-overflow > ul");
            if (ul.length === 0) return [];
            if (ul.length > 1) {
              console.warn("multiple top-level ul found in html:", html);
              return [];
            }
            return Array.from(ul[0].children).map((li) =>
              li.innerHTML.replace(/\n/g, "").trim()
            ).flat();
          };
          const remove_wrap = (html: string) => {
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, "text/html");
            const wrap = doc.querySelectorAll("div.no-overflow");
            if (wrap.length !== 1) {
              console.warn("no-overflow div not found in html:", html);
              return "";
            }
            return wrap[0].innerHTML.replace(/\n/g, "").trim();
          };

          return R.evolve({
            learning_outcomes: listify,
            why_do_this_course: listify,
            prerequisites: listify,
            material_include: listify,
            course_description: remove_wrap,
          }, mappping);
        })(course.id);
        console.info("intro:", introduction);
        // convert to acf format
        const acf_fields = R.evolve({
          learning_outcomes: (learning_outcomes: string[]) => {
            return [
              {
                key: "learning_outcomes",
                value: `${learning_outcomes.length}`,
              },
              ...learning_outcomes.map((learning_outcome, index) => ({
                key: `learning_outcomes_${index}_learning_outcome_list`,
                value: learning_outcome,
              })),
            ];
          },

          why_do_this_course: (why_do_this_course: string[]) => {
            return [
              {
                key: "why_do_this_course",
                value: `${why_do_this_course.length}`,
              },
              ...why_do_this_course.map((why_do_this_course, index) => ({
                key:
                  `why_do_this_course_${index}_benefits_from_this_course_list`,
                value: why_do_this_course,
              })),
            ];
          },

          prerequisites: (prerequisites: string[]) => {
            return [
              {
                key: "prerequisites",
                value: `${prerequisites.length}`,
              },
              ...prerequisites.map((prerequisite, index) => ({
                key: `prerequisite_${index}_list`,
                value: prerequisite,
              })),
            ];
          },

          material_include: (material_include: string[]) => {
            return [
              {
                key: "material_include",
                value: `${material_include.length}`,
              },
              ...material_include.map((includes_material, index) => ({
                key: `material_include_${index}_list`,
                value: includes_material,
              })),
            ];
          },

          course_description: (course_description: string) => {
            return {
              key: "course_description",
              value: course_description,
            };
          },
        }, introduction);
        console.info("acf_fields:", [
          Object.values(acf_fields).flat(),
        ]);

        const commonFields = {
          name,
          short_description: "",
          // meta_data: [
          // {
          //   key: "course_description",
          //   value: course.summary,
          // },
          // ...Object.entries(acf_fields).map(([key, value]) => ({
          //   key,
          //   value: value,
          // })),
          // ],
          meta_data: Object.values(acf_fields).flat(),
          images: image ? [{ id: image.id }] : undefined,
          categories: await woo.get("products/categories", {
            slug: slugify(decodeHtmlEntities(course.categoryname)),
          }).then(
            (response: unknown) => {
              const schema = z.object({
                data: z.array(z.object({
                  id: z.number(),
                })),
              });
              return schema.parse(response).data;
            },
          ).catch(
            (error: Error) => {
              console.error("failed to get category:", error);
              return [];
            },
          ),
        };
        if (!product) {
          await woo.post("products", {
            ...commonFields,
            type: "simple",
            status: "private",
            virtual: true,
            sold_individually: true,
            sku,
          }).catch((error: Error) => {
            console.error("failed to create product:", error);
          });
          console.debug("created product:", sku);
        } else {
          const diff = deepDiff(product, commonFields, {
            meta_data: { unique_by: "key" },
          });
          if (Object.keys(diff).length > 0) {
            console.info("diff:", diff);
            await woo.put(`products/${product.id}`, commonFields).catch(
              (error: Error) => {
                console.error("failed to update product:", error);
              },
            );
          }

          console.debug("updated product:", sku);
        }
      }
    }),
  );

  const perPage = 1;
  let page = 1;
  let totalOrders = 0;
  do {
    const orders = await (woo.get("orders", {
      status: "processing",
      per_page: perPage,
      page,
    }) as Promise<unknown>).then(
      (response: unknown) => {
        const schema = z.object({
          data: z.array(wooOrder),
        });
        return schema.parse(response);
      },
    ).catch(
      (error: Error) => {
        console.error("failed to get orders:", error);
        return { data: [] };
      },
    );

    // enroll users
    await Promise.all(orders.data.map(async (order) => {
      const user = await moo.core.user.getUsersByField({
        field: "email",
        values: [order.billing.email],
      });
      if (user.length === 0) {
        const user = await moo.core.user.createUsers({
          users: [
            {
              username: order.billing.email,
              email: order.billing.email,
              firstname: order.billing.first_name,
              lastname: order.billing.last_name,
              password: Math.random().toString(36).slice(-8),
            },
          ],
        });
        console.debug("created user:", user);
      }
      const course_ids = order.line_items.map((lineItem) =>
        Number(lineItem.sku.replace("C", ""))
      );
      for (const course_id of course_ids) {
        const course = courses.find((course) => course.id === course_id);
        if (!course) {
          console.error(`course with id ${course_id} not found`);
          return;
        }
        await moo.enrol.manual.enrolUsers({
          enrolments: [
            {
              roleid: 5, // student
              userid: user[0].id,
              courseid: course.id,
            },
          ],
        });
        console.debug("enrolled user:", user[0].id, "in course:", course.id);
        await woo.put(`orders/${order.id}`, {
          status: "completed",
        }).catch((error: Error) => {
          console.error("failed to update order:", error);
        });
      }
    }));

    totalOrders = orders.data.length;
  } while (perPage * page++ <= totalOrders);
}

export { moo, woo };

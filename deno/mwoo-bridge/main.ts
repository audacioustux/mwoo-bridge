import WooCommerceRestApi from "npm:@woocommerce/woocommerce-rest-api";
import { MoodleApi } from "npm:@webhare/moodle-webservice";
import { mooCourse, wooOrder, wooProduct } from "./schema.ts";
import * as R from "npm:ramda";
import z from "npm:zod";
import { JSDOM } from "npm:jsdom";
import { minify } from "npm:@minify-html/wasm";
import { encodeHex } from "jsr:@std/encoding/hex";
import { updatedDiff } from "npm:deep-object-diff";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const woo = new WooCommerceRestApi.default({
  url: "https://beta.jobready.global",
  consumerKey: Deno.env.get("WOO_CONSUMER_KEY"),
  consumerSecret: Deno.env.get("WOO_CONSUMER_SECRET"),
  version: "wc/v3",
});

const moo = MoodleApi({
  baseUrl: "https://learn.jobready.global",
  token: Deno.env.get("MOO_TOKEN"),
});

const syncMedia = async (
  sourceUrl: string,
  name?: string,
  caption?: string,
  description?: string,
): Promise<{ id: number } | undefined> => {
  const apiUrl = "https://beta.jobready.global/wp-json/wp/v2/media";
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

function canonicalizeHTML(html: string): string {
  const dom = new JSDOM(`<body>${html}</body>`);
  const bodyContent = dom.window.document.body.innerHTML;

  const htmlEncode = (text: string): string => {
    const specialCharsMap = {
      "-": "&#8211;",
    } as Record<string, string>;
    const specialChars = Object.keys(specialCharsMap).join("");
    const specialCharsRegex = new RegExp(`[${specialChars}]`, "g");
    const specialCharsReplacer = (match: string) => specialCharsMap[match];
    return text.replace(specialCharsRegex, specialCharsReplacer);
  };

  return decoder.decode(
    minify(encoder.encode(htmlEncode(bodyContent)), {}),
  );
}

if (import.meta.main) {
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

  const courseQueue = courses.slice();
  const concurrency = 10;
  Promise.all(
    Array.from({ length: concurrency }).map(async () => {
      while (courseQueue.length > 0) {
        const course = courseQueue.pop();
        if (!course) break;

        const sku = `MOO_${course.id}`;
        const product = await woo.get("products", {
          sku,
        }).then(
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

        const image = await syncMedia(
          course.courseimage,
          R.trim(course.fullname),
          course.shortname,
          canonicalizeHTML(course.summary),
        );
        const commonFields: Partial<typeof product> = {
          name: R.trim(course.fullname),
          short_description: canonicalizeHTML(course.summary),
          images: image ? [{ id: image.id }] : [],
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
          console.debug("created:", sku);
        } else {
          const transProduct = R.pipe(
            R.evolve({
              short_description: canonicalizeHTML,
            }),
          )(product);
          const updatedFields = updatedDiff(transProduct, commonFields);
          if (Object.keys(updatedFields).length > 0) {
            console.info(
              "updating:",
              updatedFields,
              "previous:",
              R.pick(Object.keys(updatedFields), product),
            );
            await woo.put(`products/${product.id}`, updatedFields).catch(
              (error: Error) => {
                console.error("failed to update product:", error);
              },
            );
          }
          console.debug("updated:", sku);
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
        Number(lineItem.sku.replace("MOO_", ""))
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

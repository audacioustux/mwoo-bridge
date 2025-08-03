import { woo, wooOrder } from "../services/woo.ts";
import * as moo from "../services/moo.ts";
import { z } from "zod";
import * as R from "@rambda/rambda";

if (import.meta.main) {
  const mooCategories = await moo.api.core.course.getCategories()
    .then(moo.getCategoriesSchema.parse);
  const mooCategoryTree = moo.buildCategoryTree(mooCategories);

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
      const user = await moo.api.core.user.getUsersByField({
        field: "email",
        values: [order.billing.email],
      });
      if (user.length === 0) {
        const user = await moo.api.core.user.createUsers({
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
        const course = mooCourses.find((course) => course.id === course_id);
        if (!course) {
          console.error(`course with id ${course_id} not found`);
          return;
        }
        await moo.api.enrol.manual.enrolUsers({
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

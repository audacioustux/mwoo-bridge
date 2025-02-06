import {
  api,
  getCoursesByFieldSchema,
  getCoursesSchema,
  searchCoursesSchema,
} from "./moo.ts";

Deno.test(async function testSearchCourses() {
  await api.core.course
    .searchCourses({
      criterianame: "tagid",
      criteriavalue: "*",
    })
    .then(searchCoursesSchema.parse);
});

Deno.test(async function testGetCourses() {
  await api.core.course.getCourses({})
    .then(getCoursesSchema.parse);
});

Deno.test(async function testGetCoursesByField() {
  await api.core.course.getCoursesByField({
    // @ts-ignore - field can be id/s, shortname, idnumber, category
    field: "id",
    value: 1,
  })
    .then(getCoursesByFieldSchema.parse);
});

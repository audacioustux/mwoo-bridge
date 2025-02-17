import { IMoodleCategory, MoodleApi } from "npm:@webhare/moodle-webservice";
import { z } from "zod";
import { requireEnv } from "../utils/index.ts";

export const api = MoodleApi({
  baseUrl: requireEnv("MOO_URL"),
  token: requireEnv("MOO_TOKEN"),
});

export type CategoryTree = IMoodleCategory & {
  children: CategoryTree[];
};

export const buildCategoryTree = (
  categories: IMoodleCategory[],
  parentId = 0,
): CategoryTree[] =>
  categories
    .filter((category) => category.parent === parentId)
    .map((category) => ({
      ...category,
      children: buildCategoryTree(categories, category.id),
    }));

export const searchCoursesSchema = z.object({
  courses: z.array(z.object({
    id: z.number(),
    fullname: z.string(),
    displayname: z.string(),
    shortname: z.string(),
    courseimage: z.string().url(),
    categoryid: z.number(),
    categoryname: z.string(),
    sortorder: z.number(),
    summary: z.string(),
    summaryformat: z.number(),
    summaryfiles: z.array(z.any()),
    overviewfiles: z.array(
      z.object({
        filename: z.string(),
        filepath: z.string(),
        filesize: z.number(),
        fileurl: z.string().url(),
        timemodified: z.number(),
        mimetype: z.string(),
      }),
    ),
    showactivitydates: z.boolean(),
    showcompletionconditions: z.boolean().nullable(),
    contacts: z.array(z.any()),
    enrollmentmethods: z.array(z.string()),
  })),
  total: z.number(),
});

export const getCoursesSchema = z.array(z.object({
  id: z.number(),
  shortname: z.string(),
  categoryid: z.number(),
  categorysortorder: z.number(),
  fullname: z.string(),
  displayname: z.string(),
  idnumber: z.string(),
  summary: z.string(),
  summaryformat: z.number(),
  format: z.string(),
  showgrades: z.number(),
  newsitems: z.number(),
  startdate: z.number(),
  enddate: z.number(),
  numsections: z.number(),
  maxbytes: z.number(),
  showreports: z.number(),
  visible: z.number(),
  hiddensections: z.number().optional(),
  groupmode: z.number(),
  groupmodeforce: z.number(),
  defaultgroupingid: z.number(),
  timecreated: z.number(),
  timemodified: z.number(),
  enablecompletion: z.number(),
  completionnotify: z.number(),
  lang: z.string(),
  forcetheme: z.string(),
  courseformatoptions: z.array(
    z.object({
      name: z.string(),
      value: z.number(),
    }),
  ),
  showactivitydates: z.boolean(),
  showcompletionconditions: z.boolean().nullable(),
}));

export const getCoursesByFieldSchema = z.object({
  courses: z.array(
    z.object({
      id: z.number(),
      fullname: z.string(),
      displayname: z.string(),
      shortname: z.string(),
      courseimage: z.string(),
      categoryid: z.number(),
      categoryname: z.string(),
      sortorder: z.number(),
      summary: z.string(),
      summaryformat: z.number(),
      summaryfiles: z.array(z.unknown()),
      overviewfiles: z.array(
        z.object({
          filename: z.string(),
          filepath: z.string(),
          filesize: z.number(),
          fileurl: z.string(),
          timemodified: z.number(),
          mimetype: z.string(),
        }),
      ),
      showactivitydates: z.boolean(),
      showcompletionconditions: z.boolean().nullable(),
      contacts: z.array(z.unknown()),
      enrollmentmethods: z.array(z.string()),
      idnumber: z.string(),
      format: z.string(),
      showgrades: z.number(),
      newsitems: z.number(),
      startdate: z.number(),
      enddate: z.number(),
      maxbytes: z.number(),
      showreports: z.number(),
      visible: z.number(),
      groupmode: z.number(),
      groupmodeforce: z.number(),
      defaultgroupingid: z.number(),
      enablecompletion: z.number(),
      completionnotify: z.number(),
      lang: z.string(),
      theme: z.string(),
      marker: z.number(),
      legacyfiles: z.number(),
      calendartype: z.string(),
      timecreated: z.number(),
      timemodified: z.number(),
      requested: z.number(),
      cacherev: z.number(),
      filters: z.array(
        z.object({
          filter: z.string(),
          localstate: z.number(),
          inheritedstate: z.number(),
        }),
      ),
      courseformatoptions: z.optional(z.array(
        z.object({
          name: z.string(),
          value: z.union([z.number(), z.string()]),
        }),
      )),
    }),
  ),
  warnings: z.array(z.unknown()),
});

export const courseModuleSchema = z.object({
  id: z.number(),
  name: z.string(),
  instance: z.number(),
  contextid: z.number(),
  description: z.string().optional(),
  visible: z.number(),
  uservisible: z.boolean(),
  visibleoncoursepage: z.number(),
  modicon: z.string().url(),
  modname: z.string(),
  purpose: z.string(),
  branded: z.boolean(),
  modplural: z.string(),
  availability: z.null(),
  indent: z.number(),
  onclick: z.string(),
  afterlink: z.null(),
  customdata: z.string(),
  noviewlink: z.boolean(),
  completion: z.number(),
  downloadcontent: z.number(),
  dates: z.array(z.unknown()),
  groupmode: z.number(),
  url: z.string().url().optional(),
});

export const getCourseContentsSchema = z.array(z.object({
  id: z.number(),
  name: z.string(),
  visible: z.number(),
  summary: z.string(),
  summaryformat: z.number(),
  section: z.number(),
  hiddenbynumsections: z.number(),
  uservisible: z.boolean(),
  modules: z.array(courseModuleSchema),
}));

export const getCategorySchema = z.object({
  id: z.number(),
  name: z.string(),
  idnumber: z.string(),
  description: z.string(),
  descriptionformat: z.number(),
  parent: z.number(),
  sortorder: z.number(),
  coursecount: z.number(),
  visible: z.number(),
  visibleold: z.number(),
  timemodified: z.number(),
  depth: z.number(),
  path: z.string(),
  theme: z.string(),
});

export const getCategoriesSchema = z.array(getCategorySchema);

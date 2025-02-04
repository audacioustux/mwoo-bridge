import { MoodleApi } from "npm:@webhare/moodle-webservice";

const moo = MoodleApi({
  baseUrl: "https://learn.jobready.global",
  token: Deno.env.get("MOO_TOKEN")!,
});

export { moo };

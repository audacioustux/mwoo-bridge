import WooCommerceRestApi from "npm:@woocommerce/woocommerce-rest-api";
import { requireEnv } from "../utils/index.ts";

const woo = new WooCommerceRestApi.default({
  url: requireEnv("WOO_URL"),
  consumerKey: requireEnv("WOO_CONSUMER_KEY"),
  consumerSecret: requireEnv("WOO_CONSUMER_SECRET"),
  version: "wc/v3",
});

export { woo };

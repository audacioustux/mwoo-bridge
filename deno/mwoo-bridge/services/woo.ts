import WooCommerceRestApi from "npm:@woocommerce/woocommerce-rest-api";

const woo = new WooCommerceRestApi.default({
  url: Deno.env.get("WOO_URL")!,
  consumerKey: Deno.env.get("WOO_CONSUMER_KEY")!,
  consumerSecret: Deno.env.get("WOO_CONSUMER_SECRET")!,
  version: "wc/v3",
});

export { woo };

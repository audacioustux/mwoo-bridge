import WooCommerceRestApi from "npm:@woocommerce/woocommerce-rest-api";
import { requireEnv } from "../utils/index.ts";
import { z } from "zod";

export const woo = new WooCommerceRestApi.default({
  url: requireEnv("WOO_URL"),
  consumerKey: requireEnv("WOO_CONSUMER_KEY"),
  consumerSecret: requireEnv("WOO_CONSUMER_SECRET"),
  version: "wc/v3",
});

export const wooProductSchema = z.object({
  id: z.number(),
  name: z.string(),
  slug: z.string(),
  permalink: z.string(),
  date_created: z.string(),
  date_modified: z.string(),
  type: z.string(),
  status: z.string(),
  featured: z.boolean(),
  catalog_visibility: z.string(),
  description: z.string(),
  short_description: z.string(),
  sku: z.string(),
  price: z.string(),
  regular_price: z.string(),
  sale_price: z.string(),
  date_on_sale_from: z.string().nullable(),
  date_on_sale_to: z.string().nullable(),
  price_html: z.string(),
  on_sale: z.boolean(),
  purchasable: z.boolean(),
  total_sales: z.number(),
  virtual: z.boolean(),
  downloadable: z.boolean(),
  downloads: z.array(z.unknown()),
  download_limit: z.number(),
  download_expiry: z.number(),
  external_url: z.string(),
  button_text: z.string(),
  tax_status: z.string(),
  tax_class: z.string(),
  manage_stock: z.boolean(),
  stock_quantity: z.number().nullable(),
  stock_status: z.string(),
  backorders: z.string(),
  backorders_allowed: z.boolean(),
  backordered: z.boolean(),
  sold_individually: z.boolean(),
  weight: z.string(),
  dimensions: z.unknown(),
  shipping_required: z.boolean(),
  shipping_taxable: z.boolean(),
  shipping_class: z.string(),
  shipping_class_id: z.number(),
  reviews_allowed: z.boolean(),
  average_rating: z.string(),
  rating_count: z.number(),
  related_ids: z.array(z.number()),
  upsell_ids: z.array(z.number()),
  cross_sell_ids: z.array(z.number()),
  parent_id: z.number(),
  purchase_note: z.string(),
  categories: z.array(z.unknown()),
  tags: z.array(z.unknown()),
  images: z.array(z.unknown()),
  attributes: z.array(z.unknown()),
  default_attributes: z.array(z.unknown()),
  variations: z.array(z.unknown()),
  grouped_products: z.array(z.unknown()),
  menu_order: z.number(),
  meta_data: z.array(z.object({
    id: z.optional(z.number()),
    key: z.string(),
    value: z.union([z.string(), z.array(z.unknown())]),
  })),
  _links: z.unknown(),
});

export const wooProductsSchema = z.array(wooProductSchema);

export const wooTagSchema = z.object({
  id: z.number(),
  name: z.string(),
  slug: z.string(),
  description: z.string(),
  count: z.number(),
  _links: z.unknown(),
});

export const wooTagsSchema = z.array(wooTagSchema);

export const wooCategorySchema = z.object({
  id: z.number(),
  name: z.string(),
  slug: z.string(),
  parent: z.number(),
  description: z.string(),
  display: z.string(),
  image: z.unknown(),
  menu_order: z.number(),
  count: z.number(),
  _links: z.unknown(),
});

export const wooCategoriesSchema = z.array(wooCategorySchema);

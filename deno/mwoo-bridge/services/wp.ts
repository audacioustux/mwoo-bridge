import { requireEnv } from "../utils/index.ts";

interface WordpressApiOptions {
  url: string;
  username: string;
  password: string;
  version: string;
}

class WordpressApi {
  private url: string;
  private username: string;
  private password: string;
  private version: string;
  constructor({ url, username, password, version }: WordpressApiOptions) {
    this.url = url;
    this.username = username;
    this.password = password;
    this.version = version;
  }

  async fetch(path: string, options?: RequestInit) {
    const response = await fetch(
      `${this.url}/wp-json/${this.version}/${path}`,
      {
        ...options,
        headers: {
          ...options?.headers,
          Authorization: `Basic ${btoa(`${this.username}:${this.password}`)}`,
        },
      },
    );
    return response.json();
  }
}

const wp = new WordpressApi({
  url: requireEnv("WP_URL"),
  username: requireEnv("WP_USERNAME"),
  password: requireEnv("WP_PASSWORD"),
  version: "wp/v2",
});

export { wp };

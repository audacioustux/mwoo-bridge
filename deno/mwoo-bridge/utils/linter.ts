import { moduleInterop } from "npm:@textlint/module-interop";
import { createLinter } from "npm:textlint";
import { TextlintKernelDescriptor } from "npm:@textlint/kernel";
import markdownProcessor from "npm:@textlint/textlint-plugin-markdown";
import htmlProcessor from "textlint-plugin-html";
import textlineDoubledSpaces from "textlint-rule-doubled-spaces";

const descriptor = new TextlintKernelDescriptor({
  rules: [
    {
      ruleId: "doubled-spaces",
      rule: moduleInterop(textlineDoubledSpaces),
    },
  ],
  plugins: [
    {
      pluginId: "@textlint/markdown",
      plugin: markdownProcessor.default,
      options: {
        extensions: ".md",
      },
    },
    {
      pluginId: "@textlint/html",
      plugin: htmlProcessor,
      options: {
        extensions: ".html",
      },
    },
  ],
  filterRules: [],
});

export const linter = createLinter({ descriptor });

import { assertEquals } from "jsr:@std/assert";
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
    {
      ruleId: "space-around-punctuations",
      rule: (context) => {
        const { Syntax, getSource, report, fixer } = context;
        return {
          [Syntax.Str](node) {
            const text = getSource(node);

            // Check for spaces before ! and ?
            const noSpaceBeforePunctRegex = / +([!?])/g;
            let match;
            while ((match = noSpaceBeforePunctRegex.exec(text))) {
              const index = match.index;
              const spacesLength = match[0].length - 1;
              const punct = match[1];
              report(
                node,
                new context.RuleError(`No space allowed before '${punct}'`, {
                  index: index,
                  fix: fixer.replaceTextRange(
                    [index, index + spacesLength + 1],
                    punct,
                  ),
                }),
              );
            }

            // Check for missing space after comma
            const commaRegex = /,(?!\s)/g;
            while ((match = commaRegex.exec(text))) {
              const index = match.index;
              report(
                node,
                new context.RuleError("Add space after comma", {
                  index: index,
                  fix: fixer.insertTextAfterRange([index, index + 1], " "),
                }),
              );
            }
          },
        };
      },
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

const linter = createLinter({ descriptor });

export const lintText = async (text: string, docName: string) =>
  await linter.lintText(text, docName);
export const fixText = async (text: string, docName: string) =>
  await linter.fixText(text, docName);

Deno.test("lintText should find doubled spaces - .md", async () => {
  const result = await lintText("Hello  world!", "test.md");
  assertEquals(result.messages.length, 1);
});

Deno.test("fixText should find doubled spaces - .html", async () => {
  const result = await fixText("Hello  world!", "test.html");
  assertEquals(result.output, "Hello world!");
});

Deno.test("lintText should find no issue in empty text", async () => {
  const result = await lintText("", "empty.html");
  assertEquals(result.messages.length, 0);
});

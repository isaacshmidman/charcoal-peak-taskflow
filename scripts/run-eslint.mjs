import { ESLint } from "eslint";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

const fix = process.argv.includes("--fix");
const eslint = new ESLint({
  fix,
  overrideConfigFile: "eslint.config.js",
});

const files = execFileSync(
  "git",
  ["ls-files", "src/**/*.js", "src/**/*.jsx", "backend/**/*.js", "backend/*.js"],
  { encoding: "utf8" },
)
  .trim()
  .split("\n")
  .filter(Boolean)
  // git ls-files reports files that are tracked but already deleted from
  // disk, and eslint throws NoFilesFoundError on the first one — so
  // deleting any source file used to break lint until the removal was
  // staged. Skip what isn't there.
  .filter((file) => existsSync(file));

const results = [];
for (const file of files) {
  results.push(...(await eslint.lintFiles([file])));
}

if (fix) {
  await ESLint.outputFixes(results);
}

const errorOnlyResults = results
  .map((result) => ({
    ...result,
    messages: result.messages.filter((message) => message.severity === 2),
    warningCount: 0,
    fixableWarningCount: 0,
  }))
  .filter((result) => result.messages.length > 0);

if (errorOnlyResults.length > 0) {
  const formatter = await eslint.loadFormatter("stylish");
  process.stdout.write(await formatter.format(errorOnlyResults));
}

const errorCount = results.reduce((count, result) => count + result.errorCount, 0);
process.exit(errorCount > 0 ? 1 : 0);

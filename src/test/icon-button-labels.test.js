/* @vitest-environment node */
/**
 * Every button that shows only an icon needs an aria-label — otherwise a
 * screen reader announces it as just "button". This scans the app's JSX
 * and fails on any `button`/`Button` whose visible content is nothing but
 * lucide icons and that has no aria-label (a `title` alone isn't read
 * reliably). Keeps new unlabelled icon buttons from creeping back in.
 */
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const files = execFileSync("git", ["ls-files", "src/**/*.jsx"], { encoding: "utf8" })
  .trim()
  .split("\n")
  .filter((file) => file && !file.includes(".test.") && !file.startsWith("src/components/ui/"));

/** Names imported from lucide-react in a file. */
function lucideImports(source) {
  const names = new Set();
  for (const node of source.statements) {
    if (!ts.isImportDeclaration(node) || !node.moduleSpecifier.getText(source).includes("lucide-react")) continue;
    const bindings = node.importClause?.namedBindings;
    // A plain loop: ts.forEachChild stops at the first truthy callback
    // result, and Set.add returns the set — it would record one icon only.
    if (bindings && ts.isNamedImports(bindings)) for (const spec of bindings.elements) names.add(spec.name.text);
  }
  return names;
}

/** True when a JSX child renders only lucide icons (or nothing). */
function iconOnly(child, icons) {
  if (ts.isJsxText(child)) return child.text.trim() === "";
  if (ts.isJsxSelfClosingElement(child)) return icons.has(child.tagName.getText());
  if (ts.isJsxElement(child)) return icons.has(child.openingElement.tagName.getText());
  if (ts.isJsxExpression(child)) {
    const expr = child.expression;
    if (!expr) return true;
    const check = (e) => {
      if (ts.isParenthesizedExpression(e)) return check(e.expression);
      if (ts.isConditionalExpression(e)) return check(e.whenTrue) && check(e.whenFalse);
      if (ts.isBinaryExpression(e)) return check(e.right); // cond && <Icon/>
      if (ts.isJsxSelfClosingElement(e)) return icons.has(e.tagName.getText());
      if (ts.isJsxElement(e)) return icons.has(e.openingElement.tagName.getText());
      return false; // text, variables, anything else counts as a label
    };
    return check(expr);
  }
  return false;
}

function unlabelledIconButtons(file) {
  const text = readFileSync(file, "utf8");
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
  const icons = lucideImports(source);
  const found = [];
  const visit = (node) => {
    if (ts.isJsxElement(node)) {
      const opening = node.openingElement;
      const tag = opening.tagName.getText();
      if (tag === "button" || tag === "Button") {
        const attrs = new Set(
          opening.attributes.properties.filter(ts.isJsxAttribute).map((a) => a.name.getText())
        );
        const children = node.children;
        const hasIcon = children.some((c) => !ts.isJsxText(c));
        if (hasIcon && children.every((c) => iconOnly(c, icons)) && !attrs.has("aria-label") && !attrs.has("aria-labelledby")) {
          const { line } = source.getLineAndCharacterOfPosition(opening.getStart());
          found.push(`${file}:${line + 1}`);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

describe("icon-only buttons", () => {
  it("all have an aria-label", () => {
    const missing = files.flatMap(unlabelledIconButtons);
    expect(missing).toEqual([]);
  });
});

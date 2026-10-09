"use strict";

/* =========================================================
 *  HTML balance test – ensures index.html has matching opening and
 *  closing <div> tags. The existing UI tests do not verify markup
 *  integrity, and a stray </div> broke keyboard handling in the past.
 *  The test counts opening `<div` occurrences and closing `</div>`
 *  occurrences and asserts they are equal. If a developer adds an
 *  extra closing tag, the test will fail, providing a clear signal.
 * ========================================================= */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

test("html: <div> tags are balanced", () => {
  const htmlPath = join(dirname(fileURLToPath(import.meta.url)), "..", "index.html");
  const html = readFileSync(htmlPath, "utf8");
  const openCount = (html.match(/<div\b/g) || []).length;
  const closeCount = (html.match(/<\/div>/g) || []).length;
  assert.equal(openCount, closeCount,
    `Mismatched <div> tags: ${openCount} opening vs ${closeCount} closing`);
});


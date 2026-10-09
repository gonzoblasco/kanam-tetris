"use strict";

/* =========================================================
 *  Pattern identity tests (ADR-097).
 *
 *  ADR-097 fixes the PRIMARY identification channel of a
 *  tetromino as its MATERIAL pattern (a texture), not its
 *  colour and not its geometric shape. These tests pin the
 *  data contract on the piece model in src/core.js:
 *
 *    1. every tetromino declares a non-empty pattern
 *    2. the seven patterns are mutually distinct
 *    3. a pattern is never a colour (no hex / rgb / hsl)
 *    4. a pattern is flat, serializable data
 *    +  the seven patterns match the canonical material list
 *
 *  Run with: node --test test/
 * ========================================================= */

import test from "node:test";
import assert from "node:assert/strict";

import { PIECES, PIECE_TYPES, PATTERN_NAMES } from "../src/core.js";

// The canonical material list, owner-defined. Order matters: it maps each
// tetromino to its material so a re-shuffle of the mapping is caught.
const CANONICAL_PATTERNS = {
  I: "lumber",
  O: "cobble",
  T: "brick",
  S: "silk",
  Z: "sand",
  J: "water",
  L: "metal",
};

/* =========================================================
 *  1. every tetromino has a non-empty pattern
 * ========================================================= */

test("patterns: all seven tetrominoes declare a non-empty pattern", () => {
  assert.equal(PIECE_TYPES.length, 7, "there must be exactly seven tetrominoes");
  for (const type of PIECE_TYPES) {
    const pattern = PIECES[type].pattern;
    assert.equal(typeof pattern, "string", `${type}.pattern must be a string`);
    assert.ok(pattern.trim().length > 0, `${type}.pattern must not be empty`);
  }
});

/* =========================================================
 *  2. the seven patterns are mutually distinct
 * ========================================================= */

test("patterns: the seven patterns are mutually distinct", () => {
  const seen = new Map(); // pattern -> type that claimed it
  for (const type of PIECE_TYPES) {
    const pattern = PIECES[type].pattern;
    assert.ok(
      !seen.has(pattern),
      `duplicate pattern "${pattern}" shared by ${seen.get(pattern)} and ${type}`,
    );
    seen.set(pattern, type);
  }
  assert.equal(seen.size, 7, "there must be seven distinct patterns");
});

/* =========================================================
 *  3. a pattern is never a colour
 * ========================================================= */

test("patterns: a pattern is not a colour value (no hex, rgb or hsl)", () => {
  // Hex colour: #rgb, #rgba, #rrggbb, #rrggbbaa.
  const hex = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
  // Functional colour notations, tolerant of inner whitespace.
  const rgb = /^rgba?\(\s*[\d.]+[\s,]+[\d.]+[\s,]+[\d.]+/i;
  const hsl = /^hsla?\(\s*[\d.]+[\s,]+[\d.]+%?[\s,]+[\d.]+%?/i;

  for (const type of PIECE_TYPES) {
    const pattern = PIECES[type].pattern;
    assert.ok(!hex.test(pattern), `${type}.pattern "${pattern}" looks like a hex colour`);
    assert.ok(!rgb.test(pattern), `${type}.pattern "${pattern}" looks like rgb()/rgba()`);
    assert.ok(!hsl.test(pattern), `${type}.pattern "${pattern}" looks like hsl()/hsla()`);
  }
});

/* =========================================================
 *  4. a pattern is flat, serializable data
 * ========================================================= */

test("patterns: the model is flat, serializable and survives JSON round-trip", () => {
  let json;
  assert.doesNotThrow(() => {
    json = JSON.stringify(PIECES);
  }, "JSON.stringify(PIECES) must not throw");

  const parsed = JSON.parse(json);
  for (const type of PIECE_TYPES) {
    assert.equal(
      parsed[type].pattern,
      PIECES[type].pattern,
      `${type}.pattern must survive a JSON round-trip`,
    );
    // Flat: a primitive, not an object/array that could smuggle in a canvas
    // handle or other non-serializable state.
    assert.equal(
      typeof PIECES[type].pattern,
      "string",
      `${type}.pattern must be a flat primitive string`,
    );
  }

  // PATTERN_NAMES is the renderer-facing flat projection and must agree.
  for (const type of PIECE_TYPES) {
    assert.equal(PATTERN_NAMES[type], PIECES[type].pattern, `${type} PATTERN_NAMES mismatch`);
  }
});

/* =========================================================
 *  +  the seven patterns match the canonical material list
 * ========================================================= */

test("patterns: each tetromino matches its canonical material exactly", () => {
  assert.deepEqual(
    PATTERN_NAMES,
    CANONICAL_PATTERNS,
    "the pattern-to-material mapping must match the owner's canonical list",
  );
});

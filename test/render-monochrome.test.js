"use strict";

/* =========================================================
 *  U2 - Monochrome render invariants (node:test, zero deps).
 *  Run with: node --test test/
 *
 *  Golden rule (owner, non-negotiable): a piece is identified by
 *  its MATERIAL PATTERN, never by colour, never by brightness.
 *  Tone is purely decorative. These tests defend that rule on the
 *  render path: no piece colour may reach a fillStyle/strokeStyle.
 *
 *  Strategy: a recording 2D context that captures every colour
 *  string handed to the painter. We drive the real renderer and
 *  assert (a) none of the 7 live piece hues is ever used as a
 *  paint colour, (b) every painted colour is one of the 4 GB
 *  tones (strict monochrome, ADR-097: zero white, zero purple),
 *  and (c) the render.js source contains no hex literal outside
 *  the GB palette at all.
 * ========================================================= */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { PIECES, PIECE_TYPES, PATTERN_NAMES, COLS, ROWS } from "../src/core.js";
import { createRenderer, CELL } from "../src/render.js";
import { emptyBoardString, boardFromString } from "./harness.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const RENDER_SRC = readFileSync(join(HERE, "..", "src", "render.js"), "utf8");

// The 4 Game Boy DMG tones, in hex and rgb triples.
const PALETTE_HEX = ["#0f380f", "#306230", "#8bac0f", "#9bbc0f"];
const PALETTE_RGB = PALETTE_HEX.map((h) => {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
});

// Strict monochrome (ADR-097): the ONLY colours permitted on the render path
// are the 4 GB tones. White floor dots, the line-clear flash and the T-spin
// announcement chrome are all GB tones now - no white, no purple. Feedback for
// the special events is carried by intensity/width/blink, never by hue.
const UI_CHROME = []; // no non-GB chrome colours remain

// A 2D context that records every colour ever assigned to a paint style.
function makeRecordingCtx() {
  const paints = []; // every string handed to fillStyle/strokeStyle/shadowColor
  const calls = [];
  function record(v) {
    if (typeof v === "string" && v.length > 0) paints.push(v);
    return v;
  }
  let fillStyle = "";
  let strokeStyle = "";
  let shadowColor = "";
  const ctx = {
    paints,
    calls,
    get fillStyle() { return fillStyle; },
    set fillStyle(v) { fillStyle = record(v); },
    get strokeStyle() { return strokeStyle; },
    set strokeStyle(v) { strokeStyle = record(v); },
    get shadowColor() { return shadowColor; },
    set shadowColor(v) { shadowColor = record(v); },
    lineWidth: 1,
    globalAlpha: 1,
    shadowBlur: 0,
    font: "",
    textAlign: "",
    textBaseline: "",
    setLineDash() {},
    clearRect() {},
    createLinearGradient() { return { addColorStop() {} }; },
    fillRect() { calls.push("fillRect"); },
    strokeRect() { calls.push("strokeRect"); },
    beginPath() {},
    arc() { calls.push("arc"); },
    fill() {},
    stroke() {},
    moveTo() {},
    lineTo() {},
    save() {},
    restore() {},
    translate() {},
    fillText() { calls.push("fillText"); },
  };
  return ctx;
}

function fakeCanvas(w, h, ctx) {
  return { width: w, height: h, getContext: () => ctx };
}

// Turn any recorded colour string into an rgb triple, or null if it does
// not carry colour (e.g. it is not a hex/rgb string we model).
function rgbOf(str) {
  const s = String(str).trim().toLowerCase();
  let m = /^#([0-9a-f]{6})$/.exec(s);
  if (m) {
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  m = /^#([0-9a-f]{3})$/.exec(s);
  if (m) {
    const c = m[1];
    return [parseInt(c[0] + c[0], 16), parseInt(c[1] + c[1], 16), parseInt(c[2] + c[2], 16)];
  }
  m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(s);
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
  return null;
}

function sameRgb(a, b) {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}

// Build a renderer whose canvases all share one recording context per panel.
function makeRenderer() {
  const ctxs = {
    board: makeRecordingCtx(),
    next: makeRecordingCtx(),
    hold: makeRecordingCtx(),
    queue: makeRecordingCtx(),
  };
  const renderer = createRenderer({
    canvas: fakeCanvas(COLS * CELL, ROWS * CELL, ctxs.board),
    nextCanvas: fakeCanvas(80, 60, ctxs.next),
    holdCanvas: fakeCanvas(80, 60, ctxs.hold),
    queueCanvas: fakeCanvas(60, 104, ctxs.queue),
  });
  return { renderer, ctxs };
}

// A state that exercises every drawing path: settled cells of every type,
// the active piece, its ghost, and the previews.
function richState() {
  const board = boardFromString(emptyBoardString());
  // One settled cell of each piece colour on the bottom rows.
  PIECE_TYPES.forEach((type, i) => {
    board[ROWS - 1][i] = PIECES[type].color;
  });
  return {
    board,
    current: {
      type: "T",
      matrix: PIECES.T.matrix.map((r) => r.slice()),
      color: PIECES.T.color,
      x: 3,
      y: 2,
      rot: 0,
    },
    nextType: "S",
    holdType: "Z",
    holdUsed: false,
    queue: ["I", "O", "T", "S", "Z"],
    clearing: null,
    gameOver: false,
    lockTimer: 0,
    announce: null,
  };
}

test("render: no live piece hue is ever used as a paint colour (incl. unknown faces)", () => {
  const { renderer, ctxs } = makeRenderer();
  const state = richState();
  // An UNKNOWN face on the board: a cell colour that is not a piece colour.
  // This is exactly the path the old colour fallback used to paint raw.
  state.board[ROWS - 2][0] = "#ff00ff";
  renderer.draw(state);
  // Force the lock glow path (grounded piece) so shadowColor is exercised too.
  state.lockTimer = 200;
  state.current.y = ROWS - 3;
  renderer.draw(state);

  const all = [...ctxs.board.paints, ...ctxs.next.paints, ...ctxs.hold.paints, ...ctxs.queue.paints];
  assert.ok(all.length > 0, "the renderer must paint something; empty output hides the check");

  const pieceRgbs = PIECE_TYPES.map((t) => rgbOf(PIECES[t].color));
  for (const paint of all) {
    const rgb = rgbOf(paint);
    if (!rgb) continue;
    for (let i = 0; i < PIECE_TYPES.length; i++) {
      assert.ok(
        !sameRgb(rgb, pieceRgbs[i]),
        `render painted with piece colour ${PIECES[PIECE_TYPES[i]].color} ` +
          `(${PIECE_TYPES[i]}) via "${paint}" - colour is never an identity channel`,
      );
    }
    // An unknown face must not be painted with its own raw colour either.
    assert.ok(
      !sameRgb(rgb, rgbOf("#ff00ff")),
      `an unknown board face leaked its raw colour via "${paint}" - no colour path may exist`,
    );
  }
});

test("render: every painted colour is a GB tone or a non-identity UI chrome colour", () => {
  const { renderer, ctxs } = makeRenderer();
  const state = richState();
  renderer.draw(state);
  // Exercise the clear flash and the T-spin announcement chrome too.
  state.clearing = { rows: [ROWS - 1], timer: 100 };
  state.pendingTSpin = { tspin: "full" };
  state.announce = { text: "T-SPIN", at: Date.now() };
  renderer.draw(state);

  const all = [...ctxs.board.paints, ...ctxs.next.paints, ...ctxs.hold.paints, ...ctxs.queue.paints];
  for (const paint of all) {
    const rgb = rgbOf(paint);
    if (!rgb) continue;
    const isTone = PALETTE_RGB.some((p) => sameRgb(p, rgb));
    assert.ok(
      isTone,
      `unexpected paint colour "${paint}" (rgb ${rgb.join(",")}) - ` +
        `strict monochrome: only the 4 GB tones ${PALETTE_HEX.join(", ")} are allowed`,
    );
  }
});

test("render.js: no source line paints with a raw piece-colour variable", () => {
  // Static guard: the old fallback did `ctx.fillStyle = colour`. Neither the
  // raw `colour`/`p.color`/`cur.color` nor a 7-hue literal may be assigned to
  // a paint style. This catches a regression a runtime path might miss.
  const offenders = RENDER_SRC.split("\n")
    .map((line, i) => [line.trim(), i + 1])
    .filter(([line]) => /\.(fillStyle|strokeStyle|shadowColor)\s*=/.test(line))
    .filter(([line]) =>
      /=\s*(colour|color|cur\.color|p\.color|piece\.color)\b/.test(line),
    );
  assert.deepEqual(
    offenders,
    [],
    `paint assignments that use a raw colour variable: ${JSON.stringify(offenders)}`,
  );

  // And no hex literal outside the GB palette. Strict monochrome (ADR-097):
  // the source file must reference ONLY the 4 GB tones, nothing else.
  const hueLiterals = RENDER_SRC.match(/#[0-9a-fA-F]{3,8}\b/g) || [];
  const allowed = new Set(PALETTE_HEX);
  const stray = hueLiterals.filter((h) => !allowed.has(h.toLowerCase()));
  assert.deepEqual(
    stray,
    [],
    `stray hex colour literals outside the GB palette: ${JSON.stringify(stray)}`,
  );
});

test("render.js: the ONLY colours in the file are the 4 GB tones (strict monochrome)", () => {
  // ADR-097, non-negotiable: a full-file scan. Every hex literal must be one
  // of the 4 GB tones, and no raw rgb()/rgba() triple may name a non-GB colour
  // (the rgba() helper takes a hex tone, so the only allowed numeric triple is
  // one that came from a palette tone). This is the guard the owner asked for.
  const hexes = (RENDER_SRC.match(/#[0-9a-fA-F]{3,8}\b/g) || []).map((h) => h.toLowerCase());
  const allowed = new Set(PALETTE_HEX);
  const strayHex = [...new Set(hexes.filter((h) => !allowed.has(h)))];
  assert.deepEqual(
    strayHex,
    [],
    `render.js contains hex colours outside the GB palette: ${JSON.stringify(strayHex)}`,
  );

  // No inlined rgba(r,g,b,...) numeric literals that bypass the rgba(hex,...)
  // helper - those would be an untraceable colour. r/g/b must never be
  // hard-coded digits; the renderer builds colour strings from tones only.
  const rawTriples = RENDER_SRC.match(/rgba?\(\s*\d/g) || [];
  assert.deepEqual(
    rawTriples,
    [],
    `render.js inlines raw rgb() numbers instead of using the GB-tone helper: ${JSON.stringify(rawTriples)}`,
  );

  // And every palette tone must actually be present (a guard against the file
  // silently losing a tone, e.g. an over-eager find/replace).
  for (const tone of PALETTE_HEX) {
    assert.ok(RENDER_SRC.includes(tone), `render.js no longer references GB tone ${tone}`);
  }
});

test("render: all 7 material stamping functions exist", () => {
  const fns = ["drawLumber", "drawCobble", "drawBrick", "drawSilk", "drawSand", "drawWater", "drawMetal"];
  for (const fn of fns) {
    const re = new RegExp(`function\\s+${fn}\\s*\\(`);
    assert.ok(re.test(RENDER_SRC), `missing material stamping function ${fn}`);
  }
  // Each material stamped by the model must have a case in drawPattern().
  const patterns = Object.values(PATTERN_NAMES);
  assert.equal(new Set(patterns).size, 7, "the 7 materials must be distinct");
  for (const name of patterns) {
    assert.ok(
      new RegExp(`case\\s+"${name}"`).test(RENDER_SRC),
      `drawPattern() has no case for material "${name}"`,
    );
  }
});

test("accessibility: two pieces sharing a tone still get DIFFERENT patterns", () => {
  // The core already guarantees 7 distinct patterns. Here we prove the
  // renderer preserves that: the tone map is cyclic (TONE_BY_TYPE lives in
  // render.js), so same-tone pairs MUST exist and MUST map to distinct
  // materials. If this ever collapses, tone would start carrying identity.
  const TONE_BY_TYPE = {
    I: 0, O: 1, T: 2, S: 3, Z: 0, J: 1, L: 2,
  };
  const patterns = new Set(PIECE_TYPES.map((t) => PIECES[t].pattern));
  assert.equal(patterns.size, 7, "the 7 piece patterns must be pairwise distinct");

  // Group types by their render tone.
  const byTone = new Map();
  for (const t of PIECE_TYPES) {
    const tone = TONE_BY_TYPE[t];
    (byTone.get(tone) || byTone.set(tone, []).get(tone)).push(t);
  }
  const pairs = [...byTone.values()].filter((g) => g.length > 1);
  assert.ok(pairs.length > 0, "the tone map must be cyclic: some tone is reused");

  for (const group of pairs) {
    const mats = new Set(group.map((t) => PIECES[t].pattern));
    assert.equal(
      mats.size,
      group.length,
      `tone shared by ${group.join(",")} must still map to distinct materials, got ${[...mats].join(",")}`,
    );
  }

  // And the renderer really consults the pattern for each type: the source
  // map from type to tone must cover all 7 types.
  const toneKeys = (RENDER_SRC.match(/TONE_BY_TYPE\s*=\s*\{([\s\S]*?)\}/) || [])[1] || "";
  for (const t of PIECE_TYPES) {
    assert.ok(new RegExp(`\\b${t}\\s*:`).test(toneKeys), `TONE_BY_TYPE has no entry for ${t}`);
  }
});

test("render.js: no Math.random - material stamping is deterministic", () => {
  // A MATERIAL must be STABLE: the same cell always stamps the SAME texture.
  // Math.random() made the sand (piece Z) texture change every frame - TV
  // static. The stamping must be a pure function of the cell, never of a
  // global RNG. This is a static guard on the source file.
  assert.ok(
    !RENDER_SRC.includes("Math.random"),
    "render.js must not use Math.random: material textures must be stable frame to frame",
  );
});

test("render.js: the draw path does not read the wall clock (Date.now is not called inline)", () => {
  // The render must be PURE: it receives the time, it never reads the clock.
  // The injected `now` clock default may still reference Date.now (backward
  // compat), but no call site inside the drawing code may call Date.now()
  // directly. We assert no `Date.now(` CALL remains in the source; a bare
  // reference as a default parameter value is fine.
  const callSites = RENDER_SRC.match(/Date\.now\s*\(/g) || [];
  assert.deepEqual(
    callSites,
    [],
    "render.js calls Date.now() in the render path; the clock must be injected via `now`",
  );
});

test("drawSand: the sand stamping is deterministic across frames", () => {
  // Drive the real renderer twice with the same sand cell and prove the
  // recorded fillRect coordinates are byte-identical: a settled grain, not
  // flicker. Uses the recording context from the monochrome suite.
  const { renderer, ctxs } = makeRenderer();
  const state = richState();
  state.board[ROWS - 1][0] = PIECES.Z.color; // Z is the sand material
  state.current = null;

  // Capture the ordered fillRect argument tuples for the sand cell only.
  const rects = [];
  const rawCtx = makeRecordingCtx();
  const spyFillRect = (x, y, w, h) => rects.push([x, y, w, h]);
  rawCtx.fillRect = spyFillRect;

  const pass = createRenderer({
    canvas: fakeCanvas(COLS * CELL, ROWS * CELL, rawCtx),
    nextCanvas: fakeCanvas(80, 60, makeRecordingCtx()),
    holdCanvas: fakeCanvas(80, 60, makeRecordingCtx()),
    queueCanvas: fakeCanvas(60, 104, makeRecordingCtx()),
  });

  pass.draw(state);
  const first = rects.slice();
  rects.length = 0;
  pass.draw(state);
  const second = rects.slice();

  assert.ok(first.length > 0, "the sand cell must stamp something; empty output hides the check");
  assert.deepEqual(
    first,
    second,
    "drawSand produced different dots on consecutive frames - the texture is not stable",
  );
  void renderer;
  void ctxs;
});

test("ghost and particles do not depend on the piece colour", () => {
  const { renderer, ctxs } = makeRenderer();
  const state = richState();
  // A piece grounded in open space draws its ghost; particles come from effects.
  state.current.y = 4;
  state.effects = null;

  const effects = {
    state: {
      shakeX: 0,
      shakeY: 0,
      // A particle carries a bright non-GB colour; the renderer must ignore it.
      particles: [
        { x: 15, y: 15, vx: 0, vy: 0, life: 10, maxLife: 20, color: "#f87171", size: 6 },
      ],
    },
  };
  const { renderer: r2, ctxs: c2 } = makeRenderer();
  // Rebuild with effects wired in.
  const withFx = createRenderer({
    canvas: fakeCanvas(COLS * CELL, ROWS * CELL, c2.board),
    nextCanvas: fakeCanvas(80, 60, c2.next),
    holdCanvas: fakeCanvas(80, 60, c2.hold),
    queueCanvas: fakeCanvas(60, 104, c2.queue),
    effects,
  });
  withFx.draw(state);

  const painted = [...c2.board.paints];
  assert.ok(painted.length > 0, "the board must paint; empty output hides the check");
  const particleHue = rgbOf("#f87171");
  for (const paint of painted) {
    const rgb = rgbOf(paint);
    if (!rgb) continue;
    assert.ok(
      !sameRgb(rgb, particleHue),
      `the particle's own colour leaked to the renderer via "${paint}"`,
    );
  }

  // The ghost uses a GB tone: at least one painted colour is a palette tone.
  const usesTone = painted.some((p) => {
    const rgb = rgbOf(p);
    return rgb && PALETTE_RGB.some((t) => sameRgb(t, rgb));
  });
  assert.ok(usesTone, "the ghost/board path must paint with a GB tone");
  void renderer;
  void ctxs;
});

"use strict";

/* =========================================================
 *  Input wiring tests - node:test, zero dependencies.
 *  Run with: node --test test/
 *
 *  These do not touch the rules (core.test.js owns those).
 *  They pin the browser wiring that the core cannot see: which
 *  element each listener is attached to.
 * ========================================================= */

import test from "node:test";
import assert from "node:assert/strict";

import { attachInput } from "../src/input.js";
import { makeGame } from "./harness.js";

// Minimal EventTarget double: records listeners per type and can fire them.
// `fire` passes a keydown-shaped event, which is all onKeyDown/onBlur read.
function fakeTarget() {
  const listeners = {};
  return {
    listeners,
    addEventListener(t, fn) { (listeners[t] ||= []).push(fn); },
    removeEventListener(t, fn) { listeners[t] = (listeners[t] || []).filter(f => f !== fn); },
    fire(t) { for (const fn of (listeners[t] || [])) fn({ key: "", preventDefault() {} }); },
  };
}

/* =========================================================
 *  Regression: blur must be registered on window, not document.
 *
 *  blur does not bubble. In v0.2 the handler was registered with
 *  window.addEventListener("blur", clearMoveState); the refactor moved
 *  it to document, where a window focus loss never fires. Result: a held
 *  arrow kept its DAS running after Cmd+Tab and the piece slid on return.
 * ========================================================= */
test("blur is registered on blurTarget, never on target", () => {
  const game = makeGame();
  const target = fakeTarget();
  const blurTarget = fakeTarget();

  attachInput({ game, target, blurTarget });

  assert.equal((target.listeners.blur || []).length, 0,
    "blur must NOT be attached to the document target (it never fires there)");
  assert.equal((blurTarget.listeners.blur || []).length, 1,
    "blur must be attached to the blur target (window)");

  // The key listeners stay on `target`, exactly like v0.2's document.
  assert.equal((target.listeners.keydown || []).length, 1);
  assert.equal((target.listeners.keyup || []).length, 1);
});

test("regression: losing focus while a direction is held stops the DAS", () => {
  const game = makeGame();
  const target = fakeTarget();
  const blurTarget = fakeTarget();

  attachInput({ game, target, blurTarget });

  // Hold left: the DAS is now running.
  game.pressMove(-1);
  assert.equal(game.state.moveDir, -1, "precondition: left is held");

  // Window loses focus (Cmd+Tab) without a keyup ever arriving.
  blurTarget.fire("blur");

  assert.equal(game.state.moveDir, 0,
    "blur must clear the held direction, otherwise the piece slides on return");
});

test("cleanup detaches blur from blurTarget as well", () => {
  const game = makeGame();
  const target = fakeTarget();
  const blurTarget = fakeTarget();

  const detach = attachInput({ game, target, blurTarget });
  detach();

  assert.equal((target.listeners.keydown || []).length, 0);
  assert.equal((target.listeners.keyup || []).length, 0);
  assert.equal((blurTarget.listeners.blur || []).length, 0);
});

test("no blurTarget and no browser: attachInput still wires up without throwing", () => {
  // Node has no `window`; the module-level code must not reference it and
  // the fallback must degrade to "no blur listener" instead of crashing.
  assert.equal(typeof window, "undefined", "precondition: this suite runs in Node");

  const game = makeGame();
  const target = fakeTarget();

  const detach = attachInput({ game, target });

  assert.equal((target.listeners.keydown || []).length, 1);
  assert.equal((target.listeners.keyup || []).length, 1);
  assert.equal((target.listeners.blur || []).length, 0,
    "the fallback must not silently reintroduce the document-level blur");

  detach(); // must not throw with win === null
});

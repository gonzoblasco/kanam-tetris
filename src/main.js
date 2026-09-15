"use strict";

/* =========================================================
 *  Boot: wires core + render + input + storage together.
 *
 *  The loop owns the clock: it computes the delta, clamps it,
 *  feeds it to core.step(), then redraws. The core never reads
 *  a clock.
 * ========================================================= */

import { createGame } from "./core.js";
import { createRenderer } from "./render.js";
import { attachInput } from "./input.js";
import { loadHighScore, saveHighScore } from "./storage.js";

// ---------- DOM ----------
const canvas = document.getElementById("board");
const nextCanvas = document.getElementById("next");
const holdCanvas = document.getElementById("hold");
const queueCanvas = document.getElementById("queue");
const overlay = document.getElementById("overlay");
const overlayTitle = document.getElementById("overlay-title");
const overlaySub = document.getElementById("overlay-sub");
const restartBtn = document.getElementById("restart");
const hiscoreEl = document.getElementById("hiscore");
const scoreEl = document.getElementById("score");
const levelEl = document.getElementById("level");
const linesEl = document.getElementById("lines");
const comboEl = document.getElementById("combo");
const b2bEl = document.getElementById("b2b");

const renderer = createRenderer({ canvas, nextCanvas, holdCanvas, queueCanvas });

// ---------- HUD & overlay ----------
function updateHUD(state) {
  scoreEl.textContent = state.score;
  levelEl.textContent = state.level;
  linesEl.textContent = state.lines;
  hiscoreEl.textContent = state.highScore;

  // Combo is only shown while a chain is alive (combo >= 1).
  if (state.combo >= 1) {
    comboEl.textContent = `x${state.combo + 1} combo`;
    comboEl.classList.add("visible");
  } else {
    comboEl.classList.remove("visible");
  }

  b2bEl.classList.toggle("visible", state.b2b === true);
}

// `subtitle` may be "" to hide the line; `withButton` toggles the restart
// button (hidden while paused, since P/Esc resumes).
function showOverlay(title, subtitle, withButton) {
  overlayTitle.textContent = title;
  overlaySub.textContent = subtitle;
  overlaySub.style.display = subtitle ? "block" : "none";
  restartBtn.style.display = withButton ? "inline-block" : "none";
  overlay.classList.add("visible");
}

function hideOverlay() {
  overlay.classList.remove("visible");
}

// ---------- Game ----------
// Exported so the DOM tests can drive a real game (see test/dom.test.js):
// the game-over and queue bugs both lived in this file's wiring, invisible to
// the core suite. Exporting costs nothing in the browser.
export const game = createGame();

// Event hook: the core announces the end through `gameover`; the UI listens
// instead of diffing frames, because a lock can end the game BETWEEN frames
// (hardDrop runs synchronously in the keydown handler, outside step()).
// A frame diff misses that transition entirely - Gonzo hit exactly that:
// topping out by hard drop never showed the game over overlay.
game.on((type, payload) => {
  if (type === "gameover") { endGameUI(); return; }
  if (type !== "clear" || !payload.tspin) return;
  const label = payload.type === "tspin_full" ? "T-SPIN" : "T-SPIN MINI";
  game.state.announce = { text: label, at: performance.now() };
});

// The stored record is loaded once; the core owns the live value and the
// write happens only when a game ends.
game.state.highScore = loadHighScore();
hiscoreEl.textContent = game.state.highScore;

function endGameUI() {
  saveHighScore(game.state.highScore); // the only write to storage
  const subtitle = game.state.recordBeaten
    ? `¡Nuevo récord! ${game.state.highScore}`
    : `Récord: ${game.state.highScore}`;
  showOverlay("Fin del juego", subtitle, true);
}

attachInput({
  game,
  target: document,
  // blur does not bubble, so it never reaches document; v0.2 listened on window.
  blurTarget: window,
  onGameOver(active) {
    if (!active) hideOverlay();
  },
  onPauseChange(paused) {
    if (paused) {
      showOverlay("Pausa", "Pulsa P o Escape para continuar", false);
    } else {
      hideOverlay();
      lastTime = performance.now(); // avoid a huge delta on the first frame back
    }
  },
});

restartBtn.addEventListener("click", () => {
  game.reset();
  game.state.announce = null;
  hideOverlay();
  restartBtn.blur();
});

// ---------- Main loop ----------
let lastTime = performance.now();

function update(time = 0) {
  // Clamp so a backgrounded tab or a long frame can't fast-forward the
  // lock delay or the clear flash.
  const delta = Math.max(0, Math.min(time - lastTime, 100));
  lastTime = time;

  game.step(delta);

  const state = game.state;
  updateHUD(state);

  renderer.draw(state);
  requestAnimationFrame(update);
}

renderer.draw(game.state);
requestAnimationFrame(update);

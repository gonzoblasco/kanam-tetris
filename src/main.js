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
const overlay = document.getElementById("overlay");
const overlayTitle = document.getElementById("overlay-title");
const overlaySub = document.getElementById("overlay-sub");
const restartBtn = document.getElementById("restart");
const hiscoreEl = document.getElementById("hiscore");
const scoreEl = document.getElementById("score");
const levelEl = document.getElementById("level");
const linesEl = document.getElementById("lines");

const renderer = createRenderer({ canvas, nextCanvas, holdCanvas });

// ---------- HUD & overlay ----------
function updateHUD(state) {
  scoreEl.textContent = state.score;
  levelEl.textContent = state.level;
  linesEl.textContent = state.lines;
  hiscoreEl.textContent = state.highScore;
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
const game = createGame();

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

  const wasGameOver = game.state.gameOver;

  game.step(delta);

  const state = game.state;
  updateHUD(state);

  // A lock can end the game; react to the transition exactly once.
  if (state.gameOver && !wasGameOver) endGameUI();

  renderer.draw(state);
  requestAnimationFrame(update);
}

renderer.draw(game.state);
requestAnimationFrame(update);

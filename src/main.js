"use strict";

/* =========================================================
 *  Boot: wires core + render + input + storage + audio + effects.
 *
 *  The loop owns the clock: it computes the delta, clamps it,
 *  feeds it to core.step(), advances the effects, then redraws.
 *  The core never reads a clock.
 * ========================================================= */

import { createGame } from "./core.js";
import { createRenderer } from "./render.js";
import { attachInput } from "./input.js";
import { loadHighScore, saveHighScore, loadMuted, saveMuted } from "./storage.js";
import { createAudio } from "./audio.js";
import { createEffects } from "./effects.js";

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
const muteEl = document.getElementById("mute");

// ---------- Accessibility ----------
// prefers-reduced-motion is read once, through a guarded call: matchMedia
// is absent in Node (and in some embedded browsers), and a missing API
// must never take the game down.
function prefersReducedMotion() {
  try {
    if (typeof globalThis === "undefined" || !globalThis.matchMedia) return false;
    return globalThis.matchMedia("(prefers-reduced-motion: reduce)").matches === true;
  } catch (e) {
    return false;
  }
}

const effects = createEffects({ reducedMotion: prefersReducedMotion() });
// Exported alongside `game` for the DOM tests: they assert that the frame
// loop advances the effects, which is a wiring contract no core test sees.
export { effects };

// ---------- Audio ----------
// The engine is built with no context: the AudioContext appears on the
// first real input (browsers block audio until a gesture). Mute comes
// from storage before anything can sound.
export const audio = createAudio({ muted: loadMuted() });

function updateMuteUI() {
  if (!muteEl) return;
  muteEl.textContent = audio.muted ? "MUTE" : "SONIDO";
  muteEl.classList.toggle("visible", audio.muted);
  // Show the live Autoplay state so a muted-turned-suspended case is not
  // silent by accident: the badge tells the player whether audio woke.
  const st = audio.contextState();
  muteEl.dataset.audioState = st;
  muteEl.setAttribute("aria-label", `audio ${st}`);
}

const renderer = createRenderer({ canvas, nextCanvas, holdCanvas, queueCanvas, effects });
updateMuteUI();

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
// button (hidden while paused, since P/Esc resumes). The 150ms fade lives
// in CSS (#overlay transition on opacity, driven by .visible).
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

// ---------- Sounds per event ----------
// The core has no `lock` and no `hardDrop` event; see audio.js for the
// full mapping rationale.
let lastLevel = 1;

game.on((type, payload) => {
  if (type === "gameover") {
    audio.playGameOver();
    endGameUI();
    return;
  }

  if (type === "clear") {
    const lines = payload.lines | 0;

    if (payload.tspin && lines === 0) {
      // A T-spin with no lines still pays (400 full / 100 mini) and still
      // gets the on-screen announce, so it must not fall through to the
      // plain lock tick: the player sees T-SPIN but would hear a click.
      audio.playTSpin();
    } else if (lines > 0) {
      // A clear happened: its own sound, plus shake and particles.
      effects.shake();
      effects.burst({
        rows: payload.rows || [],
        color: clearedColor(),
        cell: renderer.CELL_SIZE,
        cols: 10,
      });
      if (payload.tspin) {
        audio.playTSpin();
      } else if (lines >= 4) {
        audio.playTetris();
      } else {
        audio.playClear(lines);
      }
    } else if (lastKeyWasHardDrop) {
      // A hard drop locks with no lines: thud instead of the lock tick.
      audio.playHardDrop();
    } else {
      audio.playLock();
    }

    // Level up is detected by change, since the core has no event for it:
    // the `clear` payload already carries the new level.
    const level = payload.level | 0;
    if (level > lastLevel) {
      audio.playLevelUp();
      lastLevel = level;
    }

    if (payload.tspin) {
      const label = payload.type === "tspin_full" ? "T-SPIN" : "T-SPIN MINI";
      game.state.announce = { text: label, at: performance.now() };
    }
    return;
  }

  // Hold: the core reports the slot being spent, which is the moment the
  // swap is audible. `holdUsed: false` is the refill after a lock and is
  // deliberately silent.
  if (type === "holdUsed" && payload && payload.holdUsed === true) {
    audio.playHold();
    return;
  }

  if (type === "reset") {
    lastLevel = 1;
    effects.reset();
  }
});

// The color of the piece that most recently locked, for the particle burst.
// The board stamp is the only place the color survives the lock, so the
// active piece's color is captured before it is replaced.
let lastLockedColor = "#ffffff";
game.on((type) => {
  if (type === "clearing") lastLockedColor = game.state.current ? game.state.current.color : lastLockedColor;
});

function clearedColor() {
  return lastLockedColor;
}

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

// ---------- Input ----------
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
  onMute() {
    // M cycles through three states: SFX only -> SFX + music -> muted.
    // Music kicks in on the M key as well as the first gesture, so the
    // player who wants the Korobeiniki can reach it without touching
    // anything else.
    if (!audio.muted && !audio.musicOn) {
      audio.setMusic(true);
    } else if (!audio.muted && audio.musicOn) {
      audio.toggleMuted(); // SFX + music -> muted (music stops with it)
    } else {
      audio.setMuted(false); // muted -> SFX only
      audio.setMusic(false);
    }
    saveMuted(audio.muted);
    updateMuteUI();
  },
});

// The first gesture is what unlocks audio: stamp it on the same keydown
// stream the input module reads, before the game handles the key.
//
// Hard drop vs soft lock: a hard drop locks SYNCHRONOUSLY inside this
// handler, so the `clear` event that follows it arrives before the key
// is released. The flag is set here and consumed by the `clear` handler
// above; a keyup or any other frame clears it, so a held space bar does
// not keep playing the thud.
let lastKeyWasHardDrop = false;

// Wake the audio on the first, and only the first, real gesture. Each
// gesture while the context stays suspended re-arms the resume(), because
// the Autoplay policy only grants it once a TRUSTED gesture arrives - a
// keydown on the wrong element, or a click while the tab lacks focus, is
// not trusted and only a later trusted gesture wakes it. Listening to the
// pointer and key events (but not the synthetic repeat keydowns) covers
// every way a player starts.
let audioWoken = false;
function maybeWakeAudio(event) {
  if (audio.muted || audio.musicOn) return;
  if (audioWoken && audio.isRunning()) return;
  audioWoken = audio.wakeAudio(true);
  if (!audioWoken) {
    // Not yet trusted; keep trying on the next real gesture.
    audioWoken = false;
  }
}

document.addEventListener("keydown", maybeWakeAudio, { capture: true });
window.addEventListener("pointerdown", maybeWakeAudio, { capture: true, once: false });

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
  effects.update(delta);

  const state = game.state;
  updateHUD(state);

  renderer.draw(state);
  requestAnimationFrame(update);
}

renderer.draw(game.state);
requestAnimationFrame(update);

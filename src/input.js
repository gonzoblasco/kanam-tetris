"use strict";

/* =========================================================
 *  Keyboard -> intents.
 *
 *  Translates raw key events into calls on the game core and
 *  reports game-over/pause transitions so main.js can drive the
 *  overlay. No rules live here.
 * ========================================================= */

/* =========================================================
 *  attachInput({ game, target, blurTarget, onGameOver, onPauseChange, onMute })
 *
 *  onMute is optional: input.js only forwards the key, it never
 *  knows what mute means. main.js owns the audio engine.
 * ========================================================= */
export function attachInput({ game, target, blurTarget, onGameOver, onPauseChange, onMute }) {
  // Normalise once so "Escape"/"Esc", "p"/"P" and arrows compare alike.
  function onKeyDown(e) {
    const key = e.key.toLowerCase();

    if (game.state.gameOver) {
      if (key === "enter") {
        e.preventDefault();
        game.reset();
        onGameOver(false);
      }
      return;
    }

    // Pause toggles from anywhere else.
    if (key === "p" || key === "escape") {
      e.preventDefault();
      if (!e.repeat) {
        const wasPaused = game.state.paused;
        game.togglePause();
        onPauseChange(game.state.paused, wasPaused);
      }
      return;
    }
    if (game.state.paused) return;
    // The flash owns the locked piece; ignore game input. (Checked after
    // the pause handling so P/Esc still work during the flash.)
    if (game.state.clearing) return;

    if (key === "c") {
      if (!e.repeat) game.holdPiece();
      return;
    }

    // Mute is UI state, not a rule: input.js forwards it and main.js
    // decides. Handled before the clearing guard so M works mid-flash.
    if (key === "m") {
      if (!e.repeat && onMute) onMute();
      return;
    }

    switch (key) {
      case "arrowleft":
        e.preventDefault();
        if (!e.repeat) game.pressMove(-1); // OS repeat deliberately ignored
        break;
      case "arrowright":
        e.preventDefault();
        if (!e.repeat) game.pressMove(1);
        break;
      case "arrowdown":
        e.preventDefault();
        game.softDrop();
        break;
      case "arrowup":
        e.preventDefault();
        if (!e.repeat) game.rotate(1);
        break;
      case " ":
        e.preventDefault();
        if (!e.repeat) game.hardDrop();
        break;
    }
  }

  function onKeyUp(e) {
    const key = e.key.toLowerCase();
    if (key === "arrowleft") game.releaseMove(-1);
    if (key === "arrowright") game.releaseMove(1);
  }

  // Releasing focus mid-hold would otherwise leave the piece sliding.
  function onBlur() {
    game.releaseMove(-1);
    game.releaseMove(1);
  }

  // blur does not bubble: a window focus loss fires at window, never at
  // document. Register there, mirroring v0.2 (window.addEventListener).
  // Injectable so the wiring stays testable in Node (no browser).
  const win = blurTarget ?? (typeof window !== "undefined" ? window : null);

  target.addEventListener("keydown", onKeyDown);
  target.addEventListener("keyup", onKeyUp);
  if (win) win.addEventListener("blur", onBlur);

  return () => {
    target.removeEventListener("keydown", onKeyDown);
    target.removeEventListener("keyup", onKeyUp);
    if (win) win.removeEventListener("blur", onBlur);
  };
}

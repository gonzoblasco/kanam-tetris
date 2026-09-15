"use strict";

/* =========================================================
 *  High-score persistence.
 *
 *  localStorage can throw (private mode, sandboxed frames),
 *  so every access is guarded and the game never goes down
 *  because of it.
 * ========================================================= */

export const HIGH_SCORE_KEY = "tetris.highscore";
export const MUTED_KEY = "tetris.muted";

export function loadHighScore() {
  try {
    const stored = parseInt(localStorage.getItem(HIGH_SCORE_KEY), 10);
    return Number.isFinite(stored) && stored > 0 ? stored : 0;
  } catch (e) {
    return 0;
  }
}

export function saveHighScore(value) {
  try {
    localStorage.setItem(HIGH_SCORE_KEY, String(value));
  } catch (e) {
    /* storage unavailable - keep the in-memory record only */
  }
}

// Mute is persisted as the literal "1"/"0" rather than a boolean, because
// localStorage stores strings: getItem would hand back the string "false",
// which is truthy and would mute the game forever on reload.
export function loadMuted() {
  try {
    return localStorage.getItem(MUTED_KEY) === "1";
  } catch (e) {
    return false;
  }
}

export function saveMuted(value) {
  try {
    localStorage.setItem(MUTED_KEY, value ? "1" : "0");
  } catch (e) {
    /* storage unavailable - mute still works for this session */
  }
}

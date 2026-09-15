"use strict";

/* =========================================================
 *  Tetris renderer - canvas only. Wireframe language (v0.4).
 *
 *  Visual language "wireframe boxes": every cell is drawn as
 *  a colored outline with a barely-there fill, so shapes
 *  carry the information and color is the accent. The board
 *  floor is a faint dot grid (no lines). The ghost is dashed.
 *  The active piece glows while grounded, so the imminent
 *  lock is visible - a read-only signal from the state.
 *
 *  Game feel (v0.5): screen shake and clear particles come
 *  from src/effects.js, which the loop advances. The renderer
 *  only READS them (offset + particle list); it still never
 *  mutates state. Particles are drawn as outlined squares with
 *  a faint fill, the same cajita grammar as every cell.
 *
 *  Draws whatever state it is handed. It never mutates the
 *  game state and never decides anything about the rules.
 * ========================================================= */

import { COLS, ROWS, CLEAR_FLASH_MS, LOCK_DELAY_MS, PIECES, cellsOf, NEXT_QUEUE_SIZE } from "./core.js";

export const CELL = 30;       // board cell size in px
export const PREVIEW_CELL = 16; // cell size used by the hold preview
const QUEUE_CELL = 11;        // smaller cells for the 4 trailing queue previews
const QUEUE_SLOT_H = 26;      // vertical pitch of one queue slot
const NEXT_CELLS = 3;         // rows the next canvas must fit (I is 1 tall, T is 2)

// The announcement floats over the board for this long after a T-spin.
const ANNOUNCE_MS = 900;
const BOARD_FRAME = 3;        // px, board border width the pulse rides on

const DOT_ALPHA = 0.06;    // board floor dot intensity
const GHOST_DASH = [3, 4]; // dash pattern for the ghost outline
const STROKE_LOCKED = 1;   // settled cell outline width
const STROKE_ACTIVE = 2;   // active piece outline width
// Soft shade of the piece color: enough that the cell reads as its own color
// instead of a black face, still translucent so the outline and the dot floor
// stay legible. A gentle top-to-bottom gradient gives it a lit-from-above feel.
const FILL_ALPHA_TOP = 0.30;
const FILL_ALPHA_BOTTOM = 0.18;

// ---------- Color helpers ----------
function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgba(color, alpha) {
  const [r, g, b] = hexToRgb(color);
  return `rgba(${r},${g},${b},${alpha})`;
}

// A "cajita": outline of the piece color plus a soft shade fill. The
// stroke is inset by half its width so it stays inside the cell.
function drawCellWire(context, x, y, color, size, lineWidth = STROKE_LOCKED) {
  const px = x * size;
  const py = y * size;
  const inset = lineWidth / 2;
  const grad = context.createLinearGradient(px, py, px, py + size);
  grad.addColorStop(0, rgba(color, FILL_ALPHA_TOP));
  grad.addColorStop(1, rgba(color, FILL_ALPHA_BOTTOM));
  context.fillStyle = grad;
  context.fillRect(px, py, size, size);
  context.strokeStyle = rgba(color, 0.8);
  context.lineWidth = lineWidth;
  context.strokeRect(px + inset, py + inset, size - lineWidth, size - lineWidth);
}

// Draw a piece type centered inside a small preview canvas.
function drawPreview(context, target, type, size) {
  context.clearRect(0, 0, target.width, target.height);
  if (!type) return;
  const cells = cellsOf(PIECES[type].matrix);
  const minX = Math.min(...cells.map(([, c]) => c));
  const maxX = Math.max(...cells.map(([, c]) => c));
  const minY = Math.min(...cells.map(([r]) => r));
  const maxY = Math.max(...cells.map(([r]) => r));
  const w = maxX - minX + 1;
  const h = maxY - minY + 1;
  const offX = (target.width - w * size) / 2 - minX * size;
  const offY = (target.height - h * size) / 2 - minY * size;

  context.save();
  context.translate(offX, offY);
  for (const [r, c] of cells) drawCellWire(context, c, r, PIECES[type].color, size);
  context.restore();
}

/* =========================================================
 *  createRenderer({ canvas, nextCanvas, holdCanvas, queueCanvas, effects })
 *
 *  `effects` is optional: without it the renderer draws exactly
 *  as v0.4 did, which keeps the existing DOM tests valid.
 * ========================================================= */
export function createRenderer({ canvas, nextCanvas, holdCanvas, queueCanvas, effects = null }) {
  const ctx = canvas.getContext("2d");
  const nextCtx = nextCanvas.getContext("2d");
  const holdCtx = holdCanvas.getContext("2d");
  const queueCtx = queueCanvas ? queueCanvas.getContext("2d") : null;

  function drawBoard(state) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Shake: the whole board is translated by the offset the effects
    // module computed for this frame. Read-only: the renderer asks for
    // the value, it never advances the timer. Saved/restored so the
    // offset cannot leak into the next frame or the previews.
    const shakeX = effects ? effects.state.shakeX : 0;
    const shakeY = effects ? effects.state.shakeY : 0;
    ctx.save();
    if (shakeX || shakeY) ctx.translate(shakeX, shakeY);

    // Board floor: a faint dot grid at cell centers. Quieter than
    // the former grid lines, it reads as a piso under the pieces.
    ctx.fillStyle = `rgba(255,255,255,${DOT_ALPHA})`;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        ctx.beginPath();
        ctx.arc(c * CELL + CELL / 2, r * CELL + CELL / 2, 1, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Settled blocks.
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < COLS; c++)
        if (state.board[r][c]) drawCellWire(ctx, c, r, state.board[r][c], CELL);

    // Line-clear flash: the completed rows pulse as a bright outline
    // that swells and fades (same ramp, same freezing clearing state).
    // The fill is only a glow support, never the old solid white.
    if (state.clearing) {
      const t = Math.min(1, state.clearing.timer / CLEAR_FLASH_MS);
      const pulse = Math.sin(Math.PI * t); // 0 -> 1 -> 0
      // A T-spin clear gets a colored frame instead of white: same wireframe
      // language, and the event is readable without a label.
      const spin = state.pendingTSpin && state.pendingTSpin.tspin;
      const flashColor = spin ? "192,132,252" : "255,255,255";
      ctx.fillStyle = `rgba(${flashColor},${(0.05 * pulse).toFixed(3)})`;
      ctx.strokeStyle = `rgba(${flashColor},${(0.35 + 0.6 * pulse).toFixed(3)})`;
      ctx.lineWidth = 2.5;
      ctx.shadowColor = spin ? "rgba(192,132,252,0.9)" : "rgba(255,255,255,0.9)";
      ctx.shadowBlur = 14 * pulse;
      for (const r of state.clearing.rows) {
        ctx.fillRect(0, r * CELL, COLS * CELL, CELL);
        ctx.strokeRect(1.25, r * CELL + 1.25, COLS * CELL - 2.5, CELL - 2.5);
      }
      ctx.shadowBlur = 0;
    }

    // No active piece while clearing or after game over.
    const cur = state.current;
    if (!state.gameOver && !state.clearing && cur) drawActivePiece(state, cur);

    // Particles sit above the pieces (they are the newest event) but
    // below the announcement and the frame.
    drawParticles();

    ctx.restore(); // end of the shake transform

    // The announcement and the board frame are NOT shaken: the frame is
    // the reference the shake reads against, so moving it would hide the
    // effect entirely.
    drawAnnounce(state);
  }

  // One particle is a small outlined square in the cleared piece's color,
  // fading with the remaining life. Same cajita grammar as the cells.
  function drawParticles() {
    if (!effects) return;
    for (const p of effects.state.particles) {
      const t = p.maxLife > 0 ? Math.max(0, p.life / p.maxLife) : 0;
      const size = p.size;
      ctx.save();
      ctx.globalAlpha = t;
      ctx.fillStyle = rgba(p.color, 0.18);
      ctx.fillRect(p.x - size / 2, p.y - size / 2, size, size);
      ctx.strokeStyle = rgba(p.color, 0.85);
      ctx.lineWidth = 1;
      ctx.strokeRect(p.x - size / 2 + 0.5, p.y - size / 2 + 0.5, size - 1, size - 1);
      ctx.restore();
    }
  }

  function drawActivePiece(state, cur) {
    // Ghost first, under the piece: dashed outline of a tenue color,
    // fill almost null. Same `gy !== cur.y` condition as before.
    const gy = ghostYFor(state, cur);
    if (gy !== cur.y) {
      ctx.save();
      ctx.fillStyle = rgba(cur.color, 0.04);
      ctx.strokeStyle = rgba(cur.color, 0.30);
      ctx.lineWidth = 1;
      ctx.setLineDash(GHOST_DASH);
      for (const [r, c] of cellsOf(cur.matrix)) {
        const px = (cur.x + c) * CELL;
        const py = (gy + r) * CELL;
        ctx.fillRect(px, py, CELL, CELL);
        ctx.strokeRect(px + 0.5, py + 0.5, CELL - 1, CELL - 1);
      }
      ctx.restore();
    }

    // Lock-imminent glow: while the piece is grounded, the lock timer
    // ticks toward LOCK_DELAY_MS; glow scales with that progress. It is
    // useful information (the piece is about to lock), not decoration.
    const groundedHere = collidesAt(state.board, cur.matrix, cur.x, cur.y + 1);
    const lockRatio = groundedHere ? Math.min(1, state.lockTimer / LOCK_DELAY_MS) : 0;

    if (lockRatio > 0) {
      ctx.save();
      ctx.shadowColor = cur.color;
      ctx.shadowBlur = 6 + 22 * lockRatio;
    }
    for (const [r, c] of cellsOf(cur.matrix)) {
      const by = cur.y + r;
      if (by >= 0) drawCellWire(ctx, cur.x + c, by, cur.color, CELL, STROKE_ACTIVE);
    }
    if (lockRatio > 0) ctx.restore();
  }

  // The T-spin announcement: a short label over the board plus a pulse on the
  // board frame. Chosen over particles or a full-screen banner because it adds
  // no new visual vocabulary - it is text and one border, same as the rest.
  function drawAnnounce(state) {
    const ann = state.announce;
    if (!ann) return;
    const age = Date.now() - ann.at;
    if (age > ANNOUNCE_MS) return;
    const t = age / ANNOUNCE_MS;
    const alpha = 1 - t * t; // ease out, so it does not snap off

    // Board frame pulse.
    ctx.save();
    ctx.strokeStyle = `rgba(192,132,252,${(0.55 * alpha).toFixed(3)})`;
    ctx.lineWidth = BOARD_FRAME;
    ctx.strokeRect(
      BOARD_FRAME / 2,
      BOARD_FRAME / 2,
      canvas.width - BOARD_FRAME,
      canvas.height - BOARD_FRAME,
    );
    ctx.restore();

    // Floating label, centered on the board's upper third.
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = "600 20px 'SF Mono', 'Fira Code', Consolas, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#c084fc";
    ctx.shadowColor = "rgba(192,132,252,0.9)";
    ctx.shadowBlur = 12;
    ctx.fillText(ann.text, canvas.width / 2, canvas.height * 0.32 - t * 10);
    ctx.restore();
  }

  function drawNext(state) {
    drawPreview(nextCtx, nextCanvas, state.nextType, PREVIEW_CELL);
  }

  // R4: the 4 pieces after `nextType`, cascaded and smaller. The active-adjacent
  // piece is NOT redrawn here (it is the big "Siguiente" panel), so the queue
  // shown here starts at index 1.
  function drawQueue(state) {
    if (!queueCanvas || !queueCtx) return;
    queueCtx.clearRect(0, 0, queueCanvas.width, queueCanvas.height);
    const q = state.queue || [];
    for (let i = 1; i < Math.min(q.length, NEXT_QUEUE_SIZE); i++) {
      const type = q[i];
      if (!type) continue;
      const slotTop = (i - 1) * QUEUE_SLOT_H;
      queueCtx.save();
      queueCtx.translate(30 - 3 * QUEUE_CELL, slotTop + 4);
      const cells = cellsOf(PIECES[type].matrix);
      for (const [r, c] of cells) drawCellWire(queueCtx, c, r, PIECES[type].color, QUEUE_CELL);
      queueCtx.restore();
    }
  }

  // The reserved piece is dimmed while the hold slot is spent.
  function drawHold(state) {
    holdCtx.clearRect(0, 0, holdCanvas.width, holdCanvas.height);
    if (!state.holdType) return;
    holdCtx.globalAlpha = state.holdUsed ? 0.28 : 1;
    drawPreview(holdCtx, holdCanvas, state.holdType, PREVIEW_CELL);
    holdCtx.globalAlpha = 1;
  }

  function draw(state) {
    drawBoard(state);
    drawNext(state);
    drawHold(state);
    drawQueue(state);
  }

  return { draw, drawBoard, drawNext, drawHold, drawQueue, CELL_SIZE: CELL };
}

// Local ghost calculation so the renderer stays free of core internals.
function ghostYFor(state, cur) {
  let y = cur.y;
  while (!collidesAt(state.board, cur.matrix, cur.x, y + 1)) y++;
  return y;
}

function collidesAt(board, matrix, x, y) {
  for (const [r, c] of cellsOf(matrix)) {
    const bx = x + c;
    const by = y + r;
    if (bx < 0 || bx >= COLS || by >= ROWS) return true;
    if (by >= 0 && board[by][bx]) return true;
  }
  return false;
}

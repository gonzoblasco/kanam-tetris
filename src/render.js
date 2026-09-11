"use strict";

/* =========================================================
 *  Tetris renderer - canvas only.
 *
 *  Draws whatever state it is handed. It never mutates the
 *  game state and never decides anything about the rules.
 * ========================================================= */

import { COLS, ROWS, CLEAR_FLASH_MS, PIECES, cellsOf } from "./core.js";

export const CELL = 30;       // board cell size in px
export const PREVIEW_CELL = 16; // cell size used by hold/next previews

// ---------- Primitives ----------
function drawCell(context, x, y, color, size) {
  context.fillStyle = color;
  context.fillRect(x * size, y * size, size, size);
  // Subtle inner highlight for depth.
  context.fillStyle = "rgba(255,255,255,0.12)";
  context.fillRect(x * size, y * size, size, 3);
  context.fillStyle = "rgba(0,0,0,0.25)";
  context.fillRect(x * size, y * size + size - 3, size, 3);
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
  for (const [r, c] of cells) drawCell(context, c, r, PIECES[type].color, size);
  context.restore();
}

/* =========================================================
 *  createRenderer({ canvas, nextCanvas, holdCanvas })
 * ========================================================= */
export function createRenderer({ canvas, nextCanvas, holdCanvas }) {
  const ctx = canvas.getContext("2d");
  const nextCtx = nextCanvas.getContext("2d");
  const holdCtx = holdCanvas.getContext("2d");

  function drawBoard(state) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Faint grid lines for board orientation.
    ctx.strokeStyle = "rgba(255,255,255,0.04)";
    ctx.lineWidth = 1;
    for (let c = 1; c < COLS; c++) {
      ctx.beginPath();
      ctx.moveTo(c * CELL, 0);
      ctx.lineTo(c * CELL, ROWS * CELL);
      ctx.stroke();
    }
    for (let r = 1; r < ROWS; r++) {
      ctx.beginPath();
      ctx.moveTo(0, r * CELL);
      ctx.lineTo(COLS * CELL, r * CELL);
      ctx.stroke();
    }

    // Settled blocks.
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < COLS; c++)
        if (state.board[r][c]) drawCell(ctx, c, r, state.board[r][c], CELL);

    // Line-clear flash: completed rows blink white, fading out, while the
    // simulation is frozen. Over the blocks, under the overlay.
    if (state.clearing) {
      const t = Math.min(1, state.clearing.timer / CLEAR_FLASH_MS);
      ctx.fillStyle = `rgba(255,255,255,${(0.9 * (1 - t)).toFixed(3)})`;
      for (const r of state.clearing.rows) {
        ctx.fillRect(0, r * CELL, COLS * CELL, CELL);
      }
    }

    // No active piece while clearing or after game over.
    const cur = state.current;
    if (!state.gameOver && !state.clearing && cur) {
      // Ghost piece (semi-transparent silhouette of the landing spot).
      const gy = ghostYFor(state, cur);
      if (gy !== cur.y) {
        for (const [r, c] of cellsOf(cur.matrix)) {
          ctx.fillStyle = "rgba(255,255,255,0.10)";
          ctx.fillRect((cur.x + c) * CELL, (gy + r) * CELL, CELL, CELL);
          ctx.strokeStyle = "rgba(255,255,255,0.20)";
          ctx.strokeRect((cur.x + c) * CELL + 0.5, (gy + r) * CELL + 0.5, CELL - 1, CELL - 1);
        }
      }

      // Active piece.
      for (const [r, c] of cellsOf(cur.matrix)) {
        const by = cur.y + r;
        if (by >= 0) drawCell(ctx, cur.x + c, by, cur.color, CELL);
      }
    }
  }

  function drawNext(state) {
    drawPreview(nextCtx, nextCanvas, state.nextType, PREVIEW_CELL);
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
  }

  return { draw, drawBoard, drawNext, drawHold };
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

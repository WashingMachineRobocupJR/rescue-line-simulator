// Draws the course onto a canvas. The same bitmap is what the simulated
// sensors sample, so what you see is literally what the robot sees.

import { Course, Tile, TILE, tileAt } from "./course";

export const COLORS = {
  floor: "#ffffff",
  line: "#111111",
  green: "#00a651",
  silver: "#c9ccd4",
  wall: "#8b5e3c",
  zoneFloor: "#f4f4f6",
  evac: "#2b2f36",
};

export const LINE_W = 22;

function drawLine(ctx: CanvasRenderingContext2D, pts: [number, number][]) {
  ctx.strokeStyle = COLORS.line;
  ctx.lineWidth = LINE_W;
  ctx.lineCap = "butt";
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (const [x, y] of pts.slice(1)) ctx.lineTo(x, y);
  ctx.stroke();
}

function drawTile(ctx: CanvasRenderingContext2D, t: Tile, course: Course, col: number, row: number) {
  const x = col * TILE;
  const y = row * TILE;
  const cx = x + TILE / 2;
  const cy = y + TILE / 2;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate((t.rot * Math.PI) / 2);
  ctx.translate(-TILE / 2, -TILE / 2);

  const mid = TILE / 2;

  switch (t.kind) {
    case "straight":
    case "start":
      drawLine(ctx, [
        [0, mid],
        [TILE, mid],
      ]);
      if (t.kind === "start") {
        ctx.fillStyle = COLORS.silver;
        ctx.fillRect(TILE * 0.1, mid - LINE_W * 2.2, TILE * 0.16, LINE_W * 4.4);
      }
      break;
    case "gap": {
      drawLine(ctx, [
        [0, mid],
        [TILE * 0.3, mid],
      ]);
      drawLine(ctx, [
        [TILE * 0.7, mid],
        [TILE, mid],
      ]);
      break;
    }
    case "obstacle": {
      drawLine(ctx, [
        [0, mid],
        [TILE, mid],
      ]);
      ctx.fillStyle = COLORS.wall;
      ctx.fillRect(mid - 28, mid - 28, 56, 56);
      break;
    }
    case "curve": {
      ctx.strokeStyle = COLORS.line;
      ctx.lineWidth = LINE_W;
      ctx.beginPath();
      // from left edge to bottom edge
      ctx.arc(0, TILE, mid, -Math.PI / 2, 0);
      ctx.stroke();
      break;
    }
    case "t": {
      drawLine(ctx, [
        [0, mid],
        [TILE, mid],
      ]);
      drawLine(ctx, [
        [mid, mid],
        [mid, TILE],
      ]);
      if (t.marker === "left" || t.marker === "both") {
        ctx.fillStyle = COLORS.green;
        ctx.fillRect(mid - LINE_W / 2 - 34, mid + LINE_W / 2 + 4, 30, 30);
      }
      if (t.marker === "right" || t.marker === "both") {
        ctx.fillStyle = COLORS.green;
        ctx.fillRect(mid + LINE_W / 2 + 4, mid + LINE_W / 2 + 4, 30, 30);
      }
      break;
    }
    case "cross": {
      drawLine(ctx, [
        [0, mid],
        [TILE, mid],
      ]);
      drawLine(ctx, [
        [mid, 0],
        [mid, TILE],
      ]);
      if (t.marker === "left" || t.marker === "both") {
        ctx.fillStyle = COLORS.green;
        ctx.fillRect(mid - LINE_W / 2 - 34, mid + LINE_W / 2 + 4, 30, 30);
      }
      if (t.marker === "right" || t.marker === "both") {
        ctx.fillStyle = COLORS.green;
        ctx.fillRect(mid + LINE_W / 2 + 4, mid + LINE_W / 2 + 4, 30, 30);
      }
      break;
    }
    case "zone": {
      ctx.fillStyle = COLORS.zoneFloor;
      ctx.fillRect(0, 0, TILE, TILE);
      break;
    }
    default:
      break;
  }
  ctx.restore();

  // zone walls + evacuation corner drawn unrotated
  if (t.kind === "zone") {
    ctx.fillStyle = COLORS.wall;
    const W = 10;
    if (tileAt(course, col, row - 1).kind !== "zone") ctx.fillRect(x, y, TILE, W);
    if (tileAt(course, col, row + 1).kind !== "zone") ctx.fillRect(x, y + TILE - W, TILE, W);
    if (tileAt(course, col - 1, row).kind !== "zone") ctx.fillRect(x, y, W, TILE);
    if (tileAt(course, col + 1, row).kind !== "zone") ctx.fillRect(x + TILE - W, y, W, TILE);
    // evacuation corner on rot=2 tile
    if (t.rot === 2) {
      ctx.fillStyle = COLORS.evac;
      ctx.beginPath();
      ctx.moveTo(x + TILE, y + TILE);
      ctx.lineTo(x + TILE - 90, y + TILE);
      ctx.lineTo(x + TILE, y + TILE - 90);
      ctx.closePath();
      ctx.fill();
    }
  }
}

export function renderCourse(ctx: CanvasRenderingContext2D, course: Course) {
  ctx.fillStyle = COLORS.floor;
  ctx.fillRect(0, 0, course.cols * TILE, course.rows * TILE);
  for (let r = 0; r < course.rows; r++) {
    for (let c = 0; c < course.cols; c++) {
      drawTile(ctx, tileAt(course, c, r), course, c, r);
    }
  }
}

// classify a sampled pixel
export function classify(r: number, g: number, b: number): "white" | "black" | "green" | "silver" | "wall" {
  if (g > 120 && r < 100 && b < 120) return "green";
  const lum = (r + g + b) / 3;
  if (lum < 70) return "black";
  if (r > 120 && g > 80 && g < 120 && b < 80) return "wall";
  if (lum > 180 && lum < 225 && Math.abs(r - b) < 20) return "silver";
  return "white";
}

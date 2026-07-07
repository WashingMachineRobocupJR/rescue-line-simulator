// Draws the course onto a canvas. The same bitmap is what the simulated
// sensors sample, so what you see is literally what the robot sees.

import { Course, Tile, TILE, tileAt } from "./course";

export const COLORS = {
  floor: "#ffffff",
  line: "#111111",
  green: "#00a651",
  silver: "#c9ccd4",
  red: "#e10600",
  wall: "#8b5e3c",
  zoneFloor: "#f4f4f6",
  evac: "#2b2f36",
  rampShade: "#ececef",
};

export const LINE_W = 22;

function line(ctx: CanvasRenderingContext2D, pts: [number, number][], color = COLORS.line, w = LINE_W) {
  ctx.strokeStyle = color;
  ctx.lineWidth = w;
  ctx.lineCap = "butt";
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (const [x, y] of pts.slice(1)) ctx.lineTo(x, y);
  ctx.stroke();
}

function markers(ctx: CanvasRenderingContext2D, t: Tile, mid: number) {
  if (t.marker === "left" || t.marker === "both") {
    ctx.fillStyle = COLORS.green;
    ctx.fillRect(mid - LINE_W / 2 - 34, mid + LINE_W / 2 + 4, 30, 30);
  }
  if (t.marker === "right" || t.marker === "both") {
    ctx.fillStyle = COLORS.green;
    ctx.fillRect(mid + LINE_W / 2 + 4, mid + LINE_W / 2 + 4, 30, 30);
  }
}

function drawTile(ctx: CanvasRenderingContext2D, t: Tile, course: Course, col: number, row: number) {
  const x = col * TILE;
  const y = row * TILE;

  ctx.save();
  ctx.translate(x + TILE / 2, y + TILE / 2);
  ctx.rotate((t.rot * Math.PI) / 2);
  ctx.translate(-TILE / 2, -TILE / 2);

  const mid = TILE / 2;

  switch (t.kind) {
    case "straight":
      line(ctx, [[0, mid], [TILE, mid]]);
      break;
    case "start":
      line(ctx, [[0, mid], [TILE, mid]]);
      ctx.fillStyle = "#b9f0c8";
      ctx.fillRect(TILE * 0.08, mid - LINE_W * 2.2, TILE * 0.14, LINE_W * 4.4);
      break;
    case "checkpoint":
      line(ctx, [[0, mid], [TILE, mid]]);
      // checkerboard strip under the line marks the checkpoint
      for (let i = 0; i < 6; i++) {
        ctx.fillStyle = i % 2 ? "#666" : "#bbb";
        ctx.fillRect(mid - 12 + (i % 3) * 8, mid + LINE_W + 8 + Math.floor(i / 3) * 8, 8, 8);
      }
      break;
    case "silver":
      line(ctx, [[0, mid], [TILE, mid]]);
      ctx.fillStyle = COLORS.silver;
      ctx.fillRect(TILE * 0.62, mid - LINE_W * 2.4, TILE * 0.14, LINE_W * 4.8);
      break;
    case "red":
      line(ctx, [[0, mid], [TILE * 0.55, mid]]);
      // the red end line spans the full corridor, like on a real field
      ctx.fillStyle = COLORS.red;
      ctx.fillRect(TILE * 0.55, mid - LINE_W * 2.2, LINE_W * 1.6, LINE_W * 4.4);
      break;
    case "gap":
      line(ctx, [[0, mid], [TILE * 0.3, mid]]);
      line(ctx, [[TILE * 0.7, mid], [TILE, mid]]);
      break;
    case "obstacle":
      line(ctx, [[0, mid], [TILE, mid]]);
      ctx.fillStyle = COLORS.wall;
      ctx.fillRect(mid - 28, mid - 28, 56, 56);
      break;
    case "bump":
      line(ctx, [[0, mid], [TILE, mid]]);
      ctx.fillStyle = "#d8d4cc";
      for (const bx of [0.3, 0.55, 0.8]) {
        ctx.fillRect(TILE * bx - 5, mid - LINE_W * 1.8, 10, LINE_W * 3.6);
      }
      break;
    case "seesaw": {
      // plank drawn as shaded board, line continues over it
      ctx.fillStyle = "#efe7d8";
      ctx.fillRect(TILE * 0.15, mid - 55, TILE * 0.7, 110);
      ctx.strokeStyle = "#cbbfa5";
      ctx.lineWidth = 3;
      ctx.strokeRect(TILE * 0.15, mid - 55, TILE * 0.7, 110);
      line(ctx, [[0, mid], [TILE, mid]]);
      break;
    }
    case "rampup":
    case "rampdown": {
      // shaded gradient suggests slope; chevrons point uphill
      const g = ctx.createLinearGradient(0, 0, TILE, 0);
      if (t.kind === "rampup") {
        g.addColorStop(0, "#ffffff");
        g.addColorStop(1, COLORS.rampShade);
      } else {
        g.addColorStop(0, COLORS.rampShade);
        g.addColorStop(1, "#ffffff");
      }
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, TILE, TILE);
      line(ctx, [[0, mid], [TILE, mid]]);
      ctx.strokeStyle = "#b9b4c2";
      ctx.lineWidth = 5;
      const dir = t.kind === "rampup" ? 1 : -1;
      for (const cx of [0.35, 0.6]) {
        ctx.beginPath();
        ctx.moveTo(TILE * cx - 12 * dir, mid - 46);
        ctx.lineTo(TILE * cx + 12 * dir, mid - 60);
        ctx.moveTo(TILE * cx - 12 * dir, mid + 46);
        ctx.lineTo(TILE * cx + 12 * dir, mid + 60);
        ctx.stroke();
      }
      break;
    }
    case "curve":
      ctx.strokeStyle = COLORS.line;
      ctx.lineWidth = LINE_W;
      ctx.beginPath();
      ctx.arc(0, TILE, mid, -Math.PI / 2, 0);
      ctx.stroke();
      break;
    case "t":
      line(ctx, [[0, mid], [TILE, mid]]);
      line(ctx, [[mid, mid], [mid, TILE]]);
      markers(ctx, t, mid);
      break;
    case "cross":
      line(ctx, [[0, mid], [TILE, mid]]);
      line(ctx, [[mid, 0], [mid, TILE]]);
      markers(ctx, t, mid);
      break;
    case "zone":
      ctx.fillStyle = COLORS.zoneFloor;
      ctx.fillRect(0, 0, TILE, TILE);
      break;
    default:
      break;
  }
  ctx.restore();

  // zone walls + evacuation corner drawn unrotated.
  // Edges facing a line tile get a doorway (the zone entrance).
  if (t.kind === "zone") {
    ctx.fillStyle = COLORS.wall;
    const W = 10;
    const DOOR = 90;
    const wallH = (wx: number, wy: number, hasDoor: boolean) => {
      if (hasDoor) {
        const side = (TILE - DOOR) / 2;
        ctx.fillRect(wx, wy, side, W);
        ctx.fillRect(wx + TILE - side, wy, side, W);
      } else {
        ctx.fillRect(wx, wy, TILE, W);
      }
    };
    const wallV = (wx: number, wy: number, hasDoor: boolean) => {
      if (hasDoor) {
        const side = (TILE - DOOR) / 2;
        ctx.fillRect(wx, wy, W, side);
        ctx.fillRect(wx, wy + TILE - side, W, side);
      } else {
        ctx.fillRect(wx, wy, W, TILE);
      }
    };
    const isLine = (k: string) => k !== "zone" && k !== "empty";
    const n = tileAt(course, col, row - 1).kind;
    const s = tileAt(course, col, row + 1).kind;
    const w = tileAt(course, col - 1, row).kind;
    const e = tileAt(course, col + 1, row).kind;
    if (n !== "zone") wallH(x, y, isLine(n));
    if (s !== "zone") wallH(x, y + TILE - W, isLine(s));
    if (w !== "zone") wallV(x, y, isLine(w));
    if (e !== "zone") wallV(x + TILE - W, y, isLine(e));
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
  // faint grid to help editing
  ctx.strokeStyle = "#00000010";
  ctx.lineWidth = 1;
  for (let c = 1; c < course.cols; c++) {
    ctx.beginPath();
    ctx.moveTo(c * TILE, 0);
    ctx.lineTo(c * TILE, course.rows * TILE);
    ctx.stroke();
  }
  for (let r = 1; r < course.rows; r++) {
    ctx.beginPath();
    ctx.moveTo(0, r * TILE);
    ctx.lineTo(course.cols * TILE, r * TILE);
    ctx.stroke();
  }
  for (let r = 0; r < course.rows; r++) {
    for (let c = 0; c < course.cols; c++) {
      drawTile(ctx, tileAt(course, c, r), course, c, r);
    }
  }
}

// classify a sampled pixel
export function classify(
  r: number,
  g: number,
  b: number,
): "white" | "black" | "green" | "silver" | "red" | "wall" {
  if (g > 120 && r < 100 && b < 120) return "green";
  if (r > 180 && g < 80 && b < 80) return "red";
  const lum = (r + g + b) / 3;
  if (lum < 70) return "black";
  if (r > 120 && g > 80 && g < 120 && b < 80) return "wall";
  if (lum > 180 && lum < 225 && Math.abs(r - b) < 20) return "silver";
  return "white";
}

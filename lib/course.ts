// Course model: a grid of tiles, serializable to a URL-safe string.

export const TILE = 200; // px per tile (world units)

export type TileKind =
  | "empty"
  | "straight" // line along axis
  | "curve" // quarter-circle line
  | "t" // T intersection
  | "cross" // 4-way intersection
  | "gap" // straight with a missing segment
  | "obstacle" // straight with a block on the line
  | "start"
  | "zone" // evacuation zone tile (rot=2 tile hosts the evacuation corner)
  | "checkpoint" // straight with a checkpoint strip: LoP returns here
  | "seesaw" // straight over a tilting plank
  | "rampup" // line going up a ramp (slower)
  | "rampdown" // line going down a ramp (faster, harder to read)
  | "bump" // straight with speed bumps
  | "silver" // straight with a silver strip: marks the zone entrance
  | "red"; // red line: end of the run

export type Marker = "none" | "left" | "right" | "both";

export interface Tile {
  kind: TileKind;
  rot: 0 | 1 | 2 | 3; // quarter turns clockwise
  marker: Marker; // green markers on intersections
}

export interface Ball {
  x: number;
  y: number;
  kind: "silver" | "black";
  held?: boolean;
  rescued?: boolean;
}

export interface Course {
  cols: number;
  rows: number;
  tiles: Tile[]; // row-major
  balls: Ball[]; // world coordinates, zone balls
}

export const EMPTY_TILE: Tile = { kind: "empty", rot: 0, marker: "none" };

export function makeCourse(cols: number, rows: number): Course {
  return {
    cols,
    rows,
    tiles: Array.from({ length: cols * rows }, () => ({ ...EMPTY_TILE })),
    balls: [],
  };
}

export function tileAt(c: Course, col: number, row: number): Tile {
  if (col < 0 || row < 0 || col >= c.cols || row >= c.rows) return EMPTY_TILE;
  return c.tiles[row * c.cols + col];
}

export function resizeCourse(c: Course, cols: number, rows: number): Course {
  const next = makeCourse(cols, rows);
  for (let r = 0; r < Math.min(rows, c.rows); r++) {
    for (let col = 0; col < Math.min(cols, c.cols); col++) {
      next.tiles[r * cols + col] = c.tiles[r * c.cols + col];
    }
  }
  next.balls = c.balls.filter((b) => b.x < cols * TILE && b.y < rows * TILE);
  return next;
}

// ---------- serialization (URL hash) ----------
// v1-compatible: new kinds are appended, old hashes still decode.

const KINDS: TileKind[] = [
  "empty", "straight", "curve", "t", "cross", "gap", "obstacle", "start", "zone",
  "checkpoint", "seesaw", "rampup", "rampdown", "bump", "silver", "red",
];
const MARKERS: Marker[] = ["none", "left", "right", "both"];

export function serialize(c: Course): string {
  const tiles = c.tiles
    .map((t) => `${KINDS.indexOf(t.kind).toString(16)}${t.rot}${MARKERS.indexOf(t.marker)}`)
    .join("");
  const balls = c.balls
    .map((b) => `${b.kind === "silver" ? "s" : "b"}${Math.round(b.x)}.${Math.round(b.y)}`)
    .join(",");
  const raw = `1|${c.cols}|${c.rows}|${tiles}|${balls}`;
  return typeof btoa !== "undefined" ? btoa(raw).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "") : raw;
}

export function deserialize(s: string): Course | null {
  try {
    const raw = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
    const [v, colsS, rowsS, tilesS, ballsS] = raw.split("|");
    if (v !== "1") return null;
    const cols = parseInt(colsS, 10);
    const rows = parseInt(rowsS, 10);
    const tiles: Tile[] = [];
    for (let i = 0; i < cols * rows; i++) {
      const k = parseInt(tilesS[i * 3], 16);
      const r = parseInt(tilesS[i * 3 + 1], 10) as Tile["rot"];
      const m = parseInt(tilesS[i * 3 + 2], 10);
      tiles.push({ kind: KINDS[k] ?? "empty", rot: r, marker: MARKERS[m] ?? "none" });
    }
    const balls: Ball[] = (ballsS || "")
      .split(",")
      .filter(Boolean)
      .map((b) => {
        const kind = b[0] === "s" ? "silver" : "black";
        const [x, y] = b.slice(1).split(".").map(Number);
        return { x, y, kind } as Ball;
      });
    return { cols, rows, tiles, balls };
  } catch {
    return null;
  }
}

// ---------- default demo course ----------

export function demoCourse(): Course {
  const c = makeCourse(7, 4);
  const set = (col: number, row: number, t: Partial<Tile> & { kind: TileKind }) => {
    c.tiles[row * c.cols + col] = { ...EMPTY_TILE, ...t };
  };
  // curve connections: rot0 = W+S, rot1 = N+W, rot2 = E+N, rot3 = S+E
  set(0, 3, { kind: "start", rot: 0 });
  set(1, 3, { kind: "bump", rot: 0 });
  set(2, 3, { kind: "gap", rot: 0 });
  set(3, 3, { kind: "checkpoint", rot: 0 });
  set(4, 3, { kind: "straight", rot: 0 });
  set(5, 3, { kind: "curve", rot: 1 });
  set(5, 2, { kind: "obstacle", rot: 1 });
  set(5, 1, { kind: "curve", rot: 0 });
  set(4, 1, { kind: "t", rot: 0, marker: "none" });
  set(4, 2, { kind: "seesaw", rot: 1 });
  set(3, 1, { kind: "rampup", rot: 2 });
  set(2, 1, { kind: "curve", rot: 2 });
  set(2, 0, { kind: "curve", rot: 3 });
  set(3, 0, { kind: "straight", rot: 0 });
  set(4, 0, { kind: "silver", rot: 0 });
  // zone: 2x2 arena top-right
  set(5, 0, { kind: "zone", rot: 0 });
  set(6, 0, { kind: "zone", rot: 1 });
  set(6, 1, { kind: "zone", rot: 2 });
  c.balls = [
    { x: 5.4 * TILE, y: 0.4 * TILE, kind: "silver" },
    { x: 6.5 * TILE, y: 0.55 * TILE, kind: "silver" },
    { x: 6.3 * TILE, y: 1.35 * TILE, kind: "black" },
  ];
  return c;
}

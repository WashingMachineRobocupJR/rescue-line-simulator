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
  | "zone"; // evacuation zone tile (4 of them make the arena)

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

// ---------- serialization (URL hash) ----------

const KINDS: TileKind[] = ["empty", "straight", "curve", "t", "cross", "gap", "obstacle", "start", "zone"];
const MARKERS: Marker[] = ["none", "left", "right", "both"];

export function serialize(c: Course): string {
  const tiles = c.tiles
    .map((t) => `${KINDS.indexOf(t.kind)}${t.rot}${MARKERS.indexOf(t.marker)}`)
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
      const k = parseInt(tilesS[i * 3], 10);
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
  const c = makeCourse(6, 4);
  const set = (col: number, row: number, t: Partial<Tile> & { kind: TileKind }) => {
    c.tiles[row * c.cols + col] = { ...EMPTY_TILE, ...t };
  };
  // A loop: start, straights, curves, one gap, one obstacle, one intersection, into the zone.
  set(0, 3, { kind: "start", rot: 0 });
  set(1, 3, { kind: "straight", rot: 0 });
  set(2, 3, { kind: "gap", rot: 0 });
  set(3, 3, { kind: "straight", rot: 0 });
  set(4, 3, { kind: "curve", rot: 3 });
  set(4, 2, { kind: "obstacle", rot: 1 });
  set(4, 1, { kind: "curve", rot: 2 });
  set(3, 1, { kind: "t", rot: 0, marker: "left" });
  set(2, 1, { kind: "straight", rot: 0 });
  set(3, 2, { kind: "straight", rot: 1 });
  set(1, 1, { kind: "curve", rot: 1 });
  set(1, 0, { kind: "curve", rot: 0 });
  // zone: 2x2 arena top-right
  set(4, 0, { kind: "zone", rot: 0 });
  set(5, 0, { kind: "zone", rot: 1 });
  set(5, 1, { kind: "zone", rot: 2 });
  set(2, 0, { kind: "straight", rot: 0 });
  set(3, 0, { kind: "straight", rot: 0 });
  c.balls = [
    { x: 4.4 * TILE, y: 0.4 * TILE, kind: "silver" },
    { x: 5.5 * TILE, y: 0.6 * TILE, kind: "silver" },
    { x: 5.3 * TILE, y: 1.4 * TILE, kind: "black" },
  ];
  return c;
}

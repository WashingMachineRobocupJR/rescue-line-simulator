// Ten ready-made courses, easiest to hardest.
// Curve connections: rot0 = W+S, rot1 = N+W, rot2 = E+N, rot3 = S+E.
// Straight/gap/etc: rot0/2 horizontal, rot1/3 vertical.
// T junction: rot0 = W,E,S · rot1 = N,S,W · rot2 = W,E,N · rot3 = N,S,E.
// Red end: line enters from W at rot0, N at rot1, E at rot2, S at rot3.
// The zone tile with rot=2 hosts the evacuation corner.

import { Ball, Course, EMPTY_TILE, TILE, Tile, TileKind, makeCourse } from "./course";

type Spec = [number, number, TileKind, Tile["rot"]?, Tile["marker"]?];

function build(cols: number, rows: number, specs: Spec[], balls: Ball[] = []): Course {
  const c = makeCourse(cols, rows);
  for (const [col, row, kind, rot = 0, marker = "none"] of specs) {
    c.tiles[row * cols + col] = { ...EMPTY_TILE, kind, rot, marker };
  }
  c.balls = balls;
  return c;
}

const b = (tx: number, ty: number, kind: "silver" | "black"): Ball => ({
  x: tx * TILE,
  y: ty * TILE,
  kind,
});

export interface Preset {
  name: string;
  description: string;
  course: () => Course;
}

export const PRESETS: Preset[] = [
  {
    name: "01 · First Steps",
    description: "One S-curve, nothing else. Learn to follow the line.",
    course: () =>
      build(5, 3, [
        [0, 2, "start", 0],
        [1, 2, "straight", 0],
        [2, 2, "curve", 1],
        [2, 1, "straight", 1],
        [2, 0, "curve", 3],
        [3, 0, "straight", 0],
        [4, 0, "red", 0],
      ]),
  },
  {
    name: "02 · Gap Alley",
    description: "Two gaps and a checkpoint. Keep your heading.",
    course: () =>
      build(6, 3, [
        [0, 2, "start", 0],
        [1, 2, "gap", 0],
        [2, 2, "straight", 0],
        [3, 2, "gap", 0],
        [4, 2, "checkpoint", 0],
        [5, 2, "curve", 1],
        [5, 1, "straight", 1],
        [5, 0, "red", 3],
      ]),
  },
  {
    name: "03 · Marker Turns",
    description: "Green markers decide the way. Read them or get lost.",
    course: () =>
      build(5, 4, [
        [0, 3, "start", 0],
        [1, 3, "cross", 0],
        [2, 3, "t", 2, "left"],
        [2, 2, "straight", 1],
        [2, 1, "curve", 3],
        [3, 1, "straight", 0],
        [4, 1, "t", 0, "right"],
        [4, 2, "straight", 1],
        [4, 3, "curve", 1],
        [3, 3, "red", 2],
      ]),
  },
  {
    name: "04 · Obstacle Run",
    description: "Two blocks on the line. Go around, come back.",
    course: () =>
      build(6, 3, [
        [0, 1, "start", 0],
        [1, 1, "obstacle", 0],
        [2, 1, "bump", 0],
        [3, 1, "obstacle", 0],
        [4, 1, "straight", 0],
        [5, 1, "red", 0],
      ]),
  },
  {
    name: "05 · The Climb",
    description: "Ramps, a seesaw and bumps. Terrain changes your speed.",
    course: () =>
      build(6, 3, [
        [0, 1, "start", 0],
        [1, 1, "rampup", 0],
        [2, 1, "seesaw", 0],
        [3, 1, "rampdown", 0],
        [4, 1, "bump", 0],
        [5, 1, "red", 0],
      ]),
  },
  {
    name: "06 · Serpentine",
    description: "An S of curves with gaps hidden in the bends.",
    course: () =>
      build(6, 4, [
        [0, 3, "start", 0],
        [1, 3, "straight", 0],
        [2, 3, "gap", 0],
        [3, 3, "curve", 1],
        [3, 2, "straight", 1],
        [3, 1, "curve", 0],
        [2, 1, "gap", 2],
        [1, 1, "curve", 2],
        [1, 0, "curve", 3],
        [2, 0, "straight", 0],
        [3, 0, "gap", 0],
        [4, 0, "straight", 0],
        [5, 0, "red", 0],
      ]),
  },
  {
    name: "07 · Checkpoint Gauntlet",
    description: "A long loop. Checkpoints save you, hazards test you.",
    course: () =>
      build(7, 4, [
        [0, 3, "start", 0],
        [1, 3, "gap", 0],
        [2, 3, "checkpoint", 0],
        [3, 3, "obstacle", 0],
        [4, 3, "gap", 0],
        [5, 3, "checkpoint", 0],
        [6, 3, "curve", 1],
        [6, 2, "bump", 1],
        [6, 1, "gap", 1],
        [6, 0, "curve", 0],
        [5, 0, "straight", 0],
        [4, 0, "checkpoint", 0],
        [3, 0, "gap", 0],
        [2, 0, "obstacle", 0],
        [1, 0, "straight", 0],
        [0, 0, "red", 2],
      ]),
  },
  {
    name: "08 · Zone Trainer",
    description: "Straight into a big evacuation zone. Five victims. Practice the grab.",
    course: () =>
      build(5, 4, [
        [0, 3, "start", 0],
        [1, 3, "silver", 0],
        [2, 1, "zone", 0], [3, 1, "zone", 0], [4, 1, "zone", 0],
        [2, 2, "zone", 0], [3, 2, "zone", 0], [4, 2, "zone", 0],
        [2, 3, "zone", 0], [3, 3, "zone", 0], [4, 3, "zone", 2],
      ], [
        b(2.5, 1.5, "silver"),
        b(3.5, 1.4, "silver"),
        b(4.4, 2.3, "silver"),
        b(2.6, 2.6, "black"),
        b(3.4, 3.4, "black"),
      ]),
  },
  {
    name: "09 · Grand Tour",
    description: "Everything at once: hazards, terrain, checkpoints, then the zone.",
    course: () =>
      build(8, 5, [
        [0, 4, "start", 0],
        [1, 4, "bump", 0],
        [2, 4, "gap", 0],
        [3, 4, "checkpoint", 0],
        [4, 4, "obstacle", 0],
        [5, 4, "straight", 0],
        [6, 4, "curve", 1],
        [6, 3, "rampup", 1],
        [6, 2, "seesaw", 1],
        [6, 1, "rampdown", 1],
        [6, 0, "curve", 0],
        [5, 0, "straight", 0],
        [4, 0, "checkpoint", 0],
        [3, 0, "silver", 0],
        [0, 0, "zone", 0], [1, 0, "zone", 0], [2, 0, "zone", 0],
        [0, 1, "zone", 2], [1, 1, "zone", 0], [2, 1, "zone", 0],
      ], [
        b(0.5, 0.5, "silver"),
        b(1.5, 0.4, "silver"),
        b(2.4, 1.5, "black"),
      ]),
  },
  {
    name: "10 · Nightmare",
    description: "Dense hazards, a trap junction, six victims. Good luck.",
    course: () =>
      build(8, 5, [
        [0, 4, "start", 0],
        [1, 4, "gap", 0],
        [2, 4, "obstacle", 0],
        [3, 4, "bump", 0],
        [4, 4, "gap", 0],
        [5, 4, "checkpoint", 0],
        [6, 4, "obstacle", 0],
        [7, 4, "curve", 1],
        [7, 3, "gap", 1],
        [7, 2, "seesaw", 1],
        [7, 1, "rampup", 1],
        [7, 0, "curve", 0],
        [6, 0, "gap", 0],
        [5, 0, "t", 0],
        [4, 0, "checkpoint", 0],
        [3, 0, "silver", 0],
        [0, 0, "zone", 0], [1, 0, "zone", 0], [2, 0, "zone", 0],
        [0, 1, "zone", 0], [1, 1, "zone", 0], [2, 1, "zone", 0],
        [0, 2, "zone", 2], [1, 2, "zone", 0], [2, 2, "zone", 0],
      ], [
        b(0.5, 0.5, "silver"),
        b(1.6, 0.4, "silver"),
        b(2.5, 1.2, "silver"),
        b(0.4, 1.6, "black"),
        b(1.5, 2.5, "black"),
        b(2.4, 2.4, "black"),
      ]),
  },
];

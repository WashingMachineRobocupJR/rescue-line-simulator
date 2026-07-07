// Simulation engine: differential-drive robot, pixel-sampled sensors,
// ball physics, scoring. Pure logic; rendering lives elsewhere.

import { Ball, Course, TILE, tileAt } from "./course";
import { classify } from "./render";

export const ROBOT_R = 34; // robot radius (px)
export const MAX_SPEED = 260; // px/s at motor=1
const TURN_FACTOR = 3.4; // rad/s at full differential
const PICKUP_DIST = ROBOT_R + 16;
const CAMERA_FOV = Math.PI * 0.5;
const CAMERA_RANGE = TILE * 2.2;

export interface RobotState {
  x: number;
  y: number;
  heading: number; // radians, 0 = +x
  ml: number; // motor left [-1, 1]
  mr: number;
  gripperClosed: boolean;
  heldBall: Ball | null;
}

export interface Detection {
  kind: "silver" | "black";
  angle: number; // radians relative to heading, + = right
  distance: number;
}

export interface Score {
  gaps: number;
  obstacles: number;
  intersections: number;
  victimsAlive: number;
  victimsDead: number;
  lops: number;
  total: number;
}

export interface SimEvent {
  t: number;
  msg: string;
}

export class Sim {
  course: Course;
  robot: RobotState;
  balls: Ball[];
  time = 0;
  scoredTiles = new Set<number>();
  score: Score = { gaps: 0, obstacles: 0, intersections: 0, victimsAlive: 0, victimsDead: 0, lops: 0, total: 0 };
  events: SimEvent[] = [];
  offLineSince = 0;
  finished = false;
  private world: CanvasRenderingContext2D;
  private img: ImageData;

  constructor(course: Course, world: CanvasRenderingContext2D) {
    this.course = course;
    this.world = world;
    this.img = world.getImageData(0, 0, course.cols * TILE, course.rows * TILE);
    this.balls = course.balls.map((b) => ({ ...b }));
    this.robot = this.spawn();
  }

  private spawn(): RobotState {
    for (let r = 0; r < this.course.rows; r++) {
      for (let c = 0; c < this.course.cols; c++) {
        const t = tileAt(this.course, c, r);
        if (t.kind === "start") {
          const heading = (t.rot * Math.PI) / 2;
          return {
            x: c * TILE + TILE / 2,
            y: r * TILE + TILE / 2,
            heading,
            ml: 0,
            mr: 0,
            gripperClosed: false,
            heldBall: null,
          };
        }
      }
    }
    return { x: TILE / 2, y: TILE / 2, heading: 0, ml: 0, mr: 0, gripperClosed: false, heldBall: null };
  }

  // ---------- pixel sampling ----------

  sample(x: number, y: number): "white" | "black" | "green" | "silver" | "wall" {
    const w = this.course.cols * TILE;
    const h = this.course.rows * TILE;
    const xi = Math.round(x);
    const yi = Math.round(y);
    if (xi < 0 || yi < 0 || xi >= w || yi >= h) return "wall";
    const i = (yi * w + xi) * 4;
    return classify(this.img.data[i], this.img.data[i + 1], this.img.data[i + 2]);
  }

  // ---------- sensors ----------

  lineSensors(n = 8): number[] {
    // a bar of n sensors mounted ahead of the wheel axle
    const out: number[] = [];
    const span = ROBOT_R * 1.7;
    const ahead = ROBOT_R * 0.75;
    const { x, y, heading } = this.robot;
    for (let i = 0; i < n; i++) {
      const off = (i / (n - 1) - 0.5) * span;
      const sx = x + Math.cos(heading) * ahead - Math.sin(heading) * off;
      const sy = y + Math.sin(heading) * ahead + Math.cos(heading) * off;
      const c = this.sample(sx, sy);
      out.push(c === "black" ? 1 : c === "green" ? 0.55 : 0);
    }
    return out;
  }

  colorSensors(): { left: string; right: string } {
    const { x, y, heading } = this.robot;
    const ahead = ROBOT_R * 0.75;
    const off = ROBOT_R * 0.62;
    const pick = (side: number) => {
      const sx = x + Math.cos(heading) * ahead - Math.sin(heading) * off * side;
      const sy = y + Math.sin(heading) * ahead + Math.cos(heading) * off * side;
      return this.sample(sx, sy);
    };
    return { left: pick(1), right: pick(-1) };
  }

  distance(angleOffset = 0): number {
    // raycast against walls/obstacles, in px
    const { x, y, heading } = this.robot;
    const a = heading + angleOffset;
    for (let d = ROBOT_R; d < TILE * 3; d += 3) {
      const c = this.sample(x + Math.cos(a) * d, y + Math.sin(a) * d);
      if (c === "wall") return d - ROBOT_R;
    }
    return TILE * 3;
  }

  zoneCamera(): Detection[] {
    const { x, y, heading } = this.robot;
    const out: Detection[] = [];
    for (const b of this.balls) {
      if (b.held || b.rescued) continue;
      const dx = b.x - x;
      const dy = b.y - y;
      const dist = Math.hypot(dx, dy);
      if (dist > CAMERA_RANGE) continue;
      let ang = Math.atan2(dy, dx) - heading;
      while (ang > Math.PI) ang -= 2 * Math.PI;
      while (ang < -Math.PI) ang += 2 * Math.PI;
      if (Math.abs(ang) > CAMERA_FOV / 2) continue;
      out.push({ kind: b.kind, angle: ang, distance: dist });
    }
    return out.sort((a, b) => a.distance - b.distance);
  }

  inZone(): boolean {
    const t = this.tileUnder();
    return t?.kind === "zone";
  }

  private tileUnder() {
    const c = Math.floor(this.robot.x / TILE);
    const r = Math.floor(this.robot.y / TILE);
    if (c < 0 || r < 0 || c >= this.course.cols || r >= this.course.rows) return null;
    return tileAt(this.course, c, r);
  }

  // ---------- actuation + physics ----------

  setMotors(l: number, r: number) {
    this.robot.ml = Math.max(-1, Math.min(1, l));
    this.robot.mr = Math.max(-1, Math.min(1, r));
  }

  setGripper(closed: boolean) {
    const rb = this.robot;
    if (closed && !rb.gripperClosed && !rb.heldBall) {
      // try to grab the nearest ball in front
      const noseX = rb.x + Math.cos(rb.heading) * ROBOT_R;
      const noseY = rb.y + Math.sin(rb.heading) * ROBOT_R;
      let best: Ball | null = null;
      let bestD = PICKUP_DIST;
      for (const b of this.balls) {
        if (b.held || b.rescued) continue;
        const d = Math.hypot(b.x - noseX, b.y - noseY);
        if (d < bestD) {
          best = b;
          bestD = d;
        }
      }
      if (best) {
        best.held = true;
        rb.heldBall = best;
        this.log(`picked up ${best.kind} ball`);
      }
    }
    if (!closed && rb.heldBall) {
      const b = rb.heldBall;
      b.held = false;
      b.x = rb.x + Math.cos(rb.heading) * (ROBOT_R + 12);
      b.y = rb.y + Math.sin(rb.heading) * (ROBOT_R + 12);
      rb.heldBall = null;
      this.checkRescue(b);
    }
    rb.gripperClosed = closed;
  }

  private checkRescue(b: Ball) {
    // evacuation corner lives on the zone tile with rot=2, bottom-right triangle
    for (let r = 0; r < this.course.rows; r++) {
      for (let c = 0; c < this.course.cols; c++) {
        const t = tileAt(this.course, c, r);
        if (t.kind === "zone" && t.rot === 2) {
          const cornerX = (c + 1) * TILE;
          const cornerY = (r + 1) * TILE;
          if (Math.hypot(b.x - cornerX, b.y - cornerY) < 100) {
            b.rescued = true;
            if (b.kind === "silver") {
              this.score.victimsAlive++;
              this.addPoints(40, "silver victim rescued");
            } else {
              this.score.victimsDead++;
              this.addPoints(20, "black victim rescued");
            }
          }
        }
      }
    }
  }

  step(dt: number) {
    if (this.finished) return;
    this.time += dt;
    const rb = this.robot;
    const v = ((rb.ml + rb.mr) / 2) * MAX_SPEED;
    const w = ((rb.mr - rb.ml) / 2) * TURN_FACTOR;
    rb.heading += w * dt;
    const nx = rb.x + Math.cos(rb.heading) * v * dt;
    const ny = rb.y + Math.sin(rb.heading) * v * dt;

    // collision: check the nose pixel
    const noseX = nx + Math.cos(rb.heading) * ROBOT_R * Math.sign(v || 1);
    const noseY = ny + Math.sin(rb.heading) * ROBOT_R * Math.sign(v || 1);
    if (this.sample(noseX, noseY) !== "wall") {
      rb.x = nx;
      rb.y = ny;
    }

    // held ball follows
    if (rb.heldBall) {
      rb.heldBall.x = rb.x + Math.cos(rb.heading) * (ROBOT_R + 6);
      rb.heldBall.y = rb.y + Math.sin(rb.heading) * (ROBOT_R + 6);
    }

    this.updateScoring(dt);
  }

  private updateScoring(dt: number) {
    const c = Math.floor(this.robot.x / TILE);
    const r = Math.floor(this.robot.y / TILE);
    const idx = r * this.course.cols + c;
    const t = this.tileUnder();
    if (!t) return;

    if (!this.scoredTiles.has(idx)) {
      if (t.kind === "gap") {
        this.scoredTiles.add(idx);
        this.score.gaps++;
        this.addPoints(10, "gap passed");
      } else if (t.kind === "obstacle") {
        this.scoredTiles.add(idx);
        this.score.obstacles++;
        this.addPoints(15, "obstacle passed");
      } else if (t.kind === "t" || t.kind === "cross") {
        this.scoredTiles.add(idx);
        this.score.intersections++;
        this.addPoints(10, "intersection passed");
      }
    }

    // lack of progress: too long without seeing the line, outside the zone
    if (t.kind === "zone") {
      this.offLineSince = 0;
      return;
    }
    const seesLine = this.lineSensors().some((v) => v > 0.5);
    if (seesLine) {
      this.offLineSince = 0;
    } else {
      this.offLineSince += dt;
      if (this.offLineSince > 5) {
        this.lop();
      }
    }
  }

  lop() {
    this.score.lops++;
    this.offLineSince = 0;
    this.log("lack of progress, back to start");
    const held = this.robot.heldBall;
    if (held) {
      held.held = false;
    }
    this.robot = this.spawn();
  }

  private addPoints(p: number, msg: string) {
    this.score.total += p;
    this.log(`+${p} ${msg}`);
  }

  private log(msg: string) {
    this.events.push({ t: this.time, msg });
    if (this.events.length > 200) this.events.shift();
  }
}

// ---------- user code runner ----------

export interface RobotApi {
  lineSensors(): number[];
  colorSensors(): { left: string; right: string };
  distance(angleOffset?: number): number;
  zoneCamera(): Detection[];
  inZone(): boolean;
  setMotors(l: number, r: number): void;
  gripper(closed: boolean): void;
  time(): number;
  log(msg: string): void;
}

export function makeApi(sim: Sim, logs: string[]): RobotApi {
  return {
    lineSensors: (n?: number) => sim.lineSensors(n),
    colorSensors: () => sim.colorSensors(),
    distance: (a?: number) => sim.distance(a),
    zoneCamera: () => sim.zoneCamera(),
    inZone: () => sim.inZone(),
    setMotors: (l, r) => sim.setMotors(l, r),
    gripper: (c) => sim.setGripper(c),
    time: () => sim.time,
    log: (m) => {
      logs.push(String(m));
      if (logs.length > 100) logs.shift();
    },
  };
}

export function compileRobot(code: string): ((api: RobotApi, state: Record<string, unknown>) => void) | string {
  try {
    // The user defines loop(robot, state); state persists between ticks.
    const factory = new Function(
      "api",
      "state",
      `"use strict";\n${code}\n;if (typeof loop !== "function") throw new Error("define a loop(robot, state) function");\nloop(api, state);`,
    );
    return factory as (api: RobotApi, state: Record<string, unknown>) => void;
  } catch (e) {
    return String(e);
  }
}

// Simulation engine: differential-drive robot with motor inertia,
// pixel-sampled sensors with optional noise, tile mechanics
// (checkpoints, seesaw, ramps, bumps, red end line), scoring with
// checkpoint-based lack of progress, and an 8-minute run clock.

import { Ball, Course, TILE, Tile, tileAt } from "./course";
import { classify } from "./render";

export const ROBOT_R = 34; // robot radius (px)
export const MAX_SPEED = 260; // px/s at motor=1
const TURN_FACTOR = 3.4; // rad/s at full differential
const MOTOR_TAU = 0.12; // s, motor response time constant
const PICKUP_DIST = ROBOT_R + 16;
const CAMERA_FOV = Math.PI * 0.5;
const CAMERA_RANGE = TILE * 2.2;
export const RUN_SECONDS = 8 * 60;

export interface SimOptions {
  noise: boolean; // sensor + motor noise
}

export interface RobotState {
  x: number;
  y: number;
  heading: number; // radians, 0 = +x
  ml: number; // commanded motor left [-1, 1]
  mr: number;
  vl: number; // actual motor output after inertia
  vr: number;
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
  bumps: number;
  seesaws: number;
  ramps: number;
  checkpoints: number;
  victimsAlive: number;
  victimsDead: number;
  lops: number;
  total: number;
}

export interface SimEvent {
  t: number;
  msg: string;
}

const zeroScore = (): Score => ({
  gaps: 0, obstacles: 0, intersections: 0, bumps: 0, seesaws: 0, ramps: 0,
  checkpoints: 0, victimsAlive: 0, victimsDead: 0, lops: 0, total: 0,
});

function gauss(sigma: number): number {
  // Box-Muller
  const u = 1 - Math.random();
  const v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v) * sigma;
}

export class Sim {
  course: Course;
  robot: RobotState;
  balls: Ball[];
  time = 0;
  score: Score = zeroScore();
  events: SimEvent[] = [];
  offLineSince = 0;
  finished: false | "time" | "red" = false;
  opts: SimOptions;
  private scoredTiles = new Set<number>();
  private respawn: { x: number; y: number; heading: number };
  private seesawWobble = 0;
  private world: CanvasRenderingContext2D;
  private img: ImageData;

  constructor(course: Course, world: CanvasRenderingContext2D, opts: SimOptions = { noise: true }) {
    this.course = course;
    this.world = world;
    this.opts = opts;
    this.img = world.getImageData(0, 0, course.cols * TILE, course.rows * TILE);
    this.balls = course.balls.map((b) => ({ ...b }));
    this.robot = this.spawn();
    this.respawn = { x: this.robot.x, y: this.robot.y, heading: this.robot.heading };
  }

  private spawn(): RobotState {
    for (let r = 0; r < this.course.rows; r++) {
      for (let c = 0; c < this.course.cols; c++) {
        const t = tileAt(this.course, c, r);
        if (t.kind === "start") {
          return this.freshRobot(c * TILE + TILE / 2, r * TILE + TILE / 2, (t.rot * Math.PI) / 2);
        }
      }
    }
    return this.freshRobot(TILE / 2, TILE / 2, 0);
  }

  private freshRobot(x: number, y: number, heading: number): RobotState {
    return { x, y, heading, ml: 0, mr: 0, vl: 0, vr: 0, gripperClosed: false, heldBall: null };
  }

  // ---------- pixel sampling ----------

  sample(x: number, y: number): ReturnType<typeof classify> {
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
    const out: number[] = [];
    const span = ROBOT_R * 1.7;
    const ahead = ROBOT_R * 0.75;
    const { x, y, heading } = this.robot;
    for (let i = 0; i < n; i++) {
      const off = (i / (n - 1) - 0.5) * span;
      const sx = x + Math.cos(heading) * ahead - Math.sin(heading) * off;
      const sy = y + Math.sin(heading) * ahead + Math.cos(heading) * off;
      const c = this.sample(sx, sy);
      let v = c === "black" ? 1 : c === "green" ? 0.55 : c === "red" ? 0.8 : 0;
      if (this.opts.noise) v = Math.min(1, Math.max(0, v + gauss(0.03)));
      out.push(v);
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
    const { x, y, heading } = this.robot;
    const a = heading + angleOffset;
    for (let d = ROBOT_R; d < TILE * 3; d += 3) {
      const c = this.sample(x + Math.cos(a) * d, y + Math.sin(a) * d);
      if (c === "wall") {
        const val = d - ROBOT_R;
        return this.opts.noise ? Math.max(0, val + gauss(1.5)) : val;
      }
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
      out.push({
        kind: b.kind,
        angle: this.opts.noise ? ang + gauss(0.015) : ang,
        distance: this.opts.noise ? dist + gauss(2) : dist,
      });
    }
    return out.sort((a, b) => a.distance - b.distance);
  }

  inZone(): boolean {
    return this.tileUnder()?.kind === "zone";
  }

  tileUnder(): Tile | null {
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
    if (this.time >= RUN_SECONDS) {
      this.finished = "time";
      this.log("time up");
      return;
    }

    const rb = this.robot;

    // motor inertia: actual output chases the command
    const k = 1 - Math.exp(-dt / MOTOR_TAU);
    let ml = rb.ml;
    let mr = rb.mr;
    if (this.opts.noise) {
      ml *= 1 + gauss(0.02);
      mr *= 1 + gauss(0.02);
    }
    rb.vl += (ml - rb.vl) * k;
    rb.vr += (mr - rb.vr) * k;

    // tile mechanics modify effective speed
    const tile = this.tileUnder();
    let speedFactor = 1;
    if (tile) {
      const alongRamp = Math.abs(Math.cos(rb.heading - (tile.rot * Math.PI) / 2));
      if (tile.kind === "rampup") speedFactor = 1 - 0.35 * alongRamp;
      if (tile.kind === "rampdown") speedFactor = 1 + 0.2 * alongRamp;
      if (tile.kind === "bump") {
        speedFactor = 0.72;
        if (this.opts.noise) rb.heading += gauss(0.012);
      }
      if (tile.kind === "seesaw") {
        this.seesawWobble = Math.min(this.seesawWobble + dt, 0.35);
        rb.heading += Math.sin(this.time * 18) * 0.004 * (this.seesawWobble / 0.35);
      } else {
        this.seesawWobble = 0;
      }
    }

    const v = ((rb.vl + rb.vr) / 2) * MAX_SPEED * speedFactor;
    const w = ((rb.vr - rb.vl) / 2) * TURN_FACTOR;
    rb.heading += w * dt;
    const nx = rb.x + Math.cos(rb.heading) * v * dt;
    const ny = rb.y + Math.sin(rb.heading) * v * dt;

    const noseX = nx + Math.cos(rb.heading) * ROBOT_R * Math.sign(v || 1);
    const noseY = ny + Math.sin(rb.heading) * ROBOT_R * Math.sign(v || 1);
    if (this.sample(noseX, noseY) !== "wall") {
      rb.x = nx;
      rb.y = ny;
    }

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
      const give = (points: number, key: keyof Score, msg: string) => {
        this.scoredTiles.add(idx);
        (this.score[key] as number)++;
        this.addPoints(points, msg);
      };
      if (t.kind === "gap") give(10, "gaps", "gap passed");
      else if (t.kind === "obstacle") give(15, "obstacles", "obstacle passed");
      else if (t.kind === "t" || t.kind === "cross") give(10, "intersections", "intersection passed");
      else if (t.kind === "bump") give(5, "bumps", "speed bumps passed");
      else if (t.kind === "seesaw") give(15, "seesaws", "seesaw passed");
      else if (t.kind === "rampup" || t.kind === "rampdown") give(10, "ramps", "ramp passed");
      else if (t.kind === "checkpoint") {
        this.scoredTiles.add(idx);
        this.score.checkpoints++;
        this.respawn = { x: c * TILE + TILE / 2, y: r * TILE + TILE / 2, heading: this.robot.heading };
        this.addPoints(10, "checkpoint reached");
      }
    }

    // red line ends the run when the robot is on the red segment
    if (t.kind === "red") {
      const front = this.colorSensors();
      if (front.left === "red" || front.right === "red") {
        this.finished = "red";
        this.log("red line: end of run");
        return;
      }
    }

    if (t.kind === "zone") {
      this.offLineSince = 0;
      return;
    }
    const seesLine = this.lineSensors().some((v) => v > 0.5);
    if (seesLine) {
      this.offLineSince = 0;
    } else {
      this.offLineSince += dt;
      if (this.offLineSince > 5) this.lop();
    }
  }

  lop() {
    this.score.lops++;
    this.offLineSince = 0;
    this.log("lack of progress, back to last checkpoint");
    const held = this.robot.heldBall;
    if (held) held.held = false;
    this.robot = this.freshRobot(this.respawn.x, this.respawn.y, this.respawn.heading);
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

// ---------- user code runner (JavaScript) ----------

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

// snapshot of everything the Python side needs for one tick
export function sensorSnapshot(sim: Sim) {
  return {
    line: sim.lineSensors(),
    color: sim.colorSensors(),
    dist_front: sim.distance(0),
    dist_left: sim.distance(-Math.PI / 3),
    dist_right: sim.distance(Math.PI / 3),
    camera: sim.zoneCamera(),
    in_zone: sim.inZone(),
    time: sim.time,
  };
}

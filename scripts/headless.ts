// Headless engine test: runs a preset robot on a course without a browser
// and prints what actually happens. Usage:
//   pnpm exec tsx scripts/headless.ts [presetIndex] [robotName] [seconds]

import { createCanvas } from "@napi-rs/canvas";
import { TILE, demoCourse } from "../lib/course";
import { renderCourse } from "../lib/render";
import { Sim, makeApi, compileRobot } from "../lib/sim";
import { PRESETS } from "../lib/presets";
import { ROBOT_PRESETS } from "../lib/robots";

const presetIdx = process.argv[2] ? parseInt(process.argv[2], 10) : -1;
const robotName = process.argv[3] ?? "PID Pro";
const seconds = process.argv[4] ? parseFloat(process.argv[4]) : 60;

const course = presetIdx >= 0 ? PRESETS[presetIdx].course() : demoCourse();
const canvas = createCanvas(course.cols * TILE, course.rows * TILE);
const ctx = canvas.getContext("2d") as unknown as CanvasRenderingContext2D;
renderCourse(ctx, course);

const sim = new Sim(course, ctx, { noise: false });
const robot = ROBOT_PRESETS.find((r) => r.lang === "js" && r.name.startsWith(robotName));
if (!robot) throw new Error(`robot not found: ${robotName}`);
const fn = compileRobot(robot.code);
if (typeof fn === "string") throw new Error(fn);

const logs: string[] = [];
const state: Record<string, unknown> = {};
const dt = 1 / 60;
let lastEvt = 0;

for (let i = 0; i < seconds * 60; i++) {
  fn(makeApi(sim, logs), state);
  sim.step(dt);
  if (sim.events.length > lastEvt) {
    for (const e of sim.events.slice(lastEvt)) console.log(`[${e.t.toFixed(1)}s] ${e.msg}`);
    lastEvt = sim.events.length;
  }
  if (i % 300 === 0) {
    const r = sim.robot;
    console.log(
      `t=${sim.time.toFixed(1)}s pos=(${(r.x / TILE).toFixed(2)},${(r.y / TILE).toFixed(2)}) ` +
      `head=${((r.heading * 180) / Math.PI % 360).toFixed(0)}deg motors=(${r.vl.toFixed(2)},${r.vr.toFixed(2)}) ` +
      `line=[${sim.lineSensors().map((v) => v.toFixed(1)).join(",")}]`,
    );
  }
  if (sim.finished) {
    console.log(`FINISHED (${sim.finished}) at t=${sim.time.toFixed(1)}s`);
    break;
  }
}
console.log("score:", JSON.stringify(sim.score));
if (logs.length) console.log("robot logs:", logs.slice(-10));

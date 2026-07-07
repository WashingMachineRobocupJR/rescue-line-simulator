// Ready-made robot programs, from a two-liner to a full state machine.
// The "Ultra" robots follow the architecture used by top camera-based
// Rescue Line teams: adaptive speed, timed maneuvers with line-reacquire
// exits, side-aware obstacle avoidance, and a phased evacuation strategy.

import { DEMO_ROBOT } from "./demoRobot";
import { DEMO_PYTHON } from "./pyRunner";

export interface RobotPreset {
  name: string;
  lang: "js" | "py";
  code: string;
}

const ROOKIE_JS = `// Rookie: the simplest possible line follower. Watch it struggle,
// then open "PID Pro" or "Ultra" to see how it should be done.

function loop(robot, state) {
  const s = robot.lineSensors();
  const left = s[0] + s[1] + s[2];
  const right = s[5] + s[6] + s[7];
  if (left > right + 0.2)      robot.setMotors(0.15, 0.6);
  else if (right > left + 0.2) robot.setMotors(0.6, 0.15);
  else                         robot.setMotors(0.5, 0.5);
}
`;

const ULTRA_JS = `// Ultra: a competition-style state machine.
// Adaptive speed, weave gap recovery, side-aware obstacle avoidance,
// dead-end turnaround on double green, phased evacuation strategy.

const KP = 1.9, KD = 10;

function lineError(s) {
  let sum = 0, weight = 0;
  for (let i = 0; i < s.length; i++) {
    sum += s[i];
    weight += s[i] * (i - (s.length - 1) / 2);
  }
  return sum < 0.3 ? null : weight / sum; // null = no line
}

function loop(robot, state) {
  state.phase = state.phase || "line";
  const t = robot.time();

  // ---------------- evacuation zone ----------------
  if (robot.inZone()) {
    if (state.phase !== "zone") { state.phase = "zone"; state.z = "scan"; state.zt = t; }
    zone(robot, state, t);
    return;
  }

  const s = robot.lineSensors();
  const color = robot.colorSensors();
  const err = lineError(s);

  // ---------------- red line: end of run ----------------
  if (color.left === "red" || color.right === "red") {
    robot.setMotors(0, 0);
    robot.log("red line: stopping");
    return;
  }

  // ---------------- timed maneuvers ----------------
  if (state.m) {
    const dt = t - state.m.start;
    const st = state.m.steps.find(x => dt < x.until);
    if (st) {
      robot.setMotors(st.l, st.r);
      return;
    }
    // maneuver finished: hand back once we see the line again
    if (err !== null) { state.m = null; state.lastErr = err; }
    else { robot.setMotors(0.5, 0.5); }
    if (state.m) return;
  }

  // ---------------- green markers ----------------
  const gl = color.left === "green", gr = color.right === "green";
  if (gl && gr) {           // double green: dead end, turn around
    state.m = { start: t, steps: [{ until: 1.15, l: -0.55, r: 0.55 }] };
    robot.log("double green: turning around");
    return;
  }
  if (gl) { state.m = { start: t, steps: [{ until: 0.25, l: 0.45, r: 0.45 }, { until: 0.95, l: -0.2, r: 0.72 }] }; return; }
  if (gr) { state.m = { start: t, steps: [{ until: 0.25, l: 0.45, r: 0.45 }, { until: 0.95, l: 0.72, r: -0.2 }] }; return; }

  // ---------------- obstacle: pick the freer side ----------------
  if (robot.distance(0) < 26) {
    const left = robot.distance(-1.1), right = robot.distance(1.1);
    const dir = left > right ? -1 : 1; // -1 = go around left
    state.m = {
      start: t,
      steps: [
        { until: 0.45, l: 0.55 * dir, r: -0.55 * dir },       // rotate away
        { until: 1.7,  l: dir < 0 ? 0.78 : 0.42, r: dir < 0 ? 0.42 : 0.78 }, // arc around
        { until: 2.6,  l: dir < 0 ? 0.42 : 0.7,  r: dir < 0 ? 0.7 : 0.42 },  // curl back in
      ],
    };
    robot.log("obstacle: going around " + (dir < 0 ? "left" : "right"));
    return;
  }

  // ---------------- gap: hold, then weave ----------------
  if (err === null) {
    state.gapStart = state.gapStart ?? t;
    const g = t - state.gapStart;
    if (g < 0.5)      robot.setMotors(0.55, 0.55);              // push straight
    else if (g < 2.2) robot.setMotors(0.5 + Math.sin(g * 6) * 0.25, 0.5 - Math.sin(g * 6) * 0.25); // weave
    else              robot.setMotors(0.35, -0.35);             // spin search
    return;
  }
  state.gapStart = null;

  // ---------------- adaptive PID ----------------
  const d = err - (state.lastErr ?? err);
  state.lastErr = err;
  const turn = (KP * err + KD * d) * 0.12;
  const base = 0.72 - Math.min(Math.abs(err) / 3.5, 1) * 0.34; // slow in curves
  robot.setMotors(base + turn, base - turn);
}

function zone(robot, state, t) {
  const balls = robot.zoneCamera();

  // stuck against a wall while trying to move: back off
  if (state.zStuck && t - state.zStuck < 0.7) { robot.setMotors(-0.55, -0.4); return; }

  if (state.z === "scan") {
    // prefer living victims (silver) first
    const target = balls.find(b => b.kind === "silver") ?? balls[0];
    if (target) { state.z = "approach"; }
    else if (t - state.zt > 5.5) {   // full spin done: relocate
      state.z = "explore"; state.zt = t;
    } else robot.setMotors(0.3, -0.3);
    if (state.z !== "approach") return;
  }

  if (state.z === "explore") {
    if (t - state.zt > 1.6) { state.z = "scan"; state.zt = t; return; }
    if (robot.distance(0) < 35) { state.zStuck = t; state.z = "scan"; state.zt = t; return; }
    robot.setMotors(0.6, 0.5);
    return;
  }

  if (state.z === "approach") {
    const target = balls.find(b => b.kind === "silver") ?? balls[0];
    if (!target) { state.z = "scan"; state.zt = t; return; }
    if (target.distance < 52) {
      robot.gripper(true);
      state.z = "carry"; state.zt = t;
      return;
    }
    const speed = Math.min(0.65, 0.25 + target.distance / 300);
    robot.setMotors(speed + target.angle * 0.9, speed - target.angle * 0.9);
    return;
  }

  if (state.z === "carry") {
    // wall-follow right until we hit the corner, then release
    const front = robot.distance(0);
    const right = robot.distance(0.7);
    if (front < 30) {
      robot.gripper(false);
      robot.setMotors(-0.5, -0.5);
      state.z = "backoff"; state.zt = t;
      return;
    }
    if (right > 65) robot.setMotors(0.62, 0.38);
    else if (right < 25) robot.setMotors(0.38, 0.62);
    else robot.setMotors(0.55, 0.55);
    return;
  }

  if (state.z === "backoff") {
    if (t - state.zt > 0.8) { state.z = "scan"; state.zt = t; return; }
    robot.setMotors(-0.5, -0.35);
    return;
  }
}
`;

const ULTRA_PY = `# Ultra (Python): competition-style state machine, sandboxed in your browser.
# Adaptive speed, weave gap recovery, side-aware obstacle avoidance,
# dead-end turnaround on double green, phased evacuation strategy.

import math

KP, KD = 1.9, 10.0

def line_error(s):
    total = sum(s)
    if total < 0.3:
        return None
    return sum(v * (i - (len(s) - 1) / 2) for i, v in enumerate(s)) / total

def loop(robot, state):
    t = robot.time()
    state.setdefault("phase", "line")

    if robot.in_zone():
        if state["phase"] != "zone":
            state.update(phase="zone", z="scan", zt=t)
        zone(robot, state, t)
        return

    s = robot.line_sensors()
    color = robot.color_sensors()
    err = line_error(s)

    if color["left"] == "red" or color["right"] == "red":
        robot.set_motors(0, 0)
        robot.log("red line: stopping")
        return

    # timed maneuver in progress
    m = state.get("m")
    if m:
        dt = t - m["start"]
        for until, l, r in m["steps"]:
            if dt < until:
                robot.set_motors(l, r)
                return
        if err is not None:
            state["m"] = None
            state["last_err"] = err
        else:
            robot.set_motors(0.5, 0.5)
            return

    gl = color["left"] == "green"
    gr = color["right"] == "green"
    if gl and gr:
        state["m"] = {"start": t, "steps": [(1.15, -0.55, 0.55)]}
        robot.log("double green: turning around")
        return
    if gl:
        state["m"] = {"start": t, "steps": [(0.25, 0.45, 0.45), (0.95, -0.2, 0.72)]}
        return
    if gr:
        state["m"] = {"start": t, "steps": [(0.25, 0.45, 0.45), (0.95, 0.72, -0.2)]}
        return

    if robot.distance("front") < 26:
        left = robot.distance("left")
        right = robot.distance("right")
        d = -1 if left > right else 1
        state["m"] = {"start": t, "steps": [
            (0.45, 0.55 * d, -0.55 * d),
            (1.7, 0.78 if d < 0 else 0.42, 0.42 if d < 0 else 0.78),
            (2.6, 0.42 if d < 0 else 0.7, 0.7 if d < 0 else 0.42),
        ]}
        robot.log("obstacle: going around " + ("left" if d < 0 else "right"))
        return

    if err is None:
        state.setdefault("gap_start", t)
        g = t - state["gap_start"]
        if g < 0.5:
            robot.set_motors(0.55, 0.55)
        elif g < 2.2:
            w = math.sin(g * 6) * 0.25
            robot.set_motors(0.5 + w, 0.5 - w)
        else:
            robot.set_motors(0.35, -0.35)
        return
    state["gap_start"] = None

    d_err = err - state.get("last_err", err)
    state["last_err"] = err
    turn = (KP * err + KD * d_err) * 0.12
    base = 0.72 - min(abs(err) / 3.5, 1) * 0.34
    robot.set_motors(base + turn, base - turn)

def zone(robot, state, t):
    balls = robot.zone_camera()
    z = state.get("z", "scan")

    if z == "scan":
        target = next((b for b in balls if b["kind"] == "silver"), balls[0] if balls else None)
        if target:
            state["z"] = "approach"
        elif t - state["zt"] > 5.5:
            state.update(z="explore", zt=t)
            return
        else:
            robot.set_motors(0.3, -0.3)
            return

    if state["z"] == "explore":
        if t - state["zt"] > 1.6 or robot.distance("front") < 35:
            state.update(z="scan", zt=t)
            return
        robot.set_motors(0.6, 0.5)
        return

    if state["z"] == "approach":
        target = next((b for b in balls if b["kind"] == "silver"), balls[0] if balls else None)
        if not target:
            state.update(z="scan", zt=t)
            return
        if target["distance"] < 52:
            robot.gripper(True)
            state.update(z="carry", zt=t)
            return
        speed = min(0.65, 0.25 + target["distance"] / 300)
        robot.set_motors(speed + target["angle"] * 0.9, speed - target["angle"] * 0.9)
        return

    if state["z"] == "carry":
        front = robot.distance("front")
        right = robot.distance("right")
        if front < 30:
            robot.gripper(False)
            robot.set_motors(-0.5, -0.5)
            state.update(z="backoff", zt=t)
            return
        if right > 65:
            robot.set_motors(0.62, 0.38)
        elif right < 25:
            robot.set_motors(0.38, 0.62)
        else:
            robot.set_motors(0.55, 0.55)
        return

    if state["z"] == "backoff":
        if t - state["zt"] > 0.8:
            state.update(z="scan", zt=t)
        else:
            robot.set_motors(-0.5, -0.35)
`;

export const ROBOT_PRESETS: RobotPreset[] = [
  { name: "Rookie (bang-bang)", lang: "js", code: ROOKIE_JS },
  { name: "PID Pro", lang: "js", code: DEMO_ROBOT },
  { name: "Ultra (state machine)", lang: "js", code: ULTRA_JS },
  { name: "PID Pro", lang: "py", code: DEMO_PYTHON },
  { name: "Ultra (state machine)", lang: "py", code: ULTRA_PY },
];

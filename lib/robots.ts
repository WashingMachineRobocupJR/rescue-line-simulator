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

  // evacuation zone
  if (robot.inZone()) {
    if (state.phase !== "zone") { state.phase = "zone"; state.z = "scan"; state.zt = t; }
    state.zoneExit = null;
    zone(robot, state, t);
    return;
  }
  if (state.phase === "zone") {
    // drifted out through the doorway: turn around and drive back in.
    // If that does not work within 3 s (e.g. a LoP moved us far away),
    // give up and go back to line following.
    state.zoneExit = state.zoneExit ?? t;
    const dt = t - state.zoneExit;
    if (dt > 3) { state.phase = "line"; state.zoneExit = null; }
    else if (dt < 0.9) { robot.setMotors(0.55, -0.55); return; }
    else { robot.setMotors(0.55, 0.55); return; }
  }

  const s = robot.lineSensors();
  const color = robot.colorSensors();
  const err = lineError(s);

  // red line: end of run
  if (color.left === "red" || color.right === "red") {
    robot.setMotors(0.3, 0.3); // roll onto the red line, the run ends there
    return;
  }

  // timed maneuvers
  if (state.m) {
    const dt = t - state.m.start;
    if (dt > 4.5) { state.m = null; }
  }
  if (state.m) {
    const dt = t - state.m.start;
    const st = state.m.steps.find(x => dt < x.until);
    if (st) {
      robot.setMotors(st.l, st.r);
      return;
    }
    // maneuver finished: hand back once we see the line again;
    // meanwhile arc toward where the line should be
    if (err !== null) { state.m = null; state.lastErr = err; }
    else {
      const seek = state.m.seek ?? [0.42, 0.42];
      robot.setMotors(seek[0], seek[1]);
      return;
    }
  }

  // green markers (with a cooldown so the same marker cannot re-trigger
  // right after the turn)
  const greenOk = !state.greenCd || t - state.greenCd > 1.6;
  const gl = greenOk && color.left === "green", gr = greenOk && color.right === "green";
  if (gl && gr) {           // double green: dead end, turn around
    state.greenCd = t;
    state.m = { start: t, steps: [{ until: 1.15, l: -0.55, r: 0.55 }] };
    robot.log("double green: turning around");
    return;
  }
  if (gl) { state.greenCd = t; state.m = { start: t, steps: [{ until: 0.28, l: 0.45, r: 0.45 }, { until: 1.3, l: -0.3, r: 0.78 }] }; return; }
  if (gr) { state.greenCd = t; state.m = { start: t, steps: [{ until: 0.28, l: 0.45, r: 0.45 }, { until: 1.3, l: 0.78, r: -0.3 }] }; return; }

  // obstacle: debounced, and only while centered on the line so that
  // doorway pillars and border walls do not trigger it
  const obsNear = robot.distance(0) < 26 && err !== null && Math.abs(err) < 1.2;
  state.obsTicks = obsNear ? (state.obsTicks ?? 0) + 1 : 0;
  if (state.obsTicks >= 4) {
    state.obsTicks = 0;
    const left = robot.distance(-1.1), right = robot.distance(1.1);
    const dir = left > right ? -1 : 1; // -1 = go around left
    state.m = {
      start: t,
      steps: [
        { until: 0.45, l: 0.55 * dir, r: -0.55 * dir },       // rotate away
        { until: 1.7,  l: dir < 0 ? 0.78 : 0.42, r: dir < 0 ? 0.42 : 0.78 }, // arc around
      ],
      seek: dir < 0 ? [0.62, 0.3] : [0.3, 0.62],              // curl back toward the line
    };
    robot.log("obstacle: going around " + (dir < 0 ? "left" : "right"));
    return;
  }

  // gap: hold, then weave
  if (err === null) {
    state.gapStart = state.gapStart ?? t;
    const g = t - state.gapStart;
    if (g < 0.5)      robot.setMotors(0.55, 0.55);              // push straight
    else if (g < 2.2) robot.setMotors(0.5 + Math.sin(g * 6) * 0.25, 0.5 - Math.sin(g * 6) * 0.25); // weave
    else              robot.setMotors(0.35, -0.35);             // spin search
    return;
  }
  state.gapStart = null;

  // adaptive PID
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
    // hunt the dark evacuation corner with the camera, deliver, back off
    const c = robot.corner();
    if (c) {
      if (c.distance < 62) {
        robot.gripper(false);
        robot.setMotors(-0.5, -0.5);
        state.z = "backoff"; state.zt = t;
        return;
      }
      const speed = Math.min(0.6, 0.25 + c.distance / 320);
      robot.setMotors(speed + c.angle * 0.9, speed - c.angle * 0.9);
      return;
    }
    // corner not in view: spin, and step away from walls that block sight
    if (robot.distance(0) < 30) { robot.setMotors(-0.5, -0.35); return; }
    if (t - state.zt > 4.5) { robot.setMotors(0.6, 0.45); if (t - state.zt > 6) state.zt = t; return; }
    robot.setMotors(0.3, -0.3);
    return;
  }

  if (state.z === "backoff") {
    if (t - state.zt > 1.4) { state.z = "scan"; state.zt = t; return; }
    robot.setMotors(-0.5, -0.35);
    return;
  }
}
`;

const ULTRA_PY = `# Ultra (Python): competition-style state machine, sandboxed in your browser.
# Adaptive speed, gap recovery, side-aware obstacle avoidance,
# dead-end turnaround on double green, camera-guided evacuation.

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
        state["zone_exit"] = None
        zone(robot, state, t)
        return
    if state["phase"] == "zone":
        # drifted out through the doorway: turn around and drive back in,
        # give up after 3 s (a LoP may have moved us far away)
        state.setdefault("zone_exit", t)
        dt = t - (state["zone_exit"] or t)
        if dt > 3:
            state["phase"] = "line"
            state["zone_exit"] = None
        elif dt < 0.9:
            robot.set_motors(0.55, -0.55)
            return
        else:
            robot.set_motors(0.55, 0.55)
            return

    s = robot.line_sensors()
    color = robot.color_sensors()
    err = line_error(s)

    if color["left"] == "red" or color["right"] == "red":
        robot.set_motors(0.3, 0.3)  # roll onto the red line, the run ends there
        return

    m = state.get("m")
    if m and t - m["start"] > 4.5:
        m = state["m"] = None  # stale maneuver (e.g. after a LoP)
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
            seek = m.get("seek", (0.42, 0.42))
            robot.set_motors(seek[0], seek[1])
            return

    # green markers, with a cooldown so the same marker cannot re-trigger
    green_ok = not state.get("green_cd") or t - state["green_cd"] > 1.6
    gl = green_ok and color["left"] == "green"
    gr = green_ok and color["right"] == "green"
    if gl and gr:
        state["green_cd"] = t
        state["m"] = {"start": t, "steps": [(1.15, -0.55, 0.55)]}
        robot.log("double green: turning around")
        return
    if gl:
        state["green_cd"] = t
        state["m"] = {"start": t, "steps": [(0.28, 0.45, 0.45), (1.3, -0.3, 0.78)]}
        return
    if gr:
        state["green_cd"] = t
        state["m"] = {"start": t, "steps": [(0.28, 0.45, 0.45), (1.3, 0.78, -0.3)]}
        return

    # obstacle: debounced, and only while centered on the line
    obs_near = robot.distance("front") < 26 and err is not None and abs(err) < 1.2
    state["obs_ticks"] = state.get("obs_ticks", 0) + 1 if obs_near else 0
    if state["obs_ticks"] >= 4:
        state["obs_ticks"] = 0
        d = -1 if robot.distance("left") > robot.distance("right") else 1
        state["m"] = {
            "start": t,
            "steps": [
                (0.45, 0.55 * d, -0.55 * d),
                (1.7, 0.78 if d < 0 else 0.42, 0.42 if d < 0 else 0.78),
            ],
            "seek": (0.62, 0.3) if d < 0 else (0.3, 0.62),
        }
        robot.log("obstacle: going around " + ("left" if d < 0 else "right"))
        return

    if err is None:
        # line lost: strong last error means a curve, arc back toward it
        last = state.get("last_err", 0)
        state.setdefault("lost_at", t)
        lost = t - state["lost_at"]
        if abs(last) > 1.0:
            d = 1 if last > 0 else -1
            if lost < 1.4:
                robot.set_motors(0.62 if d > 0 else 0.15, 0.15 if d > 0 else 0.62)
            else:
                robot.set_motors(0.4 * d, -0.4 * d)
            return
        if lost < 0.9:
            robot.set_motors(0.55, 0.55)  # gap: push through
        else:
            robot.set_motors(0.35, -0.35)
        return
    state["lost_at"] = None

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
        # hunt the dark evacuation corner with the camera, deliver, back off
        c = robot.corner()
        if c:
            if c["distance"] < 62:
                robot.gripper(False)
                robot.set_motors(-0.5, -0.5)
                state.update(z="backoff", zt=t)
                return
            speed = min(0.6, 0.25 + c["distance"] / 320)
            robot.set_motors(speed + c["angle"] * 0.9, speed - c["angle"] * 0.9)
            return
        if robot.distance("front") < 30:
            robot.set_motors(-0.5, -0.35)
            return
        robot.set_motors(0.3, -0.3)  # spin until the corner comes into view
        return

    if state["z"] == "backoff":
        if t - state["zt"] > 1.4:
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

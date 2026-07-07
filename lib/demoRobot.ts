// The example robot program shown in the editor on first load.

export const DEMO_ROBOT = `// Rescue Line robot. Define loop(robot, state): it runs every tick (~60/s).
// state persists between ticks. Docs: press "API" above the editor.

const BASE = 0.55;
const KP = 2.2, KD = 9;

function loop(robot, state) {
  // evacuation zone
  if (robot.inZone()) {
    const balls = robot.zoneCamera();

    // wedged against a wall: back out first
    if (state.escape) {
      if (robot.time() - state.escape > 0.7) state.escape = null;
      else { robot.setMotors(-0.5, -0.3); return; }
    }
    if (!state.holding && robot.distance(0) < 12) {
      state.escape = robot.time();
      return;
    }

    if (state.holding) {
      // find the dark evacuation corner with the camera and deliver
      const c = robot.corner();
      if (c) {
        if (c.distance < 62) {
          robot.gripper(false);
          state.holding = false;
          state.dropped = robot.time();
          robot.setMotors(-0.5, -0.5);
          return;
        }
        robot.setMotors(0.45 + c.angle * 0.9, 0.45 - c.angle * 0.9);
        return;
      }
      if (robot.distance(0) < 30) { robot.setMotors(-0.5, -0.35); return; }
      robot.setMotors(0.3, -0.3);   // spin until the corner comes into view
      return;
    }

    // just dropped one: back away so we do not grab it again
    if (state.dropped && robot.time() - state.dropped < 1.4) {
      robot.setMotors(-0.45, -0.55);
      return;
    }

    if (balls.length > 0) {
      const b = balls[0];
      if (b.distance < 55) {
        robot.gripper(true);
        state.holding = true;
        return;
      }
      robot.setMotors(0.5 + b.angle, 0.5 - b.angle);
      return;
    }

    robot.setMotors(0.35, -0.35); // scan
    return;
  }

  // green markers (cooldown avoids re-triggering on the same marker)
  const color = robot.colorSensors();
  const greenOk = !state.greenCd || robot.time() - state.greenCd > 1.6;
  if (greenOk && color.left === "green" && color.right !== "green") {
    state.greenCd = robot.time();
    state.greenDir = -1;
  }
  if (greenOk && color.right === "green" && color.left !== "green") {
    state.greenCd = robot.time();
    state.greenDir = 1;
  }
  if (state.greenCd && robot.time() - state.greenCd < 1.0) {
    const dir = state.greenDir;
    robot.setMotors(dir < 0 ? -0.3 : 0.78, dir < 0 ? 0.78 : -0.3);
    return;
  }

  const s = robot.lineSensors();
  let sum = 0, weight = 0;
  for (let i = 0; i < s.length; i++) {
    sum += s[i];
    weight += s[i] * (i - (s.length - 1) / 2);
  }
  const onLine = sum >= 0.3;

  // obstacle: only trust the distance sensor while we still see the line,
  // otherwise the course border wall triggers false positives
  if (onLine && robot.distance(0) < 26 && !state.avoiding) {
    state.avoiding = robot.time();
  }
  if (state.avoiding) {
    const dt = robot.time() - state.avoiding;
    if (dt > 3.4)             state.avoiding = null;     // safety timeout
    else if (dt < 0.45)       { robot.setMotors(-0.6, 0.6); return; }  // rotate off the line
    else if (dt > 0.9 && onLine) state.avoiding = null;  // rejoined
    else                      { robot.setMotors(0.82, 0.2); return; }  // tight arc around
  }

  if (!onLine) {
    // line lost. Large last error = we slid off a curve: arc toward that
    // side to re-intersect the line. Small error = a real gap: push through.
    const last = state.lastError ?? 0;
    state.lostAt = state.lostAt ?? robot.time();
    const lost = robot.time() - state.lostAt;
    if (Math.abs(last) > 1.0) {
      const dir = Math.sign(last);
      if (lost < 1.4) robot.setMotors(dir > 0 ? 0.62 : 0.15, dir > 0 ? 0.15 : 0.62);
      else robot.setMotors(dir * 0.4, -dir * 0.4);       // tight spin fallback
      return;
    }
    if (lost < 0.9) robot.setMotors(BASE, BASE);         // push through the gap
    else robot.setMotors(0.35, -0.35);                   // then spin to search
    return;
  }
  state.lostAt = null;

  const error = weight / sum;
  const d = error - (state.lastError ?? error);
  state.lastError = error;
  const turn = (KP * error + KD * d) * 0.12;
  const base = BASE - Math.min(Math.abs(error) / 3.5, 1) * 0.25;
  robot.setMotors(base + turn, base - turn);
}
`;

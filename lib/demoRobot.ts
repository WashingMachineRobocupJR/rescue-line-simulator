// The example robot program shown in the editor on first load.

export const DEMO_ROBOT = `// Rescue Line robot. Define loop(robot, state): it runs every tick (~60/s).
// state persists between ticks. Docs: press "API" above the editor.

const BASE = 0.55;     // base speed
const KP = 1.6, KD = 8; // PID gains (try tuning them!)

function loop(robot, state) {
  state.phase = state.phase || "line";

  // ---------- evacuation zone ----------
  if (robot.inZone()) {
    const balls = robot.zoneCamera();
    const holding = state.holding;

    if (holding) {
      // carry it to the dark evacuation corner: rough strategy,
      // hug the right wall until we bump the corner, then release
      const front = robot.distance(0);
      const right = robot.distance(0.6);
      if (front < 30) {
        robot.gripper(false);       // drop
        state.holding = false;
        robot.setMotors(-0.5, -0.5);
      } else if (right > 60) {
        robot.setMotors(0.6, 0.35); // drift right
      } else {
        robot.setMotors(0.5, 0.5);
      }
      return;
    }

    if (balls.length > 0) {
      const b = balls[0];
      if (b.distance < 55) {
        robot.gripper(true);        // grab
        state.holding = true;
        return;
      }
      // steer toward the ball
      robot.setMotors(0.5 + b.angle, 0.5 - b.angle);
      return;
    }

    // no ball in sight: spin to scan
    robot.setMotors(0.35, -0.35);
    return;
  }

  // ---------- green markers ----------
  const color = robot.colorSensors();
  if (color.left === "green" && color.right !== "green") {
    robot.setMotors(-0.25, 0.75);   // turn left
    return;
  }
  if (color.right === "green" && color.left !== "green") {
    robot.setMotors(0.75, -0.25);   // turn right
    return;
  }

  // ---------- obstacle ----------
  if (robot.distance(0) < 25) {
    // go around the block on the left
    if (!state.avoiding) { state.avoiding = robot.time(); }
  }
  if (state.avoiding) {
    const dt = robot.time() - state.avoiding;
    if (dt < 0.5)      robot.setMotors(-0.6, 0.6);  // rotate left
    else if (dt < 1.6) robot.setMotors(0.75, 0.45); // arc around
    else if (robot.lineSensors().some(v => v > 0.5)) state.avoiding = null;
    else               robot.setMotors(0.75, 0.45);
    return;
  }

  // ---------- PID line following ----------
  const s = robot.lineSensors(); // 8 values, 1 = black
  let sum = 0, weight = 0;
  for (let i = 0; i < s.length; i++) {
    sum += s[i];
    weight += s[i] * (i - (s.length - 1) / 2);
  }

  if (sum < 0.3) {
    // gap: hold your heading and push through
    robot.setMotors(BASE, BASE);
    return;
  }

  const error = weight / sum;                    // -3.5 .. 3.5
  const d = error - (state.lastError ?? error);  // derivative
  state.lastError = error;
  const turn = (KP * error + KD * d) * 0.12;
  robot.setMotors(BASE + turn, BASE - turn);
}
`;

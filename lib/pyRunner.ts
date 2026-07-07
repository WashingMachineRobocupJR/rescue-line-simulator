// Main-thread wrapper around the Pyodide worker. Sends sensor snapshots,
// receives motor commands. If a tick stalls (user wrote an infinite loop),
// the worker is terminated.

export interface PyCommand {
  ml: number;
  mr: number;
  grip: boolean | null;
  logs: string[];
}

export interface PyFile {
  name: string;
  content: string;
}

const TICK_TIMEOUT_MS = 2000;

export class PyRunner {
  private worker: Worker | null = null;
  private pending: ((v: PyCommand | null) => void) | null = null;
  private stallTimer: ReturnType<typeof setTimeout> | null = null;
  busy = false;
  lastError: string | null = null;

  async init(files: PyFile[], onProgress?: (msg: string) => void): Promise<string | null> {
    this.dispose();
    onProgress?.("starting Python runtime (first load downloads ~10 MB, then cached)...");
    this.worker = new Worker("/py-worker.js");
    return new Promise((resolve) => {
      this.worker!.onmessage = (e) => {
        if (e.data.type === "ready") resolve(null);
        else resolve(e.data.error ?? "unknown init error");
      };
      this.worker!.onerror = (e) => resolve(String(e.message ?? e));
      this.worker!.postMessage({ type: "init", files });
    });
  }

  tick(snapshot: unknown): Promise<PyCommand | null> {
    if (!this.worker || this.busy) return Promise.resolve(null);
    this.busy = true;
    return new Promise((resolve) => {
      this.pending = resolve;
      this.stallTimer = setTimeout(() => {
        this.lastError = "Python tick took more than 2 s (infinite loop?). Runtime stopped.";
        this.dispose();
        resolve(null);
      }, TICK_TIMEOUT_MS);
      this.worker!.onmessage = (e) => {
        if (this.stallTimer) clearTimeout(this.stallTimer);
        this.busy = false;
        if (e.data.type === "cmd") {
          resolve(e.data.cmd as PyCommand);
        } else {
          this.lastError = e.data.error ?? "unknown error";
          resolve(null);
        }
      };
      this.worker!.postMessage({ type: "tick", snapshot });
    });
  }

  dispose() {
    if (this.stallTimer) clearTimeout(this.stallTimer);
    this.worker?.terminate();
    this.worker = null;
    this.busy = false;
    this.pending = null;
  }
}

export const DEMO_PYTHON = `# Rescue Line robot in Python. Runs sandboxed in YOUR browser (Pyodide).
# Define loop(robot, state). Allowed imports: math, random, json, ...
# Network, filesystem and JS access are blocked.

KP, KD = 2.2, 9.0
BASE = 0.55

def loop(robot, state):
    t = robot.time()

    # evacuation zone
    if robot.in_zone():
        balls = robot.zone_camera()

        if state.get("escape"):
            if t - state["escape"] > 0.7:
                state["escape"] = None
            else:
                robot.set_motors(-0.5, -0.3)
                return
        if not state.get("holding") and robot.distance("front") < 12:
            state["escape"] = t
            return

        if state.get("holding"):
            # find the dark evacuation corner with the camera and deliver
            c = robot.corner()
            if c:
                if c["distance"] < 62:
                    robot.gripper(False)
                    state["holding"] = False
                    state["dropped"] = t
                    robot.set_motors(-0.5, -0.5)
                    return
                robot.set_motors(0.45 + c["angle"] * 0.9, 0.45 - c["angle"] * 0.9)
                return
            if robot.distance("front") < 30:
                robot.set_motors(-0.5, -0.35)
                return
            robot.set_motors(0.3, -0.3)  # spin until the corner comes into view
            return

        # just dropped one: back away so we do not grab it again
        if state.get("dropped") and t - state["dropped"] < 1.4:
            robot.set_motors(-0.45, -0.55)
            return

        if balls:
            b = balls[0]
            if b["distance"] < 55:
                robot.gripper(True)
                state["holding"] = True
                return
            robot.set_motors(0.5 + b["angle"], 0.5 - b["angle"])
            return

        robot.set_motors(0.35, -0.35)  # scan
        return

    # green markers (cooldown avoids re-triggering on the same marker)
    color = robot.color_sensors()
    green_ok = not state.get("green_cd") or t - state["green_cd"] > 1.6
    if green_ok and color["left"] == "green" and color["right"] != "green":
        state["green_cd"] = t
        state["green_dir"] = -1
    if green_ok and color["right"] == "green" and color["left"] != "green":
        state["green_cd"] = t
        state["green_dir"] = 1
    if state.get("green_cd") and t - state["green_cd"] < 1.0:
        d = state["green_dir"]
        robot.set_motors(-0.3 if d < 0 else 0.78, 0.78 if d < 0 else -0.3)
        return

    s = robot.line_sensors()
    total = sum(s)
    on_line = total >= 0.3

    # obstacle: only trust the distance sensor while we still see the line
    if on_line and robot.distance("front") < 26 and not state.get("avoiding"):
        state["avoiding"] = t
    if state.get("avoiding"):
        dt = t - state["avoiding"]
        if dt > 3.4:
            state["avoiding"] = None
        elif dt < 0.45:
            robot.set_motors(-0.6, 0.6)   # rotate off the line
            return
        elif dt > 0.9 and on_line:
            state["avoiding"] = None      # rejoined
        else:
            robot.set_motors(0.82, 0.2)   # tight arc around
            return

    if not on_line:
        # line lost: strong last error means a curve, arc back toward it
        last = state.get("last_error", 0)
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
            robot.set_motors(BASE, BASE)  # gap: push through
        else:
            robot.set_motors(0.35, -0.35)
        return
    state["lost_at"] = None

    error = sum(v * (i - (len(s) - 1) / 2) for i, v in enumerate(s)) / total
    d = error - state.get("last_error", error)
    state["last_error"] = error
    turn = (KP * error + KD * d) * 0.12
    base = BASE - min(abs(error) / 3.5, 1) * 0.25
    robot.set_motors(base + turn, base - turn)
`;

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

KP, KD = 1.6, 8.0
BASE = 0.55

def loop(robot, state):
    # evacuation zone
    if robot.in_zone():
        balls = robot.zone_camera()
        if state.get("holding"):
            if robot.distance("front") < 30:
                robot.gripper(False)
                state["holding"] = False
                robot.set_motors(-0.5, -0.5)
            elif robot.distance("right") > 60:
                robot.set_motors(0.6, 0.35)
            else:
                robot.set_motors(0.5, 0.5)
            return
        if balls:
            b = balls[0]
            if b["distance"] < 55:
                robot.gripper(True)
                state["holding"] = True
                return
            robot.set_motors(0.5 + b["angle"], 0.5 - b["angle"])
            return
        robot.set_motors(0.35, -0.35)
        return

    # green markers
    color = robot.color_sensors()
    if color["left"] == "green" and color["right"] != "green":
        robot.set_motors(-0.25, 0.75)
        return
    if color["right"] == "green" and color["left"] != "green":
        robot.set_motors(0.75, -0.25)
        return

    # obstacle
    if robot.distance("front") < 25 and not state.get("avoiding"):
        state["avoiding"] = robot.time()
    if state.get("avoiding"):
        dt = robot.time() - state["avoiding"]
        if dt < 0.5:
            robot.set_motors(-0.6, 0.6)
        elif dt < 1.6:
            robot.set_motors(0.75, 0.45)
        elif any(v > 0.5 for v in robot.line_sensors()):
            state["avoiding"] = None
        else:
            robot.set_motors(0.75, 0.45)
        return

    # PID line following
    s = robot.line_sensors()
    total = sum(s)
    if total < 0.3:
        robot.set_motors(BASE, BASE)  # gap: push through
        return
    error = sum(v * (i - (len(s) - 1) / 2) for i, v in enumerate(s)) / total
    d = error - state.get("last_error", error)
    state["last_error"] = error
    turn = (KP * error + KD * d) * 0.12
    robot.set_motors(BASE + turn, BASE - turn)
`;

/*
 * Python robot runtime. Runs entirely inside this Web Worker via Pyodide
 * (CPython compiled to WebAssembly): user code never touches a server and
 * never touches the page. Defense in depth on top of the WASM sandbox:
 *
 *  1. Static validation: imports of network / process / FFI / JS-bridge
 *     modules are rejected before anything runs.
 *  2. The `js` bridge module (Pyodide's door to the DOM, cookies, fetch)
 *     is disabled inside the interpreter, along with pyodide's http helpers.
 *  3. The worker itself has no credentials: it holds no tokens and the
 *     page's cookies/localStorage are not reachable from a worker + WASM.
 *  4. A stalled tick (infinite loop) gets the worker terminated by the
 *     main thread.
 */

/* eslint-disable no-undef */

const PYODIDE_URL = "https://cdn.jsdelivr.net/pyodide/v0.26.4/full/pyodide.js";

// modules that user code may not import
const FORBIDDEN = [
  "js", "pyodide", "pyodide_js", "micropip",
  "socket", "ssl", "http", "urllib", "urllib3", "requests", "aiohttp",
  "ftplib", "smtplib", "poplib", "imaplib", "telnetlib", "xmlrpc",
  "subprocess", "ctypes", "cffi", "multiprocessing", "threading",
  "webbrowser", "importlib", "shutil", "pathlib", "os", "sys",
];

const IMPORT_RE = new RegExp(
  "^\\s*(?:import|from)\\s+(" + FORBIDDEN.join("|") + ")\\b",
  "m",
);
const DUNDER_RE = /__(?:import|builtins|loader|spec|subclasses|globals)__/;

function validate(name, source) {
  const m = source.match(IMPORT_RE);
  if (m) return `${name}: import of "${m[1]}" is not allowed in the simulator`;
  if (DUNDER_RE.test(source)) return `${name}: dunder access (__import__ and friends) is not allowed`;
  if (/getattr\s*\(/.test(source) && /["'](?:__)/.test(source)) {
    return `${name}: getattr with dunder strings is not allowed`;
  }
  return null;
}

const HARNESS = `
import sys, json

# close the JS bridge from inside the interpreter as well
for _blocked in ("js", "pyodide_js", "micropip"):
    sys.modules[_blocked] = None

class Robot:
    """API mirror of the JavaScript robot."""
    def __init__(self, snap, cmd):
        self._s = snap
        self._c = cmd
    def line_sensors(self):
        return self._s["line"]
    def color_sensors(self):
        return self._s["color"]
    def distance(self, side="front"):
        return self._s["dist_" + side]
    def zone_camera(self):
        return self._s["camera"]
    def in_zone(self):
        return self._s["in_zone"]
    def time(self):
        return self._s["time"]
    def set_motors(self, l, r):
        self._c["ml"] = max(-1.0, min(1.0, float(l)))
        self._c["mr"] = max(-1.0, min(1.0, float(r)))
    def gripper(self, closed):
        self._c["grip"] = bool(closed)
    def log(self, msg):
        if len(self._c["logs"]) < 20:
            self._c["logs"].append(str(msg))

STATE = {}

def _tick(snap_json):
    snap = json.loads(snap_json)
    cmd = {"ml": 0.0, "mr": 0.0, "grip": None, "logs": []}
    loop(Robot(snap, cmd), STATE)
    return json.dumps(cmd)
`;

let pyodide = null;

async function init(files) {
  for (const f of files) {
    const err = validate(f.name, f.content);
    if (err) return { type: "error", error: err };
  }
  if (!pyodide) {
    importScripts(PYODIDE_URL);
    pyodide = await loadPyodide({ indexURL: PYODIDE_URL.replace(/pyodide\.js$/, "") });
  }
  try {
    // user modules become importable files
    for (const f of files) {
      if (f.name !== "main.py") pyodide.FS.writeFile(f.name, f.content);
    }
    pyodide.runPython(HARNESS);
    const main = files.find((f) => f.name === "main.py") ?? files[0];
    pyodide.runPython(main.content);
    pyodide.runPython('assert callable(globals().get("loop")), "define a loop(robot, state) function in main.py"');
    return { type: "ready" };
  } catch (e) {
    return { type: "error", error: String(e) };
  }
}

function tick(snapshot) {
  try {
    const out = pyodide.globals.get("_tick")(JSON.stringify(snapshot));
    return { type: "cmd", cmd: JSON.parse(out) };
  } catch (e) {
    return { type: "error", error: String(e) };
  }
}

self.onmessage = async (e) => {
  const msg = e.data;
  if (msg.type === "init") {
    self.postMessage(await init(msg.files));
  } else if (msg.type === "tick") {
    self.postMessage(tick(msg.snapshot));
  }
};

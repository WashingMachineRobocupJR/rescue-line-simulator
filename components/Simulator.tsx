"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import {
  Ball,
  Course,
  TILE,
  Tile,
  TileKind,
  demoCourse,
  deserialize,
  resizeCourse,
  serialize,
} from "@/lib/course";
import { renderCourse } from "@/lib/render";
import {
  Sim,
  makeApi,
  compileRobot,
  sensorSnapshot,
  ROBOT_R,
  RUN_SECONDS,
  RobotApi,
} from "@/lib/sim";
import { DEMO_ROBOT } from "@/lib/demoRobot";
import { PyRunner, DEMO_PYTHON, PyFile } from "@/lib/pyRunner";
import { PRESETS } from "@/lib/presets";
import { ROBOT_PRESETS } from "@/lib/robots";

const Monaco = dynamic(() => import("@monaco-editor/react"), { ssr: false });

const PALETTE: Array<{ kind: TileKind; label: string }> = [
  { kind: "straight", label: "Straight" },
  { kind: "curve", label: "Curve" },
  { kind: "t", label: "T junction" },
  { kind: "cross", label: "Cross" },
  { kind: "gap", label: "Gap" },
  { kind: "obstacle", label: "Obstacle" },
  { kind: "bump", label: "Speed bumps" },
  { kind: "seesaw", label: "Seesaw" },
  { kind: "rampup", label: "Ramp up" },
  { kind: "rampdown", label: "Ramp down" },
  { kind: "checkpoint", label: "Checkpoint" },
  { kind: "silver", label: "Silver strip" },
  { kind: "red", label: "Red end" },
  { kind: "start", label: "Start" },
  { kind: "zone", label: "Zone" },
];

type Tool = "paint" | "rotate" | "marker" | "ball-silver" | "ball-black" | "erase";
type Mode = "edit" | "run";
type Lang = "js" | "py";

export function Simulator() {
  const [course, setCourse] = useState<Course>(() => {
    if (typeof window !== "undefined" && window.location.hash.length > 2) {
      const c = deserialize(window.location.hash.slice(1));
      if (c) return c;
    }
    return demoCourse();
  });
  const [mode, setMode] = useState<Mode>("run");
  const [tool, setTool] = useState<Tool>("paint");
  const [brush, setBrush] = useState<TileKind>("straight");
  const [running, setRunning] = useState(false);
  const [lang, setLang] = useState<Lang>("js");
  const [jsCode, setJsCode] = useState(DEMO_ROBOT);
  const [pyCode, setPyCode] = useState(DEMO_PYTHON);
  const [pyFiles, setPyFiles] = useState<PyFile[]>([]);
  const [noise, setNoise] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [hud, setHud] = useState({ total: 0, lops: 0, time: 0, finished: false as false | string });
  const [logs, setLogs] = useState<string[]>([]);
  const [showApi, setShowApi] = useState(false);

  const screenRef = useRef<HTMLCanvasElement>(null);
  const worldRef = useRef<HTMLCanvasElement | null>(null);
  const simRef = useRef<Sim | null>(null);
  const loopFnRef = useRef<((api: RobotApi, state: Record<string, unknown>) => void) | null>(null);
  const stateRef = useRef<Record<string, unknown>>({});
  const logsRef = useRef<string[]>([]);
  const runningRef = useRef(false);
  const pyRef = useRef<PyRunner | null>(null);
  const langRef = useRef<Lang>("js");
  const noiseRef = useRef(true);

  langRef.current = lang;
  noiseRef.current = noise;

  const W = course.cols * TILE;
  const H = course.rows * TILE;

  const rebuildWorld = useCallback(() => {
    const world = document.createElement("canvas");
    world.width = W;
    world.height = H;
    const ctx = world.getContext("2d", { willReadFrequently: true })!;
    renderCourse(ctx, course);
    worldRef.current = world;
    simRef.current = new Sim(course, ctx, { noise: noiseRef.current });
    stateRef.current = {};
    logsRef.current = [];
  }, [course, W, H]);

  useEffect(() => {
    rebuildWorld();
  }, [rebuildWorld]);

  const start = async () => {
    setError(null);
    if (lang === "js") {
      const fn = compileRobot(jsCode);
      if (typeof fn === "string") {
        setError(fn);
        return;
      }
      loopFnRef.current = fn;
    } else {
      const runner = new PyRunner();
      pyRef.current?.dispose();
      pyRef.current = runner;
      setStatus("starting Python runtime (first load ~10 MB, then cached)...");
      const files: PyFile[] = [{ name: "main.py", content: pyCode }, ...pyFiles];
      const err = await runner.init(files, setStatus);
      setStatus(null);
      if (err) {
        setError(err);
        return;
      }
    }
    rebuildWorld();
    runningRef.current = true;
    setRunning(true);
  };

  const stop = () => {
    runningRef.current = false;
    setRunning(false);
  };

  const reset = () => {
    stop();
    pyRef.current?.dispose();
    rebuildWorld();
    setHud({ total: 0, lops: 0, time: 0, finished: false });
    setLogs([]);
    setError(null);
  };

  const draw = useCallback(() => {
    const screen = screenRef.current;
    const world = worldRef.current;
    const sim = simRef.current;
    if (!screen || !world || !sim) return;
    const ctx = screen.getContext("2d")!;
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(world, 0, 0);

    for (const b of sim.balls) {
      if (b.rescued) continue;
      ctx.beginPath();
      ctx.arc(b.x, b.y, 13, 0, Math.PI * 2);
      ctx.fillStyle = b.kind === "silver" ? "#d8dbe2" : "#20242b";
      ctx.fill();
      ctx.strokeStyle = "#00000033";
      ctx.stroke();
    }

    const r = sim.robot;
    ctx.save();
    ctx.translate(r.x, r.y);
    ctx.rotate(r.heading);
    ctx.fillStyle = "#7A2BFF";
    ctx.beginPath();
    ctx.arc(0, 0, ROBOT_R, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(ROBOT_R - 14, -8, 12, 16);
    ctx.strokeStyle = r.gripperClosed ? "#FF7A3D" : "#ffffff";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(ROBOT_R + 2, 0, 12, -1.1, 1.1);
    ctx.stroke();
    ctx.restore();
  }, [W, H]);

  // main loop
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let lastPyCmd = { ml: 0, mr: 0 };
    const tick = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      const sim = simRef.current;
      if (sim && runningRef.current && !sim.finished) {
        if (langRef.current === "js" && loopFnRef.current) {
          try {
            loopFnRef.current(makeApi(sim, logsRef.current), stateRef.current);
          } catch (e) {
            setError(String(e));
            runningRef.current = false;
            setRunning(false);
          }
        } else if (langRef.current === "py" && pyRef.current) {
          const runner = pyRef.current;
          if (!runner.busy) {
            runner.tick(sensorSnapshot(sim)).then((cmd) => {
              if (cmd) {
                lastPyCmd = cmd;
                if (cmd.grip !== null) sim.setGripper(cmd.grip);
                for (const l of cmd.logs) {
                  logsRef.current.push(l);
                  if (logsRef.current.length > 100) logsRef.current.shift();
                }
              } else if (runner.lastError) {
                setError(runner.lastError);
                runningRef.current = false;
                setRunning(false);
              }
            });
          }
          sim.setMotors(lastPyCmd.ml, lastPyCmd.mr);
        }
        sim.step(dt);
        setHud({
          total: sim.score.total,
          lops: sim.score.lops,
          time: sim.time,
          finished: sim.finished ? (sim.finished === "red" ? "Run complete: red line!" : "Time up!") : false,
        });
        setLogs([
          ...logsRef.current.slice(-5),
          ...sim.events.slice(-4).map((e) => `[${e.t.toFixed(1)}s] ${e.msg}`),
        ]);
      }
      draw();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [draw]);

  // ---------- editing ----------

  const canvasPoint = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = screenRef.current!.getBoundingClientRect();
    const scale = W / rect.width;
    return { x: (e.clientX - rect.left) * scale, y: (e.clientY - rect.top) * scale };
  };

  const onCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (mode !== "edit") return;
    const { x, y } = canvasPoint(e);
    const col = Math.floor(x / TILE);
    const row = Math.floor(y / TILE);
    if (col < 0 || row < 0 || col >= course.cols || row >= course.rows) return;
    const idx = row * course.cols + col;

    if (tool === "ball-silver" || tool === "ball-black") {
      const kind = tool === "ball-silver" ? "silver" : "black";
      setCourse({ ...course, balls: [...course.balls, { x, y, kind } as Ball] });
      return;
    }
    if (tool === "erase") {
      // remove a ball if clicked near one, otherwise clear the tile
      const near = course.balls.findIndex((b) => Math.hypot(b.x - x, b.y - y) < 24);
      if (near >= 0) {
        setCourse({ ...course, balls: course.balls.filter((_, i) => i !== near) });
      } else {
        const tiles = course.tiles.map((t, i) => (i === idx ? { kind: "empty" as TileKind, rot: 0 as const, marker: "none" as const } : t));
        setCourse({ ...course, tiles });
      }
      return;
    }

    const tiles = course.tiles.map((t, i): Tile => {
      if (i !== idx) return t;
      if (tool === "rotate") return { ...t, rot: ((t.rot + 1) % 4) as Tile["rot"] };
      if (tool === "marker") {
        const next = t.marker === "none" ? "left" : t.marker === "left" ? "right" : t.marker === "right" ? "both" : "none";
        return { ...t, marker: next };
      }
      // paint
      if (t.kind === brush) return { ...t, rot: ((t.rot + 1) % 4) as Tile["rot"] };
      return { kind: brush, rot: 0, marker: "none" };
    });
    setCourse({ ...course, tiles });
  };

  const resize = (dc: number, dr: number) => {
    const cols = Math.max(3, Math.min(14, course.cols + dc));
    const rows = Math.max(3, Math.min(10, course.rows + dr));
    setCourse(resizeCourse(course, cols, rows));
  };

  const share = () => {
    const hash = serialize(course);
    window.history.replaceState(null, "", `#${hash}`);
    navigator.clipboard?.writeText(`${window.location.origin}${window.location.pathname}#${hash}`);
    setStatus("course link copied to clipboard");
    setTimeout(() => setStatus(null), 2500);
  };

  const uploadPy = (files: FileList) => {
    const readers = Array.from(files)
      .filter((f) => f.name.endsWith(".py"))
      .map(
        (f) =>
          new Promise<PyFile>((res) => {
            const r = new FileReader();
            r.onload = () => res({ name: f.name.replace(/[^a-zA-Z0-9._-]/g, "_"), content: String(r.result) });
            r.readAsText(f);
          }),
      );
    Promise.all(readers).then((fs) => {
      const main = fs.find((f) => f.name === "main.py");
      const rest = fs.filter((f) => f.name !== "main.py");
      if (main) setPyCode(main.content);
      setPyFiles((prev) => {
        const names = new Set(rest.map((f) => f.name));
        return [...prev.filter((p) => !names.has(p.name)), ...rest];
      });
    });
  };

  const remaining = useMemo(() => {
    const left = Math.max(RUN_SECONDS - hud.time, 0);
    const t = Math.ceil(left);
    return `${Math.floor(t / 60)}:${(t % 60).toString().padStart(2, "0")}`;
  }, [hud.time]);

  return (
    <div className="sim-root">
      <header className="sim-header">
        <div className="sim-brand">
          <span className="sim-logo">◉</span> Rescue Line Simulator
          <span className="sim-by">
            by <a href="https://washingmachine.click" target="_blank" rel="noreferrer">WashingMachine</a>
          </span>
        </div>
        <div className="sim-controls">
          <select
            className="sim-select"
            value=""
            onChange={(e) => {
              const p = PRESETS.find((x) => x.name === e.target.value);
              if (p) {
                stop();
                setCourse(p.course());
                window.history.replaceState(null, "", "#");
              }
            }}
          >
            <option value="" disabled>
              Load map…
            </option>
            {PRESETS.map((p) => (
              <option key={p.name} value={p.name} title={p.description}>
                {p.name}
              </option>
            ))}
          </select>
          <select
            className="sim-select"
            value=""
            onChange={(e) => {
              const r = ROBOT_PRESETS.find((x) => x.lang === lang && x.name === e.target.value);
              if (r) (lang === "js" ? setJsCode : setPyCode)(r.code);
            }}
          >
            <option value="" disabled>
              Load robot…
            </option>
            {ROBOT_PRESETS.filter((r) => r.lang === lang).map((r) => (
              <option key={r.name} value={r.name}>
                {r.name}
              </option>
            ))}
          </select>
          <button className={mode === "edit" ? "on" : ""} onClick={() => { reset(); setMode(mode === "edit" ? "run" : "edit"); }}>
            {mode === "edit" ? "Done editing" : "Edit course"}
          </button>
          {mode === "run" && (
            <>
              <button className="primary" onClick={running ? stop : start} disabled={!!status}>
                {running ? "Pause" : "Run"}
              </button>
              <button onClick={reset}>Reset</button>
              <button onClick={() => simRef.current?.lop()} title="Manual lack of progress">LoP</button>
            </>
          )}
          <button onClick={share}>Share course</button>
          <label className="sim-check">
            <input type="checkbox" checked={noise} onChange={(e) => { setNoise(e.target.checked); }} />
            realism (noise)
          </label>
        </div>
        <div className="sim-hud">
          <span>score <b>{hud.total}</b></span>
          <span>LoP <b>{hud.lops}</b></span>
          <span>⏱ <b>{remaining}</b></span>
        </div>
      </header>

      {mode === "edit" && (
        <div className="sim-palette">
          <div className="sim-tools">
            {(["paint", "rotate", "marker", "ball-silver", "ball-black", "erase"] as Tool[]).map((tl) => (
              <button key={tl} className={tool === tl ? "on" : ""} onClick={() => setTool(tl)}>
                {tl === "paint" ? "Paint" : tl === "rotate" ? "Rotate" : tl === "marker" ? "Green marker" : tl === "ball-silver" ? "+ Silver ball" : tl === "ball-black" ? "+ Black ball" : "Erase"}
              </button>
            ))}
            <span className="sep" />
            <button onClick={() => resize(1, 0)}>+col</button>
            <button onClick={() => resize(-1, 0)}>-col</button>
            <button onClick={() => resize(0, 1)}>+row</button>
            <button onClick={() => resize(0, -1)}>-row</button>
          </div>
          {tool === "paint" && (
            <div className="sim-brushes">
              {PALETTE.map((p) => (
                <button key={p.kind} className={brush === p.kind ? "on" : ""} onClick={() => setBrush(p.kind)}>
                  {p.label}
                </button>
              ))}
            </div>
          )}
          <span className="hint">
            {tool === "paint" && "click places the selected tile · click again rotates it"}
            {tool === "rotate" && "click a tile to rotate it"}
            {tool === "marker" && "click a junction to cycle its green markers (none → left → right → both)"}
            {(tool === "ball-silver" || tool === "ball-black") && "click inside the zone to drop a victim"}
            {tool === "erase" && "click a ball to remove it, or a tile to clear it"}
            {" · the zone tile with rotation 2 hosts the evacuation corner"}
          </span>
        </div>
      )}

      <div className="sim-main">
        <div className="sim-canvas-wrap">
          <canvas
            ref={screenRef}
            width={W}
            height={H}
            onClick={onCanvasClick}
            style={{ cursor: mode === "edit" ? "crosshair" : "default" }}
          />
          {hud.finished && <div className="sim-finish">{hud.finished} Final score: {hud.total}</div>}
          {logs.length > 0 && !hud.finished && (
            <div className="sim-log">
              {logs.map((l, i) => (
                <div key={i}>{l}</div>
              ))}
            </div>
          )}
        </div>

        <div className="sim-editor">
          <div className="sim-editor-bar">
            <div className="sim-tabs">
              <button className={lang === "js" ? "on" : ""} onClick={() => { reset(); setLang("js"); }}>robot.js</button>
              <button className={lang === "py" ? "on" : ""} onClick={() => { reset(); setLang("py"); }}>main.py</button>
              {lang === "py" &&
                pyFiles.map((f) => (
                  <span key={f.name} className="sim-file">
                    {f.name}
                    <button onClick={() => setPyFiles(pyFiles.filter((p) => p.name !== f.name))}>×</button>
                  </span>
                ))}
            </div>
            <div className="sim-tabs">
              {lang === "py" && (
                <label className="upload">
                  upload .py
                  <input type="file" accept=".py" multiple hidden onChange={(e) => e.target.files && uploadPy(e.target.files)} />
                </label>
              )}
              <button onClick={() => setShowApi(!showApi)}>{showApi ? "Code" : "API"}</button>
            </div>
          </div>
          {showApi ? (
            <div className="sim-api">
              <pre>{lang === "js" ? API_DOCS_JS : API_DOCS_PY}</pre>
            </div>
          ) : (
            <Monaco
              height="100%"
              language={lang === "js" ? "javascript" : "python"}
              theme="vs-dark"
              value={lang === "js" ? jsCode : pyCode}
              onChange={(v) => (lang === "js" ? setJsCode(v ?? "") : setPyCode(v ?? ""))}
              options={{ minimap: { enabled: false }, fontSize: 13, scrollBeyondLastLine: false }}
            />
          )}
          {status && <div className="sim-status">{status}</div>}
          {error && <div className="sim-error">{error}</div>}
        </div>
      </div>
    </div>
  );
}

const API_DOCS_JS = `Define loop(robot, state). Runs every tick (~60/s).
state persists between ticks.

robot.lineSensors()      8 values: 0 white, 1 black, ~0.55 green, ~0.8 red
robot.colorSensors()     { left, right } -> "white"|"black"|"green"|
                         "silver"|"red"|"wall"
robot.distance(offset?)  px to nearest wall/obstacle (offset in rad)
robot.zoneCamera()       [{ kind, angle, distance }] in a 90-deg cone
robot.inZone()           true in the evacuation zone
robot.setMotors(l, r)    each in [-1, 1] (motors have inertia!)
robot.gripper(closed)    grab / release balls
robot.time()             seconds since start
robot.log(msg)           on-screen log

Course elements: gap +10, obstacle +15, intersection +10,
speed bumps +5, seesaw +15, ramp +10, checkpoint +10,
silver victim +40, black victim +20.
Checkpoints set your respawn point. Silver strip marks the
zone entrance. Red line ends the run. 8:00 total run time.
5 s without the line = lack of progress -> last checkpoint.
"realism" adds sensor noise and motor variation.`;

const API_DOCS_PY = `Python runs sandboxed in YOUR browser via Pyodide (WASM).
No network, no filesystem, no JS access. Allowed imports:
math, random, json, collections, itertools, ...

Define loop(robot, state) in main.py. Upload extra .py files
and import them normally (import mylib).

robot.line_sensors()       8 values: 0 white, 1 black, ~0.55 green
robot.color_sensors()      {"left": ..., "right": ...}
robot.distance(side)       "front" | "left" | "right" -> px
robot.zone_camera()        [{"kind", "angle", "distance"}]
robot.in_zone()            True in the evacuation zone
robot.set_motors(l, r)     each in [-1, 1] (motors have inertia!)
robot.gripper(closed)      grab / release balls
robot.time()               seconds since start
robot.log(msg)             on-screen log

Python ticks run at ~30 Hz (async bridge); the last motor
command persists between ticks. Same scoring as JS.`;

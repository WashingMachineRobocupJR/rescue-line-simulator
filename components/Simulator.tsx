"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import {
  Course,
  TILE,
  Tile,
  TileKind,
  demoCourse,
  deserialize,
  serialize,
} from "@/lib/course";
import { renderCourse, COLORS } from "@/lib/render";
import { Sim, makeApi, compileRobot, ROBOT_R, RobotApi } from "@/lib/sim";
import { DEMO_ROBOT } from "@/lib/demoRobot";

const Monaco = dynamic(() => import("@monaco-editor/react"), { ssr: false });

const PALETTE: Array<{ kind: TileKind; label: string }> = [
  { kind: "straight", label: "Straight" },
  { kind: "curve", label: "Curve" },
  { kind: "t", label: "T junction" },
  { kind: "cross", label: "Cross" },
  { kind: "gap", label: "Gap" },
  { kind: "obstacle", label: "Obstacle" },
  { kind: "start", label: "Start" },
  { kind: "zone", label: "Zone" },
  { kind: "empty", label: "Erase" },
];

type Mode = "edit" | "run";

export function Simulator() {
  const [course, setCourse] = useState<Course>(() => {
    if (typeof window !== "undefined" && window.location.hash.length > 2) {
      const c = deserialize(window.location.hash.slice(1));
      if (c) return c;
    }
    return demoCourse();
  });
  const [mode, setMode] = useState<Mode>("run");
  const [brush, setBrush] = useState<TileKind>("straight");
  const [running, setRunning] = useState(false);
  const [code, setCode] = useState(DEMO_ROBOT);
  const [error, setError] = useState<string | null>(null);
  const [hud, setHud] = useState({ total: 0, lops: 0, time: 0 });
  const [logs, setLogs] = useState<string[]>([]);
  const [showApi, setShowApi] = useState(false);

  const screenRef = useRef<HTMLCanvasElement>(null);
  const worldRef = useRef<HTMLCanvasElement | null>(null);
  const simRef = useRef<Sim | null>(null);
  const loopFnRef = useRef<((api: RobotApi, state: Record<string, unknown>) => void) | null>(null);
  const stateRef = useRef<Record<string, unknown>>({});
  const logsRef = useRef<string[]>([]);
  const runningRef = useRef(false);

  const W = course.cols * TILE;
  const H = course.rows * TILE;

  // (re)build the offscreen world bitmap whenever the course changes
  const rebuildWorld = useCallback(() => {
    const world = document.createElement("canvas");
    world.width = W;
    world.height = H;
    const ctx = world.getContext("2d", { willReadFrequently: true })!;
    renderCourse(ctx, course);
    worldRef.current = world;
    simRef.current = new Sim(course, ctx);
    stateRef.current = {};
    logsRef.current = [];
  }, [course, W, H]);

  useEffect(() => {
    rebuildWorld();
  }, [rebuildWorld]);

  const compile = useCallback(() => {
    const fn = compileRobot(code);
    if (typeof fn === "string") {
      setError(fn);
      return false;
    }
    loopFnRef.current = fn;
    setError(null);
    return true;
  }, [code]);

  const start = () => {
    if (!compile()) return;
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
    rebuildWorld();
    draw();
    setHud({ total: 0, lops: 0, time: 0 });
    setLogs([]);
  };

  const draw = useCallback(() => {
    const screen = screenRef.current;
    const world = worldRef.current;
    const sim = simRef.current;
    if (!screen || !world || !sim) return;
    const ctx = screen.getContext("2d")!;
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(world, 0, 0);

    // balls
    for (const b of sim.balls) {
      if (b.rescued) continue;
      ctx.beginPath();
      ctx.arc(b.x, b.y, 13, 0, Math.PI * 2);
      ctx.fillStyle = b.kind === "silver" ? "#d8dbe2" : "#20242b";
      ctx.fill();
      ctx.strokeStyle = "#00000033";
      ctx.stroke();
    }

    // robot
    const r = sim.robot;
    ctx.save();
    ctx.translate(r.x, r.y);
    ctx.rotate(r.heading);
    ctx.fillStyle = "#7A2BFF";
    ctx.beginPath();
    ctx.arc(0, 0, ROBOT_R, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(ROBOT_R - 14, -8, 12, 16); // nose
    // gripper
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
    const tick = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      const sim = simRef.current;
      if (sim && runningRef.current && loopFnRef.current) {
        try {
          loopFnRef.current(makeApi(sim, logsRef.current), stateRef.current);
        } catch (e) {
          setError(String(e));
          runningRef.current = false;
          setRunning(false);
        }
        sim.step(dt);
        setHud({ total: sim.score.total, lops: sim.score.lops, time: sim.time });
        setLogs([...logsRef.current.slice(-6), ...sim.events.slice(-4).map((e) => `[${e.t.toFixed(1)}s] ${e.msg}`)]);
      }
      draw();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [draw]);

  // editor interactions
  const onCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (mode !== "edit") return;
    const rect = screenRef.current!.getBoundingClientRect();
    const scale = W / rect.width;
    const x = (e.clientX - rect.left) * scale;
    const y = (e.clientY - rect.top) * scale;
    const col = Math.floor(x / TILE);
    const row = Math.floor(y / TILE);
    if (col < 0 || row < 0 || col >= course.cols || row >= course.rows) return;
    const idx = row * course.cols + col;
    const tiles = course.tiles.map((t, i): Tile => {
      if (i !== idx) return t;
      if (t.kind === brush) {
        // same brush again: rotate, then cycle marker on junctions
        const rot = ((t.rot + 1) % 4) as Tile["rot"];
        let marker = t.marker;
        if ((brush === "t" || brush === "cross") && rot === 0) {
          marker = t.marker === "none" ? "left" : t.marker === "left" ? "right" : t.marker === "right" ? "both" : "none";
        }
        return { ...t, rot, marker };
      }
      return { kind: brush, rot: 0, marker: "none" };
    });
    setCourse({ ...course, tiles });
  };

  const share = () => {
    const hash = serialize(course);
    const url = `${window.location.origin}${window.location.pathname}#${hash}`;
    window.history.replaceState(null, "", `#${hash}`);
    navigator.clipboard?.writeText(url);
  };

  const timeStr = useMemo(() => {
    const t = Math.floor(hud.time);
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
          <button className={mode === "edit" ? "on" : ""} onClick={() => { reset(); setMode(mode === "edit" ? "run" : "edit"); }}>
            {mode === "edit" ? "Done editing" : "Edit course"}
          </button>
          {mode === "run" && (
            <>
              <button className="primary" onClick={running ? stop : start}>
                {running ? "Pause" : "Run"}
              </button>
              <button onClick={reset}>Reset</button>
            </>
          )}
          <button onClick={share}>Share course</button>
        </div>
        <div className="sim-hud">
          <span>score <b>{hud.total}</b></span>
          <span>LoP <b>{hud.lops}</b></span>
          <span>t <b>{timeStr}</b></span>
        </div>
      </header>

      {mode === "edit" && (
        <div className="sim-palette">
          {PALETTE.map((p) => (
            <button key={p.kind} className={brush === p.kind ? "on" : ""} onClick={() => setBrush(p.kind)}>
              {p.label}
            </button>
          ))}
          <span className="hint">click places a tile · click again rotates (and cycles green markers on junctions)</span>
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
          {logs.length > 0 && (
            <div className="sim-log">
              {logs.map((l, i) => (
                <div key={i}>{l}</div>
              ))}
            </div>
          )}
        </div>

        <div className="sim-editor">
          <div className="sim-editor-bar">
            <span>robot.js</span>
            <button onClick={() => setShowApi(!showApi)}>{showApi ? "Code" : "API"}</button>
          </div>
          {showApi ? (
            <div className="sim-api">
              <pre>{API_DOCS}</pre>
            </div>
          ) : (
            <Monaco
              height="100%"
              defaultLanguage="javascript"
              theme="vs-dark"
              value={code}
              onChange={(v) => setCode(v ?? "")}
              options={{ minimap: { enabled: false }, fontSize: 13, scrollBeyondLastLine: false }}
            />
          )}
          {error && <div className="sim-error">{error}</div>}
        </div>
      </div>
    </div>
  );
}

const API_DOCS = `Define loop(robot, state). It runs every tick (~60/s).
state is a plain object that persists between ticks.

robot.lineSensors()        8 values, 0 = white, 1 = black line,
                           ~0.55 = green (bar mounted in front)
robot.colorSensors()       { left, right } -> "white" | "black" |
                           "green" | "silver" | "wall"
robot.distance(offset?)    distance (px) to the nearest wall or
                           obstacle along heading + offset (rad)
robot.zoneCamera()         balls in a 90-degree cone in front:
                           [{ kind: "silver"|"black",
                              angle (rad, + = right),
                              distance (px) }]
robot.inZone()             true inside the evacuation zone
robot.setMotors(l, r)      motor power, each in [-1, 1]
robot.gripper(closed)      close near a ball to pick it up;
                           open to release. Release a ball over
                           the dark corner triangle to rescue it.
robot.time()               seconds since run start
robot.log(msg)             print to the on-screen log

Scoring: gap +10, obstacle +15, intersection +10,
silver victim +40, black victim +20.
5 seconds without seeing the line = lack of progress,
robot returns to start (points already earned are kept).`;

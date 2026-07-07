# Rescue Line Simulator

A free browser simulator for RoboCup Junior Rescue Line. Build courses, program a virtual robot in JavaScript, score your runs. No field, no robot, no budget required.

**Try it: [sim.washingmachine.click](https://sim.washingmachine.click)**

Built by [WashingMachine](https://washingmachine.click), a RoboCup Junior Rescue Line team from ITIS A. Rossi, Vicenza.

## Why

A Rescue Line practice field costs hundreds of euros. A competitive robot costs thousands. That is the entry barrier that keeps most schools out of robotics competitions. A browser tab costs nothing.

The simulator will never replace a real robot: motors stall, sensors drift, batteries sag, and none of that happens here. But the *hard thinking* of Rescue Line (control loops, state machines, evacuation strategy) transfers one-to-one. A team can arrive at its first real field with working logic instead of a blank file.

## What's inside

- **Course editor**: straights, curves, T and cross junctions with green markers, gaps, obstacles, and an evacuation zone with silver/black victims. Click to place, click again to rotate. Courses serialize into the URL: share a link, share the course.
- **A programmable robot**: differential drive, 8-sensor reflectance bar, two color sensors, a distance sensor, a gripper, and a zone camera that returns ball detections (kind, angle, distance), modeled after how camera-based robots actually perceive the zone.
- **Honest sensing**: sensors sample the same bitmap you see on screen. What the robot sees is literally what you see.
- **Scoring + LoP**: gaps, obstacles, intersections, victims, with automatic lack-of-progress when the robot loses the line, exactly like losing a run at a real tournament.
- **In-browser editor** (Monaco) with a persistent `state` object and an on-screen log. The default program is a complete example: PID line following, green-marker turns, obstacle avoidance, and a basic evacuation strategy. Read it, break it, beat it.

## Robot API

```js
function loop(robot, state) {
  const s = robot.lineSensors();   // 8 values, 1 = black
  robot.colorSensors();            // { left, right }
  robot.distance(0);               // px to nearest wall/obstacle
  robot.zoneCamera();              // [{ kind, angle, distance }]
  robot.inZone();                  // true inside the evacuation zone
  robot.setMotors(0.5, 0.5);       // each in [-1, 1]
  robot.gripper(true);             // grab / release balls
  robot.log("hi");                 // on-screen log
}
```

Full docs in the app (the "API" button above the editor).

## Run locally

```bash
pnpm install
pnpm dev
```

## Contributing

Issues and pull requests welcome. Good first ideas: seesaw and ramp tiles, speed bumps, sensor noise option, checkpoint tiles, a course library.

## License

MIT

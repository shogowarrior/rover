// The simulator (js/sim.js) against the firmware it previews: the wheel table
// against src/MovePatterns.cpp, the sweep against src/Explorer.h, telemetry
// against src/Protocol.cpp; the kinematics against what each verified move
// is named for, and the pivots against what their wheels imply; the sonar,
// collisions, the deadline, simulated time; and that a preview never sends.
//
// Rover frame, as in sim.js: x out of the nose, y out of the left side, w
// counter-clockwise. World: x right, y up, heading counter-clockwise from +x.
"use strict";
const assert = require("node:assert/strict");
const { test } = require("node:test");

const protocol = require("../js/protocol.js");
const { MOTIONS, motionNamed } = require("../js/mecanum.js");
const sim = require("../js/sim.js");
const { ProgramRunner } = require("../js/program.js");
const { RoverSim, Room, SimSonar, SimTarget, SIM_WHEEL_MAX_MPS, SIM_DEADBAND_PWM, SIM_CHASSIS } = sim;
const { RoverBlocks } = require("../js/blocks.js");
// The panel's own BEARINGS: the simulator takes them as they are, and never
// keeps a copy.
const { BEARINGS } = require("../js/scan.js");
const { loadPage, all, flush, connectOpen, pageFrames } = require("./fake-dom.js");
const { src, CODES, telemetry } = require("./firmware.js");

const near = (actual, expected, tolerance, what) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${what}: ${actual} is not within ${tolerance} of ${expected}`);
const sign = (v) => (Math.abs(v) < 1e-9 ? 0 : Math.sign(v));
const deg = (rad) => (rad * 180) / Math.PI;

// Advance a target by `realMs` of frames, letting a program's promises settle
// between frames as the page's event loop would.
async function run(target, realMs, frameMs = 16) {
  for (let t = 0; t < realMs; t += frameMs) {
    await target.pump(Math.min(frameMs, realMs - t));
    await flush();
  }
}

// A rover in an empty room big enough never to meet a wall.
function openFloor() {
  return new Room({ name: "floor", width: 100, height: 100, start: { x: 50, y: 50, heading: 0 } });
}

// The world displacement after holding a move for `ms` from heading 0.
function drive(move, { ms = 1000, speed = protocol.SPEED_MAX, heading = 0, releasedDrag } = {}) {
  const room = openFloor();
  const rover = new RoverSim({ pose: { x: 50, y: 50, heading }, releasedDrag });
  rover.command(move, speed, ms);
  for (let t = 0; t < ms; t += 5) rover.step(5, room);
  const pose = rover.pose;
  return { dx: pose.x - 50, dy: pose.y - 50, turn: pose.heading - heading, rover };
}

/* --- the copy of the firmware ------------------------------------------- */

test("the wheel table is src/MovePatterns.cpp's, row for row", () => {
  const value = { FWD: 1, BACK: -1, FREE: 0 };
  const rows = [...src("MovePatterns.cpp").matchAll(/^\s*PATTERN\(\s*(\w+)\s*,\s*(\w+)\s*,\s*(\w+)\s*,\s*(\w+)\s*,\s*(\w+)\s*\)/gm)];
  assert.equal(rows.length, 19, "STOP and the eighteen motions");
  for (const [, name, ...wheels] of rows) {
    assert.ok(name in CODES, `${name} is a move code`);
    assert.deepEqual(RoverSim.WHEELS[CODES[name]], wheels.map((w) => value[w]), `${name} (front-left, front-right, rear-right, rear-left)`);
  }
  assert.equal(Object.keys(RoverSim.WHEELS).length, 19, "no row the firmware does not have");
});

// The bearings the sweep visits are the panel's, which check_protocol.py
// checks against Explorer's sweep angles.
test("the sweep timing is ExploreParams' in src/Explorer.h", () => {
  const params = src("Explorer.h");
  const read = (name) => Number(params.match(new RegExp(`\\b${name}\\s*=\\s*([\\d.]+)f?\\s*;`))[1]);
  assert.equal(SimSonar.TIMING.servoBaseMs, read("servoBaseMs"));
  assert.equal(SimSonar.TIMING.servoMsPerDeg, read("servoMsPerDeg"));
  assert.equal(SimSonar.TIMING.pingIntervalMs, read("pingIntervalMs"));
});

test("speed is clamped to tuning::MOTOR_SPEED_LIMIT, as Rover::drive() clamps it", () => {
  // protocol.js's copy, which check_protocol.py checks against Tuning.h.
  assert.equal(RoverSim.SPEED_LIMIT, protocol.MOTOR_SPEED_LIMIT);
  const full = drive(protocol.MOVE_FORWARD, { speed: 255 });
  const saved = RoverSim.SPEED_LIMIT;
  RoverSim.SPEED_LIMIT = 120; // as the README advises for a full 3S pack
  try {
    const asked = drive(protocol.MOVE_FORWARD, { speed: 255 });
    const given = drive(protocol.MOVE_FORWARD, { speed: 120 });
    near(asked.dx, given.dx, 1e-9, "255 asked, 120 given");
    near(asked.dx, (full.dx * (120 - SIM_DEADBAND_PWM)) / (255 - SIM_DEADBAND_PWM), 1e-9, "in proportion");
    const rover = new RoverSim();
    rover.command(protocol.MOVE_FORWARD, 200, 400);
    assert.equal(rover.speed, 120);
  } finally {
    RoverSim.SPEED_LIMIT = saved;
  }
});

test("telemetry comes as often as the rover's: tuning::TELEMETRY_INTERVAL_MS", () => {
  assert.equal(SimTarget.TELEMETRY_MS, Number(src("Tuning.h").match(/TELEMETRY_INTERVAL_MS\s*=\s*(\d+)/)[1]));
});

/* --- kinematics ----------------------------------------------------------- */

test("forward drives along the rover's +x, with no turn", () => {
  const ahead = drive(protocol.MOVE_FORWARD);
  near(ahead.dx, SIM_WHEEL_MAX_MPS, 1e-9, "dx in 1 s at full speed");
  near(ahead.dy, 0, 1e-9, "dy");
  near(ahead.turn, 0, 1e-9, "turn");
  // Facing up the screen, forward is up the screen.
  const up = drive(protocol.MOVE_FORWARD, { heading: Math.PI / 2 });
  near(up.dx, 0, 1e-9, "dx facing up");
  near(up.dy, SIM_WHEEL_MAX_MPS, 1e-9, "dy facing up");
  const back = drive(protocol.MOVE_BACKWARD);
  near(back.dx, -SIM_WHEEL_MAX_MPS, 1e-9, "backward");
});

test("MOVE_RIGHT strafes right, with no turn; MOVE_LEFT left", () => {
  const right = drive(protocol.MOVE_RIGHT);
  near(right.dx, 0, 1e-9, "dx");
  near(right.dy, -SIM_WHEEL_MAX_MPS, 1e-9, "dy: right of a rover facing +x is -y");
  near(right.turn, 0, 1e-9, "turn");
  const left = drive(protocol.MOVE_LEFT);
  near(left.dy, SIM_WHEEL_MAX_MPS, 1e-9, "left");
  near(left.turn, 0, 1e-9, "turn");
});

test("ROTATE_CLOCKWISE turns clockwise on the spot; COUNTERCLOCKWISE the other way", () => {
  const cw = drive(protocol.ROTATE_CLOCKWISE, { ms: 100 });
  assert.ok(cw.turn < -0.1, `heading fell: ${cw.turn}`);
  near(Math.hypot(cw.dx, cw.dy), 0, 1e-9, "no travel");
  const ccw = drive(protocol.ROTATE_COUNTERCLOCKWISE, { ms: 100 });
  near(ccw.turn, -cw.turn, 1e-9, "the same rate the other way");
  near(Math.hypot(ccw.dx, ccw.dy), 0, 1e-9, "no travel");
});

test("each diagonal moves at its named angle, measured as the stick's from right", () => {
  for (const [move, angle] of [[protocol.MOVE_DIAGONAL45, 45], [protocol.MOVE_DIAGONAL135, 135],
    [protocol.MOVE_DIAGONAL225, 225], [protocol.MOVE_DIAGONAL315, 315]]) {
    const { vx, vy, w } = RoverSim.unitTwist(move, 0.25);
    // The stick's frame: right is the rover's -y, forward its +x.
    const stickAngle = (deg(Math.atan2(vx, -vy)) + 360) % 360;
    near(stickAngle, angle, 1e-6, `code ${move}'s heading`);
    assert.equal(w, 0, `code ${move} does not turn`);
    near(Math.hypot(vx, vy), Math.SQRT1_2, 1e-6, `code ${move} moves at 1/sqrt 2 of wheel speed`);
  }
});

test("STOP, a speed of 0 and a duration of 0 do not move the rover", () => {
  for (const [move, speed, ms] of [[protocol.STOP, 255, 1000], [protocol.MOVE_FORWARD, 0, 1000]]) {
    const { dx, dy, turn, rover } = drive(move, { speed, ms });
    assert.deepEqual([dx, dy, turn], [0, 0, 0]);
    assert.equal(rover.moving, false);
  }
  const rover = new RoverSim();
  rover.command(protocol.MOVE_FORWARD, 255, 0);
  assert.equal(rover.moving, false, "duration 0");
  rover.command(protocol.RESUME_AUTONOMOUS, 255, 400);
  assert.equal(rover.moving, false, "a code that is not a motion");
  assert.deepEqual(RoverSim.unitTwist(protocol.STOP), { vx: 0, vy: 0, w: 0 });
});

test("speed maps to wheel speed in proportion above the deadband, up to SIM_WHEEL_MAX_MPS", () => {
  const usable = protocol.SPEED_MAX - SIM_DEADBAND_PWM;
  assert.equal(RoverSim.wheelMps(0), 0);
  near(RoverSim.wheelMps(128), (SIM_WHEEL_MAX_MPS * (128 - SIM_DEADBAND_PWM)) / usable, 1e-12, "speed 128");
  assert.equal(RoverSim.wheelMps(protocol.SPEED_MAX), SIM_WHEEL_MAX_MPS);
  assert.equal(RoverSim.wheelMps(300), SIM_WHEEL_MAX_MPS, "clamped, as Rover::drive() clamps");
  const half = drive(protocol.MOVE_FORWARD, { speed: 128 });
  const full = drive(protocol.MOVE_FORWARD, { speed: protocol.SPEED_MAX });
  near(half.dx / full.dx, (128 - SIM_DEADBAND_PWM) / usable, 1e-9, "1 s at speed 128 against full speed");
});

// What a pivot's wheels imply, worked out from the wheels and not from the
// pivot's name. A side pair drives its side of the chassis along x: the rover
// goes that way and turns away from that side. An axle pair strafes its end of
// the chassis the way it would carry that end in MOVE_RIGHT (verified, code
// 3) or against it: the rover goes that way, the driven end swinging round.
function impliedByWheels(wheels) {
  const [fl, fr, rr, rl] = wheels;
  const right = RoverSim.WHEELS[CODES.MOVE_RIGHT];
  if (fl && rl && !fr && !rr) return { vx: fl, vy: 0, w: -fl, what: "left side" };
  if (fr && rr && !fl && !rl) return { vx: fr, vy: 0, w: fr, what: "right side" };
  if (fl && fr && !rr && !rl) {
    const toRight = fl === right[0] ? 1 : -1;
    return { vx: 0, vy: -toRight, w: -toRight, what: `front axle ${toRight > 0 ? "right" : "left"}` };
  }
  if (rr && rl && !fl && !fr) {
    const toRight = rr === right[2] ? 1 : -1;
    return { vx: 0, vy: -toRight, w: toRight, what: `rear axle ${toRight > 0 ? "right" : "left"}` };
  }
  return null;
}

test("each pivot moves and turns as its wheels imply, with released wheels free or held", () => {
  const pivots = MOTIONS.filter((m) => m.move >= protocol.PIVOT_RIGHT_FORWARD && m.move <= protocol.PIVOT_SIDEWAYS_BACKWARD_LEFT);
  assert.equal(pivots.length, 8);
  for (const { move, name } of pivots) {
    const implied = impliedByWheels(RoverSim.WHEELS[move]);
    assert.ok(implied, `${name} drives one side or one axle`);
    for (const drag of [0, 1]) {
      const t = RoverSim.unitTwist(move, drag);
      assert.deepEqual([sign(t.vx), sign(t.vy), sign(t.w)], [implied.vx, implied.vy, implied.w],
        `${name} (${implied.what}) at releasedDrag ${drag}: ${JSON.stringify(t)}`);
    }
  }
});

test("no row of the table needs a released wheel to turn, so releasedDrag leaves it as it is", () => {
  for (const { move, name } of MOTIONS) {
    const free = RoverSim.unitTwist(move, 0);
    const held = RoverSim.unitTwist(move, 1);
    for (const k of ["vx", "vy", "w"]) near(held[k], free[k], 1e-5, `${name} ${k}`);
  }
});

test("releasedDrag slows a row whose released wheels would have to turn", () => {
  // A diagonal pair driven against itself, as code 15 once was: no net push,
  // only a turning couple, which needs both released wheels to turn.
  const fighting = [1, 0, -1, 0];
  const free = RoverSim.twistForWheels(fighting, 0);
  const held = RoverSim.twistForWheels(fighting, 1);
  near(Math.hypot(free.vx, free.vy), 0, 1e-6, "no travel");
  assert.ok(free.w !== 0, "it spins");
  assert.ok(Math.abs(held.w) < Math.abs(free.w) * 0.75, `drag slows the spin: ${held.w} against ${free.w}`);
  assert.equal(sign(held.w), sign(free.w), "the same way");
});

/* --- the sonar ------------------------------------------------------------ */

test("a ray meets the nearest surface, at the angle off its normal", () => {
  const room = Room.preset("box"); // 2 x 2 m
  const straight = room.rayCast({ x: 1, y: 1 }, 0);
  near(straight.distance, 1, 1e-9, "to the right-hand wall");
  near(straight.incidence, 0, 1e-9, "square on");
  assert.equal(straight.obstacle, "the wall");
  const slanted = room.rayCast({ x: 1, y: 1 }, Math.PI / 6);
  near(slanted.distance, 1 / Math.cos(Math.PI / 6), 1e-9, "at 30 degrees");
  near(deg(slanted.incidence), 30, 1e-9, "30 degrees off the normal");
  assert.equal(room.rayCast({ x: -1, y: 1 }, Math.PI), null, "a ray that meets nothing");

  const course = Room.preset("course");
  const box = course.rayCast({ x: 3.0, y: 1.0 }, 0); // at the box turned 45 degrees
  assert.equal(box.obstacle, "the angled box");
  near(deg(box.incidence), 45, 1e-9, "its face is at 45 degrees");
  near(box.distance, 3.8 - 0.25 * Math.SQRT2 - 3.0, 1e-9, "to its near corner's faces");
});

test("no echo beyond 400 cm or off a surface met more than 60 degrees off its normal", () => {
  const corridor = Room.preset("corridor"); // 6 m long
  const far = SimSonar.measure(corridor, { x: 0.4, y: 0.6, heading: 0 }, 0);
  assert.equal(far, protocol.FAR_CM, "the end wall, 5.5 m away");
  const near_ = SimSonar.measure(corridor, { x: 2.5, y: 0.6, heading: 0 }, 0);
  near(near_, (6 - 2.5 - SIM_CHASSIS.lengthM / 2) * 100, 0.06, "the same wall from 3.4 m, to the 0.1 cm");

  const box = Room.preset("box");
  // Facing nearly along the bottom wall: square-on readings echo, glancing
  // ones do not.
  const along = { x: 1, y: 0.3, heading: (-20 * Math.PI) / 180 };
  assert.equal(SimSonar.measure(box, along, 0), protocol.FAR_CM, "70 degrees off the normal");
  const steep = SimSonar.measure(box, along, -35); // 55 degrees off
  assert.ok(steep < protocol.FAR_CM && steep > 0, `55 degrees off echoes: ${steep}`);
  const square = SimSonar.measure(box, { x: 1, y: 1, heading: 0 }, 0);
  near(square, (1 - SIM_CHASSIS.lengthM / 2) * 100, 0.06, "square on, from the front of the chassis");
});

test("the sweep visits the bearings in turn, at Explorer's pace", async () => {
  const target = new SimTarget({ bearings: BEARINGS, room: "box" });
  // Put down as if it had been sweeping: a whole sweep, left to right, that
  // ended as the preview began, 60 + 87 ms a step.
  assert.deepEqual(target.state.readings.map((r) => [r.bearing, r.reading.at]),
    [[70, -588], [35, -441], [0, -294], [-35, -147], [-70, 0]]);
  const pings = [];
  const seen = new Set();
  const frames = [];
  target.onTelemetry((frame) => frames.push(frame));
  for (let t = 0; t < 1500; t += 5) {
    await target.pump(5);
    for (const { bearing, reading } of target.state.readings) {
      if (!seen.has(`${bearing}@${reading.at}`)) {
        seen.add(`${bearing}@${reading.at}`);
        if (reading.at > 0) pings.push([bearing, reading.at]);
      }
    }
  }
  // The next sweep comes back the other way, starting with the bearing just
  // read: 70 ms (the ping interval) to ping it again, then 60 + 87 ms for each
  // 35-degree step. Each ping comes on the first 5 ms step at or after it is
  // due, as the firmware's comes on the first loop pass after: 147 ms apart
  // becomes 150.
  assert.deepEqual(pings.slice(0, 11), [
    [-70, 70], [-35, 220], [0, 370], [35, 520], [70, 670],
    [70, 740], [35, 890], [0, 1040], [-35, 1190], [-70, 1340],
    [-70, 1410],
  ]);
  // Every frame carries all five distances, as the rover's do once it has
  // measured each bearing.
  assert.ok(frames.length >= 3);
  for (const frame of frames) for (const b of BEARINGS) assert.equal(typeof frame[b.key], "number", b.key);
});

test("a reading is as old as its ping, not the rover's position now", async () => {
  const target = new SimTarget({ bearings: BEARINGS, room: "box" });
  await run(target, 1200, 5); // a whole scan, facing the top wall from the middle
  target.hold(protocol.MOVE_BACKWARD, 128);
  await run(target, 600, 5);
  const { pose, readings } = target.state;
  const front = readings.find((r) => r.bearing === 0).reading;
  const nowCm = SimSonar.measure(target.room, pose, 0);
  near(front.cm, SimSonar.measure(target.room, front.from, 0), 0.06, "the reading is where it was taken");
  assert.ok(nowCm - front.cm > 2, `the rover has backed away since: ${front.cm} then, ${nowCm} now`);
});

test("telemetry carries each bearing's last ping, never a fresh measurement", async () => {
  // What a program sees: the rover's telemetry reports what each bearing
  // read when the sweep last passed it, so a preview must not give a program
  // fresher readings than that.
  const target = new SimTarget({ bearings: BEARINGS, room: "box" });
  await run(target, 1200, 5);
  target.hold(protocol.MOVE_BACKWARD, 128);
  const frames = [];
  target.onTelemetry((frame) => {
    const { pose, readings } = target.state;
    frames.push({ frame, pinged: readings.map((r) => r.reading.cm), now: SimSonar.measure(target.room, pose, 0) });
  });
  await run(target, 2500, 5);
  assert.ok(frames.length >= 4, `${frames.length} frames`);
  let behind = 0;
  for (const { frame, pinged, now } of frames) {
    BEARINGS.forEach((b, i) => assert.equal(frame[b.key], pinged[i], `${b.key}: its own last ping`));
    if (now - frame.distanceFront > 2) behind++;
  }
  assert.ok(behind > 0, `some frame's front reading lags the rover backing away: ${JSON.stringify(frames.map((f) => [f.frame.distanceFront, f.now]))}`);
});

/* --- collisions ----------------------------------------------------------- */

test("the chassis stops at a wall, and says what it bumped into", async () => {
  const target = new SimTarget({ bearings: BEARINGS, room: "box" });
  target.place({ x: 1, y: 1, heading: 0 });
  const said = [];
  target.onLog((text) => said.push(text));
  target.hold(protocol.MOVE_FORWARD, 255);
  await run(target, 3000);
  const { pose, bumps, twist, stalled } = target.state;
  near(pose.x + SIM_CHASSIS.lengthM / 2, 2, 0.002, "the nose at the wall");
  near(pose.y, 1, 1e-9, "no slide");
  assert.equal(stalled, true, "pushing against it");
  assert.deepEqual(twist, { vx: 0, vy: 0, w: 0 }, "and not moving");
  assert.deepEqual(said, ["bumped into the wall"], "once, however long it pushes");
  assert.equal(bumps.length, 1);
  near(bumps[0].x, 2, 0.002, "the mark is on the wall");
  // The firmware cannot tell: it still reports the move.
  assert.equal(target.telemetry().data.move, "MOVE_FORWARD");
  // Another move takes it away again.
  target.hold(protocol.MOVE_BACKWARD, 255);
  await run(target, 300);
  assert.ok(target.state.pose.x < pose.x - 0.05, "it backs off the wall");
});

test("rotating beside a wall swings a corner into it", async () => {
  const target = new SimTarget({ bearings: BEARINGS, room: "corridor" });
  assert.ok(target.place({ x: 1, y: 0.09, heading: 0 }), "against the bottom wall, square");
  target.hold(protocol.ROTATE_CLOCKWISE, 128);
  await run(target, 500);
  assert.equal(target.state.stalled, true);
  assert.deepEqual(target.state.log.map((l) => l.text), ["bumped into the wall"]);
  // Trying again and again at the same spot is one mark and one line.
  for (let i = 0; i < 5; i++) {
    target.release();
    target.hold(protocol.ROTATE_CLOCKWISE, 128);
    await run(target, 200);
  }
  assert.equal(target.state.bumps.length, 1);
  assert.equal(target.state.bumps[0].times, 6);
  assert.equal(target.state.log.length, 1);
});

test("a rover wedged in a corner marks each place once, however long it pushes", async () => {
  // Pushing into one wall and then the other: when a contact was compared
  // only with the last mark, every push was a new mark and a new line.
  const target = new SimTarget({ bearings: BEARINGS, room: "box" });
  target.playback = 4;
  const said = [];
  target.onLog((text) => said.push(text));
  const runner = new ProgramRunner();
  runner.run(async (api) => {
    for (;;) {
      await api.tick();
      await api.drive(protocol.MOVE_FORWARD, 100, 3);
      await api.drive(protocol.MOVE_LEFT, 100, 2);
    }
  }, target);
  while (target.state.now < 60000) {
    await target.pump(16);
    await flush();
  }
  runner.abort("done");
  const { bumps } = target.state;
  const pushes = bumps.reduce((sum, b) => sum + b.times, 0);
  assert.ok(pushes >= 20, `pushed again and again: ${pushes}`);
  assert.ok(bumps.length <= 3, `${bumps.length} marks for ${pushes} pushes`);
  assert.deepEqual(said, bumps.map((b) => `bumped into ${b.obstacle}`), "each place said once");
});

test("pushing again at an old mark is pushing against that mark's obstacle", async () => {
  const target = new SimTarget({ bearings: BEARINGS, room: "living" }); // facing the sofa
  target.hold(protocol.MOVE_FORWARD, 255);
  await run(target, 3000);
  target.hold(protocol.MOVE_LEFT, 255); // along the sofa, into the armrest
  await run(target, 1500);
  const left = target.state.pose.x;
  target.hold(protocol.MOVE_RIGHT, 255); // back to where it met the sofa...
  await run(target, Math.round(((target.room.start.x - left) / SIM_WHEEL_MAX_MPS) * 1000));
  target.hold(protocol.MOVE_FORWARD, 255); // ...and into it again
  await run(target, 500);
  const { bumps, contact, stalled } = target.state;
  assert.deepEqual(bumps.map((b) => [b.obstacle, b.times]), [["the sofa", 2], ["the armrest", 1]]);
  assert.equal(stalled, true);
  assert.equal(contact, "the sofa", "not the newest mark's obstacle");
});

test("bump marks are capped, the oldest going first", async () => {
  const cap = SimTarget.BUMP_MARKS;
  SimTarget.BUMP_MARKS = 2;
  try {
    const target = new SimTarget({ bearings: BEARINGS, room: "box" });
    assert.ok(target.place({ x: 0.5, y: 1, heading: Math.PI / 2 }), "facing the top wall");
    // Into the top wall at three places along it, 24 cm apart.
    for (let i = 0; i < 3; i++) {
      target.hold(protocol.MOVE_FORWARD, 255);
      await run(target, 2000);
      target.hold(protocol.MOVE_BACKWARD, 255);
      await run(target, 300);
      target.hold(protocol.MOVE_RIGHT, 255);
      await run(target, 400);
    }
    const { bumps, log } = target.state;
    assert.equal(log.length, 3, "three places, each said");
    assert.equal(bumps.length, 2, "only the latest two kept");
    assert.ok(bumps[0].x > 0.6 && bumps[1].x > bumps[0].x, `the first one went: ${bumps.map((b) => b.x.toFixed(2))}`);
  } finally {
    SimTarget.BUMP_MARKS = cap;
  }
});

test("the start pose can be set only where the chassis fits", () => {
  const target = new SimTarget({ bearings: BEARINGS, room: "box" });
  assert.equal(target.place({ x: 0.05, y: 1, heading: 0 }), false, "through the wall");
  assert.equal(target.place({ x: 3, y: 1, heading: 0 }), false, "outside the room");
  assert.equal(target.place({ x: 1, y: 1.5, heading: 1 }), true);
  target.reset();
  near(target.state.pose.y, 1.5, 1e-9, "a reset goes back to the placed start");
  const living = new SimTarget({ bearings: BEARINGS, room: "living" });
  assert.equal(living.place({ x: 1.35, y: 2.6, heading: 0 }), false, "on the sofa");
});

/* --- the Target ----------------------------------------------------------- */

test("telemetry carries the keys src/Protocol.cpp writes, bar the chip and exploring", async () => {
  const written = new Set([...src("Protocol.cpp").matchAll(/\bdoc\[\s*"(\w+)"\s*\]\s*=/g)].map((m) => m[1]));
  // No chip to measure, and no exploring to report on.
  const notSimulated = new Set(["temperature", "phase", "halt"]);
  for (const key of notSimulated) assert.ok(written.has(key), `${key} is still one the firmware writes`);
  const target = new SimTarget({ bearings: BEARINGS, room: "living" });
  await run(target, 1500);
  const { data, fresh } = target.telemetry();
  assert.equal(fresh, true);
  assert.deepEqual(Object.keys(data).sort(), [...written].filter((k) => !notSimulated.has(k)).sort());
  assert.deepEqual([data.mode, data.move, data.moving, data.motorsReady, data.scheme],
    ["MANUAL", "STOP", false, true, protocol.SCHEME_NORMAL]);
  for (const b of BEARINGS) assert.equal(typeof data[b.key], "number", b.key);
  target.explore();
  await run(target, 600);
  assert.equal(target.telemetry().data.mode, "AUTONOMOUS");
  assert.ok(!("phase" in target.telemetry().data), "no phase: exploring is not simulated");
  target.setScheme(protocol.SCHEME_ADVANCED);
  target.setScheme("EXPERT"); // ignored, as the rover ignores it
  await run(target, 600);
  assert.equal(target.telemetry().data.scheme, protocol.SCHEME_ADVANCED);
});

test("telemetry comes every 500 ms of simulated time, at any playback", async () => {
  for (const playback of [1, 2, 4]) {
    const target = new SimTarget({ bearings: BEARINGS, room: "box" });
    target.playback = playback;
    const at = [];
    target.onTelemetry(() => at.push(target.state.now));
    await run(target, 2000 / playback);
    // The first as the preview starts, then one every 500 ms.
    assert.deepEqual(at.slice(0, 5), [5, 500, 1000, 1500, 2000], `${playback}x: ${at}`);
  }
});

test("an un-refreshed command stops after MOVE_DURATION_MS", () => {
  const room = openFloor();
  const rover = new RoverSim({ pose: { x: 50, y: 50, heading: 0 } });
  rover.command(protocol.MOVE_FORWARD, 255, protocol.MOVE_DURATION_MS);
  let stoppedAt = null;
  for (let t = 5; t <= 1000; t += 5) {
    rover.step(5, room);
    if (!rover.moving && stoppedAt === null) stoppedAt = t;
  }
  assert.equal(stoppedAt, protocol.MOVE_DURATION_MS);
  near(rover.pose.x - 50, (SIM_WHEEL_MAX_MPS * protocol.MOVE_DURATION_MS) / 1000, 1e-9, "it went no further");
});

test("a held move is re-commanded every REPEAT_MS, and a stalled page lets it run out", async () => {
  const target = new SimTarget({ bearings: BEARINGS, room: "corridor" });
  target.hold(protocol.MOVE_FORWARD, 64);
  await run(target, 2000);
  assert.equal(target.state.moving, true, "held for 2 s by re-commanding");
  // Two frames 250 ms late: half a second with no re-command, as a page that
  // stalled that long. The move runs out within it.
  const x0 = target.state.pose.x;
  await target.pump(250);
  await target.pump(250);
  assert.equal(target.state.moving, false, "stopped by its own deadline");
  // It went at most one command's worth, and at least what was left of one.
  const went = target.state.pose.x - x0;
  const mps = RoverSim.wheelMps(64);
  assert.ok(went <= (mps * protocol.MOVE_DURATION_MS) / 1000 + 1e-9, `went ${went} m`);
  assert.ok(went >= (mps * (protocol.MOVE_DURATION_MS - protocol.REPEAT_MS)) / 1000 - 1e-9, `went ${went} m`);
  // The next frame re-commands it, as the next repeat would.
  await target.pump(16);
  assert.equal(target.state.moving, true);
});

test("a hitch at 4x stalls the page for its real length, not four times it", async () => {
  // Forward at half speed for 2 s, in 16 ms frames, with and without one
  // 120 ms frame among them. On the real page a 120 ms hitch only delays the
  // Driver's next repeat, well inside the 400 ms each command lasts; scaled
  // to 480 ms of simulated stall, it ran the command out.
  const preview = async (frames) => {
    const target = new SimTarget({ bearings: BEARINGS, room: "corridor" });
    target.playback = 4;
    const program = (async () => {
      target.hold(protocol.MOVE_FORWARD, 128);
      await target.sleep(2000);
      target.release();
    })();
    for (const ms of frames) {
      await target.pump(ms);
      await flush();
    }
    await program;
    return target.state.pose.x - target.room.start.x;
  };
  const smooth = await preview(Array(40).fill(16));
  const hitched = await preview([...Array(10).fill(16), 120, ...Array(30).fill(16)]);
  near(smooth, RoverSim.wheelMps(128) * 2, 1e-6, "2 s of driving");
  near(hitched, smooth, 1e-9, "the hitch changes nothing");
});

test("the preview is idle only with nothing to run, and says when that ends", async () => {
  const target = new SimTarget({ bearings: BEARINGS, room: "box" });
  let wakes = 0;
  target.onWake(() => wakes++);
  assert.equal(target.idle, true);
  const unsubscribe = target.onTelemetry(() => {});
  assert.deepEqual([target.idle, wakes], [false, 1], "someone listening to telemetry, as a running program is");
  unsubscribe();
  unsubscribe();
  assert.equal(target.idle, true, "unsubscribed, and counted once");
  const slept = target.sleep(100);
  assert.deepEqual([target.idle, wakes], [false, 2], "a sleep waiting");
  await run(target, 150);
  await slept;
  assert.equal(target.idle, true, "the sleep is over");
  target.hold(protocol.MOVE_FORWARD, 100);
  assert.deepEqual([target.idle, wakes], [false, 3], "a held motion");
  target.release();
  assert.equal(target.idle, true);
});

test("sleep follows the playback speed and stops while paused", async () => {
  for (const playback of [1, 2, 4]) {
    const target = new SimTarget({ bearings: BEARINGS, room: "box" });
    target.playback = playback;
    let done = false;
    target.sleep(1000).then(() => { done = true; });
    await run(target, 1000 / playback - 40);
    assert.equal(done, false, `${playback}x: not yet`);
    await run(target, 60);
    assert.equal(done, true, `${playback}x: after ${1000 / playback} ms of frames`);
  }
  const target = new SimTarget({ bearings: BEARINGS, room: "box" });
  let done = false;
  target.sleep(100).then(() => { done = true; });
  target.paused = true;
  await run(target, 1000);
  assert.equal(done, false, "nothing passes while paused");
  target.paused = false;
  await run(target, 120);
  assert.equal(done, true);
});

test("sleep rejects when its signal aborts, and a sleep resolves where it was due", async () => {
  const target = new SimTarget({ bearings: BEARINGS, room: "box" });
  const controller = new AbortController();
  const slept = target.sleep(500, controller.signal);
  await run(target, 100);
  controller.abort();
  await assert.rejects(slept, (err) => err.name === "AbortError");
  await assert.rejects(target.sleep(10, controller.signal), (err) => err.name === "AbortError", "already aborted");

  // A program that drives for 1 s stops at 1 s of simulated time, not a
  // frame later.
  const timed = new SimTarget({ bearings: BEARINGS, room: "corridor" });
  timed.playback = 4;
  const program = (async () => {
    timed.hold(protocol.MOVE_FORWARD, 255);
    await timed.sleep(1000);
    timed.release();
  })();
  await run(timed, 400);
  await program;
  near(timed.state.pose.x - timed.room.start.x, SIM_WHEEL_MAX_MPS, SIM_WHEEL_MAX_MPS * 0.006, "1 s of driving at 4x");
});

test("release() stops only what the program drives; stop() always stops", async () => {
  const target = new SimTarget({ bearings: BEARINGS, room: "living" });
  target.release();
  assert.equal(target.state.mode, "MANUAL");
  target.explore();
  target.release(); // nothing held: an exploring rover is left exploring
  assert.equal(target.state.mode, "AUTONOMOUS");
  target.hold(protocol.MOVE_LEFT, 100);
  assert.equal(target.state.mode, "MANUAL", "any motion takes the rover out of exploring");
  target.release();
  assert.equal(target.state.moving, false);
  assert.equal(target.state.held, null);
  const pose = target.state.pose;
  await run(target, 1000);
  assert.deepEqual(target.state.pose, pose, "a released hold is never re-commanded");
  target.explore();
  target.stop();
  assert.equal(target.state.mode, "MANUAL", "stop() stops even an exploring rover");
  assert.throws(() => target.hold(protocol.STOP, 100), RangeError);
  assert.throws(() => target.hold(protocol.RESUME_AUTONOMOUS, 100), RangeError);
  assert.throws(() => target.hold(protocol.MOVE_FORWARD, NaN), RangeError);
});

test("explore() says it is not simulated, reports AUTONOMOUS and stands still", async () => {
  const target = new SimTarget({ bearings: BEARINGS, room: "living" });
  const said = [];
  target.onLog((text) => said.push(text));
  target.hold(protocol.MOVE_FORWARD, 128);
  await run(target, 300);
  target.explore();
  const pose = target.state.pose;
  await run(target, 2000);
  assert.deepEqual(said, ["exploring is not simulated: the real rover would start exploring here"]);
  assert.deepEqual(target.state.pose, pose, "it stands still");
  assert.equal(target.state.held, null);
  assert.equal(target.telemetry().data.mode, "AUTONOMOUS");
  assert.equal(target.telemetry().data.move, "STOP");
  // The next motion takes it back to manual and moves.
  target.hold(protocol.MOVE_FORWARD, 128);
  await run(target, 600);
  assert.equal(target.telemetry().data.mode, "MANUAL");
  assert.notDeepEqual(target.state.pose, pose);
});

test("a reset or a change of room is a loss; both leave a clean state", async () => {
  const target = new SimTarget({ bearings: BEARINGS, room: "living" });
  const lost = [];
  const unsubscribe = target.onLost((reason) => lost.push(reason));
  target.hold(protocol.MOVE_FORWARD, 200);
  await run(target, 1500);
  target.reset();
  assert.deepEqual(lost, [SimTarget.LOST.reset]);
  const { pose, moving, held, trail, bumps, mode } = target.state;
  assert.deepEqual(pose, target.room.start);
  assert.deepEqual([moving, held, trail.length, bumps.length, mode], [false, null, 1, 0, "MANUAL"]);
  assert.equal(target.telemetry().data, null, "nothing measured yet");
  await run(target, 1000);
  assert.deepEqual(target.state.pose, pose, "the old hold is gone, not re-commanded");
  target.setRoom("corridor");
  assert.deepEqual(lost, [SimTarget.LOST.reset, SimTarget.LOST.room]);
  assert.equal(target.room.name, "Corridor");
  assert.deepEqual(target.state.pose, target.room.start);
  target.place({ x: 1, y: 0.6, heading: 0 });
  assert.deepEqual(lost, [SimTarget.LOST.reset, SimTarget.LOST.room, SimTarget.LOST.placed]);
  unsubscribe();
  target.reset();
  assert.equal(lost.length, 3, "unsubscribed");
  assert.equal(target.ready().ok, true);
  assert.equal(target.kind, "simulator");
});

/* --- with the Program tab's runner ---------------------------------------- */

// The runner (js/program.js) reacts between frames, once its promises have
// settled; these pin the frame rules that make a preview faithful to it.

test("a program loop with nothing in it does not stop simulated time", async () => {
  const target = new SimTarget({ bearings: BEARINGS, room: "box" });
  const runner = new ProgramRunner();
  let loops = 0;
  const ended = runner.run(async (api) => {
    for (;;) {
      await api.tick(); // what every Blockly loop does each time round
      loops++;
    }
  }, target);
  await run(target, 1000);
  assert.ok(target.state.now >= 900, `1 s of frames moved simulated time by ${target.state.now} ms`);
  assert.ok(loops > 30, `${loops} loops`);
  runner.abort("done");
  assert.equal((await ended).outcome, "stopped");
});

test("drive until a reading stops on the very frame that brings it", async () => {
  const target = new SimTarget({ bearings: BEARINGS, room: "box" });
  target.place({ x: 1, y: 0.5, heading: Math.PI / 2 }); // 1.5 m from the top wall, minus the nose
  target.playback = 4;
  let brought = null;
  target.onTelemetry((frame) => {
    if (brought === null && frame.distanceFront < 60) brought = target.state.now;
  });
  let releasedAt = null;
  const release = target.release.bind(target);
  target.release = () => {
    if (releasedAt === null && target.state.held) releasedAt = target.state.now;
    release();
  };
  const runner = new ProgramRunner();
  const ended = runner.run(async (api) => {
    await api.driveUntil(protocol.MOVE_FORWARD, 60, async () => (await api.distance("distanceFront")) < 60);
  }, target);
  await run(target, 3000);
  assert.equal((await ended).outcome, "done");
  assert.ok(brought !== null, "a frame brought a reading under 60 cm");
  assert.equal(releasedAt, brought, "released at the frame's own simulated moment, not a frame later");
});

/* --- the Program tab's examples, previewed ----------------------------- */

// An example as the Program tab would run it. Blockly does not load in Node,
// so this walks the example's saved blocks and does what each block's code
// does (blocks.js, "their code"), a loop yielding each time round as
// INFINITE_LOOP_TRAP makes it. It knows only the blocks the examples use, and
// throws on any other, so that a new example is never previewed half-read.
function exampleProgram(state) {
  const input = (block, name) => block.inputs[name] && (block.inputs[name].block || block.inputs[name].shadow);
  const value = async (api, block) => {
    switch (block.type) {
      case "math_number": return block.fields.NUM;
      case "rover_clear": return api.clearBeyond(block.fields.BEARING, await value(api, input(block, "LIMIT")));
      case "rover_distance": return api.distance(block.fields.BEARING);
      case "logic_negate": return !(await value(api, input(block, "BOOL")));
      case "logic_operation": {
        const a = await value(api, input(block, "A"));
        if (block.fields.OP === "AND") return a && value(api, input(block, "B"));
        if (block.fields.OP === "OR") return a || value(api, input(block, "B"));
        break;
      }
    }
    throw new Error(`exampleProgram() cannot read a ${block.type} block`);
  };
  const run = async (api, first) => {
    for (let block = first; block; block = block.next && block.next.block) {
      const move = () => motionNamed(block.fields.MOVE).move;
      switch (block.type) {
        case "rover_drive_for":
          await api.drive(move(), await value(api, input(block, "SPEED")), await value(api, input(block, "SECONDS")));
          break;
        case "rover_drive_until":
          await api.driveUntil(move(), await value(api, input(block, "SPEED")), async () => value(api, input(block, "UNTIL")));
          break;
        case "rover_stop": await api.stop(); break;
        case "rover_explore": await api.explore(); break;
        case "rover_wait": await api.wait(await value(api, input(block, "SECONDS"))); break;
        case "rover_forever":
          for (;;) {
            await api.tick();
            await run(api, input(block, "DO"));
          }
        case "controls_repeat_ext":
          for (let i = 0, times = await value(api, input(block, "TIMES")); i < times; i++) {
            await api.tick();
            await run(api, input(block, "DO"));
          }
          break;
        case "controls_if":
          if (block.extraState && block.extraState.elseIfCount) throw new Error("exampleProgram() cannot read else-if");
          if (await value(api, input(block, "IF0"))) await run(api, input(block, "DO0"));
          else if (block.extraState && block.extraState.hasElse) await run(api, input(block, "ELSE"));
          break;
        default:
          throw new Error(`exampleProgram() cannot run a ${block.type} block`);
      }
    }
  };
  return async (api) => {
    for (const top of state.blocks.blocks) await run(api, top);
  };
}

// The examples that steer by the sonar, and so must be safe on the real
// rover; the others are drives with no eyes, to watch on a stand.
const SENSING = RoverBlocks.EXAMPLES.filter((e) => /"rover_(clear|distance)"/.test(JSON.stringify(e.state)));

// Preview `program` in a room for `ms` of simulated time, at the display's
// frame rate: a frame later than SimTarget.STALL_MS would be a stalled page,
// whose time runs with no program reacting.
async function previewFor(program, room, ms, { playback = 4, frameMs = 16 } = {}) {
  const target = new SimTarget({ bearings: BEARINGS, room });
  target.playback = playback;
  const runner = new ProgramRunner();
  const ended = runner.run(program, target);
  while (target.state.now < ms) {
    await target.pump(frameMs);
    await flush();
  }
  runner.abort("the preview is over");
  return { target, end: await ended };
}

test("every example that steers by the sonar previews in every room for a minute without a bump", async () => {
  assert.deepEqual(SENSING.map((e) => e.name), ["Patrol"], "the sensing examples");
  for (const example of SENSING) {
    for (const room of Object.keys(Room.PRESETS)) {
      const { target, end } = await previewFor(exampleProgram(example.state), room, 60000);
      const what = `${example.name} in ${Room.PRESETS[room].label}`;
      assert.deepEqual(end, { outcome: "stopped", reason: "the preview is over" }, `${what}: ran the whole minute`);
      const { trail, bumps } = target.state;
      assert.deepEqual(bumps.map((b) => b.obstacle), [], `${what}: bumped`);
      let travelled = 0;
      for (let i = 1; i < trail.length; i++) travelled += Math.hypot(trail[i].x - trail[i - 1].x, trail[i].y - trail[i - 1].y);
      assert.ok(travelled > 1, `${what}: went somewhere, not ${travelled.toFixed(2)} m`);
    }
  }
});

test("a program previews the same at any frame rate and any playback", async () => {
  // The Patrol example: forward while the way is clear, else turn.
  const patrol = exampleProgram(RoverBlocks.EXAMPLES.find((e) => e.id === "patrol").state);
  const preview = async (playback, frameMs) => {
    const { target } = await previewFor(patrol, "course", 20000, { playback, frameMs });
    // Each stops at the first frame past 20 s; compare the first 20 s.
    const { trail, log } = target.state;
    return {
      path: trail.filter((p) => p.at <= 20000).map((p) => `${p.at} ${p.x.toFixed(6)} ${p.y.toFixed(6)}`),
      log: log.filter((l) => l.at <= 20000).map((l) => `${l.at} ${l.text}`),
    };
  };
  const reference = await preview(1, 8);
  assert.ok(reference.path.length > 50, "it went somewhere");
  for (const [playback, frameMs] of [[1, 33], [4, 8], [4, 33], [2, 16]]) {
    const other = await preview(playback, frameMs);
    assert.deepEqual(other.log, reference.log, `${playback}x, ${frameMs} ms frames: what it said`);
    assert.deepEqual(other.path, reference.path, `${playback}x, ${frameMs} ms frames: the path`);
  }
});

/* --- nothing is ever sent ------------------------------------------------- */

test("a preview never sends: a spy link, socket and driver see nothing", async () => {
  // Whatever the simulator might reach for by name, in the page's one global
  // scope, records instead of sending.
  const sent = [];
  const spy = { send: (frame) => sent.push(frame) };
  const saved = { link: globalThis.link, driver: globalThis.driver, WebSocket: globalThis.WebSocket };
  globalThis.link = spy;
  globalThis.driver = new Proxy({}, { get: (_, name) => (...args) => sent.push({ driver: name, args }) });
  globalThis.WebSocket = class { constructor(url) { sent.push({ socket: url }); } send(d) { sent.push(d); } };
  try {
    const target = new SimTarget({ bearings: BEARINGS, room: "course" });
    target.hold(protocol.MOVE_FORWARD, 255);
    await run(target, 500);
    for (const { move } of MOTIONS) target.hold(move, 90);
    await run(target, 300);
    target.release();
    target.hold(protocol.ROTATE_CLOCKWISE, 255);
    const slept = target.sleep(50);
    await run(target, 100);
    await slept;
    target.stop();
    target.explore();
    target.reset();
    target.setRoom("corridor");
    await run(target, 2000);
  } finally {
    Object.assign(globalThis, saved);
  }
  assert.deepEqual(sent, []);
});

test("in the page, a preview sends nothing over the real, open Link", async () => {
  const page = loadPage();
  const ws = connectOpen(page);
  const rover = telemetry();
  ws.serverMsg(rover);
  assert.equal(page.evalIn("link.state"), "up");
  assert.equal(page.evalIn("typeof targets === 'object' && targets.simulator.kind"), "simulator");
  page.evalIn(`
    globalThis.__simulator = targets.simulator;
    __simulator.hold(MOVE_FORWARD, 200);
    __simulator.pump(100);
    __simulator.hold(PIVOT_RIGHT_FORWARD, 120);
    __simulator.pump(100);
    __simulator.release();
    __simulator.stop();
    __simulator.explore();
    __simulator.reset();
  `);
  let frames = 0;
  page.evalIn("__simulator").onTelemetry(() => frames++);
  // The page's own clock is the harness's, so the preview's turns of the
  // event loop come as it advances.
  await pageFrames(page, 1600, page.evalIn("__simulator"));
  assert.ok(frames > 0, "the preview published telemetry of its own");
  assert.deepEqual(ws.sent, [], "not one frame");
  assert.deepEqual(page.errors, []);
  // Its telemetry never reaches the readouts or the scan fan, which show the
  // rover's frame.
  assert.equal(page.$("mode").textContent, rover.mode, "the rover's mode, not the preview's MANUAL");
  const readings = all(page.$("scan")).filter((n) => n.getAttribute("class") === "reading").map((n) => n.textContent);
  assert.deepEqual(readings, BEARINGS.map((b) => `${rover[b.key]}cm`), "the rover's distances on the fan");
});

// The view's own loop, in a page whose display is throttled to two frames a
// second while its timers run on time: the Claude desktop browser pane out
// of view does exactly this. The Driver re-commands the real rover on
// timers, so the real rover drives on; pumped from animation frames, the
// preview took each half-second frame for a stalled page, let every command
// run out, and stood still.
test("in the page, a throttled display does not stall the preview", async () => {
  const page = loadPage({ frames: true, frameMs: 500 });
  const sim = page.evalIn("targets.simulator");
  page.evalIn("targets.simulator.setRoom('corridor')");
  const from = { ...sim.state.pose };
  sim.hold(protocol.MOVE_FORWARD, 128);
  await pageFrames(page, 3000);
  const moved = Math.hypot(sim.state.pose.x - from.x, sim.state.pose.y - from.y);
  // One command lasts MOVE_DURATION_MS: a preview that let it run out
  // covers about that much ground, not three seconds' worth.
  const oneCommand = (SIM_WHEEL_MAX_MPS * 128) / protocol.SPEED_MAX * (protocol.MOVE_DURATION_MS / 1000);
  assert.ok(sim.state.moving, "still driving after 3 s of held move");
  assert.ok(moved > 3 * oneCommand, `drove ${moved.toFixed(2)} m, more than three commands' worth (${(3 * oneCommand).toFixed(2)} m)`);
  assert.deepEqual(page.errors, []);
});

/* --- the view, in the page ------------------------------------------------ */

// The page, with the map given a screen transform, since nothing here lays it
// out: a pixel is a centimetre, y down the screen as on a screen. A world
// point (x, y) m is under the pointer at (100 x, -100 y).
function pageWithView(options) {
  const page = loadPage(options);
  page.evalIn(`globalThis.DOMPoint = class {
    constructor(x, y) { this.x = x; this.y = y; }
    matrixTransform() { return { x: this.x, y: this.y }; }
  };`);
  const nodes = () => all(page.$("simSlot"));
  const byClass = (name) => nodes().filter((n) => (n.getAttribute("class") || "").split(" ").includes(name));
  byClass("sim-map")[0].getScreenCTM = () => ({ inverse: () => ({}) });
  const button = (text) => nodes().find((n) => n.tagName === "BUTTON" && n.textContent === text);
  return { page, sim: page.evalIn("targets.simulator"), byClass, button };
}

test("the view: a tap on the rover leaves a preview running; a drag places it", async () => {
  const { page, sim, byClass } = pageWithView();
  assert.equal(byClass("sim-map")[0].getAttribute("role"), "group", "a group, so the rover in it is still a button");
  const rover = byClass("sim-rover")[0];
  assert.equal(rover.getAttribute("role"), "button");
  const lost = [];
  sim.onLost((reason) => lost.push(reason));
  sim.hold(protocol.MOVE_FORWARD, 128);
  await pageFrames(page, 600, sim);
  const trail = sim.state.trail.length;
  assert.ok(trail > 5 && sim.state.moving, "a preview under way");

  const pose = sim.state.pose;
  const at = (dx, dy) => ({ clientX: pose.x * 100 + dx, clientY: -pose.y * 100 + dy });
  const press = { button: 0, ctrlKey: false, pointerId: 3, target: byClass("sim-plate")[0] };
  // A tap jitters a pixel or two: no placement, so no reset.
  page.fire(rover, "pointerdown", { ...press, ...at(0, 0) });
  page.fire(rover, "pointermove", { ...press, ...at(2, 1) });
  page.fire(rover, "pointermove", { ...press, ...at(-1, 2) });
  page.fire(rover, "pointerup", { ...press, ...at(2, 1) });
  assert.deepEqual(lost, [], "a tap is not a placement");
  assert.equal(sim.state.trail.length, trail, "the trail is kept");
  assert.equal(sim.state.moving, true, "the preview runs on");

  // A drag past the slop places the rover where it is dropped: a reset.
  page.fire(rover, "pointerdown", { ...press, ...at(0, 0) });
  page.fire(rover, "pointermove", { ...press, ...at(30, 0) });
  page.fire(rover, "pointermove", { ...press, ...at(30, 0) }); // nowhere new: no second reset
  page.fire(rover, "pointerup", { ...press, ...at(30, 0) });
  assert.deepEqual(lost, [SimTarget.LOST.placed]);
  near(sim.state.pose.x, pose.x + 0.3, 1e-9, "dropped 30 cm to the right");
  assert.equal(sim.state.moving, false);
  assert.deepEqual(page.errors, []);
});

test("the view: one mark per bump, gone with the trail; and where the next preview starts", async () => {
  const { page, sim, byClass, button } = pageWithView();
  const twist = () => byClass("sim-twist")[0].textContent;
  sim.hold(protocol.MOVE_BACKWARD, 255); // into the wall behind the start
  await pageFrames(page, 2000, sim);
  sim.release();
  page.fire(button("1×"), "click"); // anything that draws
  assert.equal(sim.state.bumps.length, 1);
  assert.equal(byClass("sim-bump").length, 1, "one mark drawn");
  assert.match(twist(), /goes on from here/, "stopped away from its start");
  const listening = sim.onTelemetry(() => {}); // as a running program is
  page.fire(button("1×"), "click");
  assert.equal(twist(), "standing still", "mid-run, a wait is only standing still");
  listening();
  page.fire(button("1×"), "click");
  assert.match(twist(), /goes on from here/);
  page.fire(button("Clear trail"), "click");
  assert.equal(byClass("sim-bump").length, 0, "removed, not hidden");
  page.fire(byClass("sim-tool").find((b) => (b.getAttribute("title") || "").startsWith("Reset")), "click");
  page.fire(button("1×"), "click");
  assert.equal(twist(), "standing still", "back at its start");
  assert.deepEqual(page.errors, []);
});

test("the view's frames: none while hidden or idle out of sight, and no jump after", async () => {
  const { page, sim } = pageWithView({ frames: true });
  const pumps = [];
  const pump = sim.pump.bind(sim);
  sim.pump = (ms) => {
    pumps.push(ms);
    return pump(ms);
  };
  // The Drive tab showing and nothing on the simulator: after one frame to
  // look, the view rests.
  await pageFrames(page, 1000);
  assert.deepEqual(pumps, [], "idle and out of sight");

  // A program holding a motion wakes it, timing afresh, and it runs on
  // undrawn.
  sim.hold(protocol.MOVE_FORWARD, 100);
  await pageFrames(page, 480);
  assert.ok(pumps.length >= 25, `${pumps.length} frames`);
  assert.ok(pumps.every((ms) => ms === 16), `no jump: ${pumps}`);
  const before = sim.state.now;
  assert.ok(before >= 300, `${before} ms simulated`);

  // A hidden page asks for no frames, and simulated time waits.
  page.doc.hidden = true;
  page.fire(page.doc, "visibilitychange");
  const hiddenAt = pumps.length;
  await pageFrames(page, 2000);
  assert.equal(pumps.length, hiddenAt, "no frames while hidden");
  assert.equal(sim.state.now, before, "simulated time waits");
  // Shown again, the first frame only times: none makes up the 2 s.
  page.doc.hidden = false;
  page.fire(page.doc, "visibilitychange");
  await pageFrames(page, 160);
  assert.ok(pumps.length > hiddenAt);
  assert.ok(pumps.slice(hiddenAt).every((ms) => ms === 16), `no jump: ${pumps.slice(hiddenAt)}`);

  // Let go, out of sight, it rests again...
  sim.release();
  await pageFrames(page, 100);
  const restedAt = pumps.length;
  await pageFrames(page, 1000);
  assert.equal(pumps.length, restedAt, "resting");
  // ...until the view is shown, idle or not...
  page.fire(page.$("tabProgram"), "click");
  page.resized();
  await pageFrames(page, 320);
  assert.ok(pumps.length >= restedAt + 15, "drawn while shown");
  // ...or a sleep is waiting on it.
  page.fire(page.$("tabDrive"), "click");
  await pageFrames(page, 100);
  const hiddenTab = pumps.length;
  await pageFrames(page, 500);
  assert.equal(pumps.length, hiddenTab, "out of sight and idle: resting");
  let slept = false;
  sim.sleep(300).then(() => {
    slept = true;
  });
  await pageFrames(page, 600);
  assert.equal(slept, true, "a sleep wakes it");
  assert.deepEqual(page.errors, []);
});

test("the preview reports the rover's scheme; nothing of its own reaches the page", async () => {
  const { page, sim } = pageWithView();
  const ws = connectOpen(page);
  assert.equal(sim.scheme, protocol.SCHEME_NORMAL, "NORMAL until the rover says");
  ws.serverMsg(telemetry({ mode: "MANUAL", scheme: protocol.SCHEME_ADVANCED }));
  assert.equal(sim.scheme, protocol.SCHEME_ADVANCED);
  await pageFrames(page, 600, sim);
  assert.equal(sim.telemetry().data.scheme, protocol.SCHEME_ADVANCED);
  assert.deepEqual(ws.sent, [], "not one frame");
  assert.deepEqual(page.errors, []);
});

// ProgramRunner and RoverTarget (js/program.js), on their own: a fake Target
// with a fake clock for the runner, and a fake Driver and Link for the
// RoverTarget. panel.test.js checks the same pieces wired into the page.
//
//   node --test extras/joystick/test/
"use strict";
const assert = require("node:assert/strict");
const { ProgramRunner, RoverTarget } = require("../js/program.js");
const P = require("../js/protocol.js");
const { abortableWait } = require("../js/support.js");
const { flush } = require("./fake-dom.js");
// Every test has a time limit (harness.js says why). The tests also check
// that a run has ended before awaiting how it ended, so most regressions
// that leave a program waiting for good fail at once.
const { test } = require("./harness.js");

/* --- a target with its own clock ------------------------------------------ */

// The target's time moves only when the test advances it, and not at all while
// paused, as a simulator's does while its page is hidden.
class FakeClock {
  now = 0;
  paused = false;
  #timers = []; // {at, fn}

  at(ms, fn) {
    const timer = { at: this.now + ms, fn };
    this.#timers.push(timer);
    return () => {
      this.#timers = this.#timers.filter((t) => t !== timer);
    };
  }

  pending() {
    return this.#timers.length;
  }

  // Advance in steps, letting the program run between them, as time would.
  async advance(ms, step = 10) {
    for (let left = ms; left > 0; left -= step) {
      await flush();
      if (this.paused) continue;
      this.now += Math.min(step, left);
      const due = this.#timers.filter((t) => t.at <= this.now).sort((a, b) => a.at - b.at);
      this.#timers = this.#timers.filter((t) => t.at > this.now);
      for (const t of due) t.fn();
    }
    await flush();
  }
}

class FakeTarget {
  kind = "simulator";
  calls = []; // what the runner asked of it, in order
  at = []; // the clock's time of each call
  data = { mode: "MANUAL", distanceFront: 120, distanceLeft: 999 };
  fresh = true;
  readiness = { ok: true, why: "" };
  #frames = new Set();
  #lost = new Set();

  constructor(clock) {
    this.clock = clock;
  }

  ready() { return this.readiness; }
  hold(move, speed) { this.#call(`hold ${move} ${speed}`); }
  release() { this.#call("release"); }
  stop() { this.#call("stop"); }
  explore() { this.#call("explore"); }
  #call(what) { this.calls.push(what); this.at.push(this.clock.now); }
  timeline() { return this.calls.map((call, i) => `${call} @${this.at[i]}`); }
  telemetry() { return { data: this.data, fresh: this.fresh }; }
  onTelemetry(fn) { this.#frames.add(fn); return () => this.#frames.delete(fn); }
  onLost(fn) { this.#lost.add(fn); return () => this.#lost.delete(fn); }
  listeners() { return this.#frames.size + this.#lost.size; }

  // The rule both real Targets follow (program.js, sim.js).
  sleep(ms, signal) {
    return abortableWait(signal, (done) => this.clock.at(ms, done), (cancel) => cancel());
  }

  frame(extra = {}) {
    this.data = { ...this.data, ...extra };
    for (const fn of [...this.#frames]) fn(this.data);
  }

  lose(reason) {
    for (const fn of [...this.#lost]) fn(reason);
  }
}

function setup() {
  const clock = new FakeClock();
  const target = new FakeTarget(clock);
  const runner = new ProgramRunner();
  const logs = [];
  const states = [];
  const highlights = [];
  runner.onLog(({ text, tone }) => logs.push(`${tone}: ${text}`));
  runner.onState((state, detail) => states.push(state + (detail.outcome ? ` ${detail.outcome}` : "")));
  runner.onHighlight((id) => highlights.push(id));
  return { clock, target, runner, logs, states, highlights };
}

/* --- ProgramRunner ------------------------------------------------------- */

test("drive holds the motion for its time, then releases it", async () => {
  const { clock, target, runner, logs, states } = setup();
  const done = runner.run(async (api) => {
    await api.drive(P.MOVE_FORWARD, 50, 1);
    await api.log("after");
  }, target);
  assert.equal(runner.state, "running");
  assert.equal(runner.target, target);
  await clock.advance(990);
  assert.deepEqual(target.calls, ["hold 1 128"], "50 % of 255, held");
  await clock.advance(20);
  assert.deepEqual(await done, { outcome: "done" });
  assert.deepEqual(target.calls, ["hold 1 128", "release", "release"], "released after 1 s, and again as the program ends");
  assert.deepEqual(logs, ["info: Started on the simulator.", "say: after", "done: Done."]);
  assert.deepEqual(states, ["running", "idle done"]);
  assert.equal(runner.state, "idle");
  assert.equal(runner.target, null);
  assert.equal(target.listeners(), 0, "no listener left on the target");
  assert.equal(clock.pending(), 0, "no wait left on its clock");
});

test("abort mid-sleep rejects the wait, releases at once, and logs why", async () => {
  const { clock, target, runner, logs, states, highlights } = setup();
  let after = false;
  const done = runner.run(async (api) => {
    await api.step("b1");
    await api.drive(P.ROTATE_CLOCKWISE, 100, 30);
    after = true;
    await api.drive(P.MOVE_FORWARD, 100, 1);
  }, target);
  await clock.advance(500);
  assert.equal(runner.abort("Stop was pressed."), true);
  assert.deepEqual(target.calls, ["hold 17 255", "release"], "released inside abort()");
  assert.equal(runner.state, "stopping");
  assert.deepEqual(await done, { outcome: "stopped", reason: "Stop was pressed." });
  assert.equal(after, false, "nothing after the aborted wait ran");
  assert.ok(!target.calls.includes("hold 1 255"), "the next drive never started");
  assert.equal(logs.at(-1), "stopped: Stopped: Stop was pressed.");
  assert.deepEqual(states, ["running", "stopping", "idle stopped"]);
  assert.deepEqual(highlights, ["b1", null, null], "highlight cleared");
  assert.equal(runner.abort("again"), false, "nothing left to abort");
  assert.equal(clock.pending(), 0);
});

test("onLost of the target aborts the program with its reason", async () => {
  const { clock, target, runner } = setup();
  const done = runner.run(async (api) => { await api.wait(10); }, target);
  await clock.advance(100);
  target.lose("the room was changed.");
  assert.equal(runner.state, "stopping", "stopped at once");
  assert.deepEqual(await done, { outcome: "stopped", reason: "the room was changed." });
  assert.equal(target.listeners(), 0);
});

test("stale telemetry aborts a distance read; fresh readings are returned", async () => {
  const { clock, target, runner, logs } = setup();
  const seen = [];
  const done = runner.run(async (api) => {
    seen.push(await api.distance("distanceFront"));
    seen.push(await api.distance("distanceLeft"));
    seen.push(await api.clearBeyond("distanceFront", 100), await api.clearBeyond("distanceFront", 120));
    seen.push(await api.clearBeyond("distanceLeft", 40)); // no echo is not clear
    seen.push(await api.isExploring());
    await api.drive(P.MOVE_FORWARD, 40, 5);
    target.fresh = false;
    seen.push(await api.distance("distanceFront"));
    seen.push("read a stale distance");
  }, target);
  await clock.advance(1000);
  assert.deepEqual(seen, [120, 999, true, false, false, false]);
  target.fresh = false;
  await clock.advance(5000);
  assert.equal(runner.state, "idle");
  const end = await done;
  assert.equal(end.outcome, "stopped");
  assert.match(end.reason, /out of date/);
  assert.match(logs.at(-1), /^stopped: Stopped: the simulator's readings are out of date/);
});

test("a reading not reported yet is waited for, frame by frame, for a while", async () => {
  const { clock, target, runner } = setup();
  target.data = { mode: "MANUAL" };
  let cm = null;
  const done = runner.run(async (api) => { cm = await api.distance("distanceRight"); }, target);
  await clock.advance(300);
  assert.equal(cm, null, "waiting for a frame");
  target.frame({ distanceLeft: 80 }); // a frame without it: wait on
  await clock.advance(500);
  assert.equal(cm, null, "still waiting");
  target.frame({ distanceRight: 42 });
  await flush();
  assert.equal(cm, 42);
  assert.equal(runner.state, "idle");
  assert.deepEqual(await done, { outcome: "done" });

  const late = runner.run(async (api) => { await api.distance("distanceRight2"); }, target);
  await clock.advance(ProgramRunner.FIRST_READING_MS + 50);
  assert.equal(runner.state, "idle", "given up on, in the target's time");
  const end = await late;
  assert.equal(end.outcome, "failed");
  assert.match(end.reason, /has not sent a distanceRight2 reading yet/);

  const bad = await runner.run(async (api) => { await api.distance("mode"); }, target);
  assert.equal(bad.outcome, "failed", "only distances");
});

test("a loop that only ticks is abortable, and yields to the clock", async () => {
  const { clock, target, runner } = setup();
  let laps = 0;
  const done = runner.run(async (api) => {
    // Bounded: were tick() to stop yielding, an endless loop would starve
    // this test's own event loop, and hang it rather than fail it.
    for (let i = 0; i < 100000; i++) {
      await api.tick();
      laps++;
    }
  }, target);
  await flush();
  assert.ok(laps <= 1, `${laps} laps without the clock moving: tick() does not yield`);
  await clock.advance(50);
  assert.ok(laps > 0 && laps < 50, `ran ${laps} laps, one per turn of the clock`);
  runner.abort("Stop was pressed.");
  assert.equal((await done).outcome, "stopped");
  const at = laps;
  await clock.advance(50);
  assert.equal(laps, at, "no lap after the abort");
});

test("speed and seconds are clamped; a non-number fails cleanly", async () => {
  const { clock, target, runner } = setup();
  const done = runner.run(async (api) => {
    await api.drive(P.MOVE_LEFT, 250, 0.01);
    await api.drive(P.MOVE_LEFT, -20, 0.01);
    await api.drive(P.MOVE_LEFT, "60", 0.01);
    await api.drive(P.MOVE_RIGHT, 40, 0); // no time: no motion at all
    await api.drive(P.MOVE_RIGHT, 12.5, 1e9);
  }, target);
  // Each drive starts its turn after the last (COMMAND_GAP_MS).
  await clock.advance(400);
  assert.deepEqual(target.timeline(), [
    "hold 4 255 @0", "release @10", "hold 4 0 @100", "release @110", "hold 4 153 @200", "release @210", "hold 3 32 @300",
  ]);
  await clock.advance(ProgramRunner.DRIVE_SECONDS_MAX * 1000 - 200, 1000);
  assert.equal(target.calls.at(-1), "hold 3 32", "still driving inside the 60 s cap");
  await clock.advance(200);
  assert.equal(runner.state, "idle", "the drive was capped");
  assert.equal(target.timeline().at(-2), `release @${300 + ProgramRunner.DRIVE_SECONDS_MAX * 1000}`);
  assert.deepEqual(await done, { outcome: "done" });

  const waited = runner.run(async (api) => { await api.wait(1e6); }, target);
  await clock.advance(ProgramRunner.WAIT_SECONDS_MAX * 1000 + 10, 5000);
  assert.equal(runner.state, "idle", "the wait was capped");
  assert.deepEqual(await waited, { outcome: "done" }, "wait capped at 600 s");

  for (const program of [
    async (api) => api.drive(P.MOVE_LEFT, undefined, 1),
    async (api) => api.drive(P.MOVE_LEFT, 50, NaN),
    async (api) => api.drive(P.MOVE_LEFT, 50, "soon"),
    async (api) => api.drive(P.STOP, 50, 1),
    async (api) => api.drive(P.RESUME_AUTONOMOUS, 50, 1),
    async (api) => api.wait(Infinity),
  ]) {
    const calls = target.calls.length;
    const end = await runner.run(program, target);
    assert.equal(end.outcome, "failed", `${program}: ${JSON.stringify(end)}`);
    assert.deepEqual(target.calls.slice(calls), ["release"], `${program} only released`);
  }
});

test("an exception in the program ends it cleanly, with its message", async () => {
  const { clock, target, runner, logs, highlights } = setup();
  const done = runner.run(async (api) => {
    await api.step("b7");
    await api.drive(P.MOVE_FORWARD, 50, 0.1);
    null.boom; // eslint-disable-line no-unused-expressions
  }, target);
  await clock.advance(200);
  const end = await done;
  assert.equal(end.outcome, "failed");
  assert.match(end.reason, /null/);
  assert.equal(target.calls.at(-1), "release");
  assert.match(logs.at(-1), /^failed: Error: /);
  assert.equal(highlights.at(-1), null);
  assert.equal(runner.state, "idle");
});

test("a second run is refused while one runs, and a target that is not ready refuses", async () => {
  const { clock, target, runner } = setup();
  const first = runner.run(async (api) => api.wait(1), target);
  let ran = false;
  const second = await runner.run(async () => { ran = true; }, target);
  assert.deepEqual(second, { outcome: "refused", reason: "A program is already running." });
  assert.equal(ran, false);
  runner.abort("x");
  assert.equal(runner.state, "stopping");
  assert.equal((await runner.run(async () => { ran = true; }, target)).outcome, "refused", "still unwinding");
  await first;
  await clock.advance(10);

  assert.deepEqual(target.calls, ["release", "release"], "the first run released on abort and as it ended; the refused ones touched nothing");

  target.readiness = { ok: false, why: "Connect first." };
  assert.deepEqual(await runner.run(async () => { ran = true; }, target), { outcome: "refused", reason: "Connect first." });
  assert.equal(ran, false);
  assert.equal(target.calls.length, 2, "nor did this one");
  assert.equal(runner.state, "idle");
});

test("driveUntil holds until the condition, checked per frame, and gives up after 30 s of target time", async () => {
  const { clock, target, runner, logs } = setup();
  let checks = 0;
  const done = runner.run(async (api) => {
    await api.driveUntil(P.MOVE_FORWARD, 40, async () => { checks++; return (await api.distance("distanceFront")) < 30; });
    await api.log("met");
    await api.driveUntil(P.MOVE_BACKWARD, 40, async () => false);
    await api.log("gave up");
    await api.driveUntil(P.MOVE_LEFT, 40, async () => true); // already true: no motion
  }, target);
  await clock.advance(50);
  assert.deepEqual(target.calls, ["hold 1 102"]);
  target.frame({ distanceFront: 60 });
  await clock.advance(500);
  assert.equal(checks, 2, "once before moving, once on the frame");
  assert.deepEqual(target.calls, ["hold 1 102"], "still holding");
  target.frame({ distanceFront: 25 });
  await clock.advance(10);
  assert.deepEqual(target.calls, ["hold 1 102", "release", "hold 2 102"], "met: released, next");
  assert.ok(logs.includes("say: met"));

  // The cap is the target's time: frames do not matter, and a paused clock holds it.
  clock.paused = true;
  await clock.advance(40000, 1000);
  assert.equal(target.calls.at(-1), "hold 2 102", "paused: still holding after 40 s of wall time");
  clock.paused = false;
  await clock.advance(ProgramRunner.UNTIL_MAX_MS - 100, 1000);
  assert.equal(target.calls.at(-1), "hold 2 102", "inside the cap");
  await clock.advance(200);
  // Checked before awaiting: a cap kept in real time would only come after
  // 30 s of it.
  assert.equal(runner.state, "idle", "the cap came in the target's time");
  assert.equal(target.calls.at(-1), "release");
  assert.deepEqual(await done, { outcome: "done" });
  assert.ok(logs.some((l) => /Gave up after 30 s/.test(l)), logs.join("|"));
  assert.ok(!target.calls.includes("hold 4 102"), "a condition already true never moves");
  assert.equal(target.listeners(), 0);
  assert.equal(clock.pending(), 0, "the cap's sleep was cancelled when met");
});

test("driveUntil: a condition that throws, or an abort, releases", async () => {
  const { clock, target, runner } = setup();
  let first = true;
  const done = runner.run(async (api) => {
    await api.driveUntil(P.MOVE_RIGHT, 40, async () => {
      if (first) { first = false; return false; }
      throw new Error("bad condition");
    });
  }, target);
  await clock.advance(10);
  target.frame();
  await clock.advance(10);
  const end = await done;
  assert.deepEqual(end, { outcome: "failed", reason: "bad condition" });
  assert.deepEqual(target.calls, ["hold 3 102", "release", "release"]);

  const aborted = runner.run(async (api) => api.driveUntil(P.MOVE_RIGHT, 40, async () => false), target);
  await clock.advance(1000);
  runner.abort("Stop.");
  assert.equal((await aborted).outcome, "stopped");
  assert.equal(target.calls.at(-1), "release");
  assert.equal(clock.pending(), 0);
});

test("sleeps follow the target's clock: a paused clock holds the program", async () => {
  const { clock, target, runner } = setup();
  const said = [];
  const done = runner.run(async (api) => {
    await api.wait(1);
    said.push("one");
    await api.wait(1);
    said.push("two");
  }, target);
  await clock.advance(1005);
  assert.deepEqual(said, ["one"]);
  clock.paused = true;
  await clock.advance(5000, 500);
  assert.deepEqual(said, ["one"], "nothing moves while the target's clock is paused");
  clock.paused = false;
  await clock.advance(1000);
  assert.deepEqual(said, ["one", "two"]);
  assert.equal(runner.state, "idle");
  assert.deepEqual(await done, { outcome: "done" });
});

test("stop and explore go to the target and the program carries on", async () => {
  const { clock, target, runner } = setup();
  const done = runner.run(async (api) => {
    await api.explore();
    await api.wait(0.5);
    await api.stop();
    await api.log("still here");
  }, target);
  await clock.advance(600);
  assert.deepEqual(await done, { outcome: "done" });
  assert.deepEqual(target.calls, ["explore", "stop", "release"]);
});

test("commands are paced: the same stop or explore again after REPEAT_GAP_MS, another after COMMAND_GAP_MS, a release never", async () => {
  assert.equal(ProgramRunner.COMMAND_GAP_MS, P.STICK_SEND_MS);
  assert.equal(ProgramRunner.REPEAT_GAP_MS, P.REPEAT_MS);
  const { clock, target, runner } = setup();
  const done = runner.run(async (api) => {
    for (let i = 0; i < 3; i++) await api.stop();
    await api.explore();
    await api.stop();
    await api.explore();
    await api.drive(P.MOVE_FORWARD, 50, 0.01);
    await api.drive(P.MOVE_FORWARD, 50, 0.01);
    await api.stop();
  }, target);
  await clock.advance(2000);
  assert.equal(runner.state, "idle");
  assert.deepEqual(await done, { outcome: "done" });
  assert.deepEqual(target.timeline(), [
    "stop @0", "stop @200", "stop @400", // the same again: REPEAT_GAP_MS
    "explore @500", "stop @600", "explore @700", // another: COMMAND_GAP_MS
    "hold 1 128 @800", "release @810", "hold 1 128 @900", "release @910", // a release is never held back
    "stop @1000", "release @1000",
  ]);
});

test("a loop of stops, or of very short drives, cannot flood the target", async () => {
  for (const [what, body, most] of [
    ["stops", async (api) => api.stop(), 6], // at 0, 200 ... 1000 ms
    ["stops and explores", async (api) => { await api.stop(); await api.explore(); }, 11],
    ["0.01 s drives", async (api) => api.drive(P.MOVE_FORWARD, 50, 0.01), 22], // a move and a release each 100 ms
  ]) {
    const { clock, target, runner } = setup();
    const done = runner.run(async (api) => {
      for (let i = 0; i < 100000; i++) {
        await api.tick();
        await body(api);
      }
    }, target);
    await clock.advance(1000, 5);
    const sent = target.calls.length;
    assert.ok(sent > 2 && sent <= most, `${what}: ${sent} calls in 1 s of target time: ${target.timeline().join(", ")}`);
    runner.abort("Stop.");
    assert.equal((await done).outcome, "stopped", what);
  }
});

test("an abort while a command waits for its turn sends nothing more", async () => {
  const { clock, target, runner } = setup();
  const done = runner.run(async (api) => {
    await api.stop();
    await api.stop(); // waits REPEAT_GAP_MS for its turn
  }, target);
  await clock.advance(50);
  assert.deepEqual(target.calls, ["stop"]);
  runner.abort("Stop.");
  assert.equal(runner.state, "stopping", "stopped at once, not when the turn came");
  assert.equal((await done).outcome, "stopped");
  await clock.advance(500);
  assert.deepEqual(target.calls, ["stop", "release", "release"], "no second stop");
  assert.equal(clock.pending(), 0, "no turn left waiting on the clock");
});

test("rover is exploring reads a mode the target reported after the program's last command", async () => {
  assert.equal(ProgramRunner.MODE_FRAMES, 2);
  const { clock, target, runner } = setup();
  const seen = [];
  const done = runner.run(async (api) => {
    seen.push(await api.isExploring()); // no command yet: the frame in hand
    await api.explore();
    seen.push(await api.isExploring());
    await api.stop();
    seen.push(await api.isExploring());
    await api.drive(P.MOVE_FORWARD, 50, 0.2); // a drive changes the mode too
    seen.push(await api.isExploring());
  }, target);
  await clock.advance(50);
  assert.deepEqual(seen, [false], "before any command, the frame in hand");
  target.frame({ mode: "MANUAL" }); // sent before the rover had the command
  await clock.advance(50);
  assert.deepEqual(seen, [false], "one frame after the command is not enough");
  target.frame({ mode: "AUTONOMOUS" });
  await flush();
  assert.deepEqual(seen, [false, true], "start exploring, then exploring");

  await clock.advance(200); // the stop's turn comes 100 ms after the explore
  target.frame({ mode: "AUTONOMOUS" });
  await clock.advance(10);
  assert.equal(seen.length, 2);
  target.frame({ mode: "MANUAL" });
  await clock.advance(10);
  assert.deepEqual(seen, [false, true, false], "stop, then not exploring");

  await clock.advance(100); // the drive is under way
  target.frame({ mode: "MANUAL" });
  await clock.advance(300); // and over
  assert.equal(seen.length, 3, "one frame since the drive began is not enough");
  target.frame({ mode: "MANUAL" });
  await clock.advance(10);
  assert.deepEqual(seen, [false, true, false, false], "the second is");
  assert.equal(runner.state, "idle");
  assert.deepEqual(await done, { outcome: "done" });

  // No frame comes: it gives up after FIRST_READING_MS, rather than answer
  // from before the command.
  const silent = runner.run(async (api) => { await api.explore(); await api.isExploring(); }, target);
  await clock.advance(ProgramRunner.FIRST_READING_MS + 50);
  assert.equal(runner.state, "idle");
  const end = await silent;
  assert.equal(end.outcome, "failed");
  assert.match(end.reason, /has not sent its mode yet/);
});

test("log shows numbers tidily and caps long text", async () => {
  const { target, runner, logs } = setup();
  await runner.run(async (api) => {
    await api.log(1 / 3);
    await api.log(42);
    await api.log("x".repeat(600));
    await api.log(undefined);
  }, target);
  const said = logs.filter((l) => l.startsWith("say: ")).map((l) => l.slice(5));
  assert.deepEqual(said.slice(0, 2), ["0.333", "42"]);
  assert.equal(said[2].length, 501);
  assert.equal(said[3], "undefined");
});

/* --- RoverTarget ---------------------------------------------------------- */

// The Driver and Link, reduced to what RoverTarget uses. The Driver sends what
// the real one would, onto `sent`: STOP from endProgram() only when the
// program was driving, as drive.js does; and Stop and Autonomous raise their
// events only when they are not a program's own (byProgram).
function rover() {
  const sent = [];
  const listeners = { standDown: [], manual: [], telemetry: [], state: [] };
  const driver = {
    held: null,
    byProgram: [], // what each stopRover() and resumeAutonomous() was told
    program(move, speed) { this.held = { move, speed }; sent.push(`${move}@${speed}`); },
    endProgram() { if (this.held) { this.held = null; sent.push("STOP"); } },
    stopRover({ byProgram = false } = {}) {
      this.held = null;
      sent.push("STOP");
      this.byProgram.push(byProgram);
      if (byProgram) return;
      listeners.manual.forEach((fn) => fn());
      listeners.standDown.forEach((fn) => fn("stop"));
    },
    resumeAutonomous({ byProgram = false } = {}) {
      this.held = null;
      sent.push("RESUME");
      this.byProgram.push(byProgram);
      if (byProgram) return;
      listeners.manual.forEach((fn) => fn());
      listeners.standDown.forEach((fn) => fn("autonomous"));
    },
    standDown(reason) {
      if (this.held) { this.held = null; sent.push("STOP"); }
      listeners.standDown.forEach((fn) => fn(reason));
    },
    press() { listeners.manual.forEach((fn) => fn()); },
    onStandDown(fn) { listeners.standDown.push(fn); },
    onManualInput(fn) { listeners.manual.push(fn); },
  };
  const link = {
    state: "up",
    onTelemetry(fn) { listeners.telemetry.push(fn); },
    onState(fn) { listeners.state.push(fn); },
    frame(data) { listeners.telemetry.forEach((fn) => fn(data)); },
    go(state) { this.state = state; listeners.state.forEach((fn) => fn(state)); },
  };
  const target = new RoverTarget(driver, link);
  return { sent, driver, link, target, runner: new ProgramRunner() };
}

// RoverTarget sleeps in real time; these keep the waits short.
const realTime = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("RoverTarget: hold and release are program and endProgram", () => {
  const { sent, target } = rover();
  assert.equal(target.kind, "rover");
  target.hold(P.MOVE_FORWARD, 100);
  target.hold(P.MOVE_LEFT, 90);
  target.release();
  target.release();
  assert.deepEqual(sent, ["1@100", "4@90", "STOP"], "STOP once, only while driving");
});

test("RoverTarget: abort mid-wait sends STOP only when the program drives", async () => {
  {
    const { sent, runner, target } = rover();
    const done = runner.run(async (api) => api.drive(P.MOVE_FORWARD, 50, 5), target);
    await realTime(20);
    runner.abort("Stop.");
    assert.equal((await done).outcome, "stopped");
    assert.deepEqual(sent, ["1@128", "STOP"]);
  }
  {
    const { sent, runner, target } = rover();
    const done = runner.run(async (api) => api.wait(5), target);
    await realTime(20);
    runner.abort("Stop.");
    assert.equal((await done).outcome, "stopped");
    assert.deepEqual(sent, [], "a waiting program drove nothing, so nothing is sent");
  }
});

test("RoverTarget: after start exploring, an abort sends nothing, and the program is not lost", async () => {
  const { sent, runner, target } = rover();
  const lost = [];
  target.onLost((reason) => lost.push(reason));
  const done = runner.run(async (api) => {
    await api.explore();
    await api.wait(5);
  }, target);
  await realTime(20);
  await flush();
  assert.equal(runner.state, "running", "its own explore did not stop it");
  assert.deepEqual(lost, [], "nor count as the operator taking over");
  runner.abort("Stop.");
  assert.equal((await done).outcome, "stopped");
  assert.deepEqual(sent, ["RESUME"], "the exploring rover is left alone");

  const { sent: sent2, driver: driver2, runner: runner2, target: target2 } = rover();
  const stopped = runner2.run(async (api) => {
    await api.explore();
    await api.stop(); // its author asked: STOP, even while exploring
    await api.log("carried on");
  }, target2);
  assert.deepEqual(await stopped, { outcome: "done" });
  assert.deepEqual(sent2, ["RESUME", "STOP"]);
  assert.deepEqual(driver2.byProgram, [true, true], "both as the program's own, so the Driver raises no event");
});

test("RoverTarget: onLost fires on every stand-down and on a manual press", async () => {
  const { driver, target } = rover();
  const lost = [];
  const unsubscribe = target.onLost((reason) => lost.push(reason));
  for (const reason of ["blur", "hidden", "pagehide", "disconnect", "linkLost", "stale"]) driver.standDown(reason);
  driver.press();
  await flush();
  driver.stopRover();
  await flush();
  driver.resumeAutonomous();
  await flush();
  assert.deepEqual(lost, [
    "the panel's window lost focus.", "the page was hidden.", "the page was closed.",
    "the panel disconnected from the rover.", "the link to the rover was lost.", "telemetry stopped arriving.",
    "the rover was driven by hand.",
    "Stop was pressed.", "the rover was driven by hand.",
    "Autonomous was pressed.", "the rover was driven by hand.",
  ]);
  unsubscribe();
  driver.standDown("blur");
  assert.equal(lost.length, 11, "unsubscribed");
});

test("RoverTarget: a stand-down or a manual press stops a running program, with the first reason", async () => {
  for (const [act, reason, wire] of [
    [(d) => d.standDown("blur"), "the panel's window lost focus.", ["1@128", "STOP"]],
    [(d) => d.press(), "the rover was driven by hand.", ["1@128", "STOP"]],
    [(d) => d.stopRover(), "Stop was pressed.", ["1@128", "STOP"]],
    [(d) => d.standDown("linkLost"), "the link to the rover was lost.", ["1@128", "STOP"]],
  ]) {
    const { sent, driver, runner, target } = rover();
    const done = runner.run(async (api) => api.drive(P.MOVE_FORWARD, 50, 5), target);
    await realTime(10);
    act(driver);
    assert.deepEqual(await done, { outcome: "stopped", reason });
    assert.deepEqual(sent, wire, reason);
  }
});

test("RoverTarget: ready() and telemetry() follow the link", () => {
  const { link, target } = rover();
  assert.deepEqual(target.ready(), { ok: true, why: "" });
  link.frame({ mode: "MANUAL", distanceFront: 50 });
  assert.deepEqual(target.telemetry(), { data: { mode: "MANUAL", distanceFront: 50 }, fresh: true });
  const seen = [];
  const unsubscribe = target.onTelemetry((data) => seen.push(data.distanceFront));
  link.frame({ distanceFront: 40 });
  unsubscribe();
  link.frame({ distanceFront: 30 });
  assert.deepEqual(seen, [40]);

  link.go("stale");
  assert.equal(target.ready().ok, false);
  assert.match(target.ready().why, /stopped sending telemetry/);
  assert.equal(target.telemetry().fresh, false);
  link.go("down");
  assert.deepEqual(target.telemetry(), { data: null, fresh: false }, "the readings went with the link");
  assert.match(target.ready().why, /Connect/);
  link.go("connecting");
  assert.match(target.ready().why, /Waiting/);
  link.go("up");
  assert.equal(target.ready().ok, true);
});

test("RoverTarget: a program never starts on a rover that is not connected", async () => {
  const { sent, link, runner, target } = rover();
  link.go("down");
  const end = await runner.run(async (api) => api.drive(P.MOVE_FORWARD, 50, 1), target);
  assert.equal(end.outcome, "refused");
  assert.deepEqual(sent, []);
});

test("RoverTarget: sleep is real time and rejects on abort", async () => {
  const { target } = rover();
  const t0 = Date.now();
  await target.sleep(30, new AbortController().signal);
  assert.ok(Date.now() - t0 >= 25);
  const controller = new AbortController();
  const pending = target.sleep(10000, controller.signal);
  controller.abort(new Error("gone"));
  await assert.rejects(pending, /gone/);
  const already = new AbortController();
  already.abort(new Error("before"));
  await assert.rejects(target.sleep(1, already.signal), /before/);
});

/* --- the examples (blocks.js) --------------------------------------------- */

// blocks.js loads in Node for its data; Blockly itself never does here.
const { RoverBlocks } = require("../js/blocks.js");
const { MOTIONS } = require("../js/mecanum.js");

// Every block in a saved workspace, depth first, with its statement chains.
function blocksIn(state) {
  const out = [];
  const visit = (block) => {
    if (!block) return;
    out.push(block);
    for (const input of Object.values(block.inputs || {})) {
      visit(input.block);
      visit(input.shadow);
    }
    if (block.next) visit(block.next.block);
  };
  state.blocks.blocks.forEach(visit);
  return out;
}
// A statement chain as [type or "MOVE speed s"] for drives.
function chainOf(block) {
  const out = [];
  for (let b = block; b; b = b.next && b.next.block) {
    out.push(b.type === "rover_drive_for"
      ? `${b.fields.MOVE} ${b.inputs.SPEED.shadow.fields.NUM} ${b.inputs.SECONDS.shadow.fields.NUM}`
      : b.type);
  }
  return out;
}
// A condition made of sensor and logic blocks, in words.
function conditionOf(block) {
  if (block.type === "rover_clear") return `${block.fields.BEARING} > ${block.inputs.LIMIT.shadow.fields.NUM}`;
  if (block.type === "logic_operation") {
    return `${conditionOf(block.inputs.A.block)} ${block.fields.OP.toLowerCase()} ${conditionOf(block.inputs.B.block)}`;
  }
  if (block.type === "logic_negate") return `not (${conditionOf(block.inputs.BOOL.block)})`;
  return block.type;
}

test("examples: the four, built only from the editor's blocks and real motions", () => {
  assert.deepEqual(RoverBlocks.EXAMPLES.map((e) => e.name), ["Square", "Strafe box", "Patrol", "Mecanum tour"]);
  const names = new Set(MOTIONS.map((m) => m.name));
  for (const example of RoverBlocks.EXAMPLES) {
    assert.equal(example.state.blocks.languageVersion, 0, example.name);
    for (const block of blocksIn(example.state)) {
      assert.ok(RoverBlocks.TYPES.has(block.type), `${example.name}: ${block.type}`);
      assert.equal(block.id, undefined, `${example.name}: ids are left to Blockly`);
      if (block.fields && "MOVE" in block.fields) assert.ok(names.has(block.fields.MOVE), `${example.name}: ${block.fields.MOVE}`);
      if (block.fields && "BEARING" in block.fields) assert.match(block.fields.BEARING, /^distance[A-Z]/);
    }
  }
});

test("examples: what each one does", () => {
  const [square, box, patrol, tour] = RoverBlocks.EXAMPLES.map((e) => e.state.blocks.blocks);
  assert.equal(square.length, 1);
  assert.equal(square[0].type, "controls_repeat_ext");
  assert.equal(square[0].inputs.TIMES.shadow.fields.NUM, 4);
  assert.deepEqual(chainOf(square[0].inputs.DO.block), ["MOVE_FORWARD 50 1", "ROTATE_CLOCKWISE 50 0.6"]);

  assert.deepEqual(chainOf(box[0]), ["MOVE_FORWARD 50 1", "MOVE_RIGHT 50 1", "MOVE_BACKWARD 50 1", "MOVE_LEFT 50 1"]);

  // Forward slowly while the way ahead is clear, stopping a little short of
  // where it started; otherwise turn. test/sim.test.js previews it.
  assert.equal(patrol[0].type, "rover_forever");
  const branch = patrol[0].inputs.DO.block;
  assert.equal(branch.type, "controls_if");
  assert.deepEqual(branch.extraState, { hasElse: true });
  assert.equal(conditionOf(branch.inputs.IF0.block), "distanceFront > 60 and distanceFrontLeft > 40 and distanceFrontRight > 40");
  const go = branch.inputs.DO0.block;
  assert.equal(go.type, "rover_drive_until");
  assert.equal(go.next, undefined);
  assert.equal(go.fields.MOVE, "MOVE_FORWARD");
  assert.equal(go.inputs.SPEED.shadow.fields.NUM, 30);
  assert.equal(conditionOf(go.inputs.UNTIL.block), "not (distanceFront > 50 and distanceFrontLeft > 35 and distanceFrontRight > 35)");
  assert.deepEqual(chainOf(branch.inputs.ELSE.block), ["ROTATE_CLOCKWISE 40 0.4"]);

  const stops = chainOf(tour[0]);
  assert.equal(stops.length, 18);
  assert.deepEqual(stops.map((s) => s.split(" ")[0]).sort(), MOTIONS.map((m) => m.name).sort(), "every motion once");
  assert.ok(stops.every((s) => s.endsWith(" 40 0.5")), "each 0.5 s at 40 %");
});

test("examples: the motion menu lists all eighteen motions once, the pivots last", () => {
  assert.deepEqual([...RoverBlocks.MOTION_MENU].sort(), MOTIONS.map((m) => m.name).sort());
  const pivots = RoverBlocks.MOTION_MENU.map((name) => MOTIONS.find((m) => m.name === name).advanced);
  assert.deepEqual(pivots, [...Array(10).fill(false), ...Array(8).fill(true)]);
  for (const key of Object.keys(RoverBlocks.PALETTE)) assert.match(RoverBlocks.PALETTE[key], /^#[0-9a-f]{6}$/);
});

/* --- checking a program before it is loaded (blocks.js) -------------------- */

// state with every block's id removed, by the same walk as blocksIn().
function withoutIds(state) {
  const copy = JSON.parse(JSON.stringify(state));
  for (const block of blocksIn(copy)) delete block.id;
  return copy;
}

test("sanitize: every block id goes, at every depth, and the state passed in is left alone", () => {
  // An id is written into the program's code, so a file's own could run as
  // code: this one would have, before ids were dropped.
  const evil = "a');globalThis.__pwned=1;//";
  const number = (id, n) => ({ shadow: { type: "math_number", id, fields: { NUM: n } } });
  const state = {
    blocks: { languageVersion: 0, blocks: [
      { type: "rover_forever", id: evil, x: 40, y: 40, inputs: { DO: { block: {
        type: "controls_if", id: "if'1", extraState: { hasElse: true },
        inputs: {
          IF0: { block: { type: "rover_clear", id: "c\\1", fields: { BEARING: "distanceFront" },
            inputs: { LIMIT: { ...number("n1", 40), block: { type: "variables_get", id: "g1", fields: { VAR: { id: "v1" } } } } } } },
          DO0: { block: { type: "rover_drive_for", id: "d1", fields: { MOVE: "PIVOT_LEFT_FORWARD" },
            inputs: { SPEED: number("n2", 50), SECONDS: number("n3", 0.5) },
            next: { block: { type: "rover_stop", id: "s\n1" } } } },
          ELSE: { block: { type: "rover_explore", id: "e1" } },
        },
      } } } },
      { type: "rover_say", id: "say1", x: 40, y: 300, inputs: { TEXT: { shadow: { type: "text", id: "t1", fields: { TEXT: "hi" } } } } },
    ] },
    variables: [{ name: "gap", id: "v1" }],
  };
  const before = JSON.stringify(state);
  const clean = RoverBlocks.sanitize(state);
  assert.equal(JSON.stringify(state), before, "the state passed in is unchanged");
  assert.notEqual(clean, state, "a copy");
  assert.equal(blocksIn(clean).length, 12, "every block kept");
  assert.deepEqual(blocksIn(clean).filter((b) => "id" in b), [], "no block keeps an id, top-level, next, input or shadow");
  assert.deepEqual(clean, withoutIds(state), "and nothing else changes: fields, positions, extra state, variables");
  assert.ok(!JSON.stringify(clean).includes("pwned"));

  for (const example of RoverBlocks.EXAMPLES) {
    assert.deepEqual(RoverBlocks.sanitize(example.state), example.state, `${example.name} loads as it is`);
  }
  assert.deepEqual(RoverBlocks.sanitize({}), {}, "an empty workspace is a program");
});

test("sanitize: refuses what is not a rover program, and says why", () => {
  const program = (...blocks) => ({ blocks: { languageVersion: 0, blocks } });
  const cyclic = {};
  cyclic.self = cyclic;
  const many = Array.from({ length: RoverBlocks.MAX_BLOCKS + 1 }, () => ({ type: "rover_stop" }));
  for (const [state, why] of [
    [null, /not a JSON object/],
    [[], /not a JSON object/],
    ["{}", /not a JSON object/],
    [42, /not a JSON object/],
    [cyclic, /cannot be read/],
    [{ blocks: [] }, /"blocks" are not a list/],
    [{ blocks: { blocks: {} } }, /"blocks" are not a list/],
    [{ variables: {} }, /"variables" are not a list/],
    [program(42), /a block with no type/],
    [program({ id: "x" }), /a block with no type/],
    [program({ type: "procedures_defnoreturn" }), /"procedures_defnoreturn" block, which this editor does not have/],
    [program({ type: "rover_stop", next: { block: { type: "js_eval" } } }), /"js_eval"/],
    [program({ type: "rover_say", inputs: { TEXT: { shadow: { type: "text_print" } } } }), /"text_print"/],
    [program({ type: "rover_forever", inputs: { DO: { block: { type: "rover_wait", inputs: { SECONDS: { block: { type: "lists_create_with" } } } } } } }), /"lists_create_with"/],
    [program({ type: "rover_drive_for", fields: { MOVE: "WARP" } }), /drives "WARP", which is not a motion/],
    [program({ type: "rover_drive_until", fields: { MOVE: "STOP" } }), /drives "STOP"/],
    [program({ type: "rover_drive_for", fields: { MOVE: "RESUME_AUTONOMOUS" } }), /drives "RESUME_AUTONOMOUS"/],
    [program({ type: "rover_distance", fields: { BEARING: "distanceUp" } }), /reads "distanceUp", which is not a bearing/],
    [program({ type: "rover_stop", next: "rover_stop" }), /joined to something that is not a block/],
    [program({ type: "rover_say", inputs: { TEXT: [] } }), /joined to something that is not a block/],
    [program(...many), new RegExp(`more than ${RoverBlocks.MAX_BLOCKS} blocks`)],
  ]) {
    assert.throws(() => RoverBlocks.sanitize(state), (err) => err instanceof Error && /^This is not a rover program: /.test(err.message) && why.test(err.message),
      `${state === cyclic ? "a cyclic object" : JSON.stringify(state).slice(0, 120)} should be refused with ${why}`);
  }
  assert.equal(RoverBlocks.sanitize(program(...many.slice(1))).blocks.blocks.length, RoverBlocks.MAX_BLOCKS, "exactly MAX_BLOCKS is allowed");
});

test("tooltips quote the runner's own limits, name the motion, and warn about pivots", () => {
  const R = ProgramRunner;
  assert.match(RoverBlocks.tooltip("rover_drive_for", "MOVE_FORWARD"), new RegExp(`^Drive forward .*up to ${R.DRIVE_SECONDS_MAX} s\\), then stop\\.$`));
  assert.match(RoverBlocks.tooltip("rover_drive_until", "MOVE_LEFT"), new RegExp(`^Drive strafe left .*stops after ${R.UNTIL_MAX_MS / 1000} s `));
  assert.match(RoverBlocks.tooltip("rover_wait"), new RegExp(`up to ${R.WAIT_SECONDS_MAX} s\\.`));
  assert.match(RoverBlocks.tooltip("rover_exploring"), new RegExp(`has reported ${R.MODE_FRAMES} more times`));
  for (const motion of MOTIONS) {
    for (const type of ["rover_drive_for", "rover_drive_until"]) {
      const text = RoverBlocks.tooltip(type, motion.name);
      assert.ok(text.includes(motion.label.toLowerCase()), `${type} ${motion.name}: ${text}`);
      assert.equal(text.includes("not bench-verified"), motion.advanced, `${type} ${motion.name}: the pivot note`);
    }
  }
});

/* --- what the generator writes besides a block's own code (blocks.js) ------ */

// Line terminators, spelt out: written as escapes in this file, a raw one
// would end a line of the test itself.
const CR = String.fromCharCode(13);
const LS = String.fromCharCode(0x2028);
const PS = String.fromCharCode(0x2029);

// A stand-in for Blockly 13.3.0's JavascriptGenerator, reduced to what
// RoverBlocks.harden() replaces, each as Blockly writes it: scrub_ puts a
// block's comment before its code as `// ` lines, split at \n alone, then
// goes on to the next block; quote_ escapes the backslash, \n and the quote.
// A block is {code, comment, next}; its code calls the program's own spies.
class StandInGenerator {
  blockToCode(block) {
    return block ? this.scrub_(block, block.code) : "";
  }

  scrub_(block, code, thisOnly = false) {
    const comment = block.comment ? block.comment.split("\n").map((line) => `// ${line}\n`).join("") : "";
    const next = block.nextConnection && block.nextConnection.targetBlock();
    return comment + code + (thisOnly ? "" : this.blockToCode(next));
  }

  quote_(text) {
    return `'${text.replace(/\\/g, "\\\\").replace(/\n/g, "\\\n").replace(/'/g, "\\'")}'`;
  }
}
const standInBlock = (code, comment, next = null) => ({ code, comment, nextConnection: { targetBlock: () => next } });

test("harden: no block comment reaches the code, whatever line breaks it holds", () => {
  const program = standInBlock("ran('a');\n", `note${LS}ran('pwned by LS');//`,
    standInBlock("ran('b');\n", `two${CR}ran('pwned by CR');//`,
      standInBlock("ran('c');\n", `three${PS}ran('pwned by PS');//\nfour`)));
  const run = (code) => {
    const calls = [];
    new Function("ran", code)((what) => calls.push(what));
    return calls;
  };
  // As Blockly writes it, each comment's line break ends its `//` line, and
  // the rest runs: what an imported file could do.
  assert.deepEqual(run(new StandInGenerator().blockToCode(program)),
    ["pwned by LS", "a", "pwned by CR", "b", "pwned by PS", "c"]);

  const generator = RoverBlocks.harden(new StandInGenerator());
  const code = generator.blockToCode(program);
  assert.equal(code, "ran('a');\nran('b');\nran('c');\n", "the code alone, every block in order");
  assert.deepEqual(run(code), ["a", "b", "c"]);
  assert.equal(generator.scrub_(program, "ran('a');\n", true), "ran('a');\n", "thisOnly: the next block is left out");
  assert.equal(generator.blockToCode(null), "");
});

test("harden: a text's words compile to themselves, line breaks and quotes included", () => {
  const generator = RoverBlocks.harden(new StandInGenerator());
  for (const text of ["plain", "it's", "back\\slash", `cr${CR}here`, `ls${LS}here`, `ps${PS}here`, `${CR}'${LS}\\${PS}'`, ""]) {
    const literal = generator.quote_(text);
    assert.ok(![CR, LS, PS].some((c) => literal.includes(c)), `${JSON.stringify(text)}: ${JSON.stringify(literal)} holds no line break`);
    assert.equal(new Function(`return ${literal};`)(), text, JSON.stringify(text));
  }
  // \n keeps Blockly's own treatment: a line continuation, which drops it.
  assert.equal(new Function(`return ${generator.quote_("a\nb")};`)(), "ab");
  // Without harden(), a carriage return ends the literal mid-way.
  assert.throws(() => new Function(`return ${new StandInGenerator().quote_(`a${CR}b`)};`), SyntaxError);
  // And an id is always a string literal, quotes and all.
  assert.equal(generator.injectId("await api.step(%1);\n", { id: "a');ran();//" }), 'await api.step("a\');ran();//");\n');
});

test("sanitize: a comment's line breaks become plain \\n, and the rest of it is kept", () => {
  const state = { blocks: { languageVersion: 0, blocks: [{
    type: "rover_stop",
    icons: { comment: { text: `one${CR}\ntwo${CR}three${LS}four${PS}five\nsix`, pinned: true, height: 90, width: 200 } },
    next: { block: { type: "rover_stop", icons: { comment: { text: "plain" } } } },
  }] } };
  const clean = RoverBlocks.sanitize(state);
  assert.deepEqual(clean.blocks.blocks[0].icons.comment, { text: "one\ntwo\nthree\nfour\nfive\nsix", pinned: true, height: 90, width: 200 });
  assert.deepEqual(clean.blocks.blocks[0].next.block.icons.comment, { text: "plain" });
  assert.ok(state.blocks.blocks[0].icons.comment.text.includes(LS), "the state passed in is left alone");
});

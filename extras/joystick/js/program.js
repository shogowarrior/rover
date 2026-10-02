/**
 * Running a block program: ProgramRunner runs one program at a time on a
 * Target, and RoverTarget is the Target that is the real rover.
 *
 * A program is an async function of one argument, api (see #api below), and
 * that is all it can reach. The Program tab's blocks compile to one
 * (blocks.js); the tests write them by hand. Nothing here knows about Blockly,
 * the DOM, the Driver or the Link, so this file also loads in Node.
 *
 * A Target is what a program drives: the rover, or the simulator a preview
 * runs on (js/sim.js). Both have this shape:
 *
 *   kind               "rover" or "simulator".
 *   ready()            {ok, why}: whether a program may start on it now, and if
 *                      not, why not, in words for the operator.
 *   hold(move, speed)  drive this motion until it is changed or released. move
 *                      is a motion code from protocol.js, speed 0..SPEED_MAX.
 *   release()          stop what the program is driving, and nothing else.
 *   stop()             the "stop" block: stop, even a rover that is exploring.
 *   explore()          the "start exploring" block.
 *   telemetry()        {data, fresh}: the latest telemetry object, with the
 *                      rover's own keys (src/Protocol.cpp writes them), or
 *                      null; fresh is false once the source cannot be trusted.
 *   onTelemetry(fn)    fn(data) on each new frame: every 500 ms of the target's
 *                      own time.
 *   onLost(fn)         fn(reason) when the target can no longer be trusted to
 *                      follow the program.
 *   sleep(ms, signal)  a Promise that resolves after ms of the target's own
 *                      time, and rejects when the AbortSignal aborts.
 *   Every on...(fn) returns a function that unsubscribes fn.
 *
 * In Node there is no page: the panel's own scripts that this one reads are
 * loaded onto the global object first, as mecanum.js does.
 */
if (typeof module !== "undefined" && typeof Listeners === "undefined") {
  Object.assign(globalThis, require("./support.js"), require("./protocol.js"), require("./mecanum.js"));
}

/**
 * Runs one program at a time on a Target.
 *
 *   run(program, target)
 *       Runs program(api) on target. Returns a Promise of how it ended:
 *       {outcome: "done"}, {outcome: "stopped", reason} (aborted),
 *       {outcome: "failed", reason} (the program threw), or
 *       {outcome: "refused", reason} -- a program is already running, or the
 *       target is not ready -- in which case nothing ran.
 *   abort(reason)
 *       Stops the running program: its pending wait ends at once, what it was
 *       driving is released, and every api call it makes from then on throws.
 *       Returns false when there was nothing to stop.
 *   state        "idle", "running" or "stopping" (aborted, still unwinding).
 *   target       the Target a program is running on, or null.
 *   onState(fn)      fn(state, {kind, outcome, reason}) on each change.
 *   onLog(fn)        fn({text, tone}): tone "say" for the program's own
 *                    output, "info", "done", "stopped" or "failed".
 *   onHighlight(fn)  fn(blockId) as each statement starts; fn(null) when
 *                    nothing runs.
 *
 * Every wait goes through target.sleep(), never setTimeout: a preview then
 * keeps the simulator's time, at its playback speed, and pauses with it.
 *
 * A program's commands are paced (COMMAND_GAP_MS): one that comes too soon
 * after the last waits its turn, so no loop can flood the rover.
 */
class ProgramRunner {
  // Bounds on what a program may ask for. The firmware caps each command at
  // 1.5 s whatever it asks; these keep a typo (a drive of 600 s, a speed of
  // 1000 %) from turning into something the operator did not mean. The
  // blocks' tooltips quote them (blocks.js).
  static DRIVE_SECONDS_MAX = 60;
  static WAIT_SECONDS_MAX = 600;
  // "drive ... until" gives up after this much of the target's time, so a
  // condition that never comes true cannot drive forever. Its block's tooltip
  // says so.
  static UNTIL_MAX_MS = 30000;
  // How long a reading may take to arrive the first time. The rover reports
  // no distances until it has measured every bearing once after booting,
  // about 1.1 s, and then only in its next telemetry frame.
  static FIRST_READING_MS = 3000;
  // A command -- a drive starting, a stop, a start exploring -- starts at
  // least COMMAND_GAP_MS of the target's time after the one before it, and
  // the same stop or start exploring again at least REPEAT_GAP_MS after it:
  // no faster than the panel's own controls send (protocol.js). Without this
  // a loop of stops put about 200 STOPs a second on the wire -- each one, on
  // the rover, a change of mode and a write of all four motors over I2C,
  // with nothing in the firmware to slow it -- and a loop of very short
  // drives a move and a STOP as often. One that comes sooner waits for its
  // turn rather than being dropped, so a preview keeps the rover's pace.
  // Releasing is never made to wait: it is how a drive stops.
  static COMMAND_GAP_MS = STICK_SEND_MS;
  static REPEAT_GAP_MS = REPEAT_MS;
  // After a command, a mode is read from this many frames on. The frame in
  // hand says the mode from before the command, and so may the next: on the
  // rover it can cross the command on its way. Without this, "start
  // exploring" then "rover is exploring" read false.
  static MODE_FRAMES = 2;

  // While one runs: {target, controller, reason, unsubscribe, frames (telemetry
  // frames seen), modeFrom (the frame a mode may be read from), lastCommand}.
  #run = null;
  #state = "idle";
  #stateListeners = new Listeners();
  #logListeners = new Listeners();
  #highlightListeners = new Listeners();

  get state() {
    return this.#state;
  }

  get target() {
    return this.#run ? this.#run.target : null;
  }

  onState(fn) {
    return this.#stateListeners.add(fn);
  }

  onLog(fn) {
    return this.#logListeners.add(fn);
  }

  onHighlight(fn) {
    return this.#highlightListeners.add(fn);
  }

  run(program, target) {
    if (typeof program !== "function") throw new TypeError("run() takes the program as an async function");
    if (this.#run) return Promise.resolve({ outcome: "refused", reason: "A program is already running." });
    // A rover that is not connected would take a program's moves the moment a
    // link opened, long after the operator pressed Run.
    const { ok, why } = target.ready();
    if (!ok) return Promise.resolve({ outcome: "refused", reason: why });

    const run = { target, controller: new AbortController(), reason: null, unsubscribe: null, frames: 0, modeFrom: 0, lastCommand: null };
    this.#run = run;
    const listening = [
      target.onLost((reason) => this.#stop(run, reason)),
      // First, so a frame is counted before anything waiting on it looks.
      target.onTelemetry(() => {
        run.frames++;
      }),
    ];
    run.unsubscribe = () => listening.forEach((stop) => stop());
    this.#setState("running", { kind: target.kind });
    this.#log(`Started on the ${target.kind}.`, "info");
    return this.#execute(run, program);
  }

  abort(reason = "Stopped.") {
    return this.#run ? this.#stop(this.#run, reason) : false;
  }

  /* --- one run --------------------------------------------------------- */

  async #execute(run, program) {
    const { signal } = run.controller;
    let end;
    try {
      await program(this.#api(run));
      // A program can finish in the same turn as an abort, its last statement
      // already run; it still counts as stopped.
      end = signal.aborted ? { outcome: "stopped", reason: run.reason } : { outcome: "done" };
    } catch (err) {
      end = signal.aborted
        ? { outcome: "stopped", reason: run.reason }
        : { outcome: "failed", reason: ProgramRunner.#describe(err) };
    }

    run.unsubscribe();
    // Nothing should still be waiting, but if something is, it ends now.
    if (!signal.aborted) run.controller.abort(ProgramRunner.#stopped("The program has ended."));
    run.target.release();
    this.#highlight(null);
    this.#run = null;
    if (end.outcome === "done") this.#log("Done.", "done");
    else if (end.outcome === "stopped") this.#log(`Stopped: ${end.reason}`, "stopped");
    else this.#log(`Error: ${end.reason}`, "failed");
    this.#setState("idle", { kind: run.target.kind, ...end });
    return end;
  }

  #stop(run, reason) {
    if (run !== this.#run || run.controller.signal.aborted) return false;
    run.reason = reason;
    // The pending wait rejects, and so does every api call from here on...
    run.controller.abort(ProgramRunner.#stopped(reason));
    // ...and what the program drives stops now, not when it has unwound.
    run.target.release();
    this.#highlight(null);
    this.#setState("stopping", { kind: run.target.kind, reason });
    return true;
  }

  /* --- what a program can do ------------------------------------------- */

  // The program's only way out. Each call checks first that the run has not
  // been stopped, so a stopped program cannot drive again on its way out.
  #api(run) {
    const { target } = run;
    const { signal } = run.controller;
    const live = () => {
      if (signal.aborted) throw signal.reason;
    };

    const api = {
      // Drive a motion for a time, then stop: "drive X for N s" means move,
      // then stop, so a stack of drives stops between them.
      drive: async (move, speedPercent, seconds) => {
        live();
        ProgramRunner.#checkMotion(move);
        const speed = ProgramRunner.#speed(speedPercent);
        const ms = ProgramRunner.#seconds(seconds, ProgramRunner.DRIVE_SECONDS_MAX, "drive") * 1000;
        if (ms === 0) return;
        await this.#takeTurn(run, "hold");
        target.hold(move, speed);
        try {
          await this.#sleep(run, ms);
        } finally {
          target.release();
        }
      },

      // Drive until condition() comes true, checking it on each new reading,
      // for UNTIL_MAX_MS of the target's time at most. A condition already
      // true does not move at all.
      driveUntil: async (move, speedPercent, condition) => {
        live();
        ProgramRunner.#checkMotion(move);
        const speed = ProgramRunner.#speed(speedPercent);
        if (typeof condition !== "function") throw new TypeError("drive until needs a condition");
        if (await condition()) return;
        await this.#takeTurn(run, "hold");
        target.hold(move, speed);
        try {
          const met = await this.#until(run, condition, ProgramRunner.UNTIL_MAX_MS);
          if (!met) {
            this.#log(`Gave up after ${ProgramRunner.UNTIL_MAX_MS / 1000} s: the condition never came true.`, "info");
          }
        } finally {
          target.release();
        }
      },

      // The author asked the rover to stop, so it does, even one exploring
      // after "start exploring". The program carries on.
      stop: async () => {
        live();
        await this.#takeTurn(run, "stop");
        target.stop();
      },

      explore: async () => {
        live();
        await this.#takeTurn(run, "explore");
        target.explore();
      },

      wait: async (seconds) => {
        live();
        await this.#sleep(run, ProgramRunner.#seconds(seconds, ProgramRunner.WAIT_SECONDS_MAX, "wait") * 1000);
      },

      // A distance in cm, as telemetry reports it: FAR_CM (999) means no echo.
      distance: async (key) => {
        live();
        if (typeof key !== "string" || !/^distance[A-Z]\w*$/.test(key)) {
          throw new RangeError(`there is no distance called ${key}`);
        }
        return this.#reading(run, `a ${key} reading`, (data) => {
          const cm = data[key];
          return typeof cm === "number" && Number.isFinite(cm) ? cm : undefined;
        });
      },

      // A measured echo farther than cm. No echo is not clear: a dead or
      // unplugged sensor reads the same as open space, and an absent echo
      // alone must never justify motion (AGENTS.md, "Sensor sentinels").
      clearBeyond: async (key, cm) => {
        const limit = ProgramRunner.#number(cm, "clear beyond");
        const reading = await api.distance(key);
        return reading < FAR_CM && reading > limit;
      },

      // The mode as the target has reported it since the program's last
      // command (MODE_FRAMES), which on the rover takes up to a second.
      isExploring: async () => {
        live();
        const mode = await this.#reading(run, "its mode", (data) =>
          typeof data.mode === "string" ? data.mode : undefined, run.modeFrom);
        return mode === "AUTONOMOUS";
      },

      log: async (text) => {
        live();
        this.#log(ProgramRunner.#text(text), "say");
      },

      // Before each statement (STATEMENT_PREFIX in blocks.js).
      step: async (blockId) => {
        live();
        this.#highlight(blockId);
      },

      // Every loop iteration (INFINITE_LOOP_TRAP in blocks.js) yields a
      // macrotask, so a loop with no wait in it can neither freeze the page
      // nor outlive Stop.
      tick: async () => {
        live();
        await this.#sleep(run, 0);
      },
    };
    return Object.freeze(api);
  }

  /* --- waiting --------------------------------------------------------- */

  // ms of the target's time. It rejects the moment the run is stopped, even
  // if the target's own sleep were slow to notice the signal.
  #sleep(run, ms) {
    const { signal } = run.controller;
    if (signal.aborted) return Promise.reject(signal.reason);
    return this.#unlessStopped(run, run.target.sleep(ms, signal));
  }

  // promise, unless the run is stopped first: then it rejects at once, with
  // the reason.
  #unlessStopped(run, promise) {
    const { signal } = run.controller;
    return new Promise((resolve, reject) => {
      const onAbort = () => reject(signal.reason);
      const settle = (finish, value) => {
        signal.removeEventListener("abort", onAbort);
        finish(value);
      };
      promise.then((value) => settle(resolve, value), (err) => settle(reject, signal.aborted ? signal.reason : err));
      if (signal.aborted) onAbort();
      else signal.addEventListener("abort", onAbort, { once: true });
    });
  }

  // Wait for a command's turn (COMMAND_GAP_MS), then take it. kind is "hold"
  // (a drive starting), "stop" or "explore".
  async #takeTurn(run, kind) {
    const last = run.lastCommand;
    if (last) await this.#unlessStopped(run, kind !== "hold" && kind === last.kind ? last.again : last.next);
    const { signal } = run.controller;
    if (signal.aborted) throw signal.reason;
    // Each resolves once its time has passed, or early when the run stops.
    const after = (ms) => run.target.sleep(ms, signal).catch(() => {});
    run.lastCommand = {
      kind,
      next: after(ProgramRunner.COMMAND_GAP_MS),
      again: kind === "hold" ? null : after(ProgramRunner.REPEAT_GAP_MS),
    };
    // Every command can change the mode the target reports, a drive included:
    // any command takes the rover out of exploring.
    run.modeFrom = run.frames + ProgramRunner.MODE_FRAMES;
  }

  // Resolves true once condition() comes true, checked on each telemetry
  // frame, or false after maxMs of the target's time; rejects if the run is
  // stopped or the condition throws. One check at a time: a frame that
  // arrives while one is still running is skipped.
  #until(run, condition, maxMs) {
    const { target } = run;
    const { signal } = run.controller;
    if (signal.aborted) return Promise.reject(signal.reason);
    return new Promise((resolve, reject) => {
      const cap = new AbortController(); // ends the cap's sleep when done early
      let unsubscribe = () => {};
      let checking = false;
      let settled = false;
      const settle = (finish, value) => {
        if (settled) return;
        settled = true;
        unsubscribe();
        cap.abort();
        signal.removeEventListener("abort", onAbort);
        finish(value);
      };
      const onAbort = () => settle(reject, signal.reason);
      signal.addEventListener("abort", onAbort, { once: true });

      unsubscribe = target.onTelemetry(() => {
        if (checking || settled) return;
        checking = true;
        Promise.resolve().then(condition).then(
          (met) => {
            checking = false;
            if (met) settle(resolve, true);
          },
          (err) => {
            checking = false;
            settle(reject, signal.aborted ? signal.reason : err);
          },
        );
      });
      target.sleep(maxMs, cap.signal).then(() => settle(resolve, false), () => {});
    });
  }

  // A value read from the target's latest telemetry by read(data), which
  // returns undefined when a frame does not carry it. A program never acts
  // on stale readings: if the target says its telemetry can no longer be
  // trusted, the program is stopped, with the reason. A reading not reported
  // yet -- or not since frame fromFrame of this run -- is waited for, frame by
  // frame, for FIRST_READING_MS at most.
  async #reading(run, what, read, fromFrame = 0) {
    const latest = () => {
      const { data, fresh } = run.target.telemetry();
      if (!fresh) {
        this.#stop(run, `the ${run.target.kind}'s readings are out of date, and a program never acts on old readings.`);
        throw run.controller.signal.reason;
      }
      return data && run.frames >= fromFrame ? read(data) : undefined;
    };
    let value = latest();
    if (value !== undefined) return value;
    const arrived = await this.#until(run, () => (value = latest()) !== undefined, ProgramRunner.FIRST_READING_MS);
    if (!arrived) throw new Error(`the ${run.target.kind} has not sent ${what} yet.`);
    return value;
  }

  /* --- events ---------------------------------------------------------- */

  #setState(state, detail) {
    this.#state = state;
    this.#stateListeners.emit(state, detail);
  }

  #log(text, tone) {
    this.#logListeners.emit({ text, tone });
  }

  #highlight(blockId) {
    this.#highlightListeners.emit(blockId);
  }

  /* --- checking what a program passes ---------------------------------- */

  // A number, or a string that is one (a variable may hold either). Anything
  // else stops the program with a message, rather than driving at NaN.
  static #number(value, what) {
    const n = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
    if (typeof n !== "number" || !Number.isFinite(n)) {
      throw new TypeError(`${what} needs a number, not ${ProgramRunner.#text(value) || "nothing"}`);
    }
    return n;
  }

  // 0..100 % of SPEED_MAX. The firmware clamps further, to its own limit.
  static #speed(percent) {
    const n = Math.min(100, Math.max(0, ProgramRunner.#number(percent, "speed")));
    return Math.round((n * SPEED_MAX) / 100);
  }

  static #seconds(seconds, max, what) {
    return Math.min(max, Math.max(0, ProgramRunner.#number(seconds, what)));
  }

  static #checkMotion(move) {
    if (!motionFor(move)) throw new RangeError(`${ProgramRunner.#text(move)} is not a motion`);
  }

  static #text(value) {
    const text = typeof value === "number" && !Number.isInteger(value) ? String(Math.round(value * 1000) / 1000) : String(value);
    return text.length > 500 ? `${text.slice(0, 500)}…` : text;
  }

  static #describe(err) {
    return err && typeof err.message === "string" ? err.message : String(err);
  }

  static #stopped(reason) {
    const err = new Error(reason);
    err.name = "ProgramStopped";
    return err;
  }
}

/**
 * The real rover as a Target, over the panel's Driver and Link.
 *
 *   new RoverTarget(driver, link)
 *
 * hold() and release() are driver.program() and driver.endProgram(): a held
 * motion is re-sent every REPEAT_MS, each frame asking MOVE_DURATION_MS, like
 * any held control, so the firmware's 1.5 s cap is still the deadman if this
 * page dies. endProgram() sends STOP only if the program was what the panel
 * was driving, so an exploring rover is left alone.
 *
 * The rover is lost to a program on every stand-down of the Driver (blur, a
 * hidden page, pagehide, the link lost, stale or disconnected, Stop,
 * Autonomous) and on any manual drive press: the operator's hands win, and
 * the program does not take the rover back after them.
 */
class RoverTarget {
  // The Driver's stand-down reasons, as the console says them.
  static LOST = Object.freeze({
    blur: "the panel's window lost focus.",
    hidden: "the page was hidden.",
    pagehide: "the page was closed.",
    disconnect: "the panel disconnected from the rover.",
    linkLost: "the link to the rover was lost.",
    stale: "telemetry stopped arriving.",
    stop: "Stop was pressed.",
    autonomous: "Autonomous was pressed.",
  });

  static NOT_READY = Object.freeze({
    down: "Connect to the rover to run a program on it.",
    connecting: "Waiting for the rover to answer.",
    stale: "The rover has stopped sending telemetry.",
  });

  #driver;
  #link;
  #latest = null; // the last telemetry object, while its link lasts
  #telemetryListeners = new Listeners();
  #lostListeners = new Listeners();

  constructor(driver, link) {
    this.#driver = driver;
    this.#link = link;

    link.onTelemetry((data) => {
      this.#latest = data;
      this.#telemetryListeners.emit(data);
    });
    // Readings belong to the link they came over.
    link.onState((state) => {
      if (state === "down") this.#latest = null;
    });

    driver.onStandDown((reason) => {
      this.#lostListeners.emit(RoverTarget.LOST[reason] || `the panel stood down (${reason}).`);
    });
    // Stop and Autonomous raise this just before their own stand-down, whose
    // reason says more. Waiting one microtask lets that reason be the one the
    // console shows; the Driver has already given the operator's input the
    // rover either way.
    driver.onManualInput(() => {
      Promise.resolve().then(() => this.#lostListeners.emit("the rover was driven by hand."));
    });
  }

  get kind() {
    return "rover";
  }

  ready() {
    const state = this.#link.state;
    if (state === "up") return { ok: true, why: "" };
    return { ok: false, why: RoverTarget.NOT_READY[state] || "The rover is not connected." };
  }

  hold(move, speed) {
    this.#driver.program(move, speed);
  }

  release() {
    this.#driver.endProgram();
  }

  // The program's own stop and explore are not the operator taking over: the
  // Driver raises no event for them, so they neither stop the program that
  // asked for them nor answer anything waiting for a press.
  stop() {
    this.#driver.stopRover({ byProgram: true });
  }

  explore() {
    this.#driver.resumeAutonomous({ byProgram: true });
  }

  telemetry() {
    return { data: this.#latest, fresh: this.#link.state === "up" };
  }

  onTelemetry(fn) {
    return this.#telemetryListeners.add(fn);
  }

  onLost(fn) {
    return this.#lostListeners.add(fn);
  }

  // Real time.
  sleep(ms, signal) {
    return new Promise((resolve, reject) => {
      if (signal && signal.aborted) {
        reject(signal.reason);
        return;
      }
      const onAbort = () => {
        clearTimeout(timer);
        reject(signal.reason);
      };
      const timer = setTimeout(() => {
        if (signal) signal.removeEventListener("abort", onAbort);
        resolve();
      }, ms);
      if (signal) signal.addEventListener("abort", onAbort, { once: true });
    });
  }
}

if (typeof module !== "undefined") module.exports = { ProgramRunner, RoverTarget };

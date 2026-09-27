/**
 * Driving: turns what the operator holds -- the stick and the rotate buttons
 * -- and what a program asks for into the one command this panel sends, and
 * keeps re-sending it while it is held.
 *
 * One rule shapes most of this file: any command, STOP included, takes the
 * rover out of autonomous mode. So the panel sends only when the operator does
 * something, or to stop a motion it is itself driving -- never just because
 * the window lost focus or a mouse passed over a button while the rover was
 * exploring on its own.
 *
 *   new Driver({ link, stick, cw, ccw, speed, speedOut })
 *     link      anything with send(obj) returning false when nothing went
 *               out: a Link;
 *     stick     the joystick's container. joy.js sizes its canvas from it
 *               once, when the Driver is built, so it must be laid out (not
 *               in a hidden tab) then;
 *     cw, ccw   the rotate buttons;
 *     speed     the speed slider (0..SPEED_MAX), and speedOut its readout.
 *
 * Which input wins: the rotate button pressed last, then the stick, then a
 * program. Each input is tracked separately, so letting go of one hands the
 * rover straight back to the next still held. With nothing held the rover
 * stops -- but only if this panel was driving it. A held input is re-sent
 * every REPEAT_MS, each frame asking for MOVE_DURATION_MS; a new direction
 * goes out at once, a new speed in the same direction at most every
 * STICK_SEND_MS.
 *
 * Extension points:
 *
 *   setFamily(family)
 *   family
 *       The stick family: FAMILY_TRANSLATE (the default), FAMILY_PIVOT or
 *       FAMILY_PIVOT_SIDEWAYS, from mecanum.js; anything else throws a
 *       RangeError. The stick maps through moveForStick(x, yUp, family).
 *       Changing the family while the stick is held re-steers at once: the
 *       new direction goes out immediately, as on the gamepad. Nothing here
 *       checks the rover's scheme: offering the pivot families only under
 *       ADVANCED is the caller's job.
 *
 *   program(move, speed)
 *   endProgram()
 *       A third input, for a program runner. move is a motion code (1 to 18;
 *       anything else throws a RangeError, as does a speed that is not a
 *       finite number). speed is absolute, 0..SPEED_MAX, rounded and clamped,
 *       and not scaled by the slider. A held stick or rotate button wins over
 *       it; the program drives again once they are let go, unless it has
 *       ended. It is sent and re-sent like any held input. A later program()
 *       replaces the earlier one. endProgram() lets go of it: STOP goes out
 *       only if the program was what this panel was driving. Every stand-down
 *       below ends the program too, so a runner should listen to
 *       onStandDown and not assume its program is still held.
 *
 *   resumeAutonomous()
 *       What the Autonomous button does: forget every held input, stop
 *       repeating, and send RESUME_AUTONOMOUS.
 *
 *   stopRover()
 *       What the Stop button does: forget every held input and send STOP,
 *       whether or not this panel was driving. It is how to stop an
 *       exploring rover.
 *
 *   standDown(reason)
 *       The operator's attention or the link has gone: forget every held
 *       input and stop only what this panel is driving.
 *
 *   linkStale()
 *       Telemetry stopped though the socket is open. A held stick or rotate
 *       button keeps driving, as it always has: the operator is there and
 *       the lamp turns amber. A program is ended, since nobody is watching it
 *       through a link that has gone quiet.
 *
 *   onManualInput(fn)
 *       fn() on every operator press of a drive control: a primary press on
 *       the stick (once armed, before joy.js reports a deflection), a press
 *       of a rotate button (after it has taken effect), and the Stop and
 *       Autonomous buttons (after they have acted). Never on a hover, a
 *       right-, middle- or ctrl-click, or a press on a button already held.
 *
 *   onStandDown(fn)
 *       fn(reason) after the driver stands down or halts, whether or not
 *       anything was held: "blur", "hidden" and "pagehide" (from app.js),
 *       "disconnect" and "linkLost" (the link went down), "stale"
 *       (linkStale), "stop" (stopRover) and "autonomous"
 *       (resumeAutonomous). Not on an ordinary release of a control.
 *
 *   driving
 *       A copy of the {move, speed} this panel is sending, or null.
 */
class Driver {
  // Stick deflection, out of 100, below which the stick counts as centred.
  static DEADZONE = 12;

  #link;
  #speed;
  #family = FAMILY_TRANSLATE;

  // What is held, per input. Tracked separately so that lifting one thumb
  // never cancels what the other is still holding; #steer() combines them
  // into the one command to send.
  #held = {
    stick: null, // {x, yUp, move, strength 0..1} while the stick is deflected
    stickArmed: false, // a primary press on the stick that nothing has cancelled
    rotate: [], // rotate buttons held, oldest first: {button, pointerId, move}
    program: null, // {move, speed} a program is holding
  };

  #driving = null; // {move, speed} this panel is sending, or null
  #lastSentAt = 0; // performance.now() of the last drive command sent
  #repeatTimer = null;

  #manualInputListeners = new Listeners();
  #standDownListeners = new Listeners();

  constructor({ link, stick, cw, ccw, speed, speedOut }) {
    this.#link = link;
    this.#speed = speed;

    this.#wireStick(stick);
    this.#wireRotateButton(cw, ROTATE_CLOCKWISE);
    this.#wireRotateButton(ccw, ROTATE_COUNTERCLOCKWISE);

    speed.addEventListener("input", () => {
      speedOut.textContent = speed.value;
      this.#steer(); // a held input picks up the new limit
    });
  }

  get family() {
    return this.#family;
  }

  get driving() {
    return this.#driving && { ...this.#driving };
  }

  onManualInput(fn) {
    this.#manualInputListeners.add(fn);
  }

  onStandDown(fn) {
    this.#standDownListeners.add(fn);
  }

  setFamily(family) {
    if (!FAMILIES.includes(family)) throw new RangeError(`Unknown stick family: ${family}`);
    this.#family = family;
    const stick = this.#held.stick;
    if (stick) stick.move = moveForStick(stick.x, stick.yUp, family);
    this.#steer();
  }

  program(move, speed) {
    if (!motionFor(move)) throw new RangeError(`program() takes a motion code, 1 to 18, not ${move}`);
    if (typeof speed !== "number" || !Number.isFinite(speed)) {
      throw new RangeError(`program() takes a speed, 0 to ${SPEED_MAX}, not ${speed}`);
    }
    this.#held.program = { move, speed: Math.min(SPEED_MAX, Math.max(0, Math.round(speed))) };
    this.#steer();
  }

  endProgram() {
    if (!this.#held.program) return;
    this.#held.program = null;
    this.#steer();
  }

  resumeAutonomous() {
    // Stop repeating first: the next repeated move would take control straight
    // back. RESUME_AUTONOMOUS releases the motors itself.
    this.#releaseInputs();
    this.#stopRepeating();
    this.#send(RESUME_AUTONOMOUS, 0);
    this.#manualInputListeners.emit();
    this.#standDownListeners.emit("autonomous");
  }

  // Always sends STOP, driving or not: this is also how to stop an exploring
  // rover.
  stopRover() {
    this.#releaseInputs();
    this.#halt();
    this.#manualInputListeners.emit();
    this.#standDownListeners.emit("stop");
  }

  // Forget every held input, so nothing drives again without a fresh press,
  // and stop what this panel is driving. An exploring rover is left alone: it
  // is not ours to stop.
  standDown(reason) {
    this.#releaseInputs();
    if (this.#driving) this.#halt();
    this.#standDownListeners.emit(reason);
  }

  linkStale() {
    this.endProgram();
    this.#standDownListeners.emit("stale");
  }

  /* --- arbitration ------------------------------------------------------- */

  // The command the held inputs call for, or null. A held rotate button wins
  // over the stick, and the latest one pressed wins over an earlier one; the
  // operator's hands win over a program.
  #wanted() {
    const held = this.#held;
    const limit = Number(this.#speed.value);
    const rotate = held.rotate[held.rotate.length - 1];
    if (rotate) return { move: rotate.move, speed: limit };
    if (held.stick) return { move: held.stick.move, speed: Math.round(held.stick.strength * limit) };
    if (held.program) return { move: held.program.move, speed: held.program.speed };
    return null;
  }

  // The one place that decides what to send, called whenever an input changes.
  // With nothing held the rover stops -- but only if this panel was driving it.
  #steer() {
    const next = this.#wanted();
    const driving = this.#driving;
    if (!next) {
      if (driving) this.#halt();
      return;
    }

    const changed = !driving || next.move !== driving.move || next.speed !== driving.speed;
    const turned = !driving || next.move !== driving.move;
    this.#driving = next;
    if (turned || (changed && performance.now() - this.#lastSentAt >= STICK_SEND_MS)) this.#transmit();
  }

  // Send what is being driven and schedule its repeat. The repeat counts from
  // this send, whatever caused it. A fixed-phase interval could tick a few
  // milliseconds after a stick send and put a second speed on the wire -- two
  // motor rewrites a frame apart, which is what STICK_SEND_MS exists to prevent.
  #transmit() {
    if (!this.#driving) return;
    this.#send(this.#driving.move, this.#driving.speed);
    this.#lastSentAt = performance.now();
    clearTimeout(this.#repeatTimer);
    this.#repeatTimer = setTimeout(() => this.#transmit(), REPEAT_MS);
  }

  #send(move, speed) {
    this.#link.send({ move, speed, duration: MOVE_DURATION_MS });
  }

  #stopRepeating() {
    this.#driving = null;
    clearTimeout(this.#repeatTimer);
    this.#repeatTimer = null;
  }

  // Stop the rover. This always sends STOP, which also ends autonomous mode, so
  // only the Stop button and the end of a motion this panel drove call it.
  #halt() {
    this.#stopRepeating();
    this.#send(STOP, 0);
  }

  // Forget every held input. Clearing held.stick is not enough on its own:
  // joy.js still believes it is pressed until its own mouseup or touchend, and
  // its next move report would rebuild held.stick. Disarming makes it wait for
  // a new press. A program's input goes too, or the next #steer() would hand
  // the rover to it.
  #releaseInputs() {
    const held = this.#held;
    held.stick = null;
    held.stickArmed = false;
    for (const { button } of held.rotate) delete button.dataset.held;
    held.rotate = [];
    held.program = null;
  }

  /* --- the controls ------------------------------------------------------ */

  // A press is the primary button alone. Right-click, middle-click and a Mac's
  // ctrl-click (which arrives as button 0 with ctrlKey set) are not: each can
  // open a context menu, which takes the release with it and leaves the input
  // held with nobody holding it.
  static #isPrimaryPress(event) {
    return event.button === 0 && !event.ctrlKey;
  }

  // Holding a control is not asking for its menu, and a menu that did open
  // would swallow the release. On touch screens a long press, which is how
  // these controls are held, raises contextmenu too.
  static #suppressMenu(control) {
    control.addEventListener("contextmenu", (event) => event.preventDefault());
  }

  #wireStick(stick) {
    new JoyStick(stick.id, {
      internalFillColor: "#4db8a8",
      internalStrokeColor: "#1c1e21",
      externalStrokeColor: "#383c42",
      internalLineWidth: 2,
      externalLineWidth: 2,
      autoReturnToCenter: true,
    }, (status) => this.#onStick(status));

    Driver.#suppressMenu(stick);

    // joy.js counts any mousedown on its canvas as a press, whatever the
    // button, and forgets it only on its own mouseup or touchend. So the panel
    // arms the stick itself, only on a primary press, and #releaseInputs()
    // disarms it. Without this, joy.js stayed pressed through anything that
    // let go of the stick behind its back -- Stop, Autonomous, blur or link
    // loss under a resting thumb or a held mouse button, or a right-click whose
    // mouseup a context menu took -- and its next move report drove the rover
    // again, knocking it out of autonomous mode if it was exploring. Capture
    // phase, so this decides before joy.js sees the press.
    stick.addEventListener("mousedown", (event) => {
      this.#held.stickArmed = Driver.#isPrimaryPress(event);
      if (this.#held.stickArmed) this.#manualInputListeners.emit();
    }, true);
    stick.addEventListener("touchstart", () => {
      this.#held.stickArmed = true;
      this.#manualInputListeners.emit();
    }, true);

    // joy.js reports a release only on touchend. A touch the system takes away
    // -- an edge-swipe gesture, a notification shade, an alert -- ends in
    // touchcancel instead, and without this the last move went on repeating
    // every 200 ms with no finger on the screen. The event bubbles here from
    // joy.js's canvas.
    stick.addEventListener("touchcancel", (event) => {
      // Hand joy.js the ending it listens for, so its knob recentres rather
      // than staying drawn deflected over a stopped rover...
      const ended = new Event("touchend");
      Object.defineProperty(ended, "changedTouches", { value: event.changedTouches });
      document.dispatchEvent(ended);
      // ...and release the stick here regardless, so stopping never depends on
      // joy.js's internals.
      this.#held.stick = null;
      this.#held.stickArmed = false;
      this.#steer();
    });
  }

  // joy.js reports x and y as strings in -100..100, with y already inverted so
  // that pushing up is positive. No sign correction needed here.
  #onStick(status) {
    const x = Number(status.x);
    const yUp = Number(status.y);
    const magnitude = Math.min(100, Math.hypot(x, yUp));

    // An unarmed stick counts as centred, whatever joy.js reports.
    if (!this.#held.stickArmed || magnitude < Driver.DEADZONE) {
      this.#held.stick = null;
    } else {
      this.#held.stick = { x, yUp, move: moveForStick(x, yUp, this.#family), strength: magnitude / 100 };
    }
    this.#steer();
  }

  // A button holds only for the pointer that pressed it. Pointer Events fire
  // pointerleave for a mouse merely passing over, so without the pointerId
  // check a hover sent STOP -- and knocked an exploring rover into manual.
  #wireRotateButton(button, move) {
    Driver.#suppressMenu(button);

    button.addEventListener("pointerdown", (event) => {
      // Touch and pen presses arrive as button 0 too.
      if (!Driver.#isPrimaryPress(event)) return;
      event.preventDefault();
      const held = this.#held;
      if (held.rotate.some((h) => h.button === button)) return;
      button.dataset.held = "yes";
      held.rotate.push({ button, pointerId: event.pointerId, move });
      this.#steer();
      this.#manualInputListeners.emit();
    });

    const release = (event) => {
      const held = this.#held;
      const i = held.rotate.findIndex((h) => h.button === button && h.pointerId === event.pointerId);
      if (i < 0) return;
      held.rotate.splice(i, 1);
      delete button.dataset.held;
      this.#steer();
    };
    button.addEventListener("pointerup", release);
    button.addEventListener("pointerleave", release);
    button.addEventListener("pointercancel", release);
  }
}

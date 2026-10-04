/**
 * Driving: turns what the operator holds -- the sticks, the rotate buttons
 * and the drive keys -- and what a program asks for into the one command
 * this panel sends, and keeps re-sending it while it is held.
 *
 * One rule shapes most of this file: any command, STOP included, takes the
 * rover out of autonomous mode. So the panel sends only when the operator does
 * something, or to stop a motion it is itself driving -- never just because
 * the window lost focus or a mouse passed over a button while the rover was
 * exploring on its own.
 *
 *   new Driver({ link, stick, pivotStick, cw, ccw, speed, speedOut })
 *     link      anything with send(obj): a Link, or app.js's way to the
 *               target the page's switch picks, which on the simulator
 *               sends it there in the Link's place;
 *     stick     the translate stick's container, the left one: it always
 *               translates, under either scheme;
 *     pivotStick
 *               the pivot stick's container, the right one: its quadrant
 *               picks a pivot in the family setFamily() names. It takes no
 *               press until enablePivots(true).
 *               joy.js sizes a stick's canvas from its container as it is
 *               built, so both must be laid out (not in a hidden tab) when
 *               the Driver is built. Any move of a container on the screen
 *               under its held stick lets go of that stick (one STOP, only if
 *               it was driving): at once for a window resize or a phone
 *               turned, and otherwise (the layout above it changing, the
 *               page scrolling) at joy.js's next report, before it can
 *               drive. A new size also has the sticks built again at it;
 *     cw, ccw   the rotate buttons;
 *     speed     the speed slider (0..SPEED_MAX), and speedOut its readout.
 *
 * Which input wins: the rotate button or drive key pressed last, then the
 * stick pressed last, then a program. Each input is tracked separately, so letting go of
 * one hands the rover straight back to the next still held. With nothing
 * held the rover stops -- but only if this panel was driving it. A held
 * input is re-sent every REPEAT_MS, each frame asking for MOVE_DURATION_MS;
 * a new direction goes out at once, a new speed in the same direction at
 * most every STICK_SEND_MS.
 *
 * The sticks are named "move" (the translate stick) and "pivot" where a
 * method reports which it let go of.
 *
 * Extension points:
 *
 *   setFamily(family)
 *   family
 *       The pivot stick's family: FAMILY_PIVOT (the default) or
 *       FAMILY_PIVOT_SIDEWAYS, from mecanum.js; anything else throws a
 *       RangeError. The stick maps through moveForStick(x, yUp, family).
 *       Changing the family while the stick is held re-steers at once: the
 *       new direction goes out immediately, as on the gamepad. That needs the
 *       page to keep the stick where it is as the family changes
 *       (css/panel.css does): a stick moved under the thumb is let go of at
 *       its next report instead (see stick, above).
 *
 *   enablePivots(on)
 *   pivots
 *       Whether the pivot stick takes a press. Nothing here checks the
 *       rover's scheme: offering the pivots only under ADVANCED is the
 *       caller's job. Turned off, a held pivot stick is let go of -- one
 *       STOP, and only if it was what this panel was sending -- and nothing
 *       it reports drives until it is on again and pressed afresh. Returns
 *       true when that let go of a deflected stick.
 *
 *   releaseSticks()
 *       Let go of both sticks behind the operator's back: each drives again
 *       only from a fresh primary press, however long the thumb stays down.
 *       What a stick was driving stops -- one STOP, and only if a stick was
 *       what this panel was sending. A held rotate button, key or program
 *       carries on, as when the operator lets go of a stick. For the Drive
 *       tab hidden, and for a touch the system takes away (that stick
 *       alone). Returns the names of the sticks that were deflected: a thumb
 *       on one has just lost what it was asking for, though joy.js goes on
 *       drawing the knob under it.
 *
 *   restyle()
 *       The page's look has changed (look.js). joy.js paints a stick into
 *       its canvas once, in the colours it was built with (the look's
 *       --live, --stick-rim and --stick-ring), so where the new look's
 *       differ the sticks are built again in them, as for a new size: a
 *       stick held now is let go of first -- one STOP, and only if a stick
 *       was what this panel was sending -- and drives again only from a
 *       fresh press. Returns the names of the sticks that were deflected,
 *       as releaseSticks() does. A stick in a hidden tab has no size to be
 *       built at: it is built again by shown().
 *
 *   shown()
 *       The Drive tab is shown again. A stick whose look changed, or whose
 *       box was resized, while it was hidden is built again now, before a
 *       press can land on it: built a moment later, it would let go of the
 *       press.
 *
 *   holdKey(key, move)
 *   releaseKey(key)
 *   releaseKeys()
 *       A drive key on the keyboard (js/keys.js), named by key (a string:
 *       anything else throws a TypeError, or does nothing for a release),
 *       is an input like a rotate button: held from holdKey() to releaseKey(), driving
 *       at the slider's speed and re-sent meanwhile, and the rotate button
 *       or key pressed last wins. move is a motion code (1 to 18; anything
 *       else throws a RangeError). holdKey() of a key already held changes
 *       nothing, and is not a press; otherwise it is one (onManualInput).
 *       releaseKey() of a key not held does nothing. releaseKeys() lets go
 *       of every held key, for a release that may never arrive: one STOP,
 *       and only if a key was what this panel was sending. A key let go of
 *       any way but its own release, a stand-down's included, drives again
 *       only from a fresh holdKey().
 *
 *   program(move, speed)
 *   endProgram()
 *       A third input, for a program runner. move is a motion code (1 to 18;
 *       anything else throws a RangeError, as does a speed that is not a
 *       finite number). speed is absolute, 0..SPEED_MAX, rounded and clamped,
 *       and not scaled by the slider. A held stick, rotate button or key
 *       wins over it; the program drives again once they are let go, unless it has
 *       ended. It is sent and re-sent like any held input. A later program()
 *       replaces the earlier one. endProgram() lets go of it: STOP goes out
 *       only if the program was what this panel was driving. Every stand-down
 *       below ends the program too, so a runner should listen to
 *       onStandDown and not assume its program is still held.
 *
 *   resumeAutonomous({ byProgram })
 *       What the Autonomous button does: forget every held input, stop
 *       repeating, and send RESUME_AUTONOMOUS.
 *
 *   stopRover({ byProgram })
 *       What the Stop button does: forget every held input and send STOP,
 *       whether or not this panel was driving. It is how to stop an
 *       exploring rover.
 *
 *       With byProgram true, a program's own "stop" or "start exploring"
 *       block: the same frames go out, but neither event below is raised.
 *       Nobody pressed anything, so nothing that waits for a press may take
 *       one as answered (a stick's "press again" caption went back to its
 *       own words over a stick still let go of), and the program that
 *       asked is not lost to it.
 *
 *   standDown(reason)
 *       The operator's attention or the link has gone: forget every held
 *       input and stop only what this panel is driving.
 *
 *   linkStale()
 *       Telemetry stopped though the socket is open. A held stick, rotate
 *       button or key keeps driving, as it always has: the operator is there and
 *       the lamp turns amber. A program is ended, since nobody is watching it
 *       through a link that has gone quiet.
 *
 *   onManualInput(fn)
 *       fn(stick) on every operator press of a drive control: a primary
 *       press on a stick that takes one (once armed, before joy.js reports
 *       a deflection), with stick its name; a press of a rotate button or a
 *       drive key (after it has taken effect), and the Stop and Autonomous buttons
 *       (after they have acted), with stick undefined. Never on a hover, a
 *       right-, middle- or ctrl-click, a press on a button already held or
 *       on the pivot stick while it is off, nor on a program's own stop or
 *       start exploring.
 *
 *   onStandDown(fn)
 *       fn(reason) after the driver stands down or halts, whether or not
 *       anything was held: "blur", "hidden", "pagehide", "target" and
 *       "tab" (from app.js), "disconnect" and "linkLost" (the link went down),
 *       "stale" (linkStale), "stop" (stopRover) and "autonomous"
 *       (resumeAutonomous). Not on an ordinary release of a control, nor on
 *       a program's own stop or start exploring.
 *
 *   driving
 *       A copy of the {move, speed} this panel is sending, or null.
 */
class Driver {
  // Stick deflection, out of 100, below which the stick counts as centred.
  static DEADZONE = 12;
  // How long a stick's box keeps one size before the sticks are rebuilt at
  // it: a window being dragged, or a phone turning, has settled by then.
  static REFIT_MS = 200;

  #link;
  #speed;
  // Per stick: its box, the JoyStick drawn in it now, the look's colours it
  // was drawn in, its family, and what it holds. Tracked apart, so that
  // lifting one thumb never cancels what the other is still holding.
  #sticks = [];
  #pivot; // the pivot stick, one of #sticks
  #pivots = false; // the pivot stick takes a press
  #presses = 0; // primary presses on the sticks so far, to tell which was last

  // What else is held. #steer() combines it with the sticks into the one
  // command to send.
  #held = {
    // Rotate buttons and drive keys held, oldest first: {button, pointerId,
    // move} for a button, {key, move} for a key.
    buttons: [],
    program: null, // {move, speed} a program is holding
  };

  #driving = null; // {move, speed} this panel is sending, or null
  #lastSentAt = 0; // performance.now() of the last drive command sent
  #repeatTimer = null;

  #manualInputListeners = new Listeners();
  #standDownListeners = new Listeners();

  constructor({ link, stick, pivotStick, cw, ccw, speed, speedOut }) {
    this.#link = link;
    this.#speed = speed;

    this.#wireStick("move", stick, FAMILY_TRANSLATE);
    this.#pivot = this.#wireStick("pivot", pivotStick, FAMILY_PIVOT);
    this.#followLayout();
    this.#wireRotateButton(cw, ROTATE_CLOCKWISE);
    this.#wireRotateButton(ccw, ROTATE_COUNTERCLOCKWISE);

    speed.addEventListener("input", () => {
      speedOut.textContent = speed.value;
      this.#steer(); // a held input picks up the new limit
    });
  }

  get family() {
    return this.#pivot.family;
  }

  get pivots() {
    return this.#pivots;
  }

  get driving() {
    return this.#driving && { ...this.#driving };
  }

  onManualInput(fn) {
    return this.#manualInputListeners.add(fn);
  }

  onStandDown(fn) {
    return this.#standDownListeners.add(fn);
  }

  setFamily(family) {
    if (family !== FAMILY_PIVOT && family !== FAMILY_PIVOT_SIDEWAYS) throw new RangeError(`Not a pivot family: ${family}`);
    const stick = this.#pivot;
    stick.family = family;
    if (stick.held) stick.held.move = moveForStick(stick.held.x, stick.held.yUp, family);
    this.#steer();
  }

  enablePivots(on) {
    this.#pivots = Boolean(on);
    if (this.#pivots) return false;
    const deflected = this.#letGo(this.#pivot);
    this.#steer();
    return deflected;
  }

  // Disarming is what makes the release last (see #wireStick).
  releaseSticks() {
    const deflected = this.#sticks.filter((stick) => this.#letGo(stick)).map((stick) => stick.name);
    this.#steer();
    return deflected;
  }

  restyle() {
    return this.#refit();
  }

  shown() {
    this.#refit();
  }

  holdKey(key, move) {
    if (typeof key !== "string") throw new TypeError(`holdKey() takes a key's name, not ${key}`);
    if (!motionFor(move)) throw new RangeError(`holdKey() takes a motion code, 1 to 18, not ${move}`);
    const held = this.#held;
    if (held.buttons.some((h) => h.key === key)) return;
    held.buttons.push({ key, move });
    this.#steer();
    this.#manualInputListeners.emit();
  }

  releaseKey(key) {
    if (typeof key !== "string") return; // a rotate button's entry has no key
    const held = this.#held;
    const i = held.buttons.findIndex((h) => h.key === key);
    if (i < 0) return;
    held.buttons.splice(i, 1);
    this.#steer();
  }

  releaseKeys() {
    const held = this.#held;
    held.buttons = held.buttons.filter((h) => h.key === undefined);
    this.#steer();
  }

  program(move, speed) {
    this.#held.program = heldMotion("program()", move, speed);
    this.#steer();
  }

  endProgram() {
    if (!this.#held.program) return;
    this.#held.program = null;
    this.#steer();
  }

  resumeAutonomous({ byProgram = false } = {}) {
    // Stop repeating first: the next repeated move would take control straight
    // back. RESUME_AUTONOMOUS releases the motors itself.
    this.#releaseInputs();
    this.#stopRepeating();
    this.#send(RESUME_AUTONOMOUS, 0);
    if (byProgram) return;
    this.#manualInputListeners.emit();
    this.#standDownListeners.emit("autonomous");
  }

  stopRover({ byProgram = false } = {}) {
    this.#releaseInputs();
    this.#halt();
    if (byProgram) return;
    this.#manualInputListeners.emit();
    this.#standDownListeners.emit("stop");
  }

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

  // The command the held inputs call for, or null: see "Which input wins"
  // above.
  #wanted() {
    const held = this.#held;
    const limit = Number(this.#speed.value);
    const button = held.buttons[held.buttons.length - 1];
    if (button) return { move: button.move, speed: limit };
    let last = null;
    for (const stick of this.#sticks) {
      if (stick.held && (!last || stick.pressed > last.pressed)) last = stick;
    }
    if (last) return { move: last.held.move, speed: Math.round(last.held.strength * limit) };
    if (held.program) return { move: held.program.move, speed: held.program.speed };
    return null;
  }

  // The one place that decides what to send, called whenever an input changes.
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

  // Always sends STOP, which ends autonomous mode too: only Stop and the end of
  // a motion this panel drove may call it.
  #halt() {
    this.#stopRepeating();
    this.#send(STOP, 0);
  }

  // Forget a stick's press, and what it held: true when it was deflected.
  // Disarmed, it drives again only from a fresh press (see #wireStick). The
  // caller steers.
  #letGo(stick) {
    const deflected = stick.held !== null;
    stick.held = null;
    stick.armed = false;
    return deflected;
  }

  // Forget every held input. The sticks are disarmed too (see #wireStick),
  // and a program's input goes, or the next #steer() would hand the rover to
  // it.
  #releaseInputs() {
    const held = this.#held;
    for (const stick of this.#sticks) this.#letGo(stick);
    for (const { button } of held.buttons) if (button) delete button.dataset.held;
    held.buttons = [];
    held.program = null;
  }

  /* --- the controls ------------------------------------------------------ */

  // Holding a control is not asking for its menu, and a menu that did open
  // would swallow the release. On touch screens a long press, which is how
  // these controls are held, raises contextmenu too.
  static #suppressMenu(control) {
    control.addEventListener("contextmenu", (event) => event.preventDefault());
  }

  // Every listener here is on the stick's box, not on joy.js's canvas, so
  // each goes on working for a canvas built again (#refit).
  #wireStick(name, box, family) {
    const stick = {
      name, box, family,
      joy: null, // the JoyStick drawn in the box now
      painted: "", // the look's colours it was last drawn in
      pressedOn: null, // the box on screen at its last primary press (#boxOf)
      armed: false, // a primary press on it that nothing has cancelled
      pressed: 0, // which press that was, of #presses
      held: null, // {x, yUp, move, strength 0..1} while it is deflected
    };
    this.#sticks.push(stick);
    this.#buildJoy(stick);

    Driver.#suppressMenu(box);

    // joy.js counts any mousedown on its canvas as a press, whatever the
    // button, and forgets it only on its own mouseup or touchend. So the panel
    // arms the stick itself, only on a primary press, and #releaseInputs()
    // disarms it. Without this, joy.js stayed pressed through anything that
    // let go of the stick behind its back -- Stop, Autonomous, blur or link
    // loss under a resting thumb or a held mouse button, or a right-click whose
    // mouseup a context menu took -- and its next move report drove the rover
    // again, knocking it out of autonomous mode if it was exploring. Capture
    // phase, so this decides before joy.js sees the press. The pivot stick
    // takes no press while it is off.
    // The box is recorded after the listeners have run: what they redraw
    // for the press (a caption's request for one going back to its own
    // words) is part of the layout the thumb pressed into.
    const arm = () => {
      if (stick === this.#pivot && !this.#pivots) return;
      stick.armed = true;
      stick.pressed = ++this.#presses;
      this.#manualInputListeners.emit(name);
      stick.pressedOn = Driver.#boxOf(stick);
    };
    box.addEventListener("mousedown", (event) => {
      if (isPrimaryPress(event)) arm();
      else stick.armed = false;
    }, true);
    box.addEventListener("touchstart", arm, true);

    // joy.js reports a release only on touchend. A touch the system takes away
    // -- an edge-swipe gesture, a notification shade, an alert -- ends in
    // touchcancel instead, and without this the last move went on repeating
    // every 200 ms with no finger on the screen. The event bubbles here from
    // joy.js's canvas.
    box.addEventListener("touchcancel", (event) => {
      // Hand joy.js the ending it listens for, so its knob recentres rather
      // than staying drawn deflected over a stopped rover (the other stick's
      // JoyStick ignores a touch that is not its own)...
      const ended = new Event("touchend");
      Object.defineProperty(ended, "changedTouches", { value: event.changedTouches });
      document.dispatchEvent(ended);
      // ...and release this stick here regardless, so stopping never depends
      // on joy.js's internals.
      this.#letGo(stick);
      this.#steer();
    });
    return stick;
  }

  // joy.js draws its canvas at the box's size and in the look's colours as
  // it is built, and never looks again. Only the newest JoyStick in a box
  // drives: one a refit replaced still listens on the document, and would go
  // on reporting the thumb or mouse that pressed it.
  #buildJoy(stick) {
    const colours = Driver.#lookColours();
    const joy = new JoyStick(stick.box.id, {
      ...colours,
      internalLineWidth: 2,
      externalLineWidth: 2,
      autoReturnToCenter: true,
    }, (status) => {
      if (joy === stick.joy) this.#onStick(stick, status);
    });
    stick.joy = joy;
    stick.painted = JSON.stringify(colours);
  }

  // The knob in the page's teal, shading toward the look's rim, inside the
  // look's ring (--stick-rim and --stick-ring in css/looks.css), as joy.js
  // names them. A colour the page cannot read (css/looks.css missing, or
  // styles turned off) is left to joy.js's own: handed an empty one, its
  // canvas throws, and app.js stops before Stop is wired.
  static #lookColours() {
    const colours = {};
    for (const [parameter, name] of [["internalFillColor", "--live"], ["internalStrokeColor", "--stick-rim"], ["externalStrokeColor", "--stick-ring"]]) {
      const colour = lookToken(name);
      if (colour) colours[parameter] = colour;
    }
    return colours;
  }

  // A window resized or a phone turned can move a stick's box, resize it
  // (--stick), or both.
  //
  // Moved or resized under a held stick, the thumb or mouse resting where it
  // was on the screen rests elsewhere on the stick, and joy.js's next report
  // turns one motion into another: a 375 x 812 phone turned on its side moves
  // the box and keeps its size (54vw upright is 54vmin on its side), and a
  // thumb that held it forward drove the rover backward, with no STOP
  // between. So the stick is let go at once, as the pivots turned off let go
  // of the pivot stick. A resize that leaves the box where it was lets go of
  // nothing. A move that no resize reports is caught at the stick's next
  // report (#onStick).
  //
  // Resized, a box also needs a new canvas: one left at the old size spread
  // over the rotate buttons and the speed slider. Once the sizes have held
  // for REFIT_MS, the sticks are built again.
  #followLayout() {
    window.addEventListener("resize", () => {
      const moved = this.#sticks.filter((stick) => (stick.held || stick.armed) && Driver.#boxOf(stick) !== stick.pressedOn);
      if (moved.length === 0) return;
      for (const stick of moved) this.#letGo(stick);
      this.#steer();
    });
    if (typeof ResizeObserver !== "function") return;
    let settle = null;
    const observer = new ResizeObserver(() => {
      clearTimeout(settle);
      settle = setTimeout(() => this.#refit(), Driver.REFIT_MS);
    });
    for (const stick of this.#sticks) observer.observe(stick.box);
  }

  // Where a stick's box is on the screen, and its size: what a thumb or a
  // mouse resting on it is measured against.
  static #boxOf(stick) {
    const { left, top, width, height } = stick.box.getBoundingClientRect();
    return `${left},${top},${width},${height}`;
  }

  // New canvases, for a new size or a new look. A hidden tab's box has no
  // size, and joy.js cannot draw at none; shown again (shown()), a stick
  // needs a new canvas only if its size or the look changed meanwhile.
  // Returns the names of the sticks that were deflected when it let go.
  //
  // Rebuilding either lets go of both, as the pivots turned off let go of
  // the pivot stick: one STOP if a stick was driving, and nothing more until
  // a fresh press. A new JoyStick starts unpressed, and the mouseup handed
  // to the old one (below) reaches every JoyStick on the page, so a press
  // held on the other stick would be dropped by joy.js behind the panel's
  // back.
  #refit() {
    const stale = this.#sticks.filter((stick) => {
      const { clientWidth: width, clientHeight: height } = stick.box;
      if (width === 0 || height === 0) return false;
      const sameLook = JSON.stringify(Driver.#lookColours()) === stick.painted;
      return !(sameLook && width === stick.joy.GetWidth() && height === stick.joy.GetHeight());
    });
    if (stale.length === 0) return [];
    const deflected = this.#sticks.filter((stick) => this.#letGo(stick)).map((stick) => stick.name);
    this.#steer();
    // A mouse still pressing an old JoyStick would have it measure its
    // removed canvas, and throw, on every move: hand it the ending it
    // listens for, as touchcancel does. (A touch on a removed canvas reaches
    // the document no more.)
    document.dispatchEvent(new Event("mouseup"));
    for (const stick of stale) {
      // The old JoyStick still listens on the document, which keeps its
      // canvas alive: emptied, it holds no pixels.
      for (const old of [...stick.box.children]) {
        if (old.tagName !== "CANVAS") continue;
        old.width = old.height = 0;
        old.remove();
      }
      this.#buildJoy(stick);
    }
    return deflected;
  }

  // joy.js reports x and y as strings in -100..100, with y already inverted so
  // that pushing up is positive. No sign correction needed here. Its status
  // object is shared by every JoyStick on the page, so it is read at once.
  //
  // joy.js measures the thumb against where the canvas is now. A box that
  // has moved on the screen since the press, by anything a window resize
  // does not report (a row above it coming or going, the page scrolling),
  // turns the resting thumb's next report into another motion: so that
  // report lets go of the stick instead (one STOP, only if it was driving).
  #onStick(stick, status) {
    if (stick.armed && Driver.#boxOf(stick) !== stick.pressedOn) {
      this.#letGo(stick);
      this.#steer();
      return;
    }
    const x = Number(status.x);
    const yUp = Number(status.y);
    const magnitude = Math.min(100, Math.hypot(x, yUp));

    // An unarmed stick counts as centred, whatever joy.js reports.
    if (!stick.armed || magnitude < Driver.DEADZONE) {
      stick.held = null;
    } else {
      stick.held = { x, yUp, move: moveForStick(x, yUp, stick.family), strength: magnitude / 100 };
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
      if (!isPrimaryPress(event)) return;
      event.preventDefault();
      const held = this.#held;
      if (held.buttons.some((h) => h.button === button)) return;
      button.dataset.held = "yes";
      held.buttons.push({ button, pointerId: event.pointerId, move });
      this.#steer();
      this.#manualInputListeners.emit();
    });

    const release = (event) => {
      const held = this.#held;
      const i = held.buttons.findIndex((h) => h.button === button && h.pointerId === event.pointerId);
      if (i < 0) return;
      held.buttons.splice(i, 1);
      delete button.dataset.held;
      this.#steer();
    };
    button.addEventListener("pointerup", release);
    button.addEventListener("pointerleave", release);
    button.addEventListener("pointercancel", release);
  }
}

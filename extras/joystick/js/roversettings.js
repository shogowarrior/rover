/**
 * The rover's settings (src/Settings.h), in the Options popover's Rover
 * section: where manual mode points the sonar (Sweep, Front or Aim, and
 * the aim's angle), whether the pad drives, the controllers' priority,
 * and whether every boot runs the checks that turn no wheel; and Run
 * checks (checks.js), whose wheels do turn.
 *
 * It shows what the rover reports in its settings frame and nothing else,
 * as the scheme toggle shows telemetry's scheme (scheme.js): a press sends
 * the change and marks it pending (data-pending) until a frame reports it,
 * or CONFIRM_MS passes (the rover ignores a value it does not know, and
 * then sends no frame). A press on what the rover reports already sends
 * nothing. A change is configuration, never a command: it goes straight
 * over the Link, takes no control and stops nothing, so it may go while
 * the rover explores, or while another controller drives.
 *
 * Nothing is sent, and the section is off, saying why in its status line
 * and in each control's title, with no live link, before the rover's
 * first settings frame over it (firmware from before settings reads one as
 * a STOP that takes control, and sends none), and on the simulator target,
 * where nothing but Stop goes to the rover. The settings belong to the
 * link they came over: a link that goes takes them with it.
 *
 * The aim goes out as the slider or the scan fan (scan.js) moves, at most
 * every AIM_SEND_MS, the latest always last, each time with the sonar set
 * to Aim: aiming is asking it to aim. The slider runs from the rover's
 * left at its left end to its right at its right end: its value is the
 * aim's negative, since the aim is positive to the left.
 *
 *   new RoverSettings({ link, checks, ui })
 *     link    the Link: its state, and send(obj);
 *     checks  the Checks, for Run checks;
 *     ui      the section's elements, by name: section, sonar, aimRow,
 *             aim (a range input), aimOut, pad, padState, priority (an
 *             empty <ol>), bootChecks, runChecks and status. sonar, pad
 *             and bootChecks are empty segmented controls, built here.
 *
 *   show(frame)       a settings frame (Link.onSettings).
 *   telemetry(data)   a telemetry frame: the pad's state.
 *   linkState(state)  the link's state, on every change.
 *   target(kind)      the page's target: "rover" or "simulator".
 *   aimAt(deg)        aim the sonar there, deg positive left, rounded and
 *                     clamped to AIM_MAX_DEG either side: true when it
 *                     goes, now or with the next send.
 *   whyOff()          why the section is off now, or "".
 *   settings          what the rover last reported, or null.
 *   onChange(fn)      fn() whenever whyOff() may have changed.
 */
class RoverSettings {
  static CONFIRM_MS = 3 * TELEMETRY_MS;
  static AIM_SEND_MS = 100;

  static SONAR = Object.freeze([
    Object.freeze({ value: SONAR_MODES[0], word: "Sweep", hint: "Sweep: in manual mode the sonar sweeps all five bearings, as it does exploring." }),
    Object.freeze({ value: SONAR_MODES[1], word: "Front", hint: "Front: in manual mode the sonar looks straight ahead, and reads it more often." }),
    Object.freeze({ value: SONAR_MODES[2], word: "Aim", hint: "Aim: in manual mode the sonar holds the angle you set, here or by dragging on the scan." }),
  ]);
  static PAD = Object.freeze([
    Object.freeze({ value: "ON", word: "On", hint: "Pad on: the PS3 pad drives the rover, by the priority below." }),
    Object.freeze({ value: "OFF", word: "Off", hint: "Pad off: the pad does not drive; its Cross still stops the rover." }),
  ]);
  static BOOT_CHECKS = Object.freeze([
    Object.freeze({ value: true, word: "On", hint: "Checks at boot on: every boot checks the motor shield and the sonar. No wheel turns." }),
    Object.freeze({ value: false, word: "Off", hint: "Checks at boot off: the rover boots without them." }),
  ]);
  // The controllers as the section names them.
  static NAMES = Object.freeze({ USB: "USB", PAD: "Pad", WIFI: "WiFi" });
  static ABOUT = Object.freeze({
    USB: "the serial console, over USB",
    PAD: "the PS3 pad",
    WIFI: "this panel, and any other WiFi client",
  });
  // The pad, as telemetry reports it; ABSENT for a build without one.
  static PAD_SAYS = Object.freeze({
    CONNECTED: "Connected.",
    WAITING: "Waiting for the pad to connect.",
    OFF: "Off: it does not drive; Cross still stops.",
    ABSENT: "This build has no pad.",
  });

  static WHY_OFF = Object.freeze({
    simulator: "The simulator is the target: these are the rover's settings. Switch to Rover to change them.",
    down: "Connect to the rover to see and change its settings.",
    connecting: "Waiting for the rover to answer.",
    stale: "The rover has stopped sending telemetry.",
    unreported: "Waiting for the rover's settings.",
    tooOld: "This rover's firmware has no settings to change from here: flash it over USB once.",
  });

  static CHECKS_TITLE = "Run checks: the sonar at five bearings, each wheel alone, then four short moves. On the stand: it asks first.";

  #link;
  #checks;
  #ui;
  #segments = {}; // field -> Map of value -> its segment
  #rows = []; // the priority's three rows: { li, name, up, down }
  #reported = null; // the settings frame's settings, or null
  #heard = false; // telemetry has come over this link
  #pad = null; // telemetry's "pad", or undefined when a frame had none
  #target = "rover";
  #state = null; // the link's
  #pending = {}; // field -> { value, timer }
  #aimWanted = null; // the aim to send next, or null
  #aimTimer = null;
  #aimSentAt = -Infinity;
  #listeners = new Listeners();

  constructor({ link, checks, ui }) {
    this.#link = link;
    this.#checks = checks;
    this.#ui = ui;
    this.#state = link.state;

    this.#segments.sonar = this.#build(ui.sonar, RoverSettings.SONAR, (mode) => this.#setSonar(mode));
    this.#segments.pad = this.#build(ui.pad, RoverSettings.PAD, (on) => this.#setPad(on));
    this.#segments.checksAtBoot = this.#build(ui.bootChecks, RoverSettings.BOOT_CHECKS, (on) => this.#setChecksAtBoot(on));

    for (let rank = 0; rank < 3; rank++) {
      const li = dom.html("li", {}, ui.priority);
      dom.html("span", { class: "rank", "aria-hidden": "true" }, li, String(rank + 1));
      const name = dom.html("span", { class: "who" }, li, "—");
      const up = RoverSettings.#arrow(li, "up", "M4 10l4-4 4 4");
      const down = RoverSettings.#arrow(li, "down", "M4 6l4 4 4-4");
      up.addEventListener("click", () => this.#move(rank, -1));
      down.addEventListener("click", () => this.#move(rank, 1));
      this.#rows.push({ li, name, up, down });
    }

    ui.aim.setAttribute("min", String(-AIM_MAX_DEG));
    ui.aim.setAttribute("max", String(AIM_MAX_DEG));
    ui.aim.addEventListener("input", () => this.aimAt(-Number(ui.aim.value)));
    ui.runChecks.addEventListener("click", () => this.#checks.run().catch(reportFault));
    checks.onChange(() => this.#render());
    this.#render();
  }

  get settings() {
    return this.#reported && { ...this.#reported, priority: [...this.#reported.priority] };
  }

  onChange(fn) {
    return this.#listeners.add(fn);
  }

  whyOff() {
    const why = RoverSettings.WHY_OFF;
    if (this.#target === "simulator") return why.simulator;
    if (this.#state !== "up") return why[this.#state] || why.down;
    if (this.#reported === null) return this.#heard ? why.tooOld : why.unreported;
    return "";
  }

  // Only a frame that holds every setting the section shows is taken: a
  // part of one would leave the rest showing nothing.
  show(frame) {
    const values = frame.settings;
    const order = Array.isArray(values.priority) ? values.priority.filter((name) => name in RoverSettings.NAMES) : [];
    if (typeof values.sonar !== "string" || typeof values.aim !== "number" || typeof values.pad !== "string" ||
        typeof values.checksAtBoot !== "boolean" || new Set(order).size !== 3) return;
    const before = this.whyOff();
    this.#reported = { sonar: values.sonar, aim: values.aim, pad: values.pad, priority: order, checksAtBoot: values.checksAtBoot };
    for (const field of Object.keys(this.#pending)) {
      if (RoverSettings.#same(this.#pending[field].value, this.#reported[field])) this.#settle(field);
    }
    this.#render();
    if (this.whyOff() !== before) this.#listeners.emit();
  }

  telemetry(data) {
    const before = this.whyOff();
    this.#heard = true;
    const pad = typeof data.pad === "string" ? data.pad : undefined;
    if (pad === this.#pad && this.whyOff() === before) return;
    this.#pad = pad;
    this.#render();
    if (this.whyOff() !== before) this.#listeners.emit();
  }

  // A link that goes, or a new one, takes the settings with it; a stale
  // one keeps them shown, but nothing is offered: no frame would come to
  // settle a press.
  linkState(state) {
    this.#state = state;
    if (state !== "up") this.#settleAll();
    if (state === "down" || state === "connecting") {
      this.#reported = null;
      this.#heard = false;
      this.#pad = null;
    }
    this.#render();
    this.#listeners.emit();
  }

  target(kind) {
    this.#target = kind;
    if (kind !== "rover") this.#settleAll();
    this.#render();
    this.#listeners.emit();
  }

  aimAt(deg) {
    if (this.whyOff() || !Number.isFinite(deg)) return false;
    this.#aimWanted = Math.round(clamp(deg, -AIM_MAX_DEG, AIM_MAX_DEG));
    if (this.#aimTimer !== null) return true; // the next send takes the latest
    const wait = RoverSettings.AIM_SEND_MS - (performance.now() - this.#aimSentAt);
    if (wait <= 0) this.#sendAim();
    else this.#aimTimer = setTimeout(() => this.#sendAim(), wait);
    return true;
  }

  /* --- the changes ------------------------------------------------------- */

  // Each sends what it changes and nothing else, in a settings message of
  // its own (tools/check_protocol.py checks each one's fields).
  #setSonar(mode) {
    if (!this.#offers("sonar", mode)) return;
    if (this.#link.send({ settings: { sonar: mode } })) this.#asked("sonar", mode);
  }

  #setPad(on) {
    if (!this.#offers("pad", on)) return;
    if (this.#link.send({ settings: { pad: on } })) this.#asked("pad", on);
  }

  #setChecksAtBoot(on) {
    if (!this.#offers("checksAtBoot", on)) return;
    if (this.#link.send({ settings: { checksAtBoot: on } })) this.#asked("checksAtBoot", on);
  }

  // The whole list, the row at `rank` moved by `step`: from the order last
  // asked for while one is pending, as a second press of the scheme goes
  // on from the first.
  #move(rank, step) {
    const from = this.#pending.priority ? this.#pending.priority.value : this.#reported && this.#reported.priority;
    if (this.whyOff() || !from || rank + step < 0 || rank + step >= from.length) return;
    const priority = [...from];
    [priority[rank], priority[rank + step]] = [priority[rank + step], priority[rank]];
    if (this.#link.send({ settings: { priority } })) this.#asked("priority", priority);
  }

  #sendAim() {
    this.#aimTimer = null;
    const aim = this.#aimWanted;
    this.#aimWanted = null;
    if (aim === null || this.whyOff()) return;
    const reported = this.#reported;
    if (!this.#pending.aim && !this.#pending.sonar && reported.sonar === "AIM" && reported.aim === aim) return;
    if (!this.#link.send({ settings: { sonar: "AIM", aim } })) return;
    this.#aimSentAt = performance.now();
    this.#asked("sonar", "AIM");
    this.#asked("aim", aim);
  }

  // Whether a press of `value` asks for anything: not while the section is
  // off, nor for what is pending already or, with nothing pending, what
  // the rover reports.
  #offers(field, value) {
    if (this.whyOff()) return false;
    const pending = this.#pending[field];
    return !RoverSettings.#same(value, pending ? pending.value : this.#reported[field]);
  }

  #asked(field, value) {
    const pending = this.#pending[field];
    if (pending) clearTimeout(pending.timer);
    this.#pending[field] = {
      value,
      timer: setTimeout(() => {
        this.#settle(field);
        this.#render();
      }, RoverSettings.CONFIRM_MS),
    };
    this.#render();
  }

  #settle(field) {
    const pending = this.#pending[field];
    if (!pending) return;
    clearTimeout(pending.timer);
    delete this.#pending[field];
  }

  #settleAll() {
    for (const field of Object.keys(this.#pending)) this.#settle(field);
    clearTimeout(this.#aimTimer);
    this.#aimTimer = null;
    this.#aimWanted = null;
  }

  static #same(a, b) {
    return Array.isArray(a) ? Array.isArray(b) && a.join() === b.join() : a === b;
  }

  /* --- what the section shows ------------------------------------------- */

  #build(container, options, pick) {
    const buttons = new Map();
    for (const option of options) {
      const button = labelSegment(segment(container, () => pick(option.value)), { word: option.word, hint: option.hint });
      button.dataset.value = String(option.value);
      buttons.set(option.value, button);
    }
    return buttons;
  }

  static #arrow(li, which, path) {
    const button = dom.html("button", { type: "button", class: which }, li);
    const icon = dom.svg("svg", { class: "icon", viewBox: "0 0 16 16", "aria-hidden": "true" }, button);
    dom.svg("path", { d: path }, icon);
    return button;
  }

  #render() {
    const ui = this.#ui;
    const why = this.whyOff();
    const off = why !== "";
    const reported = this.#reported;
    const shown = this.#state === "stale" && this.#target === "rover" ? reported : off ? null : reported;
    ui.section.dataset.state = off ? (shown ? "stale" : "off") : "on";

    for (const [field, buttons] of Object.entries(this.#segments)) {
      const pending = this.#pending[field];
      pressSegment(buttons, shown ? shown[field] : undefined);
      for (const [value, button] of buttons) {
        button.disabled = off;
        const hint = (field === "sonar" ? RoverSettings.SONAR : field === "pad" ? RoverSettings.PAD : RoverSettings.BOOT_CHECKS)
          .find((option) => option.value === value).hint;
        const asked = pending && RoverSettings.#same(pending.value, value) ? " Asked of the rover: shown once it reports it." : "";
        button.title = off ? `${hint} ${why}` : `${hint}${asked}`;
        if (asked) button.dataset.pending = "yes";
        else delete button.dataset.pending;
      }
    }

    // The aim, while the sonar aims or is asked to: the slider where the
    // rover reports it, or where it was asked to go while that is pending,
    // marked so.
    const aimPending = this.#pending.aim;
    const aiming = Boolean(shown) && (shown.sonar === "AIM" || (this.#pending.sonar && this.#pending.sonar.value === "AIM"));
    ui.aimRow.hidden = !aiming;
    const aim = aimPending ? aimPending.value : shown ? shown.aim : 0;
    if (!aimPending) ui.aim.value = String(-aim);
    ui.aim.disabled = off;
    ui.aim.setAttribute("aria-valuetext", RoverSettings.aimWords(aim));
    ui.aim.title = off ? `The sonar's aim. ${why}` : "The sonar's aim in manual mode: left to right. Dragging on the scan aims it too.";
    ui.aimOut.textContent = RoverSettings.aimWords(aim);
    if (aimPending) ui.aimRow.dataset.pending = "yes";
    else delete ui.aimRow.dataset.pending;

    ui.padState.textContent = this.#pad === undefined
      ? RoverSettings.PAD_SAYS.ABSENT
      : this.#pad === null ? "" : RoverSettings.PAD_SAYS[this.#pad] || "";

    const asked = this.#pending.priority;
    const order = shown ? shown.priority : [];
    this.#rows.forEach(({ li, name, up, down }, rank) => {
      const who = order[rank];
      name.textContent = who ? RoverSettings.NAMES[who] : "—";
      li.title = who ? `${rank + 1}: ${RoverSettings.NAMES[who]}, ${RoverSettings.ABOUT[who]}` : "";
      up.disabled = off || !who || rank === 0;
      down.disabled = off || !who || rank === order.length - 1;
      const named = who ? RoverSettings.NAMES[who] : "this controller";
      up.setAttribute("aria-label", `Move ${named} up`);
      down.setAttribute("aria-label", `Move ${named} down`);
      up.title = off ? `Move up. ${why}` : rank === 0 ? `${named} is first already.` : `Move ${named} up: it takes control over ${RoverSettings.NAMES[order[rank - 1]]} while both drive.`;
      down.title = off ? `Move down. ${why}` : rank === order.length - 1 ? `${named} is last already.` : `Move ${named} down: ${RoverSettings.NAMES[order[rank + 1]]} takes control over it while both drive.`;
    });
    if (asked) {
      ui.priority.dataset.pending = "yes";
      ui.priority.title = `Asked of the rover: ${asked.value.map((who) => RoverSettings.NAMES[who]).join(", ")}. Shown once it reports it.`;
    } else {
      delete ui.priority.dataset.pending;
      ui.priority.title = "Who drives when two controllers drive at once: the higher takes control, the lower is refused until the higher has been quiet for a second. Stop from anyone always stops.";
    }

    const checksWhy = this.#checks.whyNot();
    ui.runChecks.disabled = checksWhy !== "";
    ui.runChecks.title = checksWhy ? `Run checks. ${checksWhy}` : RoverSettings.CHECKS_TITLE;

    // Why the section is off; else what the checks are doing.
    const running = this.#checks.running;
    ui.status.textContent = why || (running !== null
      ? `Check under way: ${running}. ${this.#checks.held ? "This panel holds the checks: they stop if it closes or goes behind another window." : "Stop ends them."}`
      : "");
  }

  // The aim in words: "30° left", "Ahead" or "30° right".
  static aimWords(deg) {
    if (deg === 0) return "Ahead";
    return `${Math.abs(deg)}° ${deg > 0 ? "left" : "right"}`;
  }
}

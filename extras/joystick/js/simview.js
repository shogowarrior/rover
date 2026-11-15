/**
 * The simulator on screen: the room from above, to scale, with the rover in
 * it, its five sonar rays, the path it took and where it bumped into things;
 * and the simulator's own controls. Everything it shows comes from a
 * SimTarget (sim.js), and nothing here can reach the rover: it holds no Link
 * and no Driver, and the simulator's telemetry never goes to the scan fan or
 * the readouts.
 *
 *   new SimView(slot, target, { layout })
 *     slot     the empty element the view fills (#simSlot, in the page's
 *              view pane, beside both tabs, which the layout sizes): the
 *              room takes all of it under one row, the controls and what
 *              the rover is doing, fitted with PAD kept clear around it.
 *              The row is the same on both tabs, but for the playback
 *              speed and the clock, which a held playback has no use for;
 *              the room is picked in the settings.
 *     target   the SimTarget it shows, and whose clock it runs.
 *     layout   the element whose CSS lays the pane out (the page's shell),
 *              optional: it gets --room-aspect, the room's width over its
 *              height, whenever the room changes, so the layout can give
 *              the pane the room's shape (panel.css) rather than letterbox
 *              it. Only the Program tab's layouts read it: beside the
 *              Drive tab's sticks a room picked moves nothing.
 *
 *   holdPlayback(why)
 *       Hold the playback at 1x, the faster speeds disabled in the
 *       playback list with why as their title, and the list off the bar
 *       (one speed is no choice), the settings saying why; null lets go,
 *       back to the speed chosen last. Holding also plays a paused view.
 *       For the Drive tab: its Driver
 *       re-sends a held move every 200 ms of real time, each lasting 400 ms
 *       of simulated time, so at 2x or 4x each ran out before the next
 *       came and the simulated rover drove in jerks.
 *
 * A timer advances the simulation by the real time elapsed times the
 * playback speed (the target steps it in fixed steps of its own), and it
 * draws at the display's rate with requestAnimationFrame. While the page is
 * hidden it does nothing at all, and the preview simply waits; while only
 * the view is out of sight (the rover the target, or the view pane hidden
 * on the Program tab to watch the blocks) a preview in progress runs on,
 * undrawn, and an idle one asks for no frames at all until it is shown or a
 * program starts on it.
 *
 * The rover can be dragged to set where it starts, and turned by the handle
 * ahead of its nose; focused, the arrow keys move it and Q and E turn it.
 * Each is a reset, so it stops a preview in progress; a tap is not.
 */
class SimView {
  // The room is drawn in centimetres, with y up as in the world.
  static CM = 100;
  // A stroke as wide on screen at any scale.
  static #THIN = Object.freeze({ "vector-effect": "non-scaling-stroke" });
  // Room kept clear around the floor, in screen pixels: the walls' stroke,
  // and nothing more. The words that once had a line above the floor and
  // another below it are in the bar's one row, and the room has the rest:
  // the owner asked twice for it to be bigger, and at 568 x 320 the two
  // lines and the bar took half the pane.
  static PAD = Object.freeze({ top: 3, right: 3, bottom: 3, left: 3 });
  // A ray's reading fades over about two sweeps, so an old one looks old.
  static RAY_FADE_MS = 1400;
  // The trail fades over this long, drawn in this many bands of age.
  static TRAIL_FADE_MS = 40000;
  static TRAIL_BANDS = 8;
  static NUDGE_CM = 5;
  static TURN_DEG = 15;
  // How far a press must travel, in CSS pixels, before it moves the rover.
  // Every placement is a reset, and a tap jitters a pixel or two: without
  // this, tapping a previewing rover (to see its turning handle, or by
  // accident inside its wide grip) stopped the preview and wiped its trail.
  static DRAG_SLOP_PX = 5;

  #slot;
  #target;
  #chosen = 1; // the playback speed chosen last, held or not
  #held = null; // why the playback is held at 1x, or null
  #ui = {}; // elements, by name
  #rover = {}; // the rover's drawing
  #inset = []; // the wheel diagram's four wheels
  #rays = []; // per bearing: {line, dot}
  #trail = []; // polylines, newest band first
  #bumpMarks = [];
  #pxPerCm = 1;
  #drawn = {}; // what was last drawn, to redraw only what changed
  #raf = null;
  #tickTimer = null;
  #lastTick = null;
  #drag = null; // {mode: "move" | "turn", pointerId, offset, from, moved}
  #showRays = true;
  // Without a ResizeObserver nothing would start the frames again when the
  // view is shown, so they never stop.
  #canRest = typeof ResizeObserver === "function";

  #layout;

  constructor(slot, target, { layout = null } = {}) {
    this.#slot = slot;
    this.#target = target;
    this.#layout = layout;
    this.#chosen = target.playback;
    this.#build();
    this.#drawRoom();
    this.#render();

    document.addEventListener("visibilitychange", () => this.#wake());
    // Shown again (the simulator the target, the view pane shown), or resized.
    // The root too: a view too short for the room hides the stage and still
    // shows the rover's wheels.
    if (this.#canRest) {
      const observer = new ResizeObserver(() => {
        this.#fit();
        this.#wake();
      });
      observer.observe(this.#ui.root);
      observer.observe(this.#ui.stage);
    }
    target.onWake(() => this.#wake());
    this.#wake();
  }

  holdPlayback(why) {
    this.#held = why || null;
    for (const [rate, option] of this.#ui.speedOptions) SimView.#offer(option, rate, this.#held);
    this.#ui.speedPick.setAttribute("title", this.#held || "Playback speed");
    // The bar hides the list while held (sim.css): one speed is no choice,
    // and greyed-out ones read as broken. The settings say why, in a line
    // (why's first clause), its title the whole of it. The clock goes too: at 1x it only counts
    // the operator's own seconds.
    this.#ui.root.dataset.held = this.#held ? "yes" : "no";
    this.#ui.heldWhy.textContent = this.#held ? this.#held.split(":")[0] : "";
    this.#ui.heldWhy.setAttribute("title", this.#held || "");
    this.#ui.heldWhy.hidden = !this.#held;
    this.#target.playback = this.#held ? 1 : this.#chosen;
    // A pause left on the Program tab would freeze what the Drive tab
    // drives, where a phone's view has no bar to resume it from.
    if (this.#held) this.#target.paused = false;
    this.#render();
  }

  // A speed above 1x, while the playback is held, is disabled and says why;
  // otherwise it says what it does.
  static #offer(control, rate, held) {
    control.disabled = Boolean(held) && rate !== 1;
    control.setAttribute("title", control.disabled ? held : `Play at ${rate} times real speed`);
  }

  /* --- the loops --------------------------------------------------------- */

  // The simulation runs on a timer, as the Driver's repeats do, and frames
  // only draw. Pumped from requestAnimationFrame, the preview took a
  // throttled display for a stalled page: in a browser pane out of view,
  // frames came twice a second while timers still ran every 20 ms, so the
  // previewed rover's commands ran out and it stood still where the real one,
  // re-commanded by the Driver's timers, would have driven on. A timer that
  // runs late is what would delay the Driver too, so SimTarget's stall rule
  // now measures the right thing.
  static TICK_MS = 16;

  // Both loops run only while the page is visible, and only where the page
  // has requestAnimationFrame: a real browser. (The tests pump by hand.) The
  // first tick after a gap starts timing afresh, so a preview never jumps
  // ahead by the time it was hidden.
  #wake() {
    if (typeof requestAnimationFrame !== "function") return;
    if (document.hidden) {
      clearTimeout(this.#tickTimer);
      this.#tickTimer = null;
      this.#lastTick = null;
      if (this.#raf !== null) cancelAnimationFrame(this.#raf);
      this.#raf = null;
      return;
    }
    if (this.#tickTimer === null) this.#tickTimer = setTimeout(() => this.#tick(), SimView.TICK_MS);
    if (this.#raf === null) this.#raf = requestAnimationFrame(() => this.#frame());
  }

  // The root, not the stage: a view too short for the room shows only the
  // bar, whose wheels still turn.
  #shown() {
    return this.#ui.root.getClientRects().length > 0;
  }

  // Out of sight with nothing to run -- the rover the target, and no
  // program on the simulator -- both loops rest, rather than keep a phone
  // busy through a whole drive. Being shown (the ResizeObserver) or a program
  // starting (the target's onWake) wakes them, timing afresh.
  #canIdle() {
    return this.#canRest && !this.#shown() && this.#target.idle;
  }

  #tick() {
    this.#tickTimer = null;
    if (document.hidden) {
      this.#lastTick = null;
      return;
    }
    const now = performance.now();
    if (this.#lastTick !== null) this.#target.pump(now - this.#lastTick);
    this.#lastTick = now;
    if (this.#canIdle()) {
      this.#lastTick = null;
      return;
    }
    this.#tickTimer = setTimeout(() => this.#tick(), SimView.TICK_MS);
  }

  // Draws whatever the ticks have moved, at the display's own rate. A preview
  // out of sight runs on, undrawn: its frames stop until it is shown again.
  #frame() {
    this.#raf = null;
    if (document.hidden) return;
    const shown = this.#shown();
    if (shown) this.#render();
    if (!shown && this.#canRest) return;
    this.#raf = requestAnimationFrame(() => this.#frame());
  }

  /* --- building ---------------------------------------------------------- */

  #build() {
    const ui = this.#ui;
    const root = dom.html("div", { class: "sim" }, this.#slot);
    ui.root = root;

    // One row of the panel's 32 px controls, the same on both tabs and at
    // every width: the playback speed, pause and reset, then what the rover
    // is doing, and at the far end the settings. A held playback (the
    // Drive tab) hides its list (holdPlayback), and nothing else differs.
    // The room is picked in the settings: on the bar, the room's list was
    // the first control beside the Drive tab and gone beside the Program
    // tab, the pane narrower there, so a tab switch changed the bar (the
    // critic's round 3).
    const bar = dom.html("div", { class: "sim-bar" }, root);
    // One list for the playback speed at every width. While paused it shows
    // none, so any choice resumes, the speed it was at included.
    ui.speedPick = SimView.#pick(bar, { class: "sim-speed-pick", "aria-label": "Playback speed", title: "Playback speed" });
    ui.speedOptions = new Map(SimTarget.PLAYBACKS.map((rate) => {
      const option = dom.html("option", { value: rate }, ui.speedPick, `${rate}×`);
      SimView.#offer(option, rate, null);
      return [rate, option];
    }));
    ui.speedPick.addEventListener("change", () => this.#play(Number(ui.speedPick.value)));
    ui.pause = this.#tool(bar, "Pause the preview", "M5 3.5v9M11 3.5v9", "sim-pause");
    ui.pause.addEventListener("click", () => {
      this.#target.paused = !this.#target.paused;
      this.#render();
    });
    ui.reset = this.#tool(bar, "Reset: put the rover back where it starts and clear the trail (stops a preview). " +
      "Without it, the next preview goes on from where the last one stopped.", "M3.2 8a4.8 4.8 0 1 0 1.4-3.4M3.5 2.5v2.6h2.6", "sim-reset");
    ui.reset.addEventListener("click", () => this.#target.reset());

    // The bar's middle: the wheels now, the move by name and how fast; the
    // latest word from the preview; and on the Program tab the clock. One
    // line, each part giving way where the view is narrow (sim.css), the
    // move last. How fast is in parts, each shown whole or not at all: the
    // turn in degrees, the travel in m/s, and the share of full speed,
    // which goes first, then the travel, the turn last (#fitTwist): "50% ·
    // 0.00 m/s · 0..." hid the one number that matters while rotating. The move as the Program tab's blocks name it, not
    // the firmware's MOVE_BACKWARD; and no "Idealised preview" tag, which
    // the settings say (the critic's round 3).
    const status = dom.html("div", { class: "sim-status" }, bar);
    this.#buildInset(status);
    ui.move = dom.html("output", { class: "sim-move" }, status, SimView.STILL);
    ui.twist = dom.html("span", { class: "sim-twist" }, status);
    ui.twistWord = dom.html("span", { class: "sim-word" }, ui.twist);
    ui.turn = dom.html("span", { class: "sim-turn", title: "How fast it turns" }, ui.twist);
    ui.pace = dom.html("span", { class: "sim-pace", title: "How fast it travels" }, ui.twist);
    ui.pct = dom.html("span", { class: "sim-pct", title: "Its speed, a share of full speed" }, ui.twist);
    // When it was said, then what: a narrow view drops the time (sim.css).
    ui.log = dom.html("span", { class: "sim-log", "aria-live": "polite", "data-empty": "yes" }, status);
    ui.logAt = dom.html("span", { class: "sim-log-at" }, ui.log);
    ui.logText = dom.html("span", { class: "sim-log-text" }, ui.log);
    // Captioned, not only titled: a tablet shows no title.
    ui.clockBox = dom.html("span", { class: "sim-clock", title: "Sim time: how long the simulator has run, at its playback speed" }, status);
    dom.html("span", { class: "label" }, ui.clockBox, "Sim time");
    ui.clock = dom.html("span", { class: "sim-time" }, ui.clockBox, "0.0 s");

    ui.more = this.#tool(bar, "Settings: the room, rays, trail, wheel drag and the key", "M2.5 4.5h11M2.5 8h11M2.5 11.5h11M5.5 3v3M10.5 6.5v3M7 10v3", "sim-settings");

    // The room, taking every pixel the bar leaves, nothing over it.
    ui.stage = dom.html("div", { class: "sim-stage" }, root);
    // A group, not an image: an image's contents are presentational, and the
    // rover inside it, a focusable button, would be announced as nothing.
    ui.map = dom.svg("svg", { class: "sim-map", role: "group", "aria-label": "The simulated room from above, with the rover in it" }, ui.stage);
    ui.world = dom.svg("g", { transform: "scale(1,-1)" }, ui.map);
    ui.floor = dom.svg("g", {}, ui.world);
    // A metre, in the floor's bottom-left corner, over the room's things
    // and under the rover's: in the bar it was a hairline that read as a
    // divider (the critic's round 3). #fit keeps it the same on screen.
    ui.scale = dom.svg("g", { class: "sim-scale", "aria-hidden": "true" }, ui.world);
    ui.scaleBar = dom.svg("path", { ...SimView.#THIN }, ui.scale);
    ui.scaleText = dom.svg("text", { transform: "scale(1,-1)" }, ui.scale, "1 m");
    ui.trail = dom.svg("g", { class: "sim-trail" }, ui.world);
    for (let band = 0; band < SimView.TRAIL_BANDS; band++) {
      const opacity = 0.08 + (0.72 * (SimView.TRAIL_BANDS - band)) / SimView.TRAIL_BANDS;
      this.#trail.push(dom.svg("polyline", { opacity: opacity.toFixed(2), ...SimView.#THIN }, ui.trail));
    }
    ui.rayGroup = dom.svg("g", { class: "sim-rays" }, ui.world);
    this.#rays = BEARINGS.map(() => ({
      line: dom.svg("line", { ...SimView.#THIN }, ui.rayGroup),
      dot: dom.svg("circle", { r: 0 }, ui.rayGroup),
    }));
    ui.bumps = dom.svg("g", { class: "sim-bumps" }, ui.world);
    this.#buildRover(ui.world);
    ui.labels = dom.svg("g", { class: "sim-labels" }, ui.map);

    // Folded away until asked for: the room, the less used controls, the
    // key and that this is an idealised preview. One line a setting, the
    // detail in its title: three paragraphs of prose round two buttons and
    // a slider were a wall (the critic's round 3). Its keys are its own
    // while it has the focus, not the panel's drive keys (keys.js).
    ui.panel = dom.html("div", { class: "sim-more", id: "simMore", role: "group", "aria-label": "Simulator settings", "data-keys": "own" }, root);
    const roomRow = dom.html("label", { class: "sim-row sim-room-row" }, ui.panel);
    dom.html("span", { class: "label" }, roomRow, "Room");
    ui.rooms = [this.#roomPick(roomRow)];
    // Why the playback is held, while it is (holdPlayback).
    ui.heldWhy = dom.html("p", { class: "sim-about sim-held" }, ui.panel);
    ui.heldWhy.hidden = true;
    const toggles = dom.html("div", { class: "sim-toggles" }, ui.panel);
    ui.rays = dom.html("button", { type: "button", class: "sim-switch", "aria-pressed": "true", title: "Draw each ping's ray from where the rover was" }, toggles, "Sonar rays");
    ui.rays.addEventListener("click", () => {
      this.#showRays = !this.#showRays;
      ui.rays.setAttribute("aria-pressed", String(this.#showRays));
      this.#render();
    });
    ui.clearTrail = dom.html("button", { type: "button", class: "sim-switch", title: "Forget the path the rover has drawn" }, toggles, "Clear trail");
    ui.clearTrail.addEventListener("click", () => {
      this.#target.clearTrail();
      this.#render();
    });

    // A calibration, kept: one line, what it means in its title.
    const dragWhat = "Released-wheel drag: how hard a wheel the shield has released resists turning, from 0 (it turns " +
      "freely) to 1 (it holds like a driven wheel). No move in the firmware's wheel table needs a released wheel to " +
      "turn, so today this changes nothing; it would for a row that did.";
    const drag = dom.html("label", { class: "sim-row sim-drag", title: dragWhat }, ui.panel);
    dom.html("span", { class: "label" }, drag, "Wheel drag");
    ui.drag = dom.html("input", { type: "range", min: "0", max: "1", step: "0.05", title: dragWhat }, drag);
    ui.drag.value = String(this.#target.releasedDrag);
    ui.dragOut = dom.html("output", { class: "sim-value" }, drag, this.#target.releasedDrag.toFixed(2));
    ui.drag.addEventListener("input", () => {
      this.#target.releasedDrag = Number(ui.drag.value);
      ui.dragOut.textContent = Number(ui.drag.value).toFixed(2);
    });
    this.#buildKey(ui.panel, "sim-key");
    dom.html("p", {
      class: "sim-about",
      title: "Idealised: wheels that never slip, no inertia or motor lag, one ray per ping, and a chassis that stops " +
        `dead on contact. Full speed is taken as ${SIM_WHEEL_MAX_MPS} m/s, an estimate until the bench measures it. ` +
        "The pivots follow the wheel table, which is not bench-verified yet.",
    }, ui.panel, "Idealised preview: nothing is sent to the rover");

    // Escape, or a press anywhere else, folds it away again.
    new Popover(ui.more, ui.panel);
  }

  // The key to the colours: the wheels as the rover and the inset show them,
  // the rays as the scan fan colours them.
  #buildKey(parent, className) {
    const key = dom.html("div", { class: className }, parent);
    const wheels = dom.html("div", { class: "sim-key-row" }, key);
    dom.html("span", { class: "label" }, wheels, "Wheels");
    for (const [kind, text] of [["fwd", "forward"], ["back", "backward"], ["free", "released"]]) {
      const item = dom.html("span", { class: "sim-key-item" }, wheels);
      dom.html("i", { class: `sim-swatch wheel ${kind}`, "aria-hidden": "true" }, item);
      dom.html("span", {}, item, text);
    }
    const rays = dom.html("div", { class: "sim-key-row" }, key);
    dom.html("span", { class: "label", title: "Each ray is drawn from where the rover was when it pinged" }, rays, "Sonar");
    for (const [kind, text] of [["stop", `≤ ${STOP_CM}`], ["warn", `≤ ${GO_CM}`], ["clear", "farther"], ["none", "no echo"]]) {
      const item = dom.html("span", { class: "sim-key-item" }, rays);
      dom.html("i", { class: `sim-swatch ray ${kind}`, "aria-hidden": "true" }, item);
      dom.html("span", {}, item, text);
    }
    return key;
  }

  // The rover, drawn in its own frame (x forward, in cm) and placed by one
  // transform. Wheels go over the plate, so their colours always show.
  #buildRover(parent) {
    const r = this.#rover;
    const hl = (SIM_CHASSIS.lengthM * SimView.CM) / 2;
    const hw = (SIM_CHASSIS.widthM * SimView.CM) / 2;
    r.group = dom.svg("g", {
      class: "sim-rover", tabindex: "0", role: "button",
      "aria-label": "The rover. Drag it, or use the arrow keys, to set where it starts; Q and E turn it.",
    }, parent);
    // A faint halo, so the rover is easy to find on a phone, where the
    // chassis is a dozen pixels long; and a larger, invisible grip.
    r.halo = dom.svg("circle", { class: "sim-halo", r: 20 }, r.group);
    r.grip = dom.svg("circle", { class: "sim-grip", r: 30 }, r.group);
    r.handleLine = dom.svg("line", { class: "sim-handle-line", x1: hl, y1: 0, x2: hl + 14, y2: 0, ...SimView.#THIN }, r.group);
    dom.svg("rect", { class: "sim-plate", x: -hl, y: -hw, width: 2 * hl, height: 2 * hw, rx: 1.6, ...SimView.#THIN }, r.group);
    dom.svg("rect", { class: "sim-deck", x: -hl + 3.2, y: -hw + 3.4, width: 2 * hl - 9, height: 2 * hw - 6.8, rx: 1, ...SimView.#THIN }, r.group);
    const d = SIM_WHEEL.diameterM * SimView.CM;
    const w = SIM_WHEEL.widthM * SimView.CM;
    r.wheels = RoverSim.WHEEL_AT.map(({ x, y }) => dom.svg("rect", {
      class: "sim-wheel", x: x * SimView.CM - d / 2, y: y * SimView.CM - w / 2, width: d, height: w, rx: 0.9, ...SimView.#THIN,
    }, r.group));
    // The heading: an arrow on the deck, and the sonar on the nose with the
    // way its servo points now.
    dom.svg("path", { class: "sim-nose", d: `M${hl - 4.2} 0 L${hl - 9.5} 3.6 L${hl - 8.2} 0 L${hl - 9.5} -3.6 Z` }, r.group);
    dom.svg("rect", { class: "sim-sensor", x: hl - 1.6, y: -2.3, width: 2.6, height: 4.6, rx: 0.6, ...SimView.#THIN }, r.group);
    r.aim = dom.svg("line", { class: "sim-aim", x1: hl, y1: 0, x2: hl + 10, y2: 0, ...SimView.#THIN }, r.group);
    r.handle = dom.svg("circle", { class: "sim-handle", cx: hl + 14, cy: 0, r: 2, ...SimView.#THIN }, r.group);
    r.handleGrip = dom.svg("circle", { class: "sim-grip", cx: hl + 14, cy: 0, r: 8 }, r.group);

    // A touch that starts on the rover moves the rover, not the page; a swipe
    // anywhere else on the room still scrolls it.
    r.group.addEventListener("touchstart", (event) => event.preventDefault(), { passive: false });
    r.group.addEventListener("pointerdown", (event) => this.#startDrag(event, event.target === r.handleGrip ? "turn" : "move"));
    r.group.addEventListener("pointermove", (event) => this.#dragTo(event));
    r.group.addEventListener("pointerup", (event) => this.#endDrag(event));
    r.group.addEventListener("pointercancel", (event) => this.#endDrag(event));
    r.group.addEventListener("keydown", (event) => this.#nudge(event));
  }

  // The four wheels again, large and nose up, with the way each turns: on a
  // phone the rover in the room is too small to read them from.
  #buildInset(parent) {
    const inset = dom.svg("svg", { class: "sim-inset", viewBox: "-11.5 -14 23 28", role: "img", "aria-label": "The wheels now" }, parent);
    dom.svg("rect", { class: "sim-plate", x: -7, y: -12, width: 14, height: 24, rx: 1.6 }, inset);
    dom.svg("path", { class: "sim-nose", d: "M0 -10 L2.8 -6.2 L0 -7.2 L-2.8 -6.2 Z" }, inset);
    // The table's order: front-left, front-right, rear-right, rear-left.
    this.#inset = [[-8.7, -7.2], [8.7, -7.2], [8.7, 7.2], [-8.7, 7.2]].map(([x, y]) => {
      const wheel = dom.svg("g", { transform: `translate(${x} ${y})` }, inset);
      const tyre = dom.svg("rect", { class: "sim-wheel", x: -2.3, y: -4.2, width: 4.6, height: 8.4, rx: 1.2 }, wheel);
      const arrow = dom.svg("path", { class: "sim-arrow", d: "M0 -2.4 L1.9 0.6 L-1.9 0.6 Z" }, wheel);
      return { tyre, arrow };
    });
  }

  // A list of the rooms, in the settings; #render keeps it showing the
  // room.
  #roomPick(parent) {
    const pick = SimView.#pick(parent, { class: "sim-room", "aria-label": "Room", title: "Room" });
    for (const [key, { label }] of Object.entries(Room.PRESETS)) dom.html("option", { value: key }, pick, label);
    pick.value = this.#target.roomKey;
    pick.addEventListener("change", () => {
      this.#target.setRoom(pick.value);
      this.#render();
    });
    return pick;
  }

  // A list, with the panel's caret over its right end (sim.css), as the
  // File menu's: the browser's own arrow looked like another page's.
  static #pick(parent, attributes) {
    const wrap = dom.html("span", { class: "sim-pick" }, parent);
    const select = dom.html("select", attributes, wrap);
    dom.svg("path", { d: "M4.5 6.5 8 10l3.5-3.5" }, dom.svg("svg", { class: "sim-caret", viewBox: "0 0 16 16", "aria-hidden": "true" }, wrap));
    return select;
  }

  #tool(parent, title, path, extraClass = "") {
    const button = dom.html("button", { type: "button", class: `sim-tool ${extraClass}`.trim(), title, "aria-label": title }, parent);
    dom.svg("path", { d: path }, dom.svg("svg", { class: "sim-icon", viewBox: "0 0 16 16", "aria-hidden": "true" }, button));
    return button;
  }

  // A held playback offers 1x alone, so a choice never goes past the hold.
  #play(rate) {
    if (this.#held && rate !== 1) return;
    this.#chosen = rate;
    this.#target.playback = rate;
    this.#target.paused = false;
    this.#render();
  }

  /* --- the room ---------------------------------------------------------- */

  #drawRoom() {
    const room = this.#target.room;
    const { CM } = SimView;
    const w = room.width * CM;
    const h = room.height * CM;
    const ui = this.#ui;
    ui.floor.textContent = "";
    ui.labels.textContent = "";
    // The room's shape, for the layout to give the pane (panel.css).
    const aspect = (room.width / room.height).toFixed(4);
    if (this.#layout) this.#layout.style.setProperty("--room-aspect", aspect);

    dom.svg("rect", { class: "sim-floor", x: 0, y: 0, width: w, height: h }, ui.floor);
    // A soft grid: every 50 cm, stronger every metre.
    for (let x = 50; x < w; x += 50) dom.svg("line", { class: x % 100 ? "sim-grid" : "sim-grid major", x1: x, y1: 0, x2: x, y2: h, ...SimView.#THIN }, ui.floor);
    for (let y = 50; y < h; y += 50) dom.svg("line", { class: y % 100 ? "sim-grid" : "sim-grid major", x1: 0, y1: y, x2: w, y2: y, ...SimView.#THIN }, ui.floor);
    for (const outline of room.outlines) {
      const { x, y, w: ow, h: oh } = outline;
      dom.svg("rect", { class: "sim-outline", x: (x - ow / 2) * CM, y: (y - oh / 2) * CM, width: ow * CM, height: oh * CM, rx: 2, ...SimView.#THIN }, ui.floor);
      this.#label(outline.name, x, y, ow);
    }
    for (const obstacle of room.obstacles) {
      const points = SimView.#points(obstacle.points);
      if (!obstacle.closed) {
        dom.svg("polyline", { class: "sim-wall", points, ...SimView.#THIN }, ui.floor);
        continue;
      }
      dom.svg("polygon", { class: "sim-box", points, ...SimView.#THIN }, ui.floor);
      if (!obstacle.label) continue;
      const xs = obstacle.points.map((p) => p.x);
      const ys = obstacle.points.map((p) => p.y);
      const mid = (values) => (Math.min(...values) + Math.max(...values)) / 2;
      this.#label(obstacle.label, mid(xs), mid(ys), Math.max(...xs) - Math.min(...xs));
    }
    this.#drawn = { room };
    for (const mark of this.#bumpMarks) mark.remove();
    this.#bumpMarks = [];
    this.#fit();
  }

  // A name on an obstacle, shown only while it fits inside it.
  #label(text, x, y, widthM) {
    dom.svg("text", {
      class: "sim-label", x: (x * SimView.CM).toFixed(1), y: (-y * SimView.CM).toFixed(1),
      "text-anchor": "middle", "dominant-baseline": "central", "data-width": widthM * SimView.CM,
    }, this.#ui.labels, text);
  }

  // Points in the world (m) as a polyline's or polygon's points, drawn in cm.
  static #points(list) {
    return list.map((p) => `${(p.x * SimView.CM).toFixed(1)},${(p.y * SimView.CM).toFixed(1)}`).join(" ");
  }

  // Fit the room to the stage, keeping SimView.PAD (pixels) clear around it,
  // and size whatever must look the same at any scale: labels, ray dots, bump
  // marks, the grips and the scale bar.
  #fit() {
    const ui = this.#ui;
    const room = this.#target.room;
    const { CM, PAD } = SimView;
    const width = ui.stage.clientWidth;
    const height = ui.stage.clientHeight;
    const w = room.width * CM;
    const h = room.height * CM;
    if (width > 0 && height > 0) {
      this.#pxPerCm = Math.max(0.05, Math.min((width - PAD.left - PAD.right) / w, (height - PAD.top - PAD.bottom) / h));
    }
    const s = this.#pxPerCm;
    // The viewBox spans the whole stage, so the padding is in pixels whatever
    // the room's shape; the floor sits centred in what PAD leaves. A larger
    // pad on one side moves the floor away from it: with the sign the other
    // way round the floor sat 18 px under the stage's top and 22 over its
    // foot.
    const vw = Math.max(width, 1) / s;
    const vh = Math.max(height, 1) / s;
    const left = -(vw - w) / 2 - (PAD.left - PAD.right) / (2 * s);
    const top = -h - (vh - h) / 2 - (PAD.top - PAD.bottom) / (2 * s);
    ui.map.setAttribute("viewBox", `${left.toFixed(2)} ${top.toFixed(2)} ${vw.toFixed(2)} ${vh.toFixed(2)}`);

    for (const label of ui.labels.children || []) {
      const size = 10 / s;
      label.setAttribute("font-size", size.toFixed(2));
      // About 0.85 em a letter, with the label's spacing.
      const fits = label.textContent.length * size * 0.85 + 8 / s < Number(label.getAttribute("data-width"));
      label.setAttribute("visibility", fits ? "visible" : "hidden");
    }
    // The metre, 10 px in from the floor's corner, its ends ticked 4 px up.
    const inset = 10 / s;
    const tick = 4 / s;
    ui.scaleBar.setAttribute("d", `M${inset.toFixed(1)} ${(inset + tick).toFixed(1)} V${inset.toFixed(1)} H${(inset + CM).toFixed(1)} V${(inset + tick).toFixed(1)}`);
    ui.scaleText.setAttribute("x", (inset + CM + 5 / s).toFixed(1));
    ui.scaleText.setAttribute("y", (-inset + 3.5 / s).toFixed(1));
    ui.scaleText.setAttribute("font-size", (10 / s).toFixed(2));
    // Not in a room drawn a few centimetres tall (a phone's band), where
    // it lay over half the floor.
    ui.scale.setAttribute("visibility", height >= 160 ? "visible" : "hidden");
    for (const { dot } of this.#rays) dot.setAttribute("r", (2.6 / s).toFixed(2));
    this.#fitTwist();
    this.#drawn.bumps = -1;
    this.#rover.grip.setAttribute("r", Math.max(17, 22 / s).toFixed(1));
    this.#rover.halo.setAttribute("r", Math.max(16, 15 / s).toFixed(1));
    this.#rover.handleGrip.setAttribute("r", (14 / s).toFixed(1));
    this.#rover.handle.setAttribute("r", (3.5 / s).toFixed(2));
    const reach = (SIM_CHASSIS.lengthM * CM) / 2 + Math.max(8, 16 / s);
    for (const el of [this.#rover.handle, this.#rover.handleGrip]) el.setAttribute("cx", reach.toFixed(1));
    this.#rover.handleLine.setAttribute("x2", reach.toFixed(1));
  }

  // How fast shows whole or not at all. The parts after the first wrap out
  // of sight by themselves where they do not fit (sim.css); the first, a
  // number, would be cut instead, "54°" for 54°/s, so where it does not fit
  // none shows. A word (what a stall pushes against) may be cut short.
  // Measured only as what the bar says changes, and as the view's size
  // does (#fit); a page that cannot measure shows it all.
  #fitTwist() {
    const twist = this.#ui.twist;
    twist.dataset.fit = "yes";
    const first = [...twist.children].find((n) => n.textContent);
    if (first && first !== this.#ui.twistWord && first.scrollWidth > twist.clientWidth + 0.5) twist.dataset.fit = "no";
  }

  /* --- drawing ----------------------------------------------------------- */

  #render() {
    const target = this.#target;
    const state = target.state;
    const ui = this.#ui;
    const { CM } = SimView;
    if (this.#drawn.room !== target.room) {
      for (const pick of ui.rooms) pick.value = target.roomKey;
      this.#drawRoom();
    }

    // The rover, and its wheels by direction.
    const { pose, wheels } = state;
    const headingDeg = degrees(pose.heading);
    this.#rover.group.setAttribute("transform", `translate(${(pose.x * CM).toFixed(2)} ${(pose.y * CM).toFixed(2)}) rotate(${headingDeg.toFixed(2)})`);
    const turn = (direction) => (direction > 0 ? "fwd" : direction < 0 ? "back" : "free");
    wheels.forEach((direction, i) => {
      this.#rover.wheels[i].setAttribute("data-turn", turn(direction));
      this.#inset[i].tyre.setAttribute("data-turn", turn(direction));
      this.#inset[i].arrow.setAttribute("data-turn", turn(direction));
    });
    const aim = radians(state.aimedBearing);
    const hl = (SIM_CHASSIS.lengthM * CM) / 2;
    this.#rover.aim.setAttribute("x2", (hl + 12 * Math.cos(aim)).toFixed(2));
    this.#rover.aim.setAttribute("y2", (12 * Math.sin(aim)).toFixed(2));
    this.#rover.group.setAttribute("data-stalled", state.stalled ? "yes" : "no");

    this.#drawRays(state);
    this.#drawTrail(state);
    this.#drawBumps(state);
    this.#describe(state);

    // The playback.
    ui.pause.setAttribute("aria-pressed", String(target.paused));
    ui.speedPick.value = target.paused ? "" : String(target.playback);
  }

  // What the move reads with none running, and while exploring, which
  // the simulator does not.
  static STILL = "Stopped";
  static EXPLORING = "Exploring";

  // The motion in words and numbers, the clock, and the latest thing the
  // preview said (a bump, or that exploring is not simulated). How fast
  // in parts, each only where it says something: a share of full speed,
  // the turn (a rotation's, a pivot's) and the travel (a translation's,
  // a pivot's), never "0.00 m/s" beside a rotation.
  #describe(state) {
    const ui = this.#ui;
    const motion = state.moving ? motionFor(state.move) : null;
    ui.move.textContent = motion ? motion.label : state.mode === MODE_AUTONOMOUS ? SimView.EXPLORING : SimView.STILL;
    const { vx, vy, w } = state.twist;
    const pace = Math.hypot(vx, vy);
    const turn = Math.abs(degrees(w));
    // Stopped away from its start with nothing running, the rover is where
    // the next preview begins: say so, since a second run is otherwise drawn
    // over the first. (Mid-run, a wait between moves is only a stop.)
    ui.twistWord.textContent = !motion
      ? state.mode === MODE_AUTONOMOUS ? "not simulated" : state.atStart || !this.#target.idle ? "" : "a preview goes on from here"
      : state.stalled ? `pushing against ${state.contact || "something"}` : "";
    ui.pct.textContent = motion ? `${Math.round((state.speed * 100) / SPEED_MAX)}%` : "";
    ui.turn.textContent = motion && !state.stalled && turn >= 0.5 ? `${Math.round(turn)}°/s` : "";
    ui.pace.textContent = motion && !state.stalled && pace >= 0.005 ? `${pace.toFixed(2)} m/s` : "";
    ui.move.dataset.stalled = state.stalled ? "yes" : "no";
    const said = [ui.move, ...ui.twist.children].map((n) => n.textContent).join("|");
    if (said !== this.#drawn.twist) {
      this.#drawn.twist = said;
      this.#fitTwist();
    }

    ui.clock.textContent = `${this.#target.paused ? "paused · " : ""}${(state.now / 1000).toFixed(1)} s`;
    ui.clockBox.dataset.paused = this.#target.paused ? "yes" : "no";

    const last = state.log[state.log.length - 1] || null;
    if (last !== this.#drawn.said) {
      this.#drawn.said = last;
      ui.logAt.textContent = last ? `${(last.at / 1000).toFixed(1)} s ` : "";
      ui.logText.textContent = last ? last.text : "";
      ui.log.dataset.tone = last && last.tone === "bump" ? "bump" : "";
      ui.log.dataset.empty = last ? "no" : "yes";
    }
  }

  // Each bearing's last ping, drawn from where the rover was when it was
  // taken, in the scan fan's colours: an old reading fades, and one with no
  // echo is a faint dashed line to where the sound glanced off or ran out.
  // Its zone goes on the line too, so css/sim.css draws one closing in or
  // at STOP heavy: green and amber share a lightness, and hue alone would
  // not tell them apart for everyone.
  #drawRays({ readings, now }) {
    const room = this.#target.room;
    const { CM } = SimView;
    readings.forEach(({ bearing, reading }, i) => {
      const { line, dot } = this.#rays[i];
      if (!this.#showRays || !reading) {
        line.setAttribute("visibility", "hidden");
        dot.setAttribute("visibility", "hidden");
        return;
      }
      const { origin: from, angle } = SimSonar.ray(reading.from, bearing);
      const noEcho = reading.cm >= FAR_CM;
      let lengthM = reading.cm / 100;
      if (noEcho) {
        const hit = room.rayCast(from, angle);
        lengthM = Math.min(SIM_SONAR.rangeCm / 100, hit ? hit.distance : Infinity);
      }
      const to = { x: from.x + lengthM * Math.cos(angle), y: from.y + lengthM * Math.sin(angle) };
      const age = Math.min(1, (now - reading.at) / SimView.RAY_FADE_MS);
      // A clear ray fades as it ages, so it is drawn in --ok-body, which a
      // look on a blue ground makes yellower: --ok faded over it is teal.
      const zone = noEcho ? "none" : ScanView.zoneFor(reading.cm);
      const colour = noEcho ? "var(--dim)" : zone === "clear" ? "var(--ok-body)" : ScanView.colorFor(reading.cm);
      line.setAttribute("x1", (from.x * CM).toFixed(1));
      line.setAttribute("y1", (from.y * CM).toFixed(1));
      line.setAttribute("x2", (to.x * CM).toFixed(1));
      line.setAttribute("y2", (to.y * CM).toFixed(1));
      line.setAttribute("stroke", colour);
      line.setAttribute("data-echo", noEcho ? "none" : "yes");
      line.setAttribute("data-zone", zone);
      line.setAttribute("opacity", (noEcho ? 0.55 - 0.25 * age : 0.95 - 0.55 * age).toFixed(2));
      line.setAttribute("visibility", "visible");
      dot.setAttribute("cx", (to.x * CM).toFixed(1));
      dot.setAttribute("cy", (to.y * CM).toFixed(1));
      dot.setAttribute("fill", colour);
      dot.setAttribute("opacity", (1 - 0.5 * age).toFixed(2));
      dot.setAttribute("visibility", noEcho ? "hidden" : "visible");
    });
  }

  // The path, in bands by age, newest brightest. Redrawn when it has grown,
  // and four times a second for the fading.
  #drawTrail({ trail, now }) {
    if (trail.length === this.#drawn.trailLength && trail[0] === this.#drawn.trailStart && now - this.#drawn.trailAt < 250) return;
    this.#drawn.trailLength = trail.length;
    this.#drawn.trailStart = trail[0];
    this.#drawn.trailAt = now;
    const band = SimView.TRAIL_FADE_MS / SimView.TRAIL_BANDS;
    const bands = this.#trail.map(() => []);
    for (let i = 0; i < trail.length; i++) {
      const p = trail[i];
      const b = Math.min(SimView.TRAIL_BANDS - 1, Math.floor((now - p.at) / band));
      // Each band starts where the older one ended, so the line never breaks.
      if (bands[b].length === 0 && i > 0) bands[b].push(trail[i - 1]);
      bands[b].push(p);
    }
    bands.forEach((points, b) => {
      this.#trail[b].setAttribute("points", SimView.#points(points));
    });
  }

  // Redrawn when a mark comes or goes (the target keeps a capped number, so
  // the count alone can stay the same) or the scale changes (#fit).
  #drawBumps({ bumps }) {
    const first = bumps[0];
    const last = bumps[bumps.length - 1];
    const drawn = this.#drawn;
    if (bumps.length === drawn.bumps && first === drawn.firstBump && last === drawn.lastBump) return;
    drawn.bumps = bumps.length;
    drawn.firstBump = first;
    drawn.lastBump = last;
    const size = 5 / this.#pxPerCm;
    bumps.forEach((bump, i) => {
      let mark = this.#bumpMarks[i];
      if (!mark) {
        mark = dom.svg("g", { class: "sim-bump" }, this.#ui.bumps);
        dom.svg("circle", { r: 1, ...SimView.#THIN }, mark);
        dom.svg("path", { d: "M-0.55 -0.55 L0.55 0.55 M-0.55 0.55 L0.55 -0.55", ...SimView.#THIN }, mark);
        this.#bumpMarks.push(mark);
      }
      mark.setAttribute("transform", `translate(${(bump.x * SimView.CM).toFixed(1)} ${(bump.y * SimView.CM).toFixed(1)}) scale(${size.toFixed(2)})`);
    });
    while (this.#bumpMarks.length > bumps.length) this.#bumpMarks.pop().remove();
  }

  /* --- placing the rover by hand ----------------------------------------- */

  // A primary press only (isPrimaryPress), as on the drive controls.
  #startDrag(event, mode) {
    if (!isPrimaryPress(event)) return;
    const at = this.#worldAt(event);
    if (!at) return;
    event.preventDefault();
    const pose = this.#target.state.pose;
    this.#drag = {
      mode,
      pointerId: event.pointerId,
      offset: { x: pose.x - at.x, y: pose.y - at.y },
      from: { x: event.clientX, y: event.clientY },
      moved: false,
    };
    if (this.#rover.group.setPointerCapture) this.#rover.group.setPointerCapture(event.pointerId);
    this.#rover.group.setAttribute("data-dragging", mode);
    this.#rover.group.focus();
  }

  // Nothing moves until the press has travelled DRAG_SLOP_PX, and a move
  // that would leave the pose as it is places nothing: each placement is a
  // reset, which stops a preview.
  #dragTo(event) {
    const drag = this.#drag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    if (!drag.moved) {
      if (Math.hypot(event.clientX - drag.from.x, event.clientY - drag.from.y) < SimView.DRAG_SLOP_PX) return;
      drag.moved = true;
    }
    const at = this.#worldAt(event);
    if (!at) return;
    const pose = this.#target.state.pose;
    const next = drag.mode === "move"
      ? { x: at.x + drag.offset.x, y: at.y + drag.offset.y, heading: pose.heading }
      : { x: pose.x, y: pose.y, heading: Math.atan2(at.y - pose.y, at.x - pose.x) };
    if (RoverSim.samePose(next, pose, 1e-6)) return;
    // Where the chassis would not fit, it stays where it last did.
    if (this.#target.place(next)) this.#render();
  }

  #endDrag(event) {
    if (!this.#drag || event.pointerId !== this.#drag.pointerId) return;
    this.#drag = null;
    this.#rover.group.removeAttribute("data-dragging");
  }

  #nudge(event) {
    const step = SimView.NUDGE_CM / SimView.CM;
    const turn = radians(SimView.TURN_DEG);
    const by = {
      ArrowLeft: [-step, 0, 0], ArrowRight: [step, 0, 0], ArrowUp: [0, step, 0], ArrowDown: [0, -step, 0],
      q: [0, 0, turn], Q: [0, 0, turn], e: [0, 0, -turn], E: [0, 0, -turn],
    }[event.key];
    if (!by) return;
    event.preventDefault();
    const pose = this.#target.state.pose;
    if (this.#target.place({ x: pose.x + by[0], y: pose.y + by[1], heading: pose.heading + by[2] })) this.#render();
  }

  // The world point (m) under a pointer.
  #worldAt(event) {
    const map = this.#ui.map;
    const ctm = map.getScreenCTM && map.getScreenCTM();
    if (!ctm) return null;
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(ctm.inverse());
    return { x: point.x / SimView.CM, y: -point.y / SimView.CM };
  }
}

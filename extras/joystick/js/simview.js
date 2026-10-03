/**
 * The simulator on screen: the room from above, to scale, with the rover in
 * it, its five sonar rays, the path it took and where it bumped into things;
 * and the simulator's own controls. Everything it shows comes from a
 * SimTarget (sim.js), and nothing here can reach the rover: it holds no Link
 * and no Driver, and the simulator's telemetry never goes to the scan fan or
 * the readouts.
 *
 *   new SimView(slot, target)
 *     slot     the empty element the view fills (#simSlot, which the Program
 *              tab sizes);
 *     target   the SimTarget it shows, and whose clock it runs.
 *
 * A timer advances the simulation by the real time elapsed times the
 * playback speed (the target steps it in fixed steps of its own), and it
 * draws at the display's rate with requestAnimationFrame. While the page is hidden it does
 * nothing at all, and the preview simply waits; while only the view is out of
 * sight (the Drive tab showing, or the view folded away on a phone to watch
 * the blocks) a preview in progress runs on, undrawn, and an idle one asks
 * for no frames at all until it is shown or a program starts on it.
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
  // Room kept clear around the floor, in screen pixels: the badge sits above
  // it and the scale bar below, never over the room.
  static PAD = Object.freeze({ top: 22, right: 8, bottom: 18, left: 8 });
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

  constructor(slot, target) {
    this.#slot = slot;
    this.#target = target;
    this.#build();
    this.#drawRoom();
    this.#render();

    document.addEventListener("visibilitychange", () => this.#wake());
    // Shown again (the Program tab chosen, the view unfolded), or resized.
    if (this.#canRest) {
      new ResizeObserver(() => {
        this.#fit();
        this.#wake();
      }).observe(this.#ui.stage);
    }
    target.onWake(() => this.#wake());
    this.#wake();
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

  #shown() {
    return this.#ui.stage.getClientRects().length > 0;
  }

  // Out of sight with nothing to run -- the Drive tab showing, and no
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

    // The controls, in one row.
    const bar = dom.html("div", { class: "sim-bar" }, root);
    ui.room = dom.html("select", { class: "sim-room", "aria-label": "Room", title: "Room" }, bar);
    for (const [key, { label }] of Object.entries(Room.PRESETS)) dom.html("option", { value: key }, ui.room, label);
    ui.room.value = this.#target.roomKey;
    ui.room.addEventListener("change", () => {
      this.#target.setRoom(ui.room.value);
      this.#render();
    });

    const speed = dom.html("div", { class: "segmented sim-speed", role: "group", "aria-label": "Playback speed" }, bar);
    ui.speeds = new Map(SimTarget.PLAYBACKS.map((rate) => {
      const button = segment(speed, () => {
        this.#target.playback = rate;
        this.#target.paused = false;
        this.#render();
      });
      button.textContent = `${rate}×`;
      button.setAttribute("title", `Play at ${rate} times real speed`);
      return [rate, button];
    }));
    ui.pause = this.#tool(bar, "Pause the preview", "M5 3.5v9M11 3.5v9", "sim-pause");
    ui.pause.addEventListener("click", () => {
      this.#target.paused = !this.#target.paused;
      this.#render();
    });
    ui.reset = this.#tool(bar, "Reset: put the rover back where it starts and clear the trail (stops a preview). " +
      "Without it, the next preview goes on from where the last one stopped.", "M3.2 8a4.8 4.8 0 1 0 1.4-3.4M3.5 2.5v2.6h2.6");
    ui.reset.addEventListener("click", () => this.#target.reset());
    ui.more = this.#tool(bar, "Rays, trail, wheel drag and the key", "M2.5 4.5h11M2.5 8h11M2.5 11.5h11M5.5 3v3M10.5 6.5v3M7 10v3");
    ui.more.setAttribute("aria-expanded", "false");
    ui.more.setAttribute("aria-controls", "simMore");

    // The room.
    ui.stage = dom.html("div", { class: "sim-stage" }, root);
    // A group, not an image: an image's contents are presentational, and the
    // rover inside it, a focusable button, would be announced as nothing.
    ui.map = dom.svg("svg", { class: "sim-map", role: "group", "aria-label": "The simulated room from above, with the rover in it" }, ui.stage);
    ui.world = dom.svg("g", { transform: "scale(1,-1)" }, ui.map);
    ui.floor = dom.svg("g", {}, ui.world);
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

    const badge = dom.html("div", { class: "sim-badge" }, ui.stage);
    dom.html("strong", {}, badge, "Idealised preview");
    dom.html("span", {}, badge, "nothing is sent to the rover");
    ui.scale = dom.html("div", { class: "sim-scale", "aria-hidden": "true" }, ui.stage);
    ui.scaleBar = dom.html("span", { class: "sim-scale-bar" }, ui.scale);
    dom.html("span", {}, ui.scale, "1 m");

    // What the rover is doing, and the latest word from the preview.
    const foot = dom.html("div", { class: "sim-foot" }, root);
    this.#buildInset(foot);
    const motion = dom.html("div", { class: "sim-motion" }, foot);
    ui.move = dom.html("output", { class: "sim-move" }, motion, "STOP");
    ui.twist = dom.html("span", { class: "sim-twist" }, motion, "standing still");
    const said = dom.html("div", { class: "sim-said" }, foot);
    ui.clock = dom.html("span", { class: "sim-clock" }, said, "0.0 s");
    // When it was said, then what: a narrow view drops the time (sim.css).
    ui.log = dom.html("span", { class: "sim-log", "aria-live": "polite" }, said);
    ui.logAt = dom.html("span", { class: "sim-log-at" }, ui.log);
    ui.logText = dom.html("span", { class: "sim-log-text" }, ui.log);

    // The key, under the rest when the view is tall enough for it (sim.css).
    ui.key = this.#buildKey(root, "sim-key inline");

    // Folded away until asked for: the less used controls, what the drag
    // setting means, the key and what "idealised" leaves out.
    ui.panel = dom.html("div", { class: "sim-more", id: "simMore", role: "group", "aria-label": "Simulator settings" }, root);
    ui.panel.hidden = true;
    const toggles = dom.html("div", { class: "sim-toggles" }, ui.panel);
    ui.rays = dom.html("button", { type: "button", class: "sim-switch", "aria-pressed": "true" }, toggles, "Sonar rays");
    ui.rays.addEventListener("click", () => {
      this.#showRays = !this.#showRays;
      ui.rays.setAttribute("aria-pressed", String(this.#showRays));
      this.#render();
    });
    ui.clearTrail = dom.html("button", { type: "button", class: "sim-switch" }, toggles, "Clear trail");
    ui.clearTrail.addEventListener("click", () => {
      this.#target.clearTrail();
      this.#render();
    });

    const drag = dom.html("label", { class: "sim-drag" }, ui.panel);
    dom.html("span", { class: "label" }, drag, "Released-wheel drag");
    ui.drag = dom.html("input", { type: "range", min: "0", max: "1", step: "0.05", "aria-describedby": "simDragWhat" }, drag);
    ui.drag.value = String(this.#target.releasedDrag);
    ui.dragOut = dom.html("output", { class: "sim-value" }, drag, this.#target.releasedDrag.toFixed(2));
    ui.drag.addEventListener("input", () => {
      this.#target.releasedDrag = Number(ui.drag.value);
      ui.dragOut.textContent = Number(ui.drag.value).toFixed(2);
    });
    dom.html("p", { class: "sim-about", id: "simDragWhat" }, ui.panel,
      "How hard a wheel the shield has released resists turning: at 0 it turns freely, at 1 it holds like a " +
      "driven wheel. No move in the firmware's wheel table needs a released wheel to turn, so today this " +
      "changes nothing; it would for a row that did.");
    this.#buildKey(ui.panel, "sim-key");
    dom.html("p", { class: "sim-about" }, ui.panel,
      `Idealised: wheels that never slip, no inertia or motor lag, one ray per ping, and a chassis that stops ` +
      `dead on contact. Full speed is taken as ${SIM_WHEEL_MAX_MPS} m/s, an estimate until the bench measures ` +
      "it. The pivots follow the wheel table, which is not bench-verified yet.");

    ui.more.addEventListener("click", () => this.#openPanel(ui.panel.hidden));
    // Escape, or a press anywhere else, folds it away again.
    ui.panel.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      this.#openPanel(false);
      ui.more.focus();
    });
    document.addEventListener("pointerdown", (event) => {
      if (ui.panel.hidden || !event.target || !event.target.closest) return;
      if (!event.target.closest(".sim-more") && event.target.closest("button") !== ui.more) this.#openPanel(false);
    });
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
    for (const [kind, text] of [["stop", `≤ ${STOP_CM}`], ["warn", `≤ ${GO_CM}`], ["live", "farther"], ["none", "no echo"]]) {
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

  #tool(parent, title, path, extraClass = "") {
    const button = dom.html("button", { type: "button", class: `sim-tool ${extraClass}`.trim(), title, "aria-label": title }, parent);
    dom.svg("path", { d: path }, dom.svg("svg", { class: "sim-icon", viewBox: "0 0 16 16", "aria-hidden": "true" }, button));
    return button;
  }

  #openPanel(open) {
    this.#ui.panel.hidden = !open;
    this.#ui.more.setAttribute("aria-expanded", String(open));
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
    // the room's shape; the floor sits centred in it.
    const vw = Math.max(width, 1) / s;
    const vh = Math.max(height, 1) / s;
    const left = -(vw - w) / 2 + (PAD.left - PAD.right) / (2 * s);
    const top = -h - (vh - h) / 2 + (PAD.top - PAD.bottom) / (2 * s);
    ui.map.setAttribute("viewBox", `${left.toFixed(2)} ${top.toFixed(2)} ${vw.toFixed(2)} ${vh.toFixed(2)}`);

    for (const label of ui.labels.children || []) {
      const size = 10 / s;
      label.setAttribute("font-size", size.toFixed(2));
      // About 0.85 em a letter, with the label's spacing.
      const fits = label.textContent.length * size * 0.85 + 8 / s < Number(label.getAttribute("data-width"));
      label.setAttribute("visibility", fits ? "visible" : "hidden");
    }
    ui.scaleBar.style.width = `${Math.round(CM * s)}px`;
    for (const { dot } of this.#rays) dot.setAttribute("r", (2.6 / s).toFixed(2));
    this.#drawn.bumps = -1;
    this.#rover.grip.setAttribute("r", Math.max(17, 22 / s).toFixed(1));
    this.#rover.halo.setAttribute("r", Math.max(16, 15 / s).toFixed(1));
    this.#rover.handleGrip.setAttribute("r", (14 / s).toFixed(1));
    this.#rover.handle.setAttribute("r", (3.5 / s).toFixed(2));
    const reach = (SIM_CHASSIS.lengthM * CM) / 2 + Math.max(8, 16 / s);
    for (const el of [this.#rover.handle, this.#rover.handleGrip]) el.setAttribute("cx", reach.toFixed(1));
    this.#rover.handleLine.setAttribute("x2", reach.toFixed(1));
  }

  /* --- drawing ----------------------------------------------------------- */

  #render() {
    const target = this.#target;
    const state = target.state;
    const ui = this.#ui;
    const { CM } = SimView;
    if (this.#drawn.room !== target.room) {
      ui.room.value = target.roomKey;
      this.#drawRoom();
    }

    // The rover, and its wheels by direction.
    const { pose, wheels } = state;
    const headingDeg = (pose.heading * 180) / Math.PI;
    this.#rover.group.setAttribute("transform", `translate(${(pose.x * CM).toFixed(2)} ${(pose.y * CM).toFixed(2)}) rotate(${headingDeg.toFixed(2)})`);
    const turn = (direction) => (direction > 0 ? "fwd" : direction < 0 ? "back" : "free");
    wheels.forEach((direction, i) => {
      this.#rover.wheels[i].setAttribute("data-turn", turn(direction));
      this.#inset[i].tyre.setAttribute("data-turn", turn(direction));
      this.#inset[i].arrow.setAttribute("data-turn", turn(direction));
    });
    const aim = (state.aimedBearing * Math.PI) / 180;
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
    pressSegment(ui.speeds, target.paused ? null : target.playback);
  }

  // The motion in words and numbers, the clock, and the latest thing the
  // preview said (a bump, or that exploring is not simulated).
  #describe(state) {
    const ui = this.#ui;
    const motion = state.moving ? motionFor(state.move) : null;
    ui.move.textContent = motion ? motion.name : state.mode === "AUTONOMOUS" ? "AUTONOMOUS" : "STOP";
    const percent = `${Math.round((state.speed * 100) / SPEED_MAX)}%`;
    const { vx, vy, w } = state.twist;
    // Stopped away from its start with nothing running, the rover is where
    // the next preview begins: say so, since a second run is otherwise drawn
    // over the first. (Mid-run, a wait between moves is only standing still.)
    const resting = state.atStart || !this.#target.idle ? "standing still" : "standing still · a preview goes on from here";
    ui.twist.textContent = !motion
      ? state.mode === "AUTONOMOUS" ? "exploring is not simulated" : resting
      : state.stalled ? `${percent}, pushing against ${state.contact || "something"}`
      : `${percent} · ${Math.hypot(vx, vy).toFixed(2)} m/s · ${Math.round((w * 180) / Math.PI)}°/s`;
    ui.move.dataset.stalled = state.stalled ? "yes" : "no";

    ui.clock.textContent = `${this.#target.paused ? "paused · " : ""}${(state.now / 1000).toFixed(1)} s`;
    ui.clock.dataset.paused = this.#target.paused ? "yes" : "no";

    const last = state.log[state.log.length - 1] || null;
    if (last !== this.#drawn.said) {
      this.#drawn.said = last;
      ui.logAt.textContent = last ? `${(last.at / 1000).toFixed(1)} s ` : "";
      ui.logText.textContent = last ? last.text : "";
      ui.log.dataset.tone = last && last.text.startsWith("bumped") ? "bump" : "";
      ui.log.dataset.empty = last ? "no" : "yes";
    }
  }

  // Each bearing's last ping, drawn from where the rover was when it was
  // taken, in the scan fan's colours: an old reading fades, and one with no
  // echo is a faint dashed line to where the sound glanced off or ran out.
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
      const from = RoverSim.toWorld(reading.from, RoverSim.SENSOR_AT);
      const angle = reading.from.heading + (bearing * Math.PI) / 180;
      const noEcho = reading.cm >= FAR_CM;
      let lengthM = reading.cm / 100;
      if (noEcho) {
        const hit = room.rayCast(from, angle);
        lengthM = Math.min(SIM_SONAR.rangeCm / 100, hit ? hit.distance : Infinity);
      }
      const to = { x: from.x + lengthM * Math.cos(angle), y: from.y + lengthM * Math.sin(angle) };
      const age = Math.min(1, (now - reading.at) / SimView.RAY_FADE_MS);
      const colour = noEcho ? "var(--dim)" : ScanView.colorFor(reading.cm);
      line.setAttribute("x1", (from.x * CM).toFixed(1));
      line.setAttribute("y1", (from.y * CM).toFixed(1));
      line.setAttribute("x2", (to.x * CM).toFixed(1));
      line.setAttribute("y2", (to.y * CM).toFixed(1));
      line.setAttribute("stroke", colour);
      line.setAttribute("data-echo", noEcho ? "none" : "yes");
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
    const turn = Math.atan2(Math.sin(next.heading - pose.heading), Math.cos(next.heading - pose.heading));
    if (Math.hypot(next.x - pose.x, next.y - pose.y) < 1e-6 && Math.abs(turn) < 1e-6) return;
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
    const turn = (SimView.TURN_DEG * Math.PI) / 180;
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

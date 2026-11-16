/**
 * The scan fan: the rover's five ultrasonic bearings drawn where it measures
 * them, as wedges that reach out to the distance each one reads.
 *
 *   new ScanView(svg)   lays the fan out in the empty <svg>, with nothing
 *                       to draw yet, and fits it to the svg's box whenever
 *                       that changes (a ResizeObserver, where there is one).
 *   show(data)          draws a telemetry object's distances, and the
 *                       sonar's aim while the rover aims it.
 *   clear()             draws none: no frame has come over the link yet.
 *   fit(width, height)  lays the fan out for a box that size, in CSS
 *                       pixels; the observer calls it.
 *   aimable(on)         whether a drag on the fan aims the sonar: only while
 *                       the rover's settings can be changed (app.js asks
 *                       RoverSettings). svg[data-aim] says so (panel CSS
 *                       keeps the page from scrolling under the drag).
 *   onAim(fn)           fn(deg) as a drag on the fan points, deg the bearing
 *                       from straight ahead, positive left, rounded and
 *                       within AIM_MAX_DEG either side: where to aim the
 *                       sonar. A setting, never a command (roversettings.js
 *                       sends it); the fan draws a dashed ray there until the
 *                       drag ends, and the rover's own aim as it reports it.
 *
 * Where the rover holds its sonar still in manual mode (telemetry's sonar
 * FRONT or AIM), only the bearing it points at is measured again: the
 * others keep their last reading, which the fan draws dimmed
 * (data-held="yes" on their wedges and readings), as what was last seen.
 * While it aims, a ray from the rover to full reach shows where it points,
 * with a mark where its reading (telemetry's aimCm) falls and the reading
 * by it: "…" until one is in, "no echo" for none. Neither holds while the
 * rover explores or runs its checks (telemetry's check): those point the
 * sonar their own way, so every bearing is drawn live and no aim.
 *
 * svg[data-empty] is "yes" from clear(), and as built, until the next
 * show(): the page's empty state keys on it (panel.css). A frame without
 * distances is not empty: the rover sends none until it has measured every
 * bearing once.
 *
 * The rings' legend is not in the drawing: it is one line of the card's
 * own, .scanLegend, which the ScanView adds to the svg's parent (the scan's
 * card) and panel.css puts in the card's top-left corner, under the fault
 * while there is one, in a row of its own over the fan. Drawn in the fan's
 * corner it floated with the fan, 100 px under the card's top on a wide
 * screen, and lost rows where the corner was short (the critic's round 3).
 *
 * Two layouts, whichever draws the fan larger in the box. Wide (a box about
 * twice as wide as tall: the Program tab's view, which panel.css sizes to
 * this shape on every layout, at the top of its column on a wide screen,
 * and under the top on a phone or tablet): the side readings beyond
 * the ends of their wedges. Tall (anything squarer, the Drive tab's view on
 * every layout): the side readings under the ends of their wedges, so the
 * fan's arcs span the box. A fan always 420 units wide left a square pane
 * 40% empty, 180 px over it and as much under it at 1024 x 768 (the
 * critic's round 2). svg[data-layout] says which, and --scan-k (on the svg)
 * is the screen pixels per unit, which panel.css divides into the labels'
 * sizes so a fan three times its size does not draw 45 px figures, and
 * a small one no bearing's name under TICK_PX: svg[data-labels] says which
 * labels show at this scale.
 *
 * Nothing here touches the DOM until a ScanView is built, so the file also
 * loads in Node, for BEARINGS.
 */

// The five bearings Explorer sweeps (ExploreParams in src/Explorer.h), in
// degrees from straight ahead, positive to the rover's left. On screen, up is
// ahead and the rover's left is the panel's left: screen angle = 90 + bearing.
// tools/check_protocol.py checks each key against the telemetry
// src/Protocol.cpp sends and each bearing against Explorer::angleOf, so keep
// the table in this form.
const BEARINGS = [
  { key: "distanceLeft", label: "L", bearing: 70 },
  { key: "distanceFrontLeft", label: "FL", bearing: 35 },
  { key: "distanceFront", label: "F", bearing: 0 },
  { key: "distanceFrontRight", label: "FR", bearing: -35 },
  { key: "distanceRight", label: "R", bearing: -70 },
];

class ScanView {
  // Layout in the SVG's own units. Readings sit just beyond R_MAX; the strip
  // below the rover holds the side readings in the tall layout.
  static VIEW_W = 420;
  static VIEW_H = 200;
  // The tall layout's box: the fan's arcs and the front readings, with the
  // side readings tucked under the wedges' ends.
  static TALL_X = 58;
  static TALL_W = 304;
  // A reading's type, in units (panel.css's --scan-reading), and the most
  // it may take on screen (the cap in panel.css's .reading): a bearing's
  // name sits a reading's height over it, so the two stay together as the
  // cap shrinks the reading.
  static READING_UNITS = 15;
  static READING_MAX_PX = 28;
  // The least a bearing's name is drawn at on screen (panel.css's floor in
  // .tick): at 10 px on a phone, and 8 on the Program tab's small fan, the
  // names were hard to read (the critic's round 3). It may take as many
  // units as a reading and no more, so the names show only where the fan is
  // drawn at TICK_PX / READING_UNITS screen pixels a unit or more.
  static TICK_PX = 12;
  // And the least a reading is drawn at (the floor in panel.css's
  // .reading): the same.
  static READING_MIN_PX = ScanView.TICK_PX;
  // A reading at its widest, "no echo", in ems of its type (the gauge's
  // figures about 0.6 em each), and how far it reaches over and under its
  // baseline: what #lay fits in the box.
  static READING_EMS = 4.2;
  static ASCENT = 0.75;
  static DESCENT = 0.2;
  static CX = ScanView.VIEW_W / 2; // the rover
  static CY = ScanView.VIEW_H - 20;
  static R_MIN = 24; // wedges start clear of the rover's dot
  static R_MAX = 140; // where RANGE_CM, and anything beyond it, reaches
  static RANGE_CM = 200;
  static HALF_WIDTH = 13; // degrees each side of a bearing, which are 35 apart
  static FAN_HALF = Math.max(...BEARINGS.map((b) => Math.abs(b.bearing))) + ScanView.HALF_WIDTH;

  // Square-root scale, so the near range -- where the rover makes its decisions
  // -- gets the room. A wall 20 cm away draws a 37-unit wedge instead of a
  // 12-unit stub, and the STOP and GO rings sit well clear of the rover.
  static radiusFor(cm) {
    const { R_MIN, R_MAX, RANGE_CM } = ScanView;
    return R_MIN + (R_MAX - R_MIN) * Math.sqrt(clamp(cm / RANGE_CM, 0, 1));
  }

  // Where a reading falls: inside STOP, closing in, or a clear way.
  static zoneFor(cm) {
    if (cm <= STOP_CM) return "stop";
    if (cm <= GO_CM) return "warn";
    return "clear";
  }

  // Each zone's colour, as an echo's wedge is filled. A clear one's body
  // is drawn in --ok-body by css/panel.css, by its data-zone, over this:
  // the attribute is what an unstyled page shows.
  static #ZONE_COLOURS = Object.freeze({ stop: "var(--stop)", warn: "var(--warn)", clear: "var(--ok)" });

  static colorFor(cm) {
    return ScanView.#ZONE_COLOURS[ScanView.zoneFor(cm)];
  }

  #svg;
  #views; // per bearing: { key, bearing, screen, wedge, reading, label }
  #aim; // the rover's aim: { group, ray, hit, reading }, and the drag's: wish
  #aimable = false;
  #dragging = null; // the pointerId aiming, or null
  #aimListeners = new Listeners();

  constructor(svg) {
    this.#svg = svg;
    this.#build();
    this.#lay("wide", 1);
    this.clear();
    this.aimable(false);
    this.#listenForAim();
    if (typeof ResizeObserver === "function") {
      new ResizeObserver(() => {
        const { width, height } = svg.getBoundingClientRect();
        this.fit(width, height);
      }).observe(svg);
    }
  }

  // The layout that draws the fan larger in a box this size, and the scale
  // it draws at. Tall wins only by a tenth, so a box near the wide layout's
  // shape (the Program tab's view is sized to it) never flips between them.
  // A box with no size (the view hidden) changes nothing.
  fit(width, height) {
    if (!(width > 0 && height > 0)) return;
    const { VIEW_W, VIEW_H, TALL_W } = ScanView;
    const wide = Math.min(width / VIEW_W, height / VIEW_H);
    const tall = Math.min(width / TALL_W, height / VIEW_H);
    if (tall > 1.1 * wide) this.#lay("tall", tall);
    else this.#lay("wide", wide);
  }

  show(data) {
    // The setting points the sonar only in manual mode with no check
    // running: exploring sweeps, and the checks' sonar steps point it at
    // each bearing in turn, whatever the setting says. Read from the
    // setting during the checks, the fan dimmed the bearing being measured
    // and drew the aim where the sonar was not.
    const bySetting = data.mode === MODE_MANUAL && typeof data.check !== "string";
    // The one bearing the sonar is held at, in manual mode with it held
    // still: undefined while it sweeps, and null where it is held between
    // bearings, so that none is measured.
    const held = bySetting && (data.sonar === "FRONT" || (data.sonar === "AIM" && typeof data.aim === "number"));
    const at = held ? (data.sonar === "FRONT" ? 0 : data.aim) : undefined;
    for (const view of this.#views) {
      this.#showDistance(view, data[view.key]);
      const kept = held && view.bearing !== at;
      for (const node of [view.wedge, view.reading]) {
        if (kept) node.setAttribute("data-held", "yes");
        else node.removeAttribute("data-held");
      }
    }
    this.#showAim(bySetting && data.sonar === "AIM" && typeof data.aim === "number" ? data.aim : null, data.aimCm);
    this.#svg.dataset.empty = "no";
  }

  aimable(on) {
    this.#aimable = Boolean(on);
    this.#svg.dataset.aim = this.#aimable ? "yes" : "no";
    if (!this.#aimable) this.#endDrag();
  }

  onAim(fn) {
    return this.#aimListeners.add(fn);
  }

  clear() {
    this.show({});
    this.#svg.dataset.empty = "yes";
  }

  // Lay the fan out from the constants above, so a threshold that moves in the
  // firmware (and in its copy in protocol.js) moves its ring, label and colour
  // together.
  #build() {
    const { CY, RANGE_CM, CX } = ScanView;
    // Centred in a pane of another shape: pinned to the foot of a tall
    // pane, the fan left all its spare height in one empty band over it,
    // 250 to 450 px on a wide screen (the critic's round 2).
    this.#svg.setAttribute("preserveAspectRatio", "xMidYMid meet");

    // A wedge that stops short of the red STOP ring has a return within STOP_CM
    // along that ray, which makes the threshold legible spatially rather than
    // only through colour. Exploration stops only for returns in its path:
    // straight ahead, or a front-diagonal return close enough to the centreline
    // to meet the chassis. A side return never stops a cruise; one within a few
    // centimetres of the chassis makes it sidestep away. So a red L or R wedge
    // along a corridor wall, with the rover cruising on, is expected, not a
    // missed obstacle. The outer ring is full reach and needs no label.
    const rings = [
      { cm: RANGE_CM, kind: "" },
      { cm: 100, kind: "", text: "100 cm" },
      { cm: GO_CM, kind: "go", text: `${GO_CM} cm go` },
      { cm: STOP_CM, kind: "stop", text: `${STOP_CM} cm stop` },
    ];
    for (const ring of rings) {
      dom.svg("path", { class: `ring ${ring.kind}`.trim(), d: ScanView.#ringPath(ScanView.radiusFor(ring.cm)) }, this.#svg);
    }

    // The rings' legend, quiet, one line in the card's top-left corner
    // (panel.css), never over the fan: each ring's dashes, 20 px of them so
    // red and amber tell apart, then its distance and what it means, in the
    // dim ink at the page's smallest type. Under the rings' feet, in red and
    // amber at the fan's scale, it was about 22 px on a wide screen, louder
    // than the readouts, and a red STOP word vied with Stop (the critic's
    // round 2); "25 STOP" had no unit (round 3). The stop ring first, then
    // go, then the 100 cm ring, the first to go where the card is narrow.
    const legend = dom.html("div", { class: "scanLegend", "aria-hidden": "true" }, this.#svg.parentNode);
    for (const ring of [...rings].reverse().filter((r) => r.text)) {
      const item = dom.html("span", { class: `legendItem ${ring.kind || "far"}` }, legend);
      const swatch = dom.svg("svg", { class: "legendSwatch", viewBox: "0 0 20 4", "aria-hidden": "true" }, item);
      dom.svg("path", { class: `ring ${ring.kind}`.trim(), d: "M1 2H19" }, swatch);
      dom.html("span", {}, item, ring.text);
    }

    this.#views = BEARINGS.map((b) => ({
      key: b.key,
      bearing: b.bearing,
      screen: 90 + b.bearing,
      wedge: dom.svg("path", { class: "wedge", d: "" }, this.#svg),
    }));

    // The sonar's aim, over the wedges and under the readings: the rover's
    // as it reports it, and a drag's, dashed, until the drag ends.
    const group = dom.svg("g", { class: "aim", display: "none" }, this.#svg);
    this.#aim = {
      group,
      ray: dom.svg("path", { class: "aimRay", d: "" }, group),
      hit: dom.svg("path", { class: "aimHit", d: "" }, group),
      reading: dom.svg("text", { class: "aimReading", "text-anchor": "middle" }, group, ""),
      wish: dom.svg("path", { class: "aimWish", d: "", display: "none" }, this.#svg),
    };

    // Each reading, with its bearing's name over it, where #lay puts it.
    BEARINGS.forEach((b, i) => {
      const view = this.#views[i];
      view.reading = dom.svg("text", { class: "reading" }, this.#svg, "—");
      view.label = dom.svg("text", { class: "tick" }, this.#svg, b.label);
    });

    dom.svg("circle", { cx: CX, cy: CY, r: 4, fill: "var(--readout)" }, this.#svg);
  }

  // Each reading sits just past full reach and extends away from the fan, so
  // no wedge ever runs under a number. In the tall layout the side ones sit
  // under the ends of their wedges instead, below the rover's baseline where
  // no wedge reaches, reading inward.
  //
  // A reading is never drawn under READING_MIN_PX on screen either, as the
  // names are not (the review's phones 1: 8 to 10 px readings on a phone,
  // the fan's whole point). Where the names give way, a reading takes more
  // units than the layout above was drawn for, so the readings move to
  // where there is room for them: the side ones under their wedges' ends
  // on either layout, and in the tall one the front diagonals in the box's
  // top corners, clear of the outer ring. Where all five do not fit at that
  // size, the side ones go first (L and R: Explorer stops only for what is
  // in its path), and where the front three do not fit either, all of
  // them: the wedges still show, by colour and length, what is close and
  // on which side. svg[data-labels] says which: "all" (names and
  // readings), "readings", "front" or "none".
  #lay(layout, k) {
    const { VIEW_W, VIEW_H, TALL_X, TALL_W, R_MAX, CX, CY, HALF_WIDTH, READING_EMS, ASCENT, DESCENT } = ScanView;
    const tall = layout === "tall";
    const size = Math.max(ScanView.READING_MIN_PX / k, Math.min(ScanView.READING_UNITS, ScanView.READING_MAX_PX / k));
    const names = ScanView.TICK_PX / k <= ScanView.READING_UNITS;
    const [left, right] = tall ? [TALL_X, TALL_X + TALL_W] : [0, VIEW_W];
    const width = READING_EMS * size;
    const place = (view) => {
      const outward = Math.cos(radians(view.screen));
      if (Math.abs(outward) > 0.9 && (tall || !names)) {
        // Under the wedge's end, a little outside it: the name just under
        // its lower edge and the reading under the name, or the reading
        // alone, its top on the baseline.
        const side = Math.sign(outward);
        const x = CX + R_MAX * Math.cos(radians(view.screen - side * HALF_WIDTH)) + 3 * side;
        const labelY = CY - 2;
        const readingY = names ? labelY + size + 2 : CY + ASCENT * size;
        return { x, readingY, labelY, anchor: side < 0 ? "start" : "end" };
      }
      // The reading by the arc, the name over it.
      const [px, py] = ScanView.#polar(view.screen, R_MAX + 12);
      const anchor = outward < -0.3 ? "end" : outward > 0.3 ? "start" : "middle";
      if (tall && !names && anchor !== "middle") {
        // In its top corner, its inner end clear of the outer ring.
        const x = anchor === "end" ? left + 2 : right - 2;
        const inner = anchor === "end" ? x + width : x - width;
        const reach = R_MAX + 3;
        const dx = Math.abs(CX - inner);
        const arcY = dx < reach ? CY - Math.sqrt(reach * reach - dx * dx) : CY;
        const readingY = Math.min(py + 5, arcY - 2 - DESCENT * size);
        return { x, readingY, labelY: readingY - size, anchor: anchor === "end" ? "start" : "end" };
      }
      return { x: px, readingY: py + 5, labelY: py + 5 - size, anchor };
    };
    const places = this.#views.map(place);
    // Whether these readings fit the box and keep clear of each other, at
    // their widest ("no echo").
    const boxes = places.map(({ x, readingY, anchor }) => {
      const x0 = anchor === "end" ? x - width : anchor === "start" ? x : x - width / 2;
      return { x0, x1: x0 + width, y0: readingY - ASCENT * size, y1: readingY + DESCENT * size };
    });
    const fits = (shown) => shown.every((i, n) => {
      const b = boxes[i];
      const inside = b.x0 >= left && b.x1 <= right && b.y0 >= 0 && b.y1 <= VIEW_H;
      return inside && shown.slice(n + 1).every((j) => {
        const c = boxes[j];
        return !(b.x0 < c.x1 && c.x0 < b.x1 && b.y0 < c.y1 && c.y0 < b.y1);
      });
    });
    const outer = this.#views.map((view) => Math.abs(Math.cos(radians(view.screen))) > 0.9);
    const every = places.map((p, i) => i);
    const front = every.filter((i) => !outer[i]);
    const labels = names ? "all" : fits(every) ? "readings" : fits(front) ? "front" : "none";

    this.#svg.dataset.layout = layout;
    this.#svg.setAttribute("viewBox", tall ? `${TALL_X} 0 ${TALL_W} ${VIEW_H}` : `0 0 ${VIEW_W} ${VIEW_H}`);
    this.#views.forEach((view, i) => {
      const { x, readingY, labelY, anchor } = places[i];
      for (const [text, y] of [[view.reading, readingY], [view.label, labelY]]) {
        text.setAttribute("x", x.toFixed(1));
        text.setAttribute("y", y.toFixed(1));
        text.setAttribute("text-anchor", anchor);
      }
      // L and R, which go first (panel.css).
      if (outer[i]) view.reading.setAttribute("data-outer", "yes");
    });
    this.#svg.style.setProperty("--scan-k", k.toFixed(3));
    this.#svg.dataset.labels = labels;
  }

  // The ray from the rover to full reach at the aim, and where its reading
  // falls: a short arc across the ray, as a wedge's end is drawn, and the
  // reading by it, nearer the rover, haloed in the card's colour so a wedge
  // under it never hides it.
  #showAim(deg, cm) {
    const aim = this.#aim;
    if (deg === null) {
      aim.group.setAttribute("display", "none");
      return;
    }
    const { R_MAX } = ScanView;
    const screen = 90 + clamp(deg, -AIM_MAX_DEG, AIM_MAX_DEG);
    const xy = ScanView.#xy;
    aim.group.removeAttribute("display");
    aim.ray.setAttribute("d", `M${xy(ScanView.#polar(screen, ScanView.R_MIN / 2))} L${xy(ScanView.#polar(screen, R_MAX))}`);
    const measured = typeof cm === "number" && Number.isFinite(cm);
    const noEcho = measured && cm >= FAR_CM;
    const r = !measured || noEcho ? R_MAX : ScanView.radiusFor(cm);
    if (measured && !noEcho) {
      const R = r.toFixed(1);
      aim.hit.setAttribute("d", `M${xy(ScanView.#polar(screen - 6, r))} A${R} ${R} 0 0 0 ${xy(ScanView.#polar(screen + 6, r))}`);
      aim.hit.setAttribute("data-zone", ScanView.zoneFor(cm));
    } else {
      aim.hit.setAttribute("d", "");
      aim.hit.removeAttribute("data-zone");
    }
    const [x, y] = ScanView.#polar(screen, Math.max(ScanView.R_MIN + 14, r - 16));
    aim.reading.setAttribute("x", x.toFixed(1));
    aim.reading.setAttribute("y", (y + 5).toFixed(1));
    aim.reading.textContent = !measured ? "…" : noEcho ? "no echo" : `${Math.round(cm)}cm`;
    aim.group.setAttribute("data-deg", String(deg));
  }

  // A drag on the fan aims the sonar where it points, while the fan is
  // aimable: each point is turned into a bearing from the rover and handed
  // on (onAim), and drawn as a dashed ray until the drag ends. A press on
  // the rover itself points nowhere, and is not a drag.
  #listenForAim() {
    const svg = this.#svg;
    svg.addEventListener("pointerdown", (event) => {
      if (!this.#aimable || this.#dragging !== null || !isPrimaryPress(event)) return;
      const deg = this.#bearingAt(event, true);
      if (deg === null) return;
      event.preventDefault();
      this.#dragging = event.pointerId;
      if (typeof svg.setPointerCapture === "function") {
        try {
          svg.setPointerCapture(event.pointerId);
        } catch {
          // A pointer the browser has let go of already: the drag ends on
          // its pointerup all the same.
        }
      }
      this.#aimTo(deg);
    });
    svg.addEventListener("pointermove", (event) => {
      if (event.pointerId !== this.#dragging) return;
      const deg = this.#bearingAt(event, false);
      if (deg !== null) this.#aimTo(deg);
    });
    for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) {
      svg.addEventListener(type, (event) => {
        if (event.pointerId === this.#dragging) this.#endDrag();
      });
    }
  }

  #aimTo(deg) {
    const xy = ScanView.#xy;
    const screen = 90 + deg;
    this.#aim.wish.setAttribute("d", `M${xy(ScanView.#polar(screen, ScanView.R_MIN / 2))} L${xy(ScanView.#polar(screen, ScanView.R_MAX))}`);
    this.#aim.wish.removeAttribute("display");
    this.#aimListeners.emit(deg);
  }

  #endDrag() {
    this.#dragging = null;
    this.#aim.wish.setAttribute("display", "none");
  }

  // The bearing of a pointer from the rover, in degrees, positive left,
  // rounded and clamped to the aim's reach; null for a press within the
  // rover's dot (pressing: a move may pass through it). The svg's box holds
  // its viewBox scaled to fit and centred (preserveAspectRatio
  // xMidYMid meet, #build()).
  #bearingAt(event, pressing) {
    const box = this.#svg.getBoundingClientRect();
    const view = (this.#svg.getAttribute("viewBox") || "").split(/\s+/).map(Number);
    if (view.length !== 4 || !(box.width > 0 && box.height > 0)) return null;
    const [vx, vy, vw, vh] = view;
    const k = Math.min(box.width / vw, box.height / vh);
    const ux = vx + (event.clientX - box.left - (box.width - vw * k) / 2) / k;
    const uy = vy + (event.clientY - box.top - (box.height - vh * k) / 2) / k;
    const dx = ux - ScanView.CX;
    const dy = ScanView.CY - uy;
    if (pressing && Math.hypot(dx, dy) < ScanView.R_MIN / 2) return null;
    // From straight ahead, in (-180, 180]: behind the rover, the nearer end
    // of the aim's reach.
    const bearing = ((degrees(Math.atan2(dy, dx)) - 90 + 540) % 360) - 180;
    return Math.round(clamp(bearing, -AIM_MAX_DEG, AIM_MAX_DEG));
  }

  #showDistance(view, cm) {
    if (typeof cm !== "number" || !Number.isFinite(cm)) {
      // The rover sends no distances until it has measured every bearing once
      // after booting. Clear the wedge rather than leave an old one standing.
      view.wedge.setAttribute("d", "");
      view.wedge.removeAttribute("data-zone");
      view.reading.textContent = "—";
      return;
    }

    // A no-echo reading is not a measurement. Show it at full reach in grey,
    // faded and unedged, so "nothing came back" never takes a clear way's
    // shape: css/panel.css draws a clear echo open (a faint body inside a
    // green edge) by its data-zone. Every echo is at opacity 1, and one
    // closing in or at STOP is solid: the red wedge, at the 0.85 it once
    // was, fell under 3:1 on the card in Console Dark and Blueprint Dark
    // (test/looks.test.js).
    const noEcho = cm >= FAR_CM;
    const r = noEcho ? ScanView.R_MAX : ScanView.radiusFor(cm);
    view.wedge.setAttribute("d", ScanView.#wedgePath(view.screen, r));
    view.wedge.setAttribute("fill", noEcho ? "var(--dim)" : ScanView.colorFor(cm));
    view.wedge.setAttribute("opacity", noEcho ? "0.4" : "1");
    view.wedge.setAttribute("data-zone", noEcho ? "none" : ScanView.zoneFor(cm));
    view.reading.textContent = noEcho ? "no echo" : `${Math.round(cm)}cm`;
  }

  static #polar(screenDeg, r) {
    const rad = radians(screenDeg);
    return [ScanView.CX + r * Math.cos(rad), ScanView.CY - r * Math.sin(rad)];
  }

  static #xy([x, y]) {
    return `${x.toFixed(1)} ${y.toFixed(1)}`;
  }

  // An annular sector from R_MIN out to r. The outer arc runs anticlockwise on
  // screen (sweep flag 0) and the inner one back clockwise (1); the other way
  // round bows the outer edge in toward the rover.
  static #wedgePath(screenDeg, r) {
    const { R_MIN, HALF_WIDTH } = ScanView;
    const xy = ScanView.#xy;
    const a = ScanView.#polar(screenDeg - HALF_WIDTH, R_MIN);
    const b = ScanView.#polar(screenDeg + HALF_WIDTH, R_MIN);
    const c = ScanView.#polar(screenDeg + HALF_WIDTH, r);
    const d = ScanView.#polar(screenDeg - HALF_WIDTH, r);
    const R = r.toFixed(1);
    return `M${xy(a)} L${xy(d)} A${R} ${R} 0 0 0 ${xy(c)} ` +
      `L${xy(b)} A${R_MIN} ${R_MIN} 0 0 1 ${xy(a)} Z`;
  }

  // A range ring spans the fan, as the wedges do, rather than a full half circle.
  static #ringPath(r) {
    const { FAN_HALF } = ScanView;
    const xy = ScanView.#xy;
    const R = r.toFixed(1);
    return `M${xy(ScanView.#polar(90 + FAN_HALF, r))} A${R} ${R} 0 0 1 ${xy(ScanView.#polar(90 - FAN_HALF, r))}`;
  }
}

if (typeof module !== "undefined") module.exports = { BEARINGS };

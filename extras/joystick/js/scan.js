/**
 * The scan fan: the rover's five ultrasonic bearings drawn where it measures
 * them, as wedges that reach out to the distance each one reads.
 *
 *   new ScanView(svg)   lays the fan out in the empty <svg>.
 *   show(data)          draws a telemetry object's distances.
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
  // below the rover holds the ring labels.
  static VIEW_W = 420;
  static VIEW_H = 200;
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

  static colorFor(cm) {
    if (cm <= STOP_CM) return "var(--stop)";
    if (cm <= GO_CM) return "var(--warn)";
    return "var(--live)";
  }

  #svg;
  #views; // per bearing: { key, screen, wedge, reading }

  constructor(svg) {
    this.#svg = svg;
    this.#build();
  }

  show(data) {
    for (const view of this.#views) this.#showDistance(view, data[view.key]);
  }

  // Lay the fan out from the constants above, so a threshold that moves in the
  // firmware (and in its copy in protocol.js) moves its ring, label and colour
  // together.
  #build() {
    const { VIEW_W, VIEW_H, CY, R_MAX, RANGE_CM, FAN_HALF, CX } = ScanView;
    this.#svg.setAttribute("viewBox", `0 0 ${VIEW_W} ${VIEW_H}`);

    // A wedge that stops short of the red STOP ring has a return within STOP_CM
    // along that ray, which makes the threshold legible spatially rather than
    // only through colour. Exploration stops only for returns in its path:
    // straight ahead, or a front-diagonal return close enough to the centreline
    // to meet the chassis. A side return never stops a cruise; one within a few
    // centimetres of the chassis makes it sidestep away. So a red L or R wedge
    // along a corridor wall, with the rover cruising on, is expected, not a
    // missed obstacle. Labels hang below the rover's baseline, where no wedge can
    // reach, under one foot of their ring: STOP and GO on opposite sides, since
    // their rings are too close together to label on the same one. The outer
    // ring is full reach and needs no label.
    const rings = [
      { cm: RANGE_CM, kind: "" },
      { cm: 100, kind: "", text: "100", side: 1 },
      { cm: GO_CM, kind: "go", text: `${GO_CM} GO`, side: -1 },
      { cm: STOP_CM, kind: "stop", text: `${STOP_CM} STOP`, side: 1 },
    ];
    for (const ring of rings) {
      const r = ScanView.radiusFor(ring.cm);
      dom.svg("path", { class: `ring ${ring.kind}`.trim(), d: ScanView.#ringPath(r) }, this.#svg);
      if (!ring.text) continue;
      const [x] = ScanView.#polar(90 + ring.side * FAN_HALF, r);
      const at = { x: x.toFixed(1), y: CY + 14, "text-anchor": "middle" };
      dom.svg("text", { class: `tick ${ring.kind}`.trim(), ...at }, this.#svg, ring.text);
    }

    this.#views = BEARINGS.map((b) => ({
      key: b.key,
      screen: 90 + b.bearing,
      wedge: dom.svg("path", { class: "wedge", d: "" }, this.#svg),
    }));

    // Each reading sits just past full reach and extends away from the fan, so
    // no wedge ever runs under a number. Its bearing is labelled above it.
    BEARINGS.forEach((b, i) => {
      const view = this.#views[i];
      const [x, y] = ScanView.#polar(view.screen, R_MAX + 12);
      const outward = Math.cos(radians(view.screen));
      const anchor = outward < -0.3 ? "end" : outward > 0.3 ? "start" : "middle";
      const at = { x: x.toFixed(1), "text-anchor": anchor };
      view.reading = dom.svg("text", { class: "reading", ...at, y: (y + 5).toFixed(1) }, this.#svg, "—");
      dom.svg("text", { class: "tick", ...at, y: (y - 10).toFixed(1) }, this.#svg, b.label);
    });

    dom.svg("circle", { cx: CX, cy: CY, r: 4, fill: "var(--dim)" }, this.#svg);
  }

  #showDistance(view, cm) {
    if (typeof cm !== "number" || !Number.isFinite(cm)) {
      // The rover sends no distances until it has measured every bearing once
      // after booting. Clear the wedge rather than leave an old one standing.
      view.wedge.setAttribute("d", "");
      view.reading.textContent = "—";
      return;
    }

    // A no-echo reading is not a measurement. Show it at full reach but faded,
    // so "nothing came back" never reads as a confirmed clear path.
    const noEcho = cm >= FAR_CM;
    const r = noEcho ? ScanView.R_MAX : ScanView.radiusFor(cm);
    view.wedge.setAttribute("d", ScanView.#wedgePath(view.screen, r));
    view.wedge.setAttribute("fill", noEcho ? "var(--dim)" : ScanView.colorFor(cm));
    view.wedge.setAttribute("opacity", noEcho ? "0.4" : "0.85");
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

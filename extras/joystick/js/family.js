/**
 * The pivot stick's family, and the labels on both sticks.
 *
 * The Drive tab has two sticks, as a gamepad does. The left stick always
 * translates, under either scheme. The right stick drives the pivots, which
 * the ADVANCED scheme adds: its quadrant picks the move (moveForStick in
 * mecanum.js), in the family chosen here, Pivot or Pivot sideways, as the
 * gamepad picks them by holding L1 or R1. The four moves are shown at the
 * stick's corners: what each quadrant sends is not something to learn by
 * driving. Under NORMAL, and while the scheme is unknown, the pivot stick
 * and this selector are shown but off, saying the pivots are ADVANCED's.
 *
 *   new FamilySelector({ choice, group, pad, label, hints, note })
 *     choice   the empty element the two segments are built in;
 *     group    the selector's container;
 *     pad      the pivot stick's area, which gets data-off="yes" and a
 *              title while the pivots are off, for the page's CSS;
 *     label    the translate stick's caption;
 *     hints    the empty element over the pivot stick that the corner
 *              labels are built in. The page's CSS lets every touch through
 *              it to the stick;
 *     note     the line under the selector: that the pivots are not
 *              bench-verified, that they are ADVANCED's while they are off,
 *              or a request for a fresh press.
 *
 *   offer(available)    turn the pivots on (ADVANCED) or off. The family
 *                       chosen is kept either way.
 *   awaitPress(stick, on)
 *                       while on, that stick's caption ("move", the left
 *                       stick's label) or line ("pivot", the note) asks for
 *                       a fresh press of it, with data-tone="warn": the stick
 *                       has been let go of under the operator's thumb
 *                       (app.js), and joy.js's knob, still following the
 *                       thumb, does not show it.
 *   family              the family chosen, FAMILY_PIVOT (the default) or
 *                       FAMILY_PIVOT_SIDEWAYS.
 *   onChange(fn)        fn(family) when the operator chooses the other.
 *
 * Choosing a family is not a drive press, and nothing here sends: the
 * listener hands the family to the Driver, which re-steers a held pivot
 * stick and otherwise does nothing.
 */
class FamilySelector {
  static OPTIONS = Object.freeze([
    Object.freeze({ family: FAMILY_PIVOT, label: "Pivot" }),
    Object.freeze({ family: FAMILY_PIVOT_SIDEWAYS, label: "Pivot sideways" }),
  ]);

  // Each family's icon, as an SVG path in a 16-unit box, drawn for the
  // stick pushed up and to the right; a corner mirrors it into its own
  // quadrant, as the moves mirror, and the family's segment shows it
  // unmirrored, so the segment and the corner it lights up draw alike. Drawn
  // rather than typed: no one font has every arrow these need, and the
  // fallbacks drew a family's four corners in two different weights. They
  // match the arrows MOTIONS gives the pivots for text (↱ ↰ ↳ ↲ and ↷ ↶),
  // except that the backward sideways pivots are the forward ones' arcs
  // turned under: the rear swings where the front would.
  static ICONS = Object.freeze({
    // Forward about the right wheels, the nose turning right.
    [FAMILY_PIVOT]: "M4.5 14V5h8M10 2.5 12.5 5 10 7.5",
    // The front swinging right about the rear axle.
    [FAMILY_PIVOT_SIDEWAYS]: "M1.5 10.5a5.5 5.5 0 0 1 11 0M10 8.5l2.5 2.5L15 8.5",
  });

  static TRANSLATE = "Translate";

  // A caption's request, while a press is awaited. Short enough to keep to
  // one line wherever a caption's own words do: a longer request wrapped on
  // a narrow phone, and the stick below it moved under the thumb as it came
  // and went (js/drive.js).
  static PRESS_AGAIN = "Press again";

  // The pivot stick's line: the caveat while it is on, and what it waits
  // for while it is off. One line in the stick's column wherever it is
  // narrowest (128 px, on its side at 568 x 320), as is PRESS_AGAIN, so no
  // change of words moves the stick under it: "Unverified: go slowly." ran
  // 5 px past it. Off, the pad's title says why; on, it has none, to hang
  // over a stick in use.
  static CAVEAT = "Untested: go slow.";
  static OFF = "Advanced only.";
  static OFF_TITLE = "Advanced only: the NORMAL scheme keeps the pivots off the sticks and the pad.";

  // The stick's corners, as deflections moveForStick() reads; on screen, up
  // is forward. Each is labelled with the move its quadrant sends.
  static CORNERS = Object.freeze([
    Object.freeze({ corner: "upLeft", x: -1, yUp: 1 }),
    Object.freeze({ corner: "upRight", x: 1, yUp: 1 }),
    Object.freeze({ corner: "downLeft", x: -1, yUp: -1 }),
    Object.freeze({ corner: "downRight", x: 1, yUp: -1 }),
  ]);

  #ui;
  #buttons = new Map(); // family -> its segment
  #corners = []; // per corner: { x, yUp, hint, path, text }
  #family = FAMILY_PIVOT;
  #offered = false;
  #awaiting = new Set(); // the sticks a fresh press is asked of: "move", "pivot"
  #listeners = new Listeners();

  constructor({ choice, group, pad, label, hints, note }) {
    this.#ui = { group, pad, label, note };

    for (const { family, label: name } of FamilySelector.OPTIONS) {
      const button = segment(choice, () => this.#choose(family));
      button.dataset.family = family;
      button.appendChild(FamilySelector.#icon(family, 1, 1).svg);
      dom.html("span", { class: "name" }, button, name);
      this.#buttons.set(family, button);
    }

    for (const { corner, x, yUp } of FamilySelector.CORNERS) {
      const hint = dom.html("span", { class: "hint" }, hints);
      hint.dataset.corner = corner;
      const { svg, path } = FamilySelector.#icon(null, x, yUp);
      hint.appendChild(svg);
      const text = dom.html("span", { class: "name" }, hint, "");
      this.#corners.push({ x, yUp, hint, path, text });
    }

    this.#render();
  }

  get family() {
    return this.#family;
  }

  onChange(fn) {
    return this.#listeners.add(fn);
  }

  offer(available) {
    this.#offered = Boolean(available);
    this.#render();
  }

  awaitPress(stick, on) {
    if (on) this.#awaiting.add(stick);
    else this.#awaiting.delete(stick);
    this.#render();
  }

  // A disabled segment cannot be clicked in a browser; this keeps it so
  // even for a click that arrives some other way.
  #choose(family) {
    if (!this.#offered || family === this.#family) return;
    this.#family = family;
    this.#render();
    this.#listeners.emit(family);
  }

  #render() {
    const { group, pad, label, note } = this.#ui;
    const offered = this.#offered;
    pressSegment(this.#buttons, this.#family);
    for (const button of this.#buttons.values()) button.disabled = !offered;
    group.dataset.off = offered ? "no" : "yes";
    pad.dataset.off = offered ? "no" : "yes";
    pad.title = offered ? "" : FamilySelector.OFF_TITLE;

    FamilySelector.#say(label, this.#awaiting.has("move") ? FamilySelector.PRESS_AGAIN : FamilySelector.TRANSLATE, this.#awaiting.has("move") ? "warn" : null);
    // A request for a press is for a stick that can take one.
    const pressPivot = offered && this.#awaiting.has("pivot");
    FamilySelector.#say(note, pressPivot ? FamilySelector.PRESS_AGAIN : offered ? FamilySelector.CAVEAT : FamilySelector.OFF,
      pressPivot ? "warn" : offered ? "caveat" : "off");

    // The corner labels come from moveForStick() itself, so they cannot
    // disagree with what the stick sends. They stay while the stick is off,
    // dimmed with it: what it would send is worth knowing before choosing
    // ADVANCED.
    for (const { x, yUp, hint, path, text } of this.#corners) {
      const motion = motionFor(moveForStick(x, yUp, this.#family));
      path.setAttribute("d", FamilySelector.ICONS[this.#family]);
      text.textContent = motion.short;
      hint.dataset.move = motion.name;
    }
  }

  static #say(element, text, tone) {
    element.textContent = text;
    if (tone) element.dataset.tone = tone;
    else delete element.dataset.tone;
  }

  // An icon for the quadrant (x, yUp) points into, the family's drawing
  // mirrored there: { svg, path }, the path to draw a family in. A push
  // exactly on an axis counts as right and forward, as it does in
  // moveForStick(). Hidden from assistive technology: the words beside it
  // say it.
  static #icon(family, x, yUp) {
    const sx = x < 0 ? -1 : 1;
    const sy = yUp < 0 ? -1 : 1;
    const svg = dom.svg("svg", { class: "glyph", viewBox: "0 0 16 16", "aria-hidden": "true" });
    const path = dom.svg("path", {
      transform: `matrix(${sx} 0 0 ${sy} ${sx < 0 ? 16 : 0} ${sy < 0 ? 16 : 0})`,
      d: family ? FamilySelector.ICONS[family] : "",
    }, svg);
    return { svg, path };
  }
}

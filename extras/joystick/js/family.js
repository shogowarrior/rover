/**
 * The stick family: what the stick drives, and the labels that say so.
 *
 * Under the NORMAL scheme the stick only translates. ADVANCED adds the two
 * pivot families, which the gamepad reaches by holding L1 or R1 and the panel
 * by this selector. In a pivot family the stick's quadrant picks the move
 * (moveForStick in mecanum.js), so the four moves are shown at the stick's
 * corners: what each quadrant sends is not something to learn by driving.
 *
 *   new FamilySelector({ choice, group, label, hints, caveat })
 *     choice   the empty element the three segments are built in;
 *     group    the selector's container, shown only while offered;
 *     label    the stick pad's caption, which names the family;
 *     hints    the empty element over the stick that the corner labels are
 *              built in. The page's CSS lets every touch through it to the
 *              stick;
 *     caveat   the warning that the pivots are not bench-verified, shown
 *              while a pivot family is chosen.
 *
 *   offer(available)  show the selector (ADVANCED) or withdraw it. While it
 *                     is withdrawn the family is FAMILY_TRANSLATE, and a
 *                     newly offered selector starts there too.
 *   awaitPress(on)    while on, the caption asks for a fresh press of the
 *                     stick in place of the family's name, with
 *                     data-tone="warn": the stick has been let go of under
 *                     the operator's thumb (app.js), and joy.js's knob,
 *                     still following the thumb, does not show it.
 *   family            the family chosen.
 *   onChange(fn)      fn(family) when the family changes: the operator's
 *                     choice, or the return to FAMILY_TRANSLATE on withdrawal.
 *                     Returns a function that unsubscribes fn.
 *
 * Choosing a family is not a drive press, and nothing here sends: the
 * listener hands the family to the Driver, which re-steers a held stick and
 * otherwise does nothing.
 */
class FamilySelector {
  static OPTIONS = Object.freeze([
    Object.freeze({ family: FAMILY_TRANSLATE, label: "Translate" }),
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
    // Four ways at once.
    [FAMILY_TRANSLATE]: "M8 2v12M2 8h12M6 4l2-2 2 2M6 12l2 2 2-2M4 6 2 8l2 2M12 6l2 2-2 2",
    // Forward about the right wheels, the nose turning right.
    [FAMILY_PIVOT]: "M4.5 14V5h8M10 2.5 12.5 5 10 7.5",
    // The front swinging right about the rear axle.
    [FAMILY_PIVOT_SIDEWAYS]: "M1.5 10.5a5.5 5.5 0 0 1 11 0M10 8.5l2.5 2.5L15 8.5",
  });

  // The caption's request, while a press is awaited.
  static PRESS_AGAIN = "Scheme changed: press again";

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
  #family = FAMILY_TRANSLATE;
  #offered = false;
  #awaitingPress = false;
  #listeners = new Listeners();

  constructor({ choice, group, label, hints, caveat }) {
    this.#ui = { group, label, hints, caveat };

    for (const { family, label: name } of FamilySelector.OPTIONS) {
      const button = segment(choice, () => this.#choose(family));
      button.dataset.family = family;
      button.appendChild(FamilySelector.#icon(family, 1, 1).svg);
      button.appendChild(FamilySelector.#span("name", name));
      this.#buttons.set(family, button);
    }

    for (const { corner, x, yUp } of FamilySelector.CORNERS) {
      const hint = document.createElement("span");
      hint.className = "hint";
      hint.dataset.corner = corner;
      const { svg, path } = FamilySelector.#icon(null, x, yUp);
      hint.appendChild(svg);
      const text = hint.appendChild(FamilySelector.#span("name", ""));
      hints.appendChild(hint);
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
    if (!this.#offered) this.#set(FAMILY_TRANSLATE);
    this.#render();
  }

  awaitPress(on) {
    this.#awaitingPress = Boolean(on);
    this.#render();
  }

  // A withdrawn selector cannot be clicked in a browser; this keeps it so
  // even for a click that arrives some other way.
  #choose(family) {
    if (!this.#offered) return;
    this.#set(family);
  }

  #set(family) {
    if (family === this.#family) return;
    this.#family = family;
    this.#render();
    this.#listeners.emit(family);
  }

  #render() {
    const { group, label, hints, caveat } = this.#ui;
    group.hidden = !this.#offered;
    pressSegment(this.#buttons, this.#family);
    label.textContent = this.#awaitingPress
      ? FamilySelector.PRESS_AGAIN
      : FamilySelector.OPTIONS.find((option) => option.family === this.#family).label;
    if (this.#awaitingPress) label.dataset.tone = "warn";
    else delete label.dataset.tone;

    // The corner labels come from moveForStick() itself, so they cannot
    // disagree with what the stick sends.
    const pivoting = this.#family !== FAMILY_TRANSLATE;
    hints.hidden = !pivoting;
    caveat.hidden = !pivoting;
    for (const { x, yUp, hint, path, text } of this.#corners) {
      const motion = pivoting ? motionFor(moveForStick(x, yUp, this.#family)) : null;
      path.setAttribute("d", pivoting ? FamilySelector.ICONS[this.#family] : "");
      text.textContent = motion ? motion.short : "";
      hint.dataset.move = motion ? motion.name : "";
    }
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

  static #span(className, text) {
    const span = document.createElement("span");
    span.className = className;
    span.textContent = text;
    return span;
  }
}

/**
 * The Rover | Simulator switch: what the page drives, the Drive tab's
 * controls and a program alike. A segmented control with one segment per
 * target the registry holds; with only the rover there is nothing to
 * switch, and it is hidden. The choice is remembered.
 *
 *   new TargetSwitch({ group, targets, storageKey, formerKey })
 *     group       the empty .segmented element it fills.
 *     targets     the registry, {kind: Target} (program.js): "rover" always,
 *                 "simulator" when the simulator's scripts loaded. Read once:
 *                 app.js fills it before building the switch.
 *     storageKey  where the choice is remembered.
 *     formerKey   where it was remembered before, read only while
 *                 storageKey holds nothing: the switch was the Program
 *                 tab's once, under a key of its own.
 *
 *   kind          the chosen kind.
 *   target        the chosen Target.
 *   kinds         every kind it offers, in the registry's order.
 *   onChange(fn)  fn(kind, previous) once the operator has switched.
 *
 * Choosing is all it does. What a switch must stop (a program running on the
 * target left behind, and every held control) is app.js's to wire.
 */
class TargetSwitch {
  static LABELS = Object.freeze({ rover: "Rover", simulator: "Simulator" });
  // The header's icons (labelSegment): the chassis on its four wheels, and
  // a screen.
  static ICONS = Object.freeze({
    rover: ["M9 4h6a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z", "M3 5.5h1v4H3zM20 5.5h1v4h-1zM3 14.5h1v4H3zM20 14.5h1v4h-1z", "M10.5 8h3"],
    simulator: ["M5 4h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z", "M8 20h8M12 16v4"],
  });
  static HINTS = Object.freeze({
    rover: "Rover: the controls drive the rover, and programs run on it.",
    simulator: "Simulator: the controls drive a simulated rover, and programs preview on it. Nothing goes to the rover but Stop.",
  });

  #targets;
  #storageKey;
  #kind;
  #segments = new Map(); // kind -> its button
  #listeners = new Listeners();

  constructor({ group, targets, storageKey, formerKey = null }) {
    this.#targets = targets;
    this.#storageKey = storageKey;
    const kinds = Object.keys(targets);
    let remembered = memory.recall(storageKey);
    if (remembered === null && formerKey !== null) remembered = memory.recall(formerKey);
    this.#kind = kinds.includes(remembered) ? remembered : kinds[0];
    for (const kind of kinds) {
      const button = labelSegment(segment(group, () => this.#choose(kind)), {
        word: TargetSwitch.LABELS[kind] || kind,
        paths: TargetSwitch.ICONS[kind] || [],
        hint: TargetSwitch.HINTS[kind] || "",
      });
      this.#segments.set(kind, button);
    }
    group.hidden = kinds.length < 2;
    pressSegment(this.#segments, this.#kind);
  }

  get kind() {
    return this.#kind;
  }

  get target() {
    return this.#targets[this.#kind];
  }

  get kinds() {
    return [...this.#segments.keys()];
  }

  onChange(fn) {
    return this.#listeners.add(fn);
  }

  #choose(kind) {
    const previous = this.#kind;
    if (kind === previous) return;
    this.#kind = kind;
    memory.remember(this.#storageKey, kind);
    pressSegment(this.#segments, kind);
    this.#listeners.emit(kind, previous);
  }
}

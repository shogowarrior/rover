/**
 * The Rover | Simulator switch: what a program runs on. A segmented control
 * with one segment per target the registry holds; with only the rover there
 * is nothing to switch, and it is hidden. The choice is remembered.
 *
 *   new TargetSwitch({ group, targets, storageKey })
 *     group       the empty .segmented element it fills.
 *     targets     the registry, {kind: Target} (program.js): "rover" always,
 *                 "simulator" when the simulator's scripts loaded. Read once:
 *                 app.js fills it before building the switch.
 *     storageKey  where the choice is remembered.
 *
 *   kind          the chosen kind.
 *   target        the chosen Target.
 *   kinds         every kind it offers, in the registry's order.
 *   onChange(fn)  fn(kind, previous) once the operator has switched.
 *
 * Choosing is all it does. What a switch must stop (a program running on the
 * target left behind) is app.js's to wire.
 */
class TargetSwitch {
  static LABELS = Object.freeze({ rover: "Rover", simulator: "Simulator" });

  #targets;
  #storageKey;
  #kind;
  #segments = new Map(); // kind -> its button
  #listeners = new Listeners();

  constructor({ group, targets, storageKey }) {
    this.#targets = targets;
    this.#storageKey = storageKey;
    const kinds = Object.keys(targets);
    const remembered = memory.recall(storageKey);
    this.#kind = kinds.includes(remembered) ? remembered : kinds[0];
    for (const kind of kinds) {
      const button = segment(group, () => this.#choose(kind));
      button.textContent = TargetSwitch.LABELS[kind] || kind;
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

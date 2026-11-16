/**
 * What telemetry says about the rover beyond its scan: the mode, and the
 * exploration phase while it explores, or the check under way while the
 * rover runs its checks ("Check: wheel FL", in the phase's place); the
 * move; the chip temperature; and the motor-shield warning, as the fault
 * line over the scan. The mode's
 * output, hidden, carries it as data-mode too. (The Autonomous toggle keeps
 * its own state: autotoggle.js; app.js has the link chip say "No motors"
 * where the view does not show the rover's own fault line, and "Rover
 * exploring" on the simulator target, kept dashed once the link goes.)
 *
 *   new Readouts({ mode, move, phaseCell, phaseLabel, phase, temp, motorsFault })
 *     phaseLabel   the phase's caption: "Phase", or "Check" while a check
 *                  is under way;
 *     motorsFault  shown only while the rover says its motor shield did
 *                  not answer; nothing shows while the motors are well.
 *   show(data)   update from a telemetry object; a key it lacks leaves its
 *                readout as it was (motorsReady excepted, below).
 *   linkDown()   the link the readings came over has gone.
 *   clear()      show nothing reported, as the page loads.
 *   mode         the mode telemetry last reported, or null.
 *   motorsReady  what the rover last said of its motor shield: true, false,
 *                or null for nothing said over this link.
 */
class Readouts {
  #ui;

  #mode = null;
  #motorsReady = null;

  constructor({ mode, move, phaseCell, phaseLabel, phase, temp, motorsFault }) {
    this.#ui = { mode, move, phaseCell, phaseLabel, phase, temp, motorsFault };
  }

  get mode() {
    return this.#mode;
  }

  get motorsReady() {
    return this.#motorsReady;
  }

  show(data) {
    const ui = this.#ui;
    if (typeof data.mode === "string") {
      const exploring = data.mode === MODE_AUTONOMOUS;
      ui.mode.textContent = data.mode;
      ui.mode.dataset.mode = data.mode;
      this.#mode = data.mode;

      // What exploration is doing, and why it has given up when it has: a
      // halt alone, in words and amber, its caption out of sight (panel.css
      // keys on data-halted), "Halted: boxed in". "Phase HALTED: boxed in"
      // read as a phase among others, and "CRUISE: boxed in" as a cruise
      // (the critic's round 3). The firmware sends neither in manual mode,
      // so the readout goes with it. The checks run in manual mode, and
      // say which is under way in the same place: while one wheel turns
      // alone the move says STOP, and the line said nothing of it.
      const checking = typeof data.check === "string";
      ui.phaseCell.hidden = !exploring && !checking;
      const halted = !checking && typeof data.halt === "string";
      if (ui.phaseLabel) ui.phaseLabel.textContent = checking ? "Check" : "Phase";
      ui.phase.textContent = checking
        ? data.check
        : halted
          ? `Halted: ${data.halt}`
          : typeof data.phase === "string" ? data.phase : "—";
      ui.phase.dataset.tone = halted ? "warn" : "";
      ui.phaseCell.dataset.halted = halted ? "yes" : "no";
      ui.phaseCell.title = checking ? "The check under way" : halted ? "Exploration halted, and why" : "Exploration phase";
    }
    if (typeof data.move === "string") ui.move.textContent = data.move;
    if (typeof data.temperature === "number") {
      ui.temp.textContent = `${data.temperature.toFixed(1)}°C`;
    }
    this.#showMotorsReady(data.motorsReady);
  }

  // The warning belongs to the link it came over, so losing that link clears
  // it.
  linkDown() {
    this.#showMotorsReady(undefined);
  }

  clear() {
    const ui = this.#ui;
    for (const output of [ui.mode, ui.move, ui.phase, ui.temp]) output.textContent = "—";
    delete ui.mode.dataset.mode;
    this.#mode = null;
    ui.phaseCell.hidden = true;
    ui.phase.dataset.tone = "";
    ui.phaseCell.dataset.halted = "no";
    ui.phaseCell.title = "Exploration phase";
    if (ui.phaseLabel) ui.phaseLabel.textContent = "Phase";
    this.#showMotorsReady(undefined);
  }

  // "motorsReady": false means the motor shield did not answer when the rover
  // booted. Every command is then accepted and reported -- the Move readout
  // says MOVE_FORWARD -- while the wheels never turn, which looks like a
  // software fault. Only an explicit false raises the warning: firmware from
  // before the key existed sends none, and that says nothing about the motors.
  // data-ready keeps the three cases apart, for the page's CSS.
  #showMotorsReady(ready) {
    const said = ready === true ? "yes" : ready === false ? "no" : "unknown";
    this.#motorsReady = ready === true || ready === false ? ready : null;
    this.#ui.motorsFault.hidden = ready !== false;
    this.#ui.motorsFault.dataset.ready = said;
  }
}

/**
 * What telemetry says about the rover beyond its scan: the mode, and the
 * exploration phase while it explores; the move; the chip temperature; and
 * the motor-shield warning. The mode's output carries it as data-mode too,
 * for the header's mode pill. (The Autonomous toggle keeps its own state:
 * autotoggle.js.)
 *
 *   new Readouts({ modePill, mode, move, phaseCell, phase, temp, motorsPill, motorsFault })
 *     modePill, motorsPill  the header's pills, titled with what they show
 *                           in full: a wide screen's header shows their
 *                           lamps alone.
 *   show(data)   update from a telemetry object; a key it lacks leaves its
 *                readout as it was (motorsReady excepted, below).
 *   linkDown()   the link the readings came over has gone.
 *   clear()      show nothing reported, as the page loads.
 */
class Readouts {
  #ui;

  static MOTORS_TITLE = Object.freeze({
    unknown: "The motor shield: not reported.",
    yes: "Motors OK: the motor shield answered when the rover booted.",
    no: "No motor shield: it did not answer when the rover booted, so the wheels cannot move.",
  });

  constructor({ modePill, mode, move, phaseCell, phase, temp, motorsPill, motorsFault }) {
    this.#ui = { modePill, mode, move, phaseCell, phase, temp, motorsPill, motorsFault };
  }

  show(data) {
    const ui = this.#ui;
    if (typeof data.mode === "string") {
      const exploring = data.mode === MODE_AUTONOMOUS;
      ui.mode.textContent = data.mode;
      ui.mode.dataset.mode = data.mode;
      ui.modePill.title = `The rover's mode: ${data.mode.toLowerCase()}.`;

      // What exploration is doing, and why it has given up when it has. The
      // firmware sends neither in manual mode, so the readout goes with it.
      ui.phaseCell.hidden = !exploring;
      const halted = typeof data.halt === "string";
      ui.phase.textContent = halted
        ? `${data.phase || "HALTED"}: ${data.halt}`
        : typeof data.phase === "string" ? data.phase : "—";
      ui.phase.dataset.tone = halted ? "warn" : "";
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
    ui.modePill.title = "The rover's mode: not reported.";
    ui.phaseCell.hidden = true;
    ui.phase.dataset.tone = "";
    this.#showMotorsReady(undefined);
  }

  // "motorsReady": false means the motor shield did not answer when the rover
  // booted. Every command is then accepted and reported -- the Move readout
  // says MOVE_FORWARD -- while the wheels never turn, which looks like a
  // software fault. Only an explicit false raises the warning: firmware from
  // before the key existed sends none, and that says nothing about the motors.
  // data-ready keeps the three cases apart for the header's motors pill,
  // which says "Motors OK" only on an explicit true.
  #showMotorsReady(ready) {
    const said = ready === true ? "yes" : ready === false ? "no" : "unknown";
    this.#ui.motorsFault.hidden = ready !== false;
    this.#ui.motorsFault.dataset.ready = said;
    this.#ui.motorsPill.title = Readouts.MOTORS_TITLE[said];
  }
}

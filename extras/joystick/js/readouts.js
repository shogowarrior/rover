/**
 * What telemetry says about the rover beyond its scan: the mode, and the
 * exploration phase while it explores; the move; the chip temperature; and
 * the motor-shield warning, as the fault card and as the "No motors" badge
 * in the top's first cell. The mode's output, hidden, carries it as
 * data-mode too. (The Autonomous toggle keeps its own state:
 * autotoggle.js; app.js shows the "Rover exploring" badge from mode.)
 *
 *   new Readouts({ mode, move, phaseCell, phase, temp, motorsBadge, motorsFault })
 *     motorsBadge  shown only while the rover says its motor shield did
 *                  not answer; nothing shows while the motors are well.
 *   show(data)   update from a telemetry object; a key it lacks leaves its
 *                readout as it was (motorsReady excepted, below).
 *   linkDown()   the link the readings came over has gone.
 *   clear()      show nothing reported, as the page loads.
 *   mode         the mode telemetry last reported, or null.
 */
class Readouts {
  #ui;

  static MOTORS_TITLE = "No motors: the motor shield did not answer when the rover booted, so the wheels cannot move. Check its wiring and power, then reset the rover with its wheels off the ground.";

  #mode = null;

  constructor({ mode, move, phaseCell, phase, temp, motorsBadge, motorsFault }) {
    this.#ui = { mode, move, phaseCell, phase, temp, motorsBadge, motorsFault };
    motorsBadge.setAttribute("title", Readouts.MOTORS_TITLE);
  }

  get mode() {
    return this.#mode;
  }

  show(data) {
    const ui = this.#ui;
    if (typeof data.mode === "string") {
      const exploring = data.mode === MODE_AUTONOMOUS;
      ui.mode.textContent = data.mode;
      ui.mode.dataset.mode = data.mode;
      this.#mode = data.mode;

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
    this.#mode = null;
    ui.phaseCell.hidden = true;
    ui.phase.dataset.tone = "";
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
    this.#ui.motorsFault.hidden = ready !== false;
    this.#ui.motorsFault.dataset.ready = said;
    this.#ui.motorsBadge.hidden = ready !== false;
  }
}

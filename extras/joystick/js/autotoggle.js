/**
 * The Autonomous toggle: beside Stop on a phone, at the other end of the
 * header's row from it on a wide screen. On while the target explores, off
 * while it waits for the controls. A press turns it the other way, through
 * the Driver: turned on it sends RESUME_AUTONOMOUS
 * (Driver.resumeAutonomous()), turned off STOP (Driver.stopRover(), with
 * the reason "autonomous", so a program it stops says Autonomous was
 * pressed, not Stop), and each does all that the Driver's own does. Both
 * are presses: they take over from what the panel holds, and a program
 * stops (app.js).
 *
 * Like the scheme toggle, it shows what the target reports, never what it
 * asked for: the rover's mode as telemetry last reported it, or on the
 * simulator target the simulated rover's (bind()). So a rover another
 * client sent exploring lights it, and a press always turns it the way the
 * operator sees: a press on a lit toggle stops the rover, whoever started
 * it. Until telemetry names a mode it is off, and a press sends
 * RESUME_AUTONOMOUS, as the button it replaced did. A link that went keeps
 * the mode last reported, dimmed (panel.css).
 *
 * A rover that halted (boxed in, or its sensor silent) still reports
 * AUTONOMOUS and retries by itself every 5 s; turned off and on again, it
 * retries at once, from a fresh sweep.
 *
 *   new AutoToggle({ button, driver })
 *     button   the toggle: its aria-pressed is kept here, and nowhere else;
 *     driver   the Driver.
 *
 *   show(data)    update from the rover's telemetry; a frame with no mode
 *                 leaves it as it was.
 *   clear()       nothing reported: a new link, before its first frame.
 *   bind(local)   show local's mode instead of the rover's: the
 *                 SimTarget, or anything with mode and onMode(fn). null
 *                 shows the rover's again, kept meanwhile.
 *   on            whether the mode shown is AUTONOMOUS.
 */
class AutoToggle {
  #button;
  #driver;
  #reported = null; // the rover's mode, as telemetry last reported it, or null
  #local = null; // what bind() gave, or null
  #unlisten = null;

  constructor({ button, driver }) {
    this.#button = button;
    this.#driver = driver;
    button.addEventListener("click", () => this.#press());
    this.#render();
  }

  get on() {
    return (this.#local ? this.#local.mode : this.#reported) === MODE_AUTONOMOUS;
  }

  show(data) {
    if (typeof data.mode !== "string") return;
    this.#reported = data.mode;
    this.#render();
  }

  clear() {
    this.#reported = null;
    this.#render();
  }

  bind(local) {
    if (this.#unlisten) this.#unlisten();
    this.#unlisten = null;
    this.#local = local;
    if (local) this.#unlisten = local.onMode(() => this.#render());
    this.#render();
  }

  // Rendered again at once for the simulator, whose mode changes as it
  // takes the command; the rover's comes with its next frame.
  #press() {
    if (this.on) this.#driver.stopRover({ reason: "autonomous" });
    else this.#driver.resumeAutonomous();
    this.#render();
  }

  #render() {
    this.#button.setAttribute("aria-pressed", String(this.on));
  }
}

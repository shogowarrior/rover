/**
 * The rover's checks (src/SelfTest.h), started from the Options popover's
 * Run checks: the sonar at each of its five bearings, then each wheel
 * alone, then four short moves that drive the rover forward and sideways
 * and turn it. So the rover belongs on its stand, and the panel asks first,
 * in the page's one dialog.
 *
 * The panel holds the checks as it holds a move (Driver.runChecks()):
 * RUN_CHECKS goes out on the press and again every REPEAT_MS, and the rover
 * starts no wheel's step without a RUN_CHECKS in the last CHECK_HOLD_MS. So
 * the checks run only while the panel is open, in front and linked: every
 * way a held move is let go of (blur, a hidden page, Stop, Autonomous, a
 * drive press, a switch of target, the link lost or stale) lets go of them,
 * sending nothing more, and the rover ends them itself within a second.
 * This class lets go of them too, sending nothing, once telemetry says they
 * are over: a frame without "check" after one with it (they ran their
 * course; a re-send that crosses their end starts no new run), or
 * CONFIRM_MS from the press with no frame showing one (the rover never
 * started them: another controller held control, or firmware without
 * them).
 *
 *   new Checks({ driver, ask, whyOff })
 *     driver  the Driver, which holds them as an operator press;
 *     ask     the page's AskDialog;
 *     whyOff  fn() saying why the checks cannot start now, or "" when they
 *             can: no live link, a rover too old for them, the simulator
 *             target (RoverSettings.whyOff()).
 *
 *   run()        ask, and start them on a yes: a promise of whether they
 *                were started. Nothing is asked, or sent, while whyNot()
 *                says why not; a yes is checked again.
 *   show(data)   a telemetry frame (Link.onTelemetry).
 *   whyNot()     why Run checks is off now, or "": whyOff()'s reason, or
 *                checks under way already (Stop ends them).
 *   running      the check telemetry last reported under way, or null.
 *   held         whether this panel holds checks now.
 *   onChange(fn) fn() whenever running or held may have changed.
 */
class Checks {
  // How long checks this panel asked for may go unseen: three telemetry
  // intervals, as the scheme toggle waits for a change (scheme.js).
  static CONFIRM_MS = 3 * TELEMETRY_MS;

  static QUESTION = Object.freeze({
    title: "Run the rover's checks?",
    text: "Put the rover on its stand first: every wheel will turn. It pings the sonar at five bearings, turns each wheel alone, then drives forward, sideways and round in four short moves, which would drive it off a table. The checks run only while this panel stays open and in front; any command ends them, Stop among them.",
    yes: "Run checks",
  });

  static RUNNING = "The checks are running: Stop ends them.";

  #driver;
  #ask;
  #whyOff;
  #running = null; // the check telemetry reports, or null
  #heard = false; // a frame has shown a check since the press
  #unseenTimer = null; // gives up on checks no frame has shown
  #listeners = new Listeners();

  constructor({ driver, ask, whyOff }) {
    this.#driver = driver;
    this.#ask = ask;
    this.#whyOff = whyOff;
    // The Driver lets go of them on its own (a stand-down, a press): say so.
    const changed = () => this.#listeners.emit();
    driver.onStandDown(changed);
    driver.onManualInput(changed);
  }

  get running() {
    return this.#running;
  }

  get held() {
    return this.#driver.checking;
  }

  onChange(fn) {
    return this.#listeners.add(fn);
  }

  whyNot() {
    return this.#whyOff() || (this.#running !== null ? Checks.RUNNING : "");
  }

  async run() {
    if (this.whyNot()) return false;
    if (!(await this.#ask.ask(Checks.QUESTION)) || this.whyNot()) return false;
    this.#heard = false;
    clearTimeout(this.#unseenTimer);
    this.#unseenTimer = setTimeout(() => {
      if (!this.#heard) this.#letGo();
    }, Checks.CONFIRM_MS);
    this.#driver.runChecks();
    this.#listeners.emit();
    return true;
  }

  show(data) {
    const running = typeof data.check === "string" ? data.check : null;
    const was = this.#running;
    this.#running = running;
    if (this.#driver.checking) {
      if (running !== null) this.#heard = true;
      else if (this.#heard) this.#letGo();
    }
    if (running !== was) this.#listeners.emit();
  }

  #letGo() {
    clearTimeout(this.#unseenTimer);
    this.#unseenTimer = null;
    if (!this.#driver.checking) return;
    this.#driver.endChecks();
    this.#listeners.emit();
  }
}

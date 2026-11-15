/**
 * The Autonomous toggle: a labelled switch in the top's first cell, the
 * other cell from Stop, so that a press that misses Stop can never land on
 * it and start the rover exploring (F8). It sits second in that cell,
 * after the target and before the link chip, near the cell's start on
 * every layout. Where the cells stack, the first over the second, it is
 * never over Stop, which keeps the second cell's far end (it was at the
 * first cell's far end, right over Stop: the critics' round 3). On while
 * the target explores, off while it waits for the controls; its track and
 * knob show which
 * (panel.css). A press turns it the other way, through
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
 * AUTONOMOUS and retries by itself every 5 s; turned off, and on again once
 * the switch shows off (a frame, up to half a second), it retries at once,
 * from a fresh sweep.
 *
 * A press on the rover is a request, which only a frame confirms, and the
 * switch shows nothing new until one does: up to half a second, more over
 * a slow link. So, as the scheme toggle does (scheme.js), it keeps what it
 * asked for, pending, and marks the switch so (data-pending, "on" or
 * "off", which panel.css draws as a dashed track), aria-pressed still the
 * rover's word, until a frame reports that mode or CONFIRM_FRAMES frames
 * have not. A press while one is pending sends STOP, whichever way that
 * request went: only a press with nothing pending takes its direction from
 * the report, so RESUME_AUTONOMOUS goes out only from a switch that shows
 * off with nothing pending, and two quick presses always end with STOP,
 * from off (RESUME_AUTONOMOUS, STOP) or from on (STOP, STOP). The
 * reviewers' rounds 2 and 3: a quick press again to undo the first left
 * the rover exploring, from off when it went by the report, and from on
 * when it went the other way from the request (the knob does not move
 * until a frame comes, so an Off press that seems not to have taken is
 * pressed again). A stale link keeps the request pending, since no frame
 * comes to settle it; a link that goes, or a new one, forgets it, and so does
 * any other press of the operator's (the Driver's onManualInput: Stop, a
 * stick, a rotate button or a drive key), whose command was the rover's
 * last word: T after Stop resumes, as the switch, off, says it will. The
 * simulator takes the mode at once, so nothing is pending there.
 *
 * With no link on the rover target (none yet, or still connecting) a press
 * sends nothing, and is not silent either: it calls unlinked(), which
 * opens the link's popover and says there why (app.js). A switch that did
 * nothing at all read as broken (the reviewers' round 2).
 *
 *   new AutoToggle({ button, driver, link, unlinked })
 *     button    the toggle: its aria-pressed and data-pending are kept
 *               here, and nowhere else;
 *     driver    the Driver;
 *     link      the Link: its state says whether a press can reach the
 *               rover;
 *     unlinked  fn() for a press on the rover target with no link.
 *
 *   show(data)    update from the rover's telemetry; a frame with no mode
 *                 leaves it as it was.
 *   clear()       nothing reported: a new link, before its first frame.
 *   linkDown()    the link went: a request over it can no longer be
 *                 confirmed, and is forgotten; the mode last reported stays.
 *   bind(local)   show local's mode instead of the rover's: the
 *                 SimTarget, or anything with mode and onMode(fn). null
 *                 shows the rover's again, kept meanwhile.
 *   on            whether the mode shown is AUTONOMOUS.
 *   pending       the mode asked of the rover and not yet reported, or
 *                 null.
 */
class AutoToggle {
  // Frames that may report the mode from before a request reached the
  // rover: three, as the scheme toggle waits three intervals (scheme.js).
  static CONFIRM_FRAMES = 3;

  #button;
  #driver;
  #link;
  #unlinked;
  #reported = null; // the rover's mode, as telemetry last reported it, or null
  #pending = null; // the mode asked of the rover and not yet reported, or null
  #unconfirmed = 0; // frames since that request that did not report it
  #local = null; // what bind() gave, or null
  #unlisten = null;

  constructor({ button, driver, link, unlinked }) {
    this.#button = button;
    this.#driver = driver;
    this.#link = link;
    this.#unlinked = unlinked;
    button.addEventListener("click", () => this.#press());
    // Another press supersedes a request. The switch's own press raises
    // this too, before it marks what it asked.
    driver.onManualInput(() => {
      this.#pending = null;
      this.#render();
    });
    this.#render();
  }

  get on() {
    return (this.#local ? this.#local.mode : this.#reported) === MODE_AUTONOMOUS;
  }

  get pending() {
    return this.#pending;
  }

  show(data) {
    if (typeof data.mode !== "string") return;
    this.#reported = data.mode;
    if (this.#pending !== null && (data.mode === this.#pending || ++this.#unconfirmed >= AutoToggle.CONFIRM_FRAMES)) {
      this.#pending = null;
    }
    this.#render();
  }

  clear() {
    this.#reported = null;
    this.#pending = null;
    this.#render();
  }

  linkDown() {
    this.#pending = null;
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
  // takes the command; the rover's comes with its next frame, and until
  // then the request is pending. With one pending, STOP, whichever way it
  // went: never RESUME_AUTONOMOUS from a switch not confirmed off.
  #press() {
    if (this.#local) {
      if (this.on) this.#driver.stopRover({ reason: "autonomous" });
      else this.#driver.resumeAutonomous();
      this.#render();
      return;
    }
    const state = this.#link.state;
    if (state !== "up" && state !== "stale") {
      this.#unlinked();
      return;
    }
    const asked = this.#pending !== null || this.#reported === MODE_AUTONOMOUS ? MODE_MANUAL : MODE_AUTONOMOUS;
    if (asked === MODE_MANUAL) this.#driver.stopRover({ reason: "autonomous" });
    else this.#driver.resumeAutonomous();
    this.#pending = asked;
    this.#unconfirmed = 0;
    this.#render();
  }

  // Pressed is what the target reports; pending only ever a mark, so a
  // request the rover did not take cannot look applied.
  #render() {
    this.#button.setAttribute("aria-pressed", String(this.on));
    const pending = this.#local ? null : this.#pending;
    if (pending === null) delete this.#button.dataset.pending;
    else this.#button.dataset.pending = pending === MODE_AUTONOMOUS ? "on" : "off";
  }
}

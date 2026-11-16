/**
 * Who has control, when it is not this panel and that matters: while
 * telemetry's "control" names the pad or the USB console, ranked above
 * WiFi in the rover's priority, and this panel is driving the rover (a held
 * control, a program, the checks), or drove it or pressed a drive control
 * within CONTROL_HOLD_MS, a line at the top of the view says so in words.
 * The rover refuses every WiFi command but Stop while a controller ranked
 * above WiFi drives (src/Control.h), so a stick that moved nothing
 * otherwise read as broken. One ranked below WiFi loses control to this
 * panel's next move, so it gets no line: the line once claimed it refused
 * the panel's moves too. It names the controller and what that means; Stop
 * still stops, from anyone. On the rover target only, with a live link: on
 * the simulator the panel's presses go to the simulator.
 *
 * The line takes its height from the scan's card, inside the view, which
 * is size-contained: nothing outside the view moves as it comes and goes.
 * A narrow view says the first half alone (rover.css).
 *
 *   new HeldBy({ element, who, driver, priority })
 *     element   the line, hidden here while there is nothing to say;
 *     who       its first half, which names the controller;
 *     driver    the Driver: whether this panel drives, holds the checks, or
 *               was just pressed;
 *     priority  () => the priority the rover last reported (RoverSettings'
 *               settings), first first, or null before a settings frame:
 *               then the firmware's default, USB, PAD, WIFI (SOURCES'
 *               order), which ranks both above WiFi. Read as each frame
 *               comes.
 *
 *   show(data)        a telemetry frame.
 *   linkState(state)  the link's state, on every change.
 *   target(kind)      the page's target: "rover" or "simulator".
 *   holder            the controller the line names, or null while hidden.
 */
class HeldBy {
  static NAMES = Object.freeze({ PAD: "The pad", USB: "The USB console" });

  #element;
  #who;
  #driver;
  #priority;
  #control = null; // telemetry's "control", or null
  #live = false;
  #target = "rover";
  #activeAt = -Infinity; // when this panel last drove or was pressed
  #timer = null;

  constructor({ element, who, driver, priority }) {
    this.#element = element;
    this.#who = who;
    this.#driver = driver;
    this.#priority = priority;
    driver.onManualInput(() => {
      this.#activeAt = performance.now();
      this.#say();
    });
    this.#say();
  }

  get holder() {
    return this.#element.hidden ? null : this.#control;
  }

  show(data) {
    this.#control = typeof data.control === "string" ? data.control : null;
    this.#say();
  }

  linkState(state) {
    this.#live = state === "up";
    if (state === "down" || state === "connecting") this.#control = null;
    this.#say();
  }

  target(kind) {
    this.#target = kind;
    this.#say();
  }

  #say() {
    clearTimeout(this.#timer);
    this.#timer = null;
    const name = this.#aboveWifi(this.#control) ? HeldBy.NAMES[this.#control] : undefined;
    const now = performance.now();
    if (this.#driver.driving !== null || this.#driver.checking) this.#activeAt = now;
    const since = now - this.#activeAt;
    const on = Boolean(name) && this.#live && this.#target === "rover" && since < CONTROL_HOLD_MS;
    this.#element.hidden = !on;
    if (!on) return;
    this.#who.textContent = `${name} has control`;
    this.#element.title = `${name} has control of the rover, and is ranked above WiFi in the rover's priority (Options, Rover): this panel's moves are refused while it drives. Stop still stops the rover.`;
    // Again once this panel has been idle CONTROL_HOLD_MS, unless a frame
    // comes first: still driving, it stays.
    this.#timer = setTimeout(() => this.#say(), CONTROL_HOLD_MS - since);
  }

  // Whether the rover refuses WiFi's moves while `who` drives: whether it
  // ranks above WiFi in the priority reported, or the default's.
  #aboveWifi(who) {
    const order = this.#priority() || SOURCES.slice(0, 3);
    const rank = order.indexOf(who);
    return rank !== -1 && rank < order.indexOf("WIFI");
  }
}

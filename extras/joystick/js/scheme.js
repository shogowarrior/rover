/**
 * The control scheme toggle in the header: which layout the rover's
 * controllers drive with, NORMAL or ADVANCED (docs/mecanum.md "Control
 * schemes"). On the simulator target it is the simulator's instead (bind()).
 *
 * The rover holds one scheme for every controller, and any of them may change
 * it: this toggle, another panel, the gamepad's SELECT. So the toggle shows
 * what telemetry reports and nothing else -- never what it asked for, never a
 * guess:
 *   * until a telemetry frame names a scheme, the toggle is disabled and
 *     shows the scheme as unknown. Firmware from before schemes sends none,
 *     and the toggle then stays disabled;
 *   * choosing the other scheme sends one {"scheme": NAME} and marks it
 *     pending until telemetry reports it, or for CONFIRM_MS at most;
 *   * while the link is stale the scheme last reported stays shown, dimmed,
 *     and nothing is offered: no telemetry could confirm a request, and a
 *     rover that rebooted is back on its default scheme. The next frame
 *     brings it back;
 *   * losing the link makes the scheme unknown again.
 *
 * The scheme message is configuration, not a command: the firmware neither
 * takes control for it nor stops anything, so the toggle works while the
 * rover explores and leaves it exploring. It goes straight to the Link, not
 * through the Driver, and is not manual input.
 *
 * Bound to the simulator, the toggle shows and sets the simulated rover's
 * scheme, which lives on the page: always known, never stale, and set at
 * once by a choice, with nothing to confirm and nothing sent over the Link.
 * So Normal | Advanced work with no rover. The rover's reports are kept
 * meanwhile, and shown again when the toggle is unbound.
 *
 *   new SchemeToggle({ link, group, choice })
 *     link     a Link, to send the scheme message;
 *     group    the toggle's container, which gets data-state = "unknown",
 *              "known", "pending" or "stale" for the page's CSS;
 *     choice   the empty element the two segments are built in.
 *
 *   show(data)    update from the rover's telemetry.
 *   linkStale()   telemetry has stopped, though the socket is open.
 *   linkDown()    the link telemetry came over has gone.
 *   bind(local)   show and set local's scheme instead of the rover's: a
 *                 SimTarget, or anything with scheme and setScheme(name).
 *                 null shows the rover's again.
 *   scheme        the scheme shown, SCHEME_NORMAL or SCHEME_ADVANCED: the
 *                 bound simulator's, or the rover's as telemetry last
 *                 reported it, null while unknown.
 *   onChange(fn)  fn(scheme, previous) whenever the scheme shown changes, to
 *                 or from null included -- whoever changed it, a bind too.
 */
class SchemeToggle {
  // Telemetry arrives every TELEMETRY_MS (protocol.js). Three frames without
  // the scheme asked for, and the request was lost or someone has already
  // changed it back: show the rover's scheme again.
  static CONFIRM_MS = 3 * TELEMETRY_MS;

  static OPTIONS = Object.freeze([
    Object.freeze({ scheme: SCHEME_NORMAL, label: "Normal" }),
    Object.freeze({ scheme: SCHEME_ADVANCED, label: "Advanced" }),
  ]);

  #link;
  #group;
  #buttons = new Map(); // scheme -> its segment
  #reported = null; // the rover's, as telemetry last reported it, or null
  #local = null; // what bind() gave: shown and set instead, or null
  #stale = false; // telemetry has stopped since it was reported
  #pending = null; // the scheme asked for and not yet reported, or null
  #pendingTimer = null;
  #listeners = new Listeners();

  constructor({ link, group, choice }) {
    this.#link = link;
    this.#group = group;
    for (const { scheme, label } of SchemeToggle.OPTIONS) {
      const button = segment(choice, () => this.#choose(scheme));
      button.textContent = label;
      button.dataset.scheme = scheme;
      this.#buttons.set(scheme, button);
    }
    this.#render();
  }

  get scheme() {
    return this.#local ? this.#local.scheme : this.#reported;
  }

  onChange(fn) {
    return this.#listeners.add(fn);
  }

  // Every frame states the scheme. One that names none, or one this panel
  // does not know, says the scheme is unknown: older firmware, or newer
  // firmware with a scheme the panel cannot drive in.
  show(data) {
    const reported = SchemeToggle.OPTIONS.some((option) => option.scheme === data.scheme) ? data.scheme : null;
    this.#stale = false;
    if (reported === null || reported === this.#pending) this.#settle();
    this.#set(reported);
  }

  // Stale is not lost: the scheme stays shown, for the stick still drives
  // with it. A request is given up at once, since nothing can confirm it.
  linkStale() {
    this.#stale = true;
    this.#settle();
    this.#render();
  }

  linkDown() {
    this.#stale = false;
    this.#settle();
    this.#set(null);
  }

  // A request to the rover still pending goes on, unseen, and its report is
  // kept for when the rover's scheme is shown again.
  bind(local) {
    const previous = this.scheme;
    this.#local = local;
    this.#render();
    if (this.scheme !== previous) this.#listeners.emit(this.scheme, previous);
  }

  // A click on the scheme already shown, confirmed or pending, sends nothing.
  // A click on the other sends one frame, and a later click replaces it: the
  // rover takes them in order, so the last one asked for is what it ends on.
  #choose(scheme) {
    if (this.#local) {
      const previous = this.#local.scheme;
      if (scheme === previous) return;
      this.#local.setScheme(scheme);
      this.#render();
      this.#listeners.emit(this.#local.scheme, previous);
      return;
    }
    // A disabled button takes no clicks in a browser; this keeps the rule in
    // the code as well as in the attribute. A stale link may be half-open:
    // a request only goes out on one whose telemetry can confirm it.
    if (this.#reported === null || this.#stale) return;
    if (scheme === (this.#pending || this.#reported)) return;
    if (!this.#link.send({ scheme })) return;
    clearTimeout(this.#pendingTimer);
    this.#pending = scheme;
    this.#pendingTimer = setTimeout(() => this.#settle(), SchemeToggle.CONFIRM_MS);
    this.#render();
  }

  // Forget the request, confirmed or given up on.
  #settle() {
    clearTimeout(this.#pendingTimer);
    this.#pendingTimer = null;
    if (this.#pending === null) return;
    this.#pending = null;
    this.#render();
  }

  // Rendered every time, changed or not: a frame after a stale spell brings
  // back the same scheme, and the toggle must still light up again.
  #set(reported) {
    const previous = this.scheme;
    this.#reported = reported;
    this.#render();
    if (this.scheme !== previous) this.#listeners.emit(this.scheme, previous);
  }

  // Pressed is what the rover reports, or the bound simulator's scheme;
  // pending is only ever a mark on the segment asked for, so a request that
  // never lands cannot look applied.
  #render() {
    const scheme = this.scheme;
    const known = scheme !== null;
    const stale = !this.#local && this.#stale;
    const pending = this.#local ? null : this.#pending;
    this.#group.dataset.state = !known ? "unknown" : stale ? "stale" : pending ? "pending" : "known";
    this.#group.setAttribute("aria-busy", String(pending !== null));
    this.#group.title = this.#local
      ? "The simulator's control scheme. The rover's stays as it is."
      : !known
        ? "The rover has not reported a control scheme. Firmware from before schemes never does."
        : stale
          ? "Telemetry has stopped: the scheme cannot be changed until the rover reports it again."
          : "";
    pressSegment(this.#buttons, scheme);
    for (const [option, button] of this.#buttons) {
      button.disabled = !known || stale;
      if (option === pending) button.dataset.pending = "yes";
      else delete button.dataset.pending;
    }
  }
}

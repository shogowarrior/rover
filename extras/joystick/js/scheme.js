/**
 * The control scheme toggle in the top's second cell: which layout the
 * rover's controllers drive with, NORMAL or ADVANCED (docs/mecanum.md
 * "Control schemes"). On the simulator target it is the simulator's instead
 * (bind()).
 *
 * The rover holds one scheme for every controller, and any of them may change
 * it: this toggle, another panel, the gamepad's SELECT. So the toggle shows
 * what telemetry reports and nothing else -- never what it asked for, never a
 * guess:
 *   * until a telemetry frame names a scheme (no link yet, connecting, or a
 *     link that went) neither segment is pressed, and both take a press:
 *     never greyed for want of a link, which the owner read as broken (F8).
 *     A press there is a wish: that segment is marked pending and titled
 *     so, its notes say it in words (a touch screen shows no title), and
 *     nothing is sent. When a frame next names a scheme, a wish for
 *     the other one sends one {"scheme": NAME}, pending as below, and the
 *     wish is gone either way. A press on the other segment replaces the
 *     wish, a press on the wished one drops it. Firmware from before schemes
 *     names none, and leaves a wish pending;
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
 * through the Driver, and is not manual input. A wish sent as a frame
 * arrives is the same message, and no more a command.
 *
 * Bound to the simulator, the toggle shows and sets the simulated rover's
 * scheme, which lives on the page: always known, never stale, and set at
 * once by a choice, with nothing to confirm and nothing sent over the Link.
 * So Normal | Advanced work with no rover. The rover's reports are kept
 * meanwhile, and a wish for it with them, and shown again when the toggle
 * is unbound. Nothing goes to the rover while bound, a wish included: it
 * waits, unseen, and is settled as the toggle is unbound if the rover has
 * named a scheme by then, or by the next frame that names one.
 *
 *   new SchemeToggle({ link, group, choice, notes })
 *     link     a Link, to send the scheme message;
 *     group    the toggle's container, which gets data-state = "unknown",
 *              "known", "pending" or "stale" for the page's CSS;
 *     choice   the empty element the two segments are built in;
 *     notes    elements that say a wish in words while there is one, and
 *              are hidden while there is none: the link's popover, and the
 *              connect card over the rover's scan (optional).
 *
 *   show(data)    update from the rover's telemetry.
 *   linkStale()   telemetry has stopped, though the socket is open.
 *   linkDown()    the link telemetry came over has gone.
 *   bind(local)   show and set local's scheme instead of the rover's: a
 *                 SimTarget, or anything with scheme and setScheme(name).
 *                 null shows the rover's again.
 *   scheme        the scheme shown, SCHEME_NORMAL or SCHEME_ADVANCED: the
 *                 bound simulator's, or the rover's as telemetry last
 *                 reported it, null while unknown (a wish is not a scheme).
 *   wanted        the scheme wished for the rover while its own is unknown,
 *                 or null.
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
  static HINTS = Object.freeze({
    [SCHEME_NORMAL]: "Normal: the left stick and the rotate buttons. The pivots are off.",
    [SCHEME_ADVANCED]: "Advanced: the pivots too, on the right stick.",
  });
  // Where the cell is narrowest (panel.css): the word shown instead.
  static SHORT = Object.freeze({ [SCHEME_ADVANCED]: "Adv" });
  static UNKNOWN_TITLE = "The rover has not reported its control scheme: a choice is sent to it as soon as it does.";
  static WISH_TITLE = "Sent to the rover as soon as it reports its scheme (firmware from before schemes never does). Press again to drop it.";
  // A wish in words, where the page shows it: before a link has brought
  // a frame, and after (firmware that names no scheme).
  static WISH_NOTE = Object.freeze({
    waiting: (label) => `${label} goes to the rover once it connects.`,
    heard: (label) => `${label} goes to the rover once it reports its scheme.`,
  });

  #link;
  #group;
  #notes;
  #buttons = new Map(); // scheme -> its segment
  #reported = null; // the rover's, as telemetry last reported it, or null
  #local = null; // what bind() gave: shown and set instead, or null
  #stale = false; // telemetry has stopped since it was reported
  #pending = null; // the scheme asked for and not yet reported, or null
  #wanted = null; // the scheme wished for while the rover's is unknown, or null
  #heard = false; // a frame has come over the link since it was last down
  #pendingTimer = null;
  #listeners = new Listeners();

  constructor({ link, group, choice, notes = [] }) {
    this.#link = link;
    this.#group = group;
    this.#notes = notes.filter(Boolean);
    for (const { scheme, label } of SchemeToggle.OPTIONS) {
      const button = labelSegment(segment(choice, () => this.#choose(scheme)), {
        word: label, short: SchemeToggle.SHORT[scheme] || null, hint: SchemeToggle.HINTS[scheme],
      });
      button.dataset.scheme = scheme;
      this.#buttons.set(scheme, button);
    }
    this.#render();
  }

  get scheme() {
    return this.#local ? this.#local.scheme : this.#reported;
  }

  get wanted() {
    return this.#wanted;
  }

  onChange(fn) {
    return this.#listeners.add(fn);
  }

  // Every frame states the scheme. One that names none, or one this panel
  // does not know, says the scheme is unknown: older firmware, or newer
  // firmware with a scheme the panel cannot drive in. One that names a
  // scheme settles a wish: the other scheme goes out as a request, pending
  // as a press's would, and the scheme wished for already goes nowhere.
  show(data) {
    const reported = SchemeToggle.OPTIONS.some((option) => option.scheme === data.scheme) ? data.scheme : null;
    this.#stale = false;
    this.#heard = true;
    if (reported === null || reported === this.#pending) this.#settle();
    this.#set(reported);
    this.#spendWish();
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
    this.#heard = false;
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
    this.#spendWish();
  }

  // A click on the scheme already shown, confirmed or pending, sends nothing.
  // A click on the other sends one frame, and a later click replaces it: the
  // rover takes them in order, so the last one asked for is what it ends on.
  // While the rover's scheme is unknown a click is a wish, which a click on
  // the other replaces and a click on the same one drops.
  #choose(scheme) {
    if (this.#local) {
      const previous = this.#local.scheme;
      if (scheme === previous) return;
      this.#local.setScheme(scheme);
      this.#render();
      this.#listeners.emit(this.#local.scheme, previous);
      return;
    }
    if (this.#reported === null) {
      this.#wanted = scheme === this.#wanted ? null : scheme;
      this.#render();
      return;
    }
    // A disabled button takes no clicks in a browser; this keeps the rule in
    // the code as well as in the attribute. A stale link may be half-open:
    // a request only goes out on one whose telemetry can confirm it.
    if (this.#stale) return;
    if (scheme === (this.#pending || this.#reported)) return;
    this.#request(scheme);
  }

  // One {"scheme"} frame, pending until reported or CONFIRM_MS. Nothing is
  // marked when there is no socket to send it on.
  #request(scheme) {
    if (!this.#link.send({ scheme })) return;
    clearTimeout(this.#pendingTimer);
    this.#pending = scheme;
    this.#pendingTimer = setTimeout(() => this.#settle(), SchemeToggle.CONFIRM_MS);
    this.#render();
  }

  // A wish is settled once the rover has named a scheme, and only while the
  // toggle shows the rover's: bound to the simulator nothing goes to the
  // rover but Stop (targetswitch.js), so a frame then leaves the wish
  // waiting, unseen, and unbinding settles it (the reviewer's round 1: a
  // wish went to the rover from the simulator target, where nobody saw it).
  // A stale link waits for the next frame, as a press would. A wish for the
  // scheme the rover reports goes nowhere; one for the other is a request.
  #spendWish() {
    const wanted = this.#wanted;
    if (this.#local || wanted === null || this.#reported === null || this.#stale) return;
    this.#wanted = null;
    if (wanted !== this.#reported) this.#request(wanted);
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
  // pending is only ever a mark on the segment asked for or wished for, so
  // a request that never lands cannot look applied. Unknown is no reason to
  // grey anything: both segments take a press, as a wish. Only a stale link
  // offers nothing, its scheme shown dimmed.
  #render() {
    const scheme = this.scheme;
    const known = scheme !== null;
    const stale = !this.#local && this.#stale && known;
    const pending = this.#local ? null : this.#pending;
    const wish = this.#local ? null : this.#wanted;
    this.#group.dataset.state = !known ? "unknown" : stale ? "stale" : pending ? "pending" : "known";
    this.#group.setAttribute("aria-busy", String(pending !== null || wish !== null));
    this.#group.title = this.#local
      ? "The simulator's control scheme. The rover's stays as it is."
      : !known
        ? SchemeToggle.UNKNOWN_TITLE
        : stale
          ? "Telemetry has stopped: the scheme cannot be changed until the rover reports it again."
          : "";
    pressSegment(this.#buttons, scheme);
    for (const [option, button] of this.#buttons) {
      // Its own hint, and what the group says: hovering a segment shows
      // the button's title, not the group's.
      const says = option === wish ? SchemeToggle.WISH_TITLE : this.#group.title;
      button.title = [SchemeToggle.HINTS[option], says].filter(Boolean).join(" ");
      button.disabled = stale;
      if (option === pending || option === wish) button.dataset.pending = "yes";
      else delete button.dataset.pending;
    }
    // The wish in words, as well as in its segment's title, which a touch
    // screen never shows (the reviewer's round 1, on an iPad: a dashed
    // segment that said nothing).
    const label = wish && SchemeToggle.OPTIONS.find((option) => option.scheme === wish).label;
    const note = label ? SchemeToggle.WISH_NOTE[this.#heard ? "heard" : "waiting"](label) : "";
    for (const element of this.#notes) {
      element.textContent = note;
      element.hidden = !note;
    }
  }
}

/**
 * The rover's log, and its graphs (graphs.js), in a drawer of the view's
 * own under the scan's card, opened by Log at the end of the readouts'
 * line: on the rover target only, as the scan is. The drawer takes its
 * height from the scan's card, inside the view, so nothing outside the
 * view moves as it opens (panel.css: the view is size-contained).
 *
 * Each line says when on the rover's clock (its time since boot), whose it
 * is (USB, Pad, WiFi, or the rover's own), and what; a warning is marked,
 * in amber and in words. The newest is at the foot, and the list follows
 * it while it is scrolled to the foot, and stays where it is otherwise.
 * A filter shows one controller's lines, or the rover's, and Warnings the
 * warnings alone. While the drawer is closed, Log counts the warnings that
 * came meanwhile. Clear empties the log (RoverHistory.clearLines: a link
 * that comes back does not bring it back). Save hands over a .jsonl file of
 * every line and sample still held (RoverHistory.jsonl), which ws.py
 * --import reads into its database.
 *
 * Where the drawer is wide enough (rover.css, a container query), the
 * graphs stand beside the lines; narrower, Log | Graphs picks one.
 * Nothing here is a command: none of it takes control or stops anything.
 * Nothing in it is data-keys="own" (keys.js), so Space stops the rover
 * with the focus on any of its buttons, as on the page's others.
 *
 *   new RoverLog({ history, graphs, ui })
 *     history  the RoverHistory;
 *     graphs   the RoverGraphs, in ui.graphs, told when it shows;
 *     ui       the drawer's elements, by name: toggle (Log), badge (its
 *              count), drawer, pane, filter (empty segmented controls,
 *              built here), warnings (a toggle button), clear, save,
 *              lines (an empty <ol>), empty (what an empty list says)
 *              and graphs.
 *
 *   open(on)     open or close the drawer, as Log does.
 *   isOpen       whether it is open.
 *   save()       what Save does: false where the browser cannot save a
 *                file (no Blob or object URL).
 *   static clock(t)  the rover's clock (ms since boot) as a time since
 *                boot: "1:01.2", or "26:01:01" from an hour.
 */
class RoverLog {
  static FILTERS = Object.freeze([
    Object.freeze({ value: "all", word: "All", hint: "Every line, whoever's it is." }),
    Object.freeze({ value: "USB", word: "USB", hint: "The serial console's lines alone: what came over USB." }),
    Object.freeze({ value: "PAD", word: "Pad", hint: "The pad's lines alone." }),
    Object.freeze({ value: "WIFI", word: "WiFi", hint: "WiFi's lines alone: this panel's, and any other WiFi client's." }),
    Object.freeze({ value: "ROVER", word: "Rover", hint: "The rover's own lines alone: boot, checks, sensors, exploring." }),
  ]);
  // Who each line is, as the drawer names them.
  static SOURCES = Object.freeze({ USB: "USB", PAD: "Pad", WIFI: "WiFi", ROVER: "Rover" });
  static PANES = Object.freeze([
    Object.freeze({ value: "lines", word: "Log", hint: "The rover's log." }),
    Object.freeze({ value: "graphs", word: "Graphs", hint: "The rover's loop rate, free heap, WiFi signal, chip temperature and front distance, over the last 10 minutes." }),
  ]);
  static TOGGLE_TITLE = "Log: the rover's log, and graphs of how it runs, under the scan.";
  // How near the foot the list may be scrolled and still follow new lines.
  static FOOT_PX = 8;

  #history;
  #graphs;
  #ui;
  #filter = "all";
  #warningsOnly = false;
  #unseen = 0; // warnings since the drawer was last open
  #filterButtons;
  #paneButtons;

  constructor({ history, graphs, ui }) {
    this.#history = history;
    this.#graphs = graphs;
    this.#ui = ui;

    this.#filterButtons = new Map(RoverLog.FILTERS.map((option) => [
      option.value,
      labelSegment(segment(ui.filter, () => this.#setFilter(option.value)), option),
    ]));
    this.#paneButtons = new Map(RoverLog.PANES.map((option) => [
      option.value,
      labelSegment(segment(ui.pane, () => this.#setPane(option.value)), option),
    ]));
    this.#setPane("lines");
    pressSegment(this.#filterButtons, this.#filter);

    ui.toggle.addEventListener("click", () => this.open(!this.isOpen));
    ui.warnings.addEventListener("click", () => {
      this.#warningsOnly = !this.#warningsOnly;
      this.#refilter();
    });
    ui.clear.addEventListener("click", () => history.clearLines());
    ui.save.addEventListener("click", () => this.save());

    for (const line of history.lines) this.#add(line);
    history.onLine((line) => {
      const follow = this.#atFoot();
      this.#add(line);
      while (ui.lines.children.length > RoverHistory.LINES) ui.lines.children[0].remove();
      if (line.frame.warn === true && !this.isOpen) this.#unseen++;
      this.#refilter();
      if (follow) ui.lines.scrollTop = ui.lines.scrollHeight;
    });
    history.onClear(() => {
      while (ui.lines.children.length) ui.lines.children[0].remove();
      this.#unseen = 0;
      this.#refilter();
    });
    history.onSample(() => this.#sayButtons());
    this.open(false);
  }

  get isOpen() {
    return !this.#ui.drawer.hidden;
  }

  open(on) {
    const ui = this.#ui;
    ui.drawer.hidden = !on;
    ui.toggle.setAttribute("aria-expanded", String(Boolean(on)));
    if (on) {
      this.#unseen = 0;
      ui.lines.scrollTop = ui.lines.scrollHeight;
    }
    this.#graphs.shown(Boolean(on));
    this.#refilter();
  }

  save() {
    if (typeof Blob !== "function" || typeof URL === "undefined" || typeof URL.createObjectURL !== "function") return false;
    const url = URL.createObjectURL(new Blob([this.#history.jsonl()], { type: "application/x-ndjson" }));
    const link = dom.html("a", { href: url, download: RoverLog.fileName(new Date()), hidden: "" }, this.#ui.drawer);
    link.click();
    link.remove();
    // Once the browser has taken the file.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return true;
  }

  static clock(t) {
    const tenths = Math.floor(t / 100);
    const s = Math.floor(tenths / 10);
    const two = (n) => String(n).padStart(2, "0");
    if (s < 3600) return `${Math.floor(s / 60)}:${two(s % 60)}.${tenths % 10}`;
    return `${Math.floor(s / 3600)}:${two(Math.floor(s / 60) % 60)}:${two(s % 60)}`;
  }

  // rover-20261116-140503.jsonl, in the operator's own time.
  static fileName(date) {
    const two = (n) => String(n).padStart(2, "0");
    const day = `${date.getFullYear()}${two(date.getMonth() + 1)}${two(date.getDate())}`;
    return `rover-${day}-${two(date.getHours())}${two(date.getMinutes())}${two(date.getSeconds())}.jsonl`;
  }

  #setFilter(value) {
    this.#filter = value;
    pressSegment(this.#filterButtons, value);
    this.#refilter();
  }

  #setPane(value) {
    this.#ui.drawer.dataset.pane = value;
    pressSegment(this.#paneButtons, value);
  }

  #atFoot() {
    const list = this.#ui.lines;
    if (!(list.scrollHeight > 0)) return true;
    return list.scrollHeight - list.scrollTop - list.clientHeight <= RoverLog.FOOT_PX;
  }

  #add({ at, frame }) {
    const src = typeof frame.src === "string" ? frame.src : "";
    const warn = frame.warn === true;
    const li = dom.html("li", {}, this.#ui.lines);
    li.dataset.src = src;
    if (warn) li.dataset.warn = "yes";
    const t = typeof frame.t === "number" ? RoverLog.clock(frame.t) : "";
    dom.html("span", { class: "logT" }, li, t);
    dom.html("span", { class: "logSrc" }, li, RoverLog.SOURCES[src] || src || "?");
    const text = dom.html("span", { class: "logText" }, li);
    if (warn) dom.html("strong", { class: "logWarn" }, text, "Warning");
    dom.html("span", {}, text, frame.log);
    const when = new Date(at);
    li.title = `${warn ? "Warning" : "Line"} from ${RoverLog.SOURCES[src] || "the rover"}, ${t} after the rover booted, received at ${when.toLocaleTimeString()}.`;
  }

  #shows(li) {
    if (this.#warningsOnly && li.dataset.warn !== "yes") return false;
    return this.#filter === "all" || li.dataset.src === this.#filter;
  }

  #refilter() {
    const ui = this.#ui;
    let shown = 0;
    for (const li of ui.lines.children) {
      li.hidden = !this.#shows(li);
      if (!li.hidden) shown++;
    }
    const total = ui.lines.children.length;
    const whose = this.#filter === "all" ? "" : ` from ${RoverLog.SOURCES[this.#filter]}`;
    ui.empty.hidden = shown > 0;
    ui.empty.textContent = total === 0
      ? "Nothing yet: the rover's log comes over the link, every line it still holds as it connects."
      : `No ${this.#warningsOnly ? "warnings" : "lines"}${whose} among the last ${total}.`;
    ui.warnings.setAttribute("aria-pressed", String(this.#warningsOnly));
    ui.warnings.title = this.#warningsOnly ? "Warnings: showing the warnings alone. Press to show every line." : "Warnings: show the warnings alone.";
    this.#sayButtons();
  }

  #sayButtons() {
    const ui = this.#ui;
    const lines = ui.lines.children.length;
    ui.clear.disabled = lines === 0;
    ui.clear.title = lines ? `Clear: empty the log here (${lines} line${lines === 1 ? "" : "s"}). The rover keeps its own.` : "Clear: the log here is empty.";
    const empty = lines === 0 && this.#history.telemetry.length === 0 && this.#history.metrics.length === 0;
    ui.save.disabled = empty;
    ui.save.title = empty
      ? "Save: nothing to save yet."
      : "Save: download the log's lines and the last 10 minutes of samples as a .jsonl file, which client/ws.py --import reads.";
    const unseen = this.#unseen;
    ui.badge.hidden = unseen === 0;
    ui.badge.textContent = unseen ? String(unseen) : "";
    ui.toggle.title = (this.isOpen ? "Log: close the rover's log and graphs." : RoverLog.TOGGLE_TITLE) +
      (unseen ? ` ${unseen} new warning${unseen === 1 ? "" : "s"}.` : "");
  }
}

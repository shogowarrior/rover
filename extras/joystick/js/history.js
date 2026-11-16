/**
 * What the rover has said lately, kept in memory for the log and the graphs
 * (roverlog.js, graphs.js) and for Save: the lines of its log, its
 * telemetry sampled at most once a SAMPLE_MS, every metrics frame and every
 * settings frame, each with the time it arrived. Nothing is kept anywhere
 * else: a page that closes takes it with it.
 *
 * The log keeps its last LINES lines. The rover sends every line it still
 * holds to a client as it connects, so a link that comes back would show
 * each again: a line whose "seq" has been seen is dropped (the rover
 * numbers its lines from a random start each boot, so two boots' lines do
 * not collide). Clear empties the log but remembers what it held, so the
 * next connection does not bring it back. The samples keep WINDOW_MS:
 * older ones go as new ones come, but for the last settings frame.
 *
 *   new RoverHistory({ clock })
 *     clock  fn() the time now in ms since 1970: Date.now by default.
 *
 *   addLine(frame)       a line of the rover's log (Link.onLog): false when
 *                        it was a line seen already.
 *   addTelemetry(frame)  a telemetry frame (Link.onTelemetry): kept as a
 *                        sample when SAMPLE_MS have passed since the last.
 *   addMetrics(frame)    a metrics frame (Link.onMetrics): always kept.
 *   addSettings(frame)   a settings frame (Link.onSettings): kept for Save.
 *   clearLines()         empty the log.
 *   lines                the log's lines, oldest first: { at, frame }.
 *   telemetry, metrics   the samples, oldest first: { at, frame }.
 *   jsonl()              every line and sample, by when it arrived, one
 *                        {"at": <ms since 1970>, "frame": <as received>}
 *                        a line: what client/recorder.py's import_lines()
 *                        reads, and so ws.py --import.
 *   onLine(fn)           fn({ at, frame }) for each new line.
 *   onSample(fn)         fn(kind, { at, frame }) for each new sample, kind
 *                        "telemetry" or "metrics".
 *   onClear(fn)          fn() as the log is emptied.
 */
class RoverHistory {
  static LINES = 500;
  static WINDOW_MS = 10 * 60 * 1000;
  static SAMPLE_MS = 1000;
  // How many lines' seq are remembered, the log's and those cleared from
  // it: more than a boot's worth the rover can hold and resend.
  static SEEN = 4 * RoverHistory.LINES;

  #clock;
  #lines = [];
  #samples = { telemetry: [], metrics: [], settings: [] };
  #seen = new Set();
  #lineListeners = new Listeners();
  #sampleListeners = new Listeners();
  #clearListeners = new Listeners();

  constructor({ clock = () => Date.now() } = {}) {
    this.#clock = clock;
  }

  get lines() {
    return [...this.#lines];
  }

  get telemetry() {
    return [...this.#samples.telemetry];
  }

  get metrics() {
    return [...this.#samples.metrics];
  }

  onLine(fn) {
    return this.#lineListeners.add(fn);
  }

  onSample(fn) {
    return this.#sampleListeners.add(fn);
  }

  onClear(fn) {
    return this.#clearListeners.add(fn);
  }

  addLine(frame) {
    const seq = frame.seq;
    if (typeof seq === "number") {
      if (this.#seen.has(seq)) return false;
      this.#seen.add(seq);
      // A Set iterates in the order its keys went in: the oldest first.
      if (this.#seen.size > RoverHistory.SEEN) this.#seen.delete(this.#seen.values().next().value);
    }
    const line = { at: this.#clock(), frame };
    this.#lines.push(line);
    if (this.#lines.length > RoverHistory.LINES) this.#lines.shift();
    this.#lineListeners.emit(line);
    return true;
  }

  addTelemetry(frame) {
    const kept = this.#samples.telemetry;
    const now = this.#clock();
    const last = kept[kept.length - 1];
    if (last && now - last.at < RoverHistory.SAMPLE_MS && now >= last.at) return false;
    this.#keep("telemetry", { at: now, frame });
    return true;
  }

  addMetrics(frame) {
    this.#keep("metrics", { at: this.#clock(), frame });
  }

  addSettings(frame) {
    this.#keep("settings", { at: this.#clock(), frame });
  }

  clearLines() {
    this.#lines = [];
    this.#clearListeners.emit();
  }

  jsonl() {
    const all = [...this.#lines, ...this.#samples.telemetry, ...this.#samples.metrics, ...this.#samples.settings];
    all.sort((a, b) => a.at - b.at);
    return all.map(({ at, frame }) => {
      const entry = { at, frame };
      return `${JSON.stringify(entry)}\n`;
    }).join("");
  }

  #keep(kind, sample) {
    const kept = this.#samples[kind];
    kept.push(sample);
    // The settings in force are kept whatever their age: the last frame
    // says them.
    const since = sample.at - RoverHistory.WINDOW_MS;
    const least = kind === "settings" ? 1 : 0;
    while (kept.length > least && kept[0].at < since) kept.shift();
    if (kind !== "settings") this.#sampleListeners.emit(kind, sample);
  }
}

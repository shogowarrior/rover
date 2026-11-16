/**
 * The rover's graphs, beside its log (roverlog.js): the loop's rate, the
 * free heap and the WiFi signal from its metrics, and the chip's
 * temperature and the front distance from telemetry, each over the last
 * RoverHistory.WINDOW_MS (10 minutes), from what RoverHistory keeps. One
 * small chart a row: the series' name, its latest value, its range over
 * the window, and its line, in inline SVG on the look's tokens, so a look
 * picked restyles it with no redraw. No library.
 *
 * A line breaks where no sample came for a while (the link down, or quiet)
 * and where the front reading heard no echo (999 is not a distance), so
 * a gap never reads as a slope. Each chart is drawn to the window's width
 * whatever the box's (preserveAspectRatio none, the stroke kept to its
 * width by vector-effect), and redrawn as a sample arrives, while the
 * graphs show: hidden, nothing is drawn.
 *
 *   new RoverGraphs({ history, box, clock })
 *     history  the RoverHistory;
 *     box      the empty element the charts are built in;
 *     clock    fn() the time now in ms since 1970: Date.now by default.
 *
 *   shown(on)  whether the graphs are on screen: they draw as they show.
 *   draw()     draw every chart from what history holds now.
 */
class RoverGraphs {
  static W = 600;
  static H = 48;
  // A line breaks where samples are further apart than this many of their
  // intervals.
  static GAP = 3.5;

  static SERIES = Object.freeze([
    Object.freeze({
      key: "loopHz", from: "metrics", every: 2000, name: "Loop", about: "The rover's loop rate", unit: "Hz",
      read: (m) => m.loopHz, say: (v) => `${Math.round(v)} Hz`,
    }),
    Object.freeze({
      key: "heap", from: "metrics", every: 2000, name: "Free heap", about: "The rover's free heap", unit: "KB",
      read: (m) => m.heap / 1024, say: (v) => `${Math.round(v)} KB`,
    }),
    Object.freeze({
      key: "rssi", from: "metrics", every: 2000, name: "WiFi", about: "The rover's WiFi signal", unit: "dBm",
      read: (m) => m.rssi, say: (v) => `${Math.round(v)} dBm`,
    }),
    Object.freeze({
      key: "temperature", from: "telemetry", every: 1000, name: "Chip", about: "The ESP32 chip's temperature", unit: "°C",
      read: (t) => t.temperature, say: (v) => `${v.toFixed(1)}°C`,
    }),
    Object.freeze({
      key: "distanceFront", from: "telemetry", every: 1000, name: "Front", about: "The front distance", unit: "cm",
      read: (t) => (t.distanceFront >= FAR_CM ? null : t.distanceFront), say: (v) => `${Math.round(v)} cm`,
    }),
  ]);

  #history;
  #clock;
  #charts = []; // per series: { series, figure, now, range, svg, line }
  #visible = false;

  constructor({ history, box, clock = () => Date.now() }) {
    this.#history = history;
    this.#clock = clock;
    const { W, H } = RoverGraphs;
    for (const series of RoverGraphs.SERIES) {
      const figure = dom.html("figure", { class: "graph", "data-key": series.key }, box);
      const caption = dom.html("figcaption", {}, figure);
      dom.html("span", { class: "graphName" }, caption, series.name);
      const now = dom.html("output", { class: "graphNow" }, caption, "—");
      const range = dom.html("span", { class: "graphRange" }, caption, "");
      const svg = dom.svg("svg", { class: "graphPlot", viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: "none", role: "img" }, figure);
      dom.svg("path", { class: "graphMid", d: `M0 ${H / 2}H${W}`, "vector-effect": "non-scaling-stroke" }, svg);
      const line = dom.svg("path", { class: "graphLine", d: "", "vector-effect": "non-scaling-stroke" }, svg);
      this.#charts.push({ series, figure, now, range, svg, line });
    }
    history.onSample(() => {
      if (this.#visible) this.draw();
    });
    this.draw();
  }

  shown(on) {
    this.#visible = Boolean(on);
    if (this.#visible) this.draw();
  }

  draw() {
    const end = this.#clock();
    const start = end - RoverHistory.WINDOW_MS;
    for (const chart of this.#charts) this.#drawChart(chart, start, end);
  }

  #drawChart({ series, figure, now, range, svg, line }, start, end) {
    const { W, H, GAP } = RoverGraphs;
    const samples = (series.from === "metrics" ? this.#history.metrics : this.#history.telemetry)
      .filter((sample) => sample.at >= start)
      .map(({ at, frame }) => {
        const inner = series.from === "metrics" ? frame.metrics : frame;
        const value = inner ? series.read(inner) : null;
        return { at, value: typeof value === "number" && Number.isFinite(value) ? value : null };
      });
    const values = samples.filter((s) => s.value !== null).map((s) => s.value);
    const latest = samples.length ? samples[samples.length - 1].value : null;
    now.textContent = latest === null ? "—" : series.say(latest);
    if (!values.length) {
      line.setAttribute("d", "");
      range.textContent = "";
      const why = samples.length ? `${series.about}: no reading in the last 10 minutes.` : `${series.about}: nothing received in the last 10 minutes.`;
      figure.title = why;
      svg.setAttribute("aria-label", why);
      return;
    }
    const lo = Math.min(...values);
    const hi = Math.max(...values);
    // A flat line in the middle, rather than along an edge.
    const pad = hi > lo ? (hi - lo) * 0.12 : 1;
    const bottom = lo - pad;
    const top = hi + pad;
    const x = (at) => ((at - start) / (end - start)) * W;
    const y = (v) => H - ((v - bottom) / (top - bottom)) * H;
    let d = "";
    let previous = null;
    for (const sample of samples) {
      if (sample.value === null) {
        previous = null;
        continue;
      }
      const px = x(sample.at).toFixed(1);
      const py = y(sample.value).toFixed(1);
      const joined = previous && sample.at - previous.at <= GAP * series.every;
      // A point alone is drawn as a dot: a line of no length, its caps round.
      d += joined ? `L${px} ${py}` : `M${px} ${py}l0.01 0`;
      previous = sample;
    }
    line.setAttribute("d", d);
    range.textContent = hi > lo ? `${series.say(lo)} to ${series.say(hi)}` : "";
    const said = hi > lo
      ? `${series.about} over the last 10 minutes: from ${series.say(lo)} to ${series.say(hi)}, ${latest === null ? "no reading" : series.say(latest)} last.`
      : `${series.about} over the last 10 minutes: ${series.say(hi)} throughout.`;
    figure.title = said;
    svg.setAttribute("aria-label", said);
  }
}

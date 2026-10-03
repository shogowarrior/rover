/**
 * The Program tab: its toolbar, the block editor's place, the simulator's
 * place, and the console under them. It compiles the editor's program and
 * hands it to a ProgramRunner, on the target the switch picks, and shows what
 * the runner says.
 *
 *   new ProgramTab({ runner, targets, examples, ui, storageKey })
 *     runner      a ProgramRunner (program.js).
 *     targets     the registry, {kind: Target}: "rover" always, "simulator"
 *                 when the simulator's scripts loaded. refresh() re-reads it.
 *     examples    [{id, name, state}] for the Examples menu (blocks.js).
 *     ui          the tab's elements, by name: targetChoice, run, runLabel,
 *                 stop, examples, exportButton, importButton, importFile,
 *                 clear, stage, hint, offline, simPane, simToggle, state,
 *                 log; and ask, the <dialog> Run asks in, with its askText,
 *                 askRun and askCancel.
 *     storageKey  where the chosen target is remembered.
 *
 *   attachEditor(editor)    the block editor is ready (a BlockEditor).
 *   editorUnavailable(why)  there will be no editor: say why in its place and
 *                           keep Run off. Driving does not need it.
 *   refresh()               re-check whether the chosen target is ready (the
 *                           link changed), and re-read the registry.
 *   shown()                 the tab has just been shown: fit the editor to it.
 *   setScheme(scheme)       the rover's control scheme, as telemetry reports
 *                           it (SchemeToggle), or null while unknown.
 *   note(text, tone)        add a line to the console, for what the runner
 *                           does not say itself (app.js: the simulator's
 *                           word). tone as the runner's log lines, or "bump".
 *   kind                    the chosen target's kind.
 *   onTargetChange(fn)      fn(kind, previous) when the operator switches.
 *
 * Run on the rover asks first when the editor holds more than one stack of
 * blocks, and when the program drives a pivot while the rover is not on the
 * ADVANCED scheme. A preview never asks: it sends nothing. It asks in the
 * page, in ui.ask, and never with window.confirm(): desktop Chrome gives its
 * own dialog the focus and sends the window a blur once it has closed, by
 * when the run had started, so the blur stood it down (app.js) and every
 * run the operator confirmed stopped at once.
 *
 * The tab's Stop only asks the runner to abort; app.js wires it, with every
 * other way a program is stopped. Nothing here sends to the rover: a program
 * reaches it only through the runner and the rover's Target.
 */
class ProgramTab {
  static LABELS = Object.freeze({ rover: "Rover", simulator: "Simulator" });
  static RUN_LABELS = Object.freeze({ rover: "Run on rover", simulator: "Preview" });
  static EMPTY = "Nothing to run yet: drag blocks in, or load an example.";
  static LOG_LINES = 200;

  #runner;
  #targets;
  #examples;
  #ui;
  #storageKey;
  #editor = null;
  #editorWhy = "Loading the block editor…";
  #kind = "rover";
  #kinds = ""; // the registry's kinds as last rendered
  #segments = new Map(); // kind -> its button
  #outcome = null; // how the last run ended: {tone, text}, until something changes
  #scheme = null; // the rover's control scheme, as last reported, or null
  #targetListeners = new Listeners();

  constructor({ runner, targets, examples, ui, storageKey }) {
    this.#runner = runner;
    this.#targets = targets;
    this.#examples = examples;
    this.#ui = ui;
    this.#storageKey = storageKey;

    const remembered = memory.recall(storageKey);
    if (remembered && remembered in targets) this.#kind = remembered;
    // On a phone, where the simulator's view sits under the editor, it starts
    // folded away unless a preview is what the operator last chose.
    this.#expandSim(this.#kind === "simulator");

    ui.run.addEventListener("click", () => this.#run().catch(reportFault));
    ui.askRun.addEventListener("click", () => ui.ask.close("run"));
    ui.askCancel.addEventListener("click", () => ui.ask.close("cancel"));
    ui.examples.addEventListener("change", () => this.#loadExample());
    ui.exportButton.addEventListener("click", () => this.#export());
    ui.importButton.addEventListener("click", () => ui.importFile.click());
    ui.importFile.addEventListener("change", () => this.#import());
    ui.clear.addEventListener("click", () => this.#clear());
    ui.simToggle.addEventListener("click", () => this.#expandSim(ui.simToggle.getAttribute("aria-expanded") !== "true"));

    for (const example of examples) dom.html("option", { value: example.id }, ui.examples, example.name);

    runner.onState((state, detail) => this.#onRunnerState(state, detail));
    runner.onLog((entry) => this.#appendLog(entry));
    runner.onHighlight((id) => {
      if (this.#editor) this.#editor.highlight(id);
    });

    this.refresh();
  }

  get kind() {
    return this.#kind;
  }

  onTargetChange(fn) {
    return this.#targetListeners.add(fn);
  }

  attachEditor(editor) {
    this.#editor = editor;
    this.#editorWhy = "";
    this.#ui.offline.hidden = true;
    editor.onChange(() => this.#update());
    this.#update();
  }

  editorUnavailable(why) {
    this.#editor = null;
    this.#editorWhy = why;
    this.#ui.offline.hidden = false;
    this.#update();
  }

  refresh() {
    this.#renderTargets();
    this.#update();
  }

  shown() {
    if (this.#editor) this.#editor.resize();
  }

  setScheme(scheme) {
    this.#scheme = scheme;
  }

  note(text, tone = "info") {
    this.#appendLog({ text, tone });
  }

  /* --- the target switch ------------------------------------------------- */

  // One segment per registered target. With only the rover there is nothing
  // to switch, and no simulator to show.
  #renderTargets() {
    const kinds = Object.keys(this.#targets);
    if (kinds.join() === this.#kinds) return;
    this.#kinds = kinds.join();
    if (!kinds.includes(this.#kind)) this.#kind = kinds[0];

    const { targetChoice, simPane, stage } = this.#ui;
    for (const button of this.#segments.values()) button.remove();
    this.#segments.clear();
    for (const kind of kinds) {
      const button = segment(targetChoice, () => this.#choose(kind));
      button.textContent = ProgramTab.LABELS[kind] || kind;
      this.#segments.set(kind, button);
    }
    targetChoice.hidden = kinds.length < 2;

    const simulator = "simulator" in this.#targets;
    simPane.hidden = !simulator;
    stage.dataset.sim = simulator ? "yes" : "no";
  }

  #choose(kind) {
    const previous = this.#kind;
    if (kind === previous) return;
    this.#kind = kind;
    memory.remember(this.#storageKey, kind);
    this.#outcome = null;
    // On a phone the view is folded away; previewing is when it is wanted.
    if (kind === "simulator") this.#expandSim(true);
    this.#update();
    this.#targetListeners.emit(kind, previous);
  }

  #expandSim(open) {
    this.#ui.simToggle.setAttribute("aria-expanded", String(open));
    this.#ui.simPane.dataset.collapsed = open ? "no" : "yes";
  }

  /* --- running ----------------------------------------------------------- */

  async #run() {
    if (!this.#canRun()) return;
    const editor = this.#editor;
    const target = this.#targets[this.#kind];
    // Run runs every stack on the canvas, top to bottom, as Blockly does: a
    // drive dragged out to look at and left lying there would drive the real
    // rover after the program. A preview only shows it.
    const stacks = editor.stacks;
    if (target.kind === "rover" && stacks > 1 &&
        !(await this.#ask(`The editor holds ${stacks} separate stacks of blocks. Run runs every one, top to bottom, ` +
          `so a block left lying loose drives the rover too. Run all ${stacks} on the rover?`))) return;
    // The NORMAL scheme keeps the pivots (codes 9 to 16) off the stick and the
    // pad, because nobody has watched one on the bench yet (docs/mecanum.md);
    // a program could drive all eight without a word, the Mecanum tour
    // example among them. Under ADVANCED the operator has already chosen
    // them, so it does not ask again.
    const pivots = target.kind === "rover" && this.#scheme !== SCHEME_ADVANCED ? editor.pivots : [];
    if (pivots.length > 0 && !(await this.#ask(ProgramTab.#pivotQuestion(pivots, this.#scheme)))) return;
    // The page lived on while it asked: it runs only if Run still could, on
    // the target the answer was for. (A link lost meanwhile is the runner's
    // to refuse, below.)
    if (!this.#canRun() || this.#targets[this.#kind] !== target) return;
    let program;
    try {
      program = editor.compile();
    } catch (err) {
      this.#outcome = { tone: "failed", text: `Cannot run: ${err.message}` };
      this.#appendLog({ text: this.#outcome.text, tone: "failed" });
      if (err.blockId) editor.select(err.blockId);
      this.#update();
      return;
    }
    // Refused only if the target stopped being ready since Run was enabled;
    // the strip already says why, from the target itself.
    this.#runner.run(program, target).then((end) => {
      if (end.outcome === "refused") this.#appendLog({ text: `Not run: ${end.reason}`, tone: "failed" });
    });
  }

  // Whether Run can start anything: a program in the editor, nothing
  // running, and no question already waiting for its answer.
  #canRun() {
    const editor = this.#editor;
    return Boolean(editor) && !editor.empty && this.#runner.state === "idle" && !this.#ui.ask.open;
  }

  // Ask in ui.ask, the page's <dialog>. True only for Run on rover: Cancel,
  // Escape or anything else that closes it is a no. Escape closes it with
  // no value, which would leave the last answer standing, so that is
  // cleared first.
  #ask(question) {
    const { ask, askText } = this.#ui;
    askText.textContent = question;
    ask.returnValue = "";
    return new Promise((resolve) => {
      const answered = () => {
        ask.removeEventListener("close", answered);
        resolve(ask.returnValue === "run");
      };
      ask.addEventListener("close", answered);
      ask.showModal();
    });
  }

  static #pivotQuestion(pivots, scheme) {
    const which = pivots.length === 1 ? `a pivot (${pivots[0]})` : `${pivots.length} pivots (${pivots.join("; ")})`;
    const where = scheme === SCHEME_NORMAL
      ? "The rover is on the NORMAL scheme, which keeps them off the stick and the pad."
      : "The rover has not said which control scheme it is on.";
    return `This program drives ${which}, which nobody has checked on the bench yet: ` +
      `a pivot may not go the way its name says (docs/mecanum.md). ${where} ` +
      "Run it on the rover anyway, with the wheels off the ground or Stop in reach?";
  }

  #onRunnerState(state, { kind, outcome, reason }) {
    if (state === "idle" && outcome) {
      this.#outcome = {
        done: { tone: "done", text: `Done on the ${kind}.` },
        stopped: { tone: "stopped", text: `Stopped: ${reason}` },
        failed: { tone: "failed", text: `Error: ${reason}` },
      }[outcome];
    } else {
      this.#outcome = null;
    }
    if (this.#editor) this.#editor.setReadOnly(state !== "idle");
    this.#update();
  }

  /* --- the editor's file tools ------------------------------------------- */

  #loadExample() {
    const select = this.#ui.examples;
    const example = this.#examples.find((e) => e.id === select.value);
    select.value = "";
    if (!example || !this.#editor) return;
    if (!this.#editor.empty && !confirm(`Replace the program in the editor with the "${example.name}" example?`)) return;
    try {
      this.#editor.load(example.state);
      this.#appendLog({ text: `Loaded the "${example.name}" example.`, tone: "info" });
    } catch (err) {
      this.#appendLog({ text: err.message, tone: "failed" });
    }
  }

  #export() {
    if (!this.#editor) return;
    const text = JSON.stringify(this.#editor.save(), null, 2);
    const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "rover-program.json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    // After the download has had its turn to start.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // Read a file the operator picked and load it, keeping the current program
  // if it is not one.
  async #import() {
    const input = this.#ui.importFile;
    const file = input.files && input.files[0];
    input.value = ""; // so the same file can be picked again
    if (!file || !this.#editor) return;
    try {
      if (file.size > 2 * 1024 * 1024) throw new Error("This file is too big to be a rover program.");
      let state;
      try {
        state = JSON.parse(await file.text());
      } catch {
        throw new Error("This file is not JSON, so not a rover program.");
      }
      if (!this.#editor.empty && !confirm(`Replace the program in the editor with ${file.name}?`)) return;
      this.#editor.load(state);
      this.#appendLog({ text: `Imported ${file.name}.`, tone: "info" });
    } catch (err) {
      this.#appendLog({ text: `Kept the program you had. ${err.message}`, tone: "failed" });
    }
  }

  #clear() {
    if (!this.#editor || this.#editor.empty) return;
    if (!confirm("Remove every block? Undo (Ctrl+Z) brings them back.")) return;
    this.#editor.clear();
  }

  /* --- what the tab shows ------------------------------------------------ */

  #update() {
    const ui = this.#ui;
    const kind = this.#kind;
    const target = this.#targets[kind];
    const state = this.#runner.state;
    const idle = state === "idle";
    const editor = this.#editor;
    const readiness = target.ready();

    pressSegment(this.#segments, kind);

    const empty = Boolean(editor && editor.empty);
    ui.runLabel.textContent = ProgramTab.RUN_LABELS[kind] || `Run on ${kind}`;
    ui.run.disabled = !editor || empty || !idle || !readiness.ok;
    ui.run.title = !editor ? this.#editorWhy : !readiness.ok ? readiness.why : empty ? ProgramTab.EMPTY : "";
    ui.stop.disabled = state !== "running";
    ui.examples.disabled = !editor || !idle;
    ui.importButton.disabled = !editor || !idle;
    ui.clear.disabled = !editor || !idle;
    ui.exportButton.disabled = !editor;
    ui.hint.hidden = !editor || !editor.empty;

    const running = this.#runner.target ? this.#runner.target.kind : kind;
    let status;
    if (state === "running") status = { tone: "running", text: running === "simulator" ? "Previewing on the simulator…" : `Running on the ${running}…` };
    else if (state === "stopping") status = { tone: "stopping", text: "Stopping…" };
    else if (this.#outcome) status = this.#outcome;
    else if (!editor) status = { tone: "idle", text: this.#editorWhy };
    else if (!readiness.ok) status = { tone: "idle", text: readiness.why };
    else if (empty) status = { tone: "idle", text: ProgramTab.EMPTY };
    else status = { tone: "ready", text: kind === "simulator" ? "Ready to preview on the simulator." : `Ready to run on the ${kind}.` };
    ui.state.textContent = status.text;
    ui.state.dataset.tone = status.tone;
  }

  #appendLog({ text, tone }) {
    const log = this.#ui.log;
    const line = document.createElement("li");
    line.textContent = text;
    line.dataset.tone = tone;
    log.appendChild(line);
    while (log.children.length > ProgramTab.LOG_LINES) log.children[0].remove();
    log.scrollTop = log.scrollHeight;
  }
}

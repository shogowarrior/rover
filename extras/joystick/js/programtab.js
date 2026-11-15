/**
 * The Program tab: its toolbar, the block editor's place, and the console
 * under it; and whether the page's view pane (the scan, or the simulated
 * room) shows beside it. It compiles the editor's program and hands it to a
 * ProgramRunner, on the target the switch picks, and shows what the runner
 * says.
 *
 *   new ProgramTab({ runner, targetSwitch, examples, ask, showView, ui })
 *     runner        a ProgramRunner (program.js).
 *     targetSwitch  the TargetSwitch that picks the target (targetswitch.js).
 *     examples      [{id, name, state}] for the File menu (blocks.js).
 *     ask           the page's AskDialog (ask.js), for every question here.
 *     showView      whether the page has room for the view pane beside the
 *                   tab (a wide screen): there it shows at first, and again
 *                   once the target is switched to the simulator. A phone
 *                   has no room for both: there the view starts folded on
 *                   either target and stays as the View toggle leaves it,
 *                   until Preview is pressed: a preview with the view
 *                   folded showed nothing moving (the review's phones 1),
 *                   so Preview shows it, on every layout, and it stays
 *                   shown for the operator to see where the preview ended.
 *     ui            the tab's elements, by name: tab (the tab itself, whose
 *                   data-view, "shown" or "hidden", the page's CSS keys on),
 *                   run, runLabel (Run's word) and runShort (its short word,
 *                   where the toolbar is narrow), stop, the File menu's
 *                   button and list (menu, menuList), examples (the group
 *                   its examples go in), exportButton, importButton,
 *                   importFile, clear, workspace (the block editor's box),
 *                   hint, offline, viewToggle (the toolbar's View toggle),
 *                   state, log, and logToggle and logCount (a phone's Log,
 *                   which shows or hides the log under the state line).
 *                   runShort, logToggle and logCount may be left out.
 *
 *   attachEditor(editor)    the block editor is ready (a BlockEditor).
 *   editorUnavailable(why)  there will be no editor: say why in its place and
 *                           keep Run off. Driving does not need it.
 *   refresh()               re-check whether the chosen target is ready (the
 *                           link changed).
 *   shown()                 the tab has just been shown: fit the editor to it.
 *                           Within the tab the editor refits itself as its
 *                           box changes size.
 *   restyle()               the page's look has changed: the editor takes it.
 *                           An editor not yet built is built in it.
 *   setScheme(scheme)       the control scheme the toggle shows (SchemeToggle):
 *                           the rover's on the rover target, the
 *                           simulator's on the simulator target, or null
 *                           while unknown. Under NORMAL the editor marks
 *                           each pivot before Run is pressed.
 *   note(text, tone)        add a line to the console, for what the runner
 *                           does not say itself (app.js: the simulator's
 *                           word). tone as the runner's log lines, or "bump".
 *
 * Run on the rover asks first when the editor holds more than one stack of
 * blocks, and when the program drives a pivot while the rover is not on the
 * ADVANCED scheme. A preview never asks: it sends nothing. Loading an
 * example or a file over a program, and Clear, ask too. Every question is
 * the AskDialog's, never window.confirm() (ask.js says why).
 *
 * The File menu holds what is used now and then and moves nothing: the
 * examples, Import, Export and Clear. Run and Stop program stay on the
 * toolbar, one press each, and the switch is in the page's header, for both
 * tabs (app.js).
 *
 * The tab's Stop only asks the runner to abort; app.js wires it, with every
 * other way a program is stopped. It is the operator ending their own
 * program (ProgramRunner's own stop), so the console says a plain
 * "Stopped.", where a stop the panel imposed (a lost link, a drive press,
 * the top's Stop) says why, in amber (the review's phones 25).
 * Nothing here sends to the rover: a program reaches it only through the
 * runner and the rover's Target.
 */
class ProgramTab {
  static RUN_LABELS = Object.freeze({ rover: "Run on rover", simulator: "Preview" });
  // Where the toolbar is narrow (program.css): Run gives way, never Stop
  // program, which alone read "Stop" beside the top's red Stop (the
  // review's phones 6). Run's title names the target either way.
  static RUN_SHORT = Object.freeze({ rover: "Run", simulator: "Preview" });
  // An empty editor: the console's line says only that, the reason Run is
  // off; the advice is the editor's own placeholder, said once (the
  // critic's round 2: the same advice three times). Run's title says both.
  static EMPTY = "No blocks yet.";
  static EMPTY_TITLE = "Nothing to run yet: drag blocks in from the toolbox, or load an example from the File menu.";
  static LOG_LINES = 200;
  // What the File menu's items do, and why one cannot now (F3f: disabled,
  // with a title that says why).
  static TITLES = Object.freeze({
    menu: "The examples, Import, Export and Clear",
    example: "Load this example into the editor",
    run: { rover: "Run the program on the rover", simulator: "Preview the program on the simulator" },
    running: "A program is running: Stop program ends it",
    view: {
      shown: "View: hide the scan, or the simulated room, and give the editor its room",
      hidden: "View: show the scan, or the simulated room, beside the editor",
    },
    import: "Open a program saved with Export",
    export: "Save the program as rover-program.json",
    nothingToExport: "Nothing to export: the editor has no blocks yet",
    clear: "Remove every block",
    busy: "Stop the program first",
    nothingToClear: "Nothing to clear",
    log: { open: "Hide the program's log", closed: "Show the program's log: what the program and the runner said" },
  });

  #runner;
  #targetSwitch;
  #ask;
  #ui;
  #exampleItems = []; // the File menu's example buttons
  #editor = null;
  #editorWhy = "Loading the block editor…";
  #outcome = null; // how the last run ended: {tone, text}, until something changes
  #scheme = null; // the scheme the toggle shows: the rover's on the rover target

  constructor({ runner, targetSwitch, examples, ask, showView = true, ui }) {
    this.#runner = runner;
    this.#targetSwitch = targetSwitch;
    this.#ask = ask;
    this.#ui = ui;

    // The view pane beside the editor, where the page says there is room.
    // On a phone it squeezed the editor to a strip on the simulator target
    // (the critic's round 1): folded there, the toggle's to open.
    this.#showView(showView);
    targetSwitch.onChange((kind) => {
      this.#outcome = null;
      // Previewing is when the view is wanted: show it, where it fits.
      if (kind === "simulator" && showView) this.#showView(true);
      this.#update();
    });

    new Popover(ui.menu, ui.menuList, { menu: true });
    for (const example of examples) {
      const item = dom.html("button", { type: "button", role: "menuitem" }, ui.examples, example.name);
      item.addEventListener("click", () => this.#loadExample(example).catch(reportFault));
      this.#exampleItems.push(item);
    }

    ui.run.addEventListener("click", () => this.#run().catch(reportFault));
    ui.exportButton.addEventListener("click", () => this.#export());
    // The file picker opens only from the press itself (user activation),
    // so from here, not after anything asynchronous.
    ui.importButton.addEventListener("click", () => ui.importFile.click());
    ui.importFile.addEventListener("change", () => this.#import().catch(reportFault));
    ui.clear.addEventListener("click", () => this.#clear().catch(reportFault));
    ui.viewToggle.addEventListener("click", () => this.#showView(ui.viewToggle.getAttribute("aria-pressed") !== "true"));
    if (ui.logToggle) {
      ui.logToggle.addEventListener("click", () => this.#openLog(ui.logToggle.getAttribute("aria-expanded") !== "true"));
      this.#openLog(false);
    }
    // Blockly refits itself only to a window's resize. Its box also changes
    // as the view pane shows or hides, or as the console under it grows.
    if (typeof ResizeObserver === "function") {
      new ResizeObserver(() => {
        if (this.#editor) this.#editor.resize();
      }).observe(ui.workspace);
    }

    runner.onState((state, detail) => this.#onRunnerState(state, detail));
    runner.onLog((entry) => this.#appendLog(entry));
    runner.onHighlight((id) => {
      if (this.#editor) this.#editor.highlight(id);
    });

    this.#update();
  }

  attachEditor(editor) {
    this.#editor = editor;
    this.#editorWhy = "";
    this.#ui.offline.hidden = true;
    editor.setScheme(this.#scheme);
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
    this.#update();
  }

  shown() {
    if (this.#editor) this.#editor.resize();
  }

  restyle() {
    if (this.#editor) this.#editor.restyle();
  }

  setScheme(scheme) {
    this.#scheme = scheme;
    if (this.#editor) this.#editor.setScheme(scheme);
  }

  note(text, tone = "info") {
    this.#appendLog({ text, tone });
  }

  #showView(shown) {
    const { tab, viewToggle } = this.#ui;
    viewToggle.setAttribute("aria-pressed", String(shown));
    viewToggle.title = ProgramTab.TITLES.view[shown ? "shown" : "hidden"];
    tab.dataset.view = shown ? "shown" : "hidden";
  }

  // A phone's log, under the state line, or out of sight (program.css keys
  // on the log's data-open). The Log button shows only once there is one.
  #openLog(open) {
    const { logToggle, log } = this.#ui;
    logToggle.setAttribute("aria-expanded", String(open));
    logToggle.title = ProgramTab.TITLES.log[open ? "open" : "closed"];
    log.dataset.open = open ? "yes" : "no";
  }

  /* --- running ----------------------------------------------------------- */

  async #run() {
    if (!this.#canRun()) return;
    const editor = this.#editor;
    const target = this.#targetSwitch.target;
    // Run runs every stack on the canvas, top to bottom, as Blockly does: a
    // drive dragged out to look at and left lying there would drive the real
    // rover after the program. A preview only shows it.
    const stacks = editor.stacks;
    if (target.kind === "rover" && stacks > 1 &&
        !(await this.#askToRun(`The editor holds ${stacks} separate stacks of blocks. Run runs every one, top to bottom, ` +
          `so a block left lying loose drives the rover too. Run all ${stacks} on the rover?`))) return;
    // The NORMAL scheme keeps the pivots (codes 9 to 16) off the stick and the
    // pad, because nobody has watched one on the bench yet (docs/mecanum.md);
    // a program could drive all eight without a word, the Mecanum tour
    // example among them. Under ADVANCED the operator has already chosen
    // them, so it does not ask again.
    const pivots = target.kind === "rover" && this.#scheme !== SCHEME_ADVANCED ? editor.pivots : [];
    if (pivots.length > 0 && !(await this.#askToRun(ProgramTab.#pivotQuestion(pivots, this.#scheme)))) return;
    // The page lived on while it asked: it runs only if Run still could, on
    // the target the answer was for. (A link lost meanwhile is the runner's
    // to refuse, below.)
    if (!this.#canRun() || this.#targetSwitch.target !== target) return;
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
    // A preview is to be watched: with the view folded (a phone's start),
    // it ran with nothing on screen moving. Shown, it stays, so the
    // operator sees where the preview left the simulated rover.
    if (target.kind === "simulator" && this.#ui.tab.dataset.view !== "shown") this.#showView(true);
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
    return Boolean(editor) && !editor.empty && this.#runner.state === "idle" && !this.#ask.open;
  }

  #askToRun(text) {
    return this.#ask.ask({ title: "Run on the rover?", text, yes: "Run on rover" });
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

  #onRunnerState(state, { kind, outcome, reason, own }) {
    if (state === "idle" && outcome) {
      this.#outcome = {
        done: { tone: "done", text: `Done on the ${kind}.` },
        // The operator's own Stop program: what they asked for, no warning.
        stopped: own ? { tone: "ended", text: "Stopped." } : { tone: "stopped", text: `Stopped: ${reason}` },
        failed: { tone: "failed", text: `Error: ${reason}` },
      }[outcome];
    } else {
      this.#outcome = null;
    }
    if (this.#editor) this.#editor.setReadOnly(state !== "idle");
    this.#update();
  }

  /* --- the File menu ----------------------------------------------------- */

  // Whether the editor may be changed: it is there, and no program runs.
  // Checked again after every question and file read, since the page lived
  // on meanwhile.
  #canEdit() {
    return Boolean(this.#editor) && this.#runner.state === "idle";
  }

  // Before replacing a program, ask; an empty editor has nothing to lose.
  #askToReplace(what) {
    if (this.#editor.empty) return Promise.resolve(true);
    return this.#ask.ask({ title: "Replace the program?", text: `Replace the program in the editor with ${what}?`, yes: "Replace" });
  }

  async #loadExample(example) {
    if (!this.#canEdit()) return;
    if (!(await this.#askToReplace(`the "${example.name}" example`)) || !this.#canEdit()) return;
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
    if (!file || !this.#canEdit()) return;
    try {
      if (file.size > 2 * 1024 * 1024) throw new Error("This file is too big to be a rover program.");
      let state;
      try {
        state = JSON.parse(await file.text());
      } catch {
        throw new Error("This file is not JSON, so not a rover program.");
      }
      if (!this.#canEdit()) return;
      if (!(await this.#askToReplace(file.name)) || !this.#canEdit()) return;
      this.#editor.load(state);
      this.#appendLog({ text: `Imported ${file.name}.`, tone: "info" });
    } catch (err) {
      this.#appendLog({ text: `Kept the program you had. ${err.message}`, tone: "failed" });
    }
  }

  async #clear() {
    if (!this.#canEdit() || this.#editor.empty) return;
    const yes = await this.#ask.ask({
      title: "Clear the program?",
      text: "Remove every block? Ctrl+Z (Cmd+Z on a Mac) in the editor brings them back.",
      yes: "Clear",
    });
    if (yes && this.#canEdit()) this.#editor.clear();
  }

  /* --- what the tab shows ------------------------------------------------ */

  #update() {
    const ui = this.#ui;
    const kind = this.#targetSwitch.kind;
    const readiness = this.#targetSwitch.target.ready();
    const state = this.#runner.state;
    const idle = state === "idle";
    const editor = this.#editor;

    const empty = Boolean(editor && editor.empty);
    ui.runLabel.textContent = ProgramTab.RUN_LABELS[kind] || `Run on ${kind}`;
    if (ui.runShort) ui.runShort.textContent = ProgramTab.RUN_SHORT[kind] || "Run";
    ui.run.disabled = !editor || empty || !idle || !readiness.ok;
    ui.run.title = !editor ? this.#editorWhy : !idle ? ProgramTab.TITLES.running : !readiness.ok ? readiness.why : empty ? ProgramTab.EMPTY_TITLE : ProgramTab.TITLES.run[kind] || "";
    ui.stop.disabled = state !== "running";

    // Without an editor no item can act, so neither can the menu. With one,
    // an item that cannot act now stays, disabled, saying why.
    const titles = ProgramTab.TITLES;
    const canEdit = this.#canEdit();
    const busy = canEdit ? "" : titles.busy;
    ui.menu.disabled = !editor;
    ui.menu.title = editor ? titles.menu : this.#editorWhy;
    for (const item of this.#exampleItems) {
      item.disabled = !canEdit;
      item.title = busy || titles.example;
    }
    ui.importButton.disabled = !canEdit;
    ui.importButton.title = busy || titles.import;
    ui.clear.disabled = !canEdit || empty;
    ui.clear.title = busy || (empty ? titles.nothingToClear : titles.clear);
    // Nothing to save from an empty editor, as nothing to clear (the
    // review's tablets 17): off, saying why. A running program can be saved.
    ui.exportButton.disabled = !editor || empty;
    ui.exportButton.title = empty ? titles.nothingToExport : titles.export;
    ui.hint.hidden = !editor || !editor.empty;

    const running = this.#runner.target ? this.#runner.target.kind : kind;
    let status;
    // Short, as the line is one line: a preview is on the simulator, whose
    // name the top's switch shows, and a target not ready says so briefly
    // (Run's title, and the line's, say why in full).
    if (state === "running") status = { tone: "running", text: running === "simulator" ? "Previewing…" : `Running on the ${running}…` };
    else if (state === "stopping") status = { tone: "stopping", text: "Stopping…" };
    else if (this.#outcome) status = this.#outcome;
    else if (!editor) status = { tone: "idle", text: this.#editorWhy };
    else if (!readiness.ok) status = { tone: "idle", text: readiness.brief || readiness.why, whole: readiness.why };
    else if (empty) status = { tone: "idle", text: ProgramTab.EMPTY };
    else status = { tone: "ready", text: kind === "simulator" ? "Ready to preview." : `Ready to run on the ${kind}.` };
    ui.state.textContent = status.text;
    // Whole on hover, where one line cuts it short or says it briefly.
    ui.state.title = status.whole || status.text;
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
    // A phone's Log, once there is one, with how many lines it holds.
    const { logToggle, logCount } = this.#ui;
    if (logToggle) logToggle.hidden = false;
    if (logCount) logCount.textContent = String(log.children.length);
  }
}

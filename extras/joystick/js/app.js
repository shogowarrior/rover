/**
 * The control panel's composition root, like src/main.cpp: it builds every
 * part of the panel, wires them together by reference, and does nothing else.
 *
 * Open joystick.html from disk (AGENTS.md says why). The page loads its
 * scripts as classic <script src> files, in order, because Chrome refuses
 * module scripts from file://. Classic scripts share one global scope: what
 * one file declares at top level is visible to every file after it, and a
 * second top-level declaration of the same name stops that whole second
 * file from loading. So each file declares at top level only what it offers
 * the others, and keeps the rest inside its class. The first two load in
 * <head>, the rest at the foot of <body>, after the vendored joy.js:
 *
 *   support.js       what the parts share: Listeners, memory, dom, segment,
 *                    pressSegment, clamp, radians, degrees, abortableWait,
 *                    isPrimaryPress, reportFault
 *   look.js          LookPicker, lookToken: the page's looks, the one in
 *                    force, and the tiles that pick one
 *   protocol.js      the firmware's constants: move codes, scheme and mode names,
 *                    speed limits, the port, distances and timing
 *   mecanum.js       the motions, moveForStick() for the stick families, and
 *                    heldMotion() for a program's
 *   link.js          Link: the WebSocket, the link state, telemetry
 *   scan.js          BEARINGS, ScanView: the scan fan
 *   readouts.js      Readouts: mode, move, phase, chip temperature, motor warning
 *   drive.js         Driver: the stick, rotate buttons and speed, and what to send
 *   scheme.js        SchemeToggle: the rover's control scheme, NORMAL or ADVANCED
 *   family.js        FamilySelector: the stick family, and the stick's labels
 *   tabs.js          Tabs: the Drive and Program tabs
 *   ask.js           AskDialog: the page's one way to ask the operator something
 *   popover.js       Popover: a button and the menu or panel it opens
 *   program.js       ProgramRunner, RoverTarget: running a block program on a
 *                    target
 *   blocks.js        RoverBlocks, BlockEditor: the rover's blocks, on Blockly
 *   targetswitch.js  TargetSwitch: the Rover | Simulator switch
 *   programtab.js    ProgramTab: the Program tab's toolbar, File menu, editor and
 *                    console
 *   sim.js           RoverSim, Room, SimSonar, SimTarget: the simulator a program
 *                    previews on
 *   simview.js       SimView: the simulator on screen, and its own controls
 *   app.js           this file, last
 *
 * Every part's on...(fn) returns a function that unsubscribes fn
 * (Listeners.add, support.js).
 *
 * Below, each wiring concern is a block of its own. A new part is built and
 * wired in a new block, rather than by growing another.
 */

// A missing element is a page that no longer matches its scripts. Say which,
// at load, rather than fail on the first press.
function byId(id) {
  const element = document.getElementById(id);
  if (!element) throw new Error(`joystick.html has no #${id}`);
  return element;
}

/* --- the parts ----------------------------------------------------------- */

const link = new Link({
  body: document.body,
  host: byId("host"),
  connect: byId("connect"),
  linkState: byId("linkState"),
  note: byId("note"),
  storageKey: "rover.host",
});

const scanView = new ScanView(byId("scan"));

const readouts = new Readouts({
  mode: byId("mode"),
  move: byId("move"),
  phaseCell: byId("phaseCell"),
  phase: byId("phase"),
  temp: byId("temp"),
  auto: byId("auto"),
  motorsFault: byId("motorsFault"),
});

// Built while the Drive tab is still showing, before the tabs restore the one
// last chosen: joy.js sizes the stick from its container as it is built, and a
// hidden container has no size.
const driver = new Driver({
  link,
  stick: byId("stick"),
  cw: byId("cw"),
  ccw: byId("ccw"),
  speed: byId("speed"),
  speedOut: byId("speedOut"),
});

/* --- telemetry ----------------------------------------------------------- */

link.onTelemetry((data) => {
  scanView.show(data);
  readouts.show(data);
});

// Readings belong to the link they came over. A link that went leaves the
// last scan and mode on screen, dimmed (panel.css), as what the rover last
// reported; a new link starts from nothing. It is up as its socket opens,
// before the rover has sent a frame over it, and the last link's scan was
// drawn as live again until one came: an all-clear that nothing vouched for.
link.onState((state) => {
  if (state === "connecting") {
    scanView.clear();
    readouts.clear();
  }
});

/* --- loss of control stops the rover ------------------------------------- */

// When the link goes down, nothing held may drive again without a fresh
// press, and whatever this panel was driving stops. When the panel closes its
// own socket, the Link runs this first, so the STOP still goes out on it; a
// socket that closed under the panel cannot carry one, and the firmware stops
// the wheels itself when the client driving it disconnects. The motor warning
// belongs to the link it came over, so it goes too.
link.onState((state, cause) => {
  if (state === "down") {
    driver.standDown(cause);
    readouts.linkDown();
  } else if (state === "stale") {
    driver.linkStale();
  }
});

// Anything that takes the operator's eyes or hands off the page must not
// leave the rover under this panel's power. It stops only what the panel is
// driving: alt-tabbing away while the rover explores must leave it exploring.
window.addEventListener("blur", () => driver.standDown("blur"));
document.addEventListener("visibilitychange", () => {
  if (document.hidden) driver.standDown("hidden");
});
window.addEventListener("pagehide", () => driver.standDown("pagehide"));

/* --- Stop and Autonomous ------------------------------------------------- */

// Outside the tabs, so both are in reach whatever tab is showing. Stop always
// sends STOP, driving or not: it is also how to stop an exploring rover. Both
// also stop a program, a preview included: see the Program tab's block.
byId("stop").addEventListener("click", () => driver.stopRover());
byId("auto").addEventListener("click", () => driver.resumeAutonomous());

/* --- control scheme ------------------------------------------------------ */

// The rover holds one control scheme for every controller, and any of them
// may change it: this toggle, another panel, the gamepad's SELECT. The toggle
// shows what telemetry reports; its message is configuration, sent straight
// over the link, and never a command, so it neither takes control nor stops
// an exploring rover.
const schemeToggle = new SchemeToggle({
  link,
  group: byId("scheme"),
  choice: byId("schemeChoice"),
});

// Offered under ADVANCED only; TRANSLATE otherwise.
const familySelector = new FamilySelector({
  choice: byId("familyChoice"),
  group: byId("family"),
  label: byId("stickLabel"),
  hints: byId("stickHints"),
  caveat: byId("pivotCaveat"),
});

link.onTelemetry((data) => schemeToggle.show(data));
link.onState((state) => {
  if (state === "down") schemeToggle.linkDown();
  else if (state === "stale") schemeToggle.linkStale();
});

// The operator's own choice re-steers a held stick at once, as pressing L1 or
// R1 does on the gamepad: the thumb is theirs, and so is the change.
familySelector.onChange((family) => driver.setFamily(family));

// A change of scheme, from anyone, never redirects a held stick: the stick
// lets go (Driver.releaseStick: one STOP, only if it was driving) and drives
// again only from a fresh press, which its caption asks for
// (FamilySelector.awaitPress); a link that goes takes the request with it.
// Learning the scheme for the first time redirects nothing -- the family was
// TRANSLATE while it was unknown, and stays so -- so a stick held as
// telemetry first arrives drives on.
schemeToggle.onChange((scheme, previous) => {
  const letGo = previous !== null && driver.releaseStick();
  familySelector.offer(scheme === SCHEME_ADVANCED);
  if (letGo) familySelector.awaitPress(true);
  else if (scheme === null) familySelector.awaitPress(false);
});
driver.onManualInput(() => familySelector.awaitPress(false));

/* --- tabs ---------------------------------------------------------------- */

// Choosing a tab is not driving: the Tabs reach neither the Driver nor the
// Link. Only leaving the Drive tab under a held stick sends anything (see the
// Program tab's block, below).
const tabs = new Tabs([byId("tabDrive"), byId("tabProgram")], { storageKey: "rover.tab" });

/* --- program targets ----------------------------------------------------- */

// What a program can run on, by kind; the Target interface is described in
// js/program.js. The rover is always here. The simulator's block, next, adds
// it when its scripts loaded; the target switch, after that, offers whatever
// is here.
const targets = { rover: new RoverTarget(driver, link) };

/* --- the simulator ------------------------------------------------------- */

// A preview: the same program on a simulated rover, drawn in #simSlot. The
// simulator holds no Link and no Driver, so a preview sends nothing whatever
// the link is doing, and its telemetry reaches only the program and its
// view, never the scan fan or the readouts. Only the rover's scheme crosses
// over, the other way. If its scripts did not load, the tab offers the rover
// alone.
if (typeof SimTarget === "function" && typeof SimView === "function") {
  const simulator = new SimTarget({ bearings: BEARINGS });
  targets.simulator = simulator;
  new SimView(byId("simSlot"), simulator);
  schemeToggle.onChange((scheme) => {
    if (scheme !== null) simulator.setScheme(scheme);
  });
}

/* --- the Program tab ----------------------------------------------------- */

// Programs run one at a time, through the runner, on the target the switch
// picks from the registry, which is complete by now. A program reaches the
// rover only through its Target, which drives it through the Driver like any
// held control. Every question the tab asks is the page's one AskDialog.
const runner = new ProgramRunner();
const targetSwitch = new TargetSwitch({
  group: byId("programTarget"),
  targets,
  storageKey: "rover.programTarget",
});
const ask = new AskDialog({
  dialog: byId("ask"),
  text: byId("askText"),
  yes: byId("askYes"),
  no: byId("askNo"),
});
const programTab = new ProgramTab({
  runner,
  targetSwitch,
  examples: RoverBlocks.EXAMPLES,
  ask,
  ui: {
    run: byId("programRun"),
    runLabel: byId("programRunLabel"),
    stop: byId("programStop"),
    menu: byId("programMenu"),
    menuList: byId("programMenuList"),
    examples: byId("programExamples"),
    exportButton: byId("programExport"),
    importButton: byId("programImport"),
    importFile: byId("programFile"),
    clear: byId("programClear"),
    stage: byId("programStage"),
    workspace: byId("programWorkspace"),
    hint: byId("programHint"),
    offline: byId("programOffline"),
    simPane: byId("programSim"),
    simToggle: byId("simToggle"),
    state: byId("programState"),
    log: byId("programLog"),
  },
});

// Every other way a program stops: the Target reports its own losses
// (program.js). Stop and Autonomous stop a program on any target, a preview
// included: an operator reaching for Stop means everything.
byId("programStop").addEventListener("click", () => runner.abort("Stop was pressed on the Program tab."));
byId("stop").addEventListener("click", () => runner.abort("Stop was pressed."));
byId("auto").addEventListener("click", () => runner.abort("Autonomous was pressed."));
targetSwitch.onChange((kind) => runner.abort(`the target was switched to the ${kind}.`));

// Run on the rover needs a live link, and asks before it drives a pivot
// unless the rover reports ADVANCED.
link.onState(() => programTab.refresh());
schemeToggle.onChange((scheme) => programTab.setScheme(scheme));

// A program driving the rover from the Program tab goes on while the Drive
// tab shows, and nothing there said so: the tab itself is marked while one
// runs. A press of any drive control takes over, as ever.
const programTabButton = byId("tabProgram");
runner.onState((state, { kind }) => {
  if (state !== "idle" && kind === "rover") {
    programTabButton.dataset.running = "yes";
    programTabButton.setAttribute("title", "A program is driving the rover. Any drive press, Stop or Autonomous takes over.");
  } else {
    delete programTabButton.dataset.running;
    programTabButton.removeAttribute("title");
  }
});

// Leaving the Drive tab lets go of a held stick (one STOP, only if it was
// driving): hidden, the stick can no longer be steered or centred, since
// joy.js throws on every move of a canvas with no layout, and the last move
// went on repeating until the thumb lifted. A held rotate button carries on,
// as it has nothing to steer and its release still arrives; a program or an
// exploring rover is left alone.
//
// Blockly sizes its workspace from its container, and a hidden tab has no
// size: fit it again whenever the tab is shown. So with the stick, whose
// look or size may have changed while it was hidden (Driver.shown).
tabs.onChange((tab) => {
  if (tab.id === "tabDrive") driver.shown();
  else driver.releaseStick();
  if (tab.id === "tabProgram") programTab.shown();
});

// Blockly is deferred (joystick.html): once the page is parsed, it has run,
// or failed to load. Only then is the editor built. Without Blockly the tab
// says so in the editor's place, and driving goes on as ever.
function startBlockEditor() {
  if (typeof Blockly === "undefined" || typeof javascript === "undefined") {
    programTab.editorUnavailable("The block editor could not load: it needs Blockly from cdn.jsdelivr.net.");
    return;
  }
  // Blockly's own questions (deleting every block, or a variable still in
  // use) are asked as the panel's are: in the page's one dialog, Cancel
  // focused, rather than in Blockly's, where OK has the focus and a
  // reflexive Enter deletes.
  Blockly.dialog.setConfirm((message, callback) => {
    ask.ask({ title: "Delete blocks?", text: message, yes: "Delete" }).then(callback);
  });
  try {
    programTab.attachEditor(new BlockEditor(byId("programWorkspace"), {
      Blockly,
      generator: javascript.javascriptGenerator,
      storageKey: "rover.program",
    }));
  } catch (err) {
    reportFault(err);
    programTab.editorUnavailable(`The block editor failed to start: ${err.message}`);
  }
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", startBlockEditor);
else startBlockEditor();

/* --- the simulator's word, in the Program console ------------------------ */

// What the preview has to say -- a bump, or that the real rover would start
// exploring here -- goes to the console beside the runner's own lines while
// a preview runs; otherwise the console said "Done." after a preview that
// bumped into the wall. A preview carries on from where the last one left the
// simulated rover, as SimView shows; the console says so as one starts away
// from the start, since Reset is in the simulator's bar, not here.
if (targets.simulator) {
  const simulator = targets.simulator;
  let stopListening = null;
  runner.onState((state, { kind }) => {
    if (state === "running" && kind === "simulator" && !stopListening) {
      if (!simulator.state.atStart) {
        programTab.note("The preview goes on from where the last one left the simulated rover: Reset, in the simulator's bar, starts it over.");
      }
      stopListening = simulator.onLog(({ text, tone }) => programTab.note(`Simulator: ${text}`, tone));
    } else if (state === "idle" && stopListening) {
      stopListening();
      stopListening = null;
    }
  });
}

/* --- the look ------------------------------------------------------------ */

// The page's colours, picked under the gear (look.js has already put the
// remembered look on <html>), in a popover that is not modal (see
// joystick.html).
const lookPicker = new LookPicker(byId("lookChoice"));
new Popover(byId("options"), byId("optionsPanel"));

// Whatever took the look's colours as plain values when it was built takes
// the new look's: the stick's knob, which joy.js paints into its canvas,
// and the block editor's Blockly theme (look.js paints the browser's own
// bar). Anything styled with var() follows by itself. Rebuilt, the stick
// lets go of a held stick as a scheme change does (one STOP, only if it was
// driving), and its caption asks for a fresh press; nothing else is sent.
lookPicker.onChange(() => {
  if (driver.restyle()) familySelector.awaitPress(true);
  programTab.restyle();
});

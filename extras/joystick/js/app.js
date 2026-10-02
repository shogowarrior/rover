/**
 * The control panel's composition root, like src/main.cpp: it builds every
 * part of the panel, wires them together by reference, and does nothing else.
 *
 * Open joystick.html directly in a browser -- the rover cannot serve it.
 * partition.csv allocates the whole flash to nvs, otadata and two OTA app
 * slots, leaving no SPIFFS/LittleFS partition to hold web assets.
 *
 * The page loads its scripts as classic <script src> files, in order, because
 * Chrome refuses module scripts from file://. Classic scripts share one global
 * scope: what one file declares at top level is visible to every file after
 * it, and a second top-level declaration of the same name stops that whole
 * second file from loading. So each file declares at top level only what it
 * offers the others, and keeps the rest inside its class:
 *
 *   support.js     Listeners, memory: event listeners and best-effort storage
 *   protocol.js    every value mirrored from the firmware
 *   mecanum.js     the motions, and moveForStick() for the stick families
 *   link.js        Link: the WebSocket, the link state, telemetry
 *   scan.js        BEARINGS, ScanView: the scan fan
 *   readouts.js    Readouts: mode, move, phase, chip temperature, motor warning
 *   drive.js       Driver: the stick, rotate buttons and speed, and what to send
 *   scheme.js      SchemeToggle: the rover's control scheme, NORMAL or ADVANCED
 *   family.js      FamilySelector: the stick family, and the stick's labels
 *   tabs.js        Tabs: the Drive and Program tabs
 *   program.js     ProgramRunner, RoverTarget: running a block program on a target
 *   blocks.js      RoverBlocks, BlockEditor: the rover's blocks, on Blockly
 *   programtab.js  ProgramTab: the Program tab's toolbar, editor and console
 *   sim.js         RoverSim, Room, SimSonar, SimClock, SimTarget: the simulator
 *                  a program previews on
 *   simview.js     SimView: the simulator on screen, and its own controls
 *   app.js         this file, last
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
// last chosen: joy.js sizes the stick from its container once, here, and a
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

// A change of scheme never redirects a held stick. It can come from anyone,
// and would otherwise turn the move under this operator's thumb into another
// -- a diagonal into a pivot, or a pivot into a diagonal. So, as the gamepad
// does (src/GamepadSession.cpp), the stick lets go of what it was driving (one
// STOP, and only if it was driving) and drives again only from a fresh press;
// only then does the family follow the scheme. A held rotate button carries
// on: it sends the same move under either scheme. Learning the scheme for the
// first time redirects nothing -- the family was TRANSLATE while it was
// unknown, and stays so -- so a stick held as telemetry first arrives drives
// on.
//
// joy.js goes on drawing the knob under a thumb the stick has let go of, over
// a rover that has stopped, so the stick's caption asks for a fresh press
// until the next press of any drive control; otherwise the operator takes it
// for a dead link. A link that goes takes the request with it.
schemeToggle.onChange((scheme, previous) => {
  const letGo = previous !== null && driver.releaseStick();
  familySelector.offer(scheme === SCHEME_ADVANCED);
  if (letGo) familySelector.awaitPress(true);
  else if (scheme === null) familySelector.awaitPress(false);
});
driver.onManualInput(() => familySelector.awaitPress(false));

/* --- tabs ---------------------------------------------------------------- */

// Choosing a tab is not driving: nothing here reaches the Driver or the Link.
const tabs = new Tabs([byId("tabDrive"), byId("tabProgram")], { storageKey: "rover.tab" });

/* --- program targets ----------------------------------------------------- */

// What a program can run on, by kind; the Target interface is described in
// js/program.js. The rover is always here. The simulator's block, next, adds
// it when its scripts loaded; the Program tab, after that, offers whatever is
// here.
const targets = { rover: new RoverTarget(driver, link) };

/* --- the simulator ------------------------------------------------------- */

// A preview: the same program, run on a simulated rover in a simulated room
// and drawn in #simSlot, so the operator can see where it would go before
// (or instead of) running it for real. The simulator holds no Link and no
// Driver, so in a preview nothing is ever sent, whatever the link is doing;
// and its telemetry goes only to the program and its own view, never to the
// scan fan or the readouts, which show the rover. It measures at the scan
// fan's own BEARINGS. If its scripts did not load, the tab offers the rover
// alone.
//
// Only the rover's scheme crosses over, the other way: the preview's
// telemetry reports the scheme the rover last reported (NORMAL until one is
// known), as the rover's own would. Nothing of the preview's reaches the
// toggle.
if (typeof SimTarget === "function" && typeof SimView === "function") {
  const simulator = new SimTarget({ bearings: BEARINGS });
  targets.simulator = simulator;
  new SimView(byId("simSlot"), simulator);
  schemeToggle.onChange((scheme) => {
    if (scheme !== null) simulator.setScheme(scheme);
  });
}

/* --- the Program tab ----------------------------------------------------- */

// Programs run one at a time, through the runner, on the target the tab's
// switch picks. A program reaches the rover only through its Target, which
// drives it through the Driver like any held control.
const runner = new ProgramRunner();
const programTab = new ProgramTab({
  runner,
  targets,
  examples: RoverBlocks.EXAMPLES,
  storageKey: "rover.programTarget",
  ui: {
    targetChoice: byId("programTarget"),
    run: byId("programRun"),
    runLabel: byId("programRunLabel"),
    stop: byId("programStop"),
    examples: byId("programExamples"),
    exportButton: byId("programExport"),
    importButton: byId("programImport"),
    importFile: byId("programFile"),
    clear: byId("programClear"),
    stage: byId("programStage"),
    hint: byId("programHint"),
    offline: byId("programOffline"),
    simPane: byId("programSim"),
    simToggle: byId("simToggle"),
    state: byId("programState"),
    log: byId("programLog"),
  },
});

// Every way a program is stopped before it ends. The target it runs on
// reports its own losses, and the runner listens for them itself: for the
// rover, any stand-down (blur, a hidden or closed page, the link lost, stale
// or disconnected) and any manual drive press. The panel's Stop and
// Autonomous stop a program on any target, a preview included: an operator
// reaching for Stop means everything.
byId("programStop").addEventListener("click", () => runner.abort("Stop was pressed on the Program tab."));
byId("stop").addEventListener("click", () => runner.abort("Stop was pressed."));
byId("auto").addEventListener("click", () => runner.abort("Autonomous was pressed."));
programTab.onTargetChange((kind) => runner.abort(`the target was switched to the ${kind}.`));

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

// Blockly sizes its workspace from its container, and a hidden tab has no
// size: fit it again whenever the tab is shown. Switching tabs stops nothing.
tabs.onChange((tab) => {
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
  try {
    programTab.attachEditor(new BlockEditor(byId("programWorkspace"), {
      Blockly,
      generator: javascript.javascriptGenerator,
      storageKey: "rover.program",
    }));
  } catch (err) {
    reportError(err);
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
      stopListening = simulator.onLog((text) => programTab.note(`Simulator: ${text}`, text.startsWith("bumped") ? "bump" : "info"));
    } else if (state === "idle" && stopListening) {
      stopListening();
      stopListening = null;
    }
  });
}

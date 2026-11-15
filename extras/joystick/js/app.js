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
 *                    pressSegment, labelSegment, clamp, radians, degrees,
 *                    abortableWait, isPrimaryPress, reportFault, fitSteps
 *   look.js          LookPicker, lookToken: the page's looks, the one in
 *                    force, and the Dark | Light toggle and theme tiles
 *                    that pick one
 *   protocol.js      the firmware's constants: move codes, scheme and mode names,
 *                    speed limits, the port, distances and timing
 *   mecanum.js       the motions, moveForStick() for the stick families, and
 *                    heldMotion() for a program's
 *   link.js          Link: the WebSocket, the link state, telemetry
 *   scan.js          BEARINGS, ScanView: the scan fan
 *   readouts.js      Readouts: mode, move, phase, chip temperature, motor warning
 *   drive.js         Driver: the two sticks, rotate buttons, keys and speed, and
 *                    what to send
 *   keys.js          Keyboard: client/drive.py's keys, driving through the Driver
 *   scheme.js        SchemeToggle: the control scheme, NORMAL or ADVANCED: the
 *                    rover's, or on the simulator target the simulator's
 *   autotoggle.js    AutoToggle: the Autonomous toggle, on while the target
 *                    explores
 *   family.js        FamilySelector: the pivot stick's family, and both
 *                    sticks' labels
 *   tabs.js          Tabs: the Drive and Program tabs
 *   ask.js           AskDialog: the page's one way to ask the operator something
 *   popover.js       Popover: a button and the menu or panel it opens
 *   program.js       ProgramRunner, RoverTarget: running a block program on a
 *                    target
 *   blocks.js        RoverBlocks, BlockEditor: the rover's blocks, on Blockly
 *   targetswitch.js  TargetSwitch: the Rover | Simulator switch, what the page
 *                    drives
 *   programtab.js    ProgramTab: the Program tab's toolbar, File menu, editor and
 *                    console
 *   sim.js           RoverSim, Room, SimSonar, SimTarget: the simulator, which a
 *                    program previews on and the Drive tab can drive
 *   simview.js       SimView: the simulator on screen, and its own controls
 *   md5.js           md5: the MD5 of bytes or text, as the rover writes one
 *   firmware.js      FirmwareUpdate: new firmware sent to the rover over the
 *                    link, from the Options popover
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
  chip: byId("linkChip"),
  linkState: byId("linkState"),
  note: byId("note"),
  proxy: byId("connectGo"),
  cardTitle: byId("connectTitle"),
  storageKey: "rover.host",
});

// The link chip opens the link's popover: the address, Connect and the
// note. It hangs below the top's cells, never over them, from the chip's
// left edge (panel.css, with the chip's place from the top's block,
// below), and is not modal, so Stop stays one press while it is open.
new Popover(byId("linkChip"), byId("linkPanel"));

// The connect card, over the faint scan while the rover target has no
// link: its button is a press of Connect (Link), and Change address opens
// the link's popover, as the chip does, with the focus in the address.
byId("changeAddress").addEventListener("click", () => {
  if (byId("linkPanel").hidden) byId("linkChip").click();
  byId("host").focus();
});

const scanView = new ScanView(byId("scan"));

const readouts = new Readouts({
  mode: byId("mode"),
  move: byId("move"),
  phaseCell: byId("phaseCell"),
  phase: byId("phase"),
  temp: byId("temp"),
  motorsFault: byId("motorsFault"),
});

// Where the Driver's commands go: over the Link to the rover, or, while the
// target switch says Simulator, to the simulator in its place, so that
// nothing the Drive tab does reaches the rover (the target's block, below,
// sets which). The simulator takes each as the rover would (SimTarget).
const driven = {
  simulator: null, // the simulator's Target while it is the one driven
  send(frame) {
    if (this.simulator) this.simulator.command(frame.move, frame.speed, frame.duration);
    else link.send(frame);
  },
};

// Built while the Drive tab is still showing, before the tabs restore the one
// last chosen: joy.js sizes the stick from its container as it is built, and a
// hidden container has no size.
const driver = new Driver({
  link: driven,
  stick: byId("stick"),
  pivotStick: byId("pivotStick"),
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
// belongs to the link it came over, so it goes too. While the Driver drives
// the simulator the link is not its concern: a rover rebooting must not let
// go of what drives the simulated one, and the scheme there is the
// simulator's own (the target's block, below).
link.onState((state, cause) => {
  if (state === "down") {
    if (!driven.simulator) driver.standDown(cause);
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

// In the top's cells, outside the tabs, so both are in reach whatever tab
// is showing. Stop always
// sends STOP, driving or not: it is also how to stop an exploring rover. On
// the simulator the Driver's STOP goes there, and Stop sends one to a
// connected rover too, since Stop means everything: first, so that nothing
// the simulator does can keep it from the rover. Autonomous is a toggle,
// on while the target explores: a press turns it the other way, on the
// target alone, so on the simulator it leaves the rover be (the target's
// block binds it there). Both also stop a program, a preview included: see
// the Program tab's block.
byId("stop").addEventListener("click", () => {
  if (driven.simulator) link.send({ move: STOP, speed: 0, duration: MOVE_DURATION_MS });
  driver.stopRover();
  stopReachedRover();
});
const autoToggle = new AutoToggle({ button: byId("auto"), driver });
link.onTelemetry((data) => autoToggle.show(data));
link.onState((state) => {
  if (state === "connecting") autoToggle.clear();
});

/* --- the keyboard -------------------------------------------------------- */

// drive.py's keys: the drive keys are held as a rotate button is, through
// the Driver, so every stand-down above lets go of them too; Space and T
// press Stop and Autonomous, and do all that those do. Options lists them.
new Keyboard({
  driver,
  speed: byId("speed"),
  stop: byId("stop"),
  auto: byId("auto"),
  driveTab: byId("driveTab"),
  dialog: byId("ask"),
  legend: byId("keyList"),
});

/* --- control scheme ------------------------------------------------------ */

// The rover holds one control scheme for every controller, and any of them
// may change it: this toggle, another panel, the gamepad's SELECT. The toggle
// shows what telemetry reports; its message is configuration, sent straight
// over the link, and never a command, so it neither takes control nor stops
// an exploring rover. On the simulator target it is the simulator's scheme
// instead (the target's block, below).
const schemeToggle = new SchemeToggle({
  link,
  group: byId("scheme"),
  choice: byId("schemeChoice"),
  notes: [byId("linkWish"), byId("connectWish")],
});

// The pivot stick's family, on under ADVANCED only.
const familySelector = new FamilySelector({
  choice: byId("familyChoice"),
  group: byId("family"),
  pad: byId("pivotPad"),
  label: byId("stickLabel"),
  hints: byId("stickHints"),
  note: byId("pivotNote"),
});

link.onTelemetry((data) => schemeToggle.show(data));
link.onState((state) => {
  if (state === "down") schemeToggle.linkDown();
  else if (state === "stale") schemeToggle.linkStale();
});

// The operator's own choice re-steers a held pivot stick at once, as
// pressing L1 or R1 does on the gamepad: the thumb is theirs, and so is the
// change.
familySelector.onChange((family) => driver.setFamily(family));

// The pivots are ADVANCED's: under NORMAL, or while the scheme is unknown,
// the pivot stick is shown but off. A change of scheme, from anyone, never
// redirects a held stick. Away from ADVANCED a held pivot stick lets go
// (Driver.enablePivots: one STOP, only if it was driving), and it drives
// again only from a fresh press once ADVANCED is back, which its line asks
// for then (FamilySelector.awaitPress); a link that goes takes the requests
// with it. The translate stick sends the same moves under either scheme, so
// it drives on.
const answerPresses = () => {
  familySelector.awaitPress("move", false);
  familySelector.awaitPress("pivot", false);
};
schemeToggle.onChange((scheme) => {
  const advanced = scheme === SCHEME_ADVANCED;
  const letGo = driver.enablePivots(advanced);
  familySelector.offer(advanced);
  if (scheme === null) answerPresses();
  else if (letGo) familySelector.awaitPress("pivot", true);
});
// A press answers a request: a stick's press its own, since a thumb still
// resting on the other stick drives nothing; a press of anything else both,
// since the operator has taken the rover in hand again.
driver.onManualInput((stick) => {
  if (stick !== "pivot") familySelector.awaitPress("move", false);
  if (stick !== "move") familySelector.awaitPress("pivot", false);
});

/* --- tabs ---------------------------------------------------------------- */

// Choosing a tab is not driving: the Tabs reach neither the Driver nor the
// Link. Only leaving the Drive tab under a held stick sends anything (see the
// Program tab's block, below).
const tabs = new Tabs([byId("tabDrive"), byId("tabProgram")], { storageKey: "rover.tab" });

/* --- program targets ----------------------------------------------------- */

// What a program can run on, by kind; the Target interface is described in
// js/program.js. The rover is always here. The simulator's block, next, adds
// it when its scripts loaded; the target switch, after that, offers whatever
// is here. Programs run one at a time, through the runner.
const targets = { rover: new RoverTarget(driver, link) };
const runner = new ProgramRunner();

/* --- the simulator ------------------------------------------------------- */

// A simulated rover, drawn in #simSlot, in the view pane beside both tabs:
// a program previews on it, and the Drive tab's controls can drive it (the
// target's block, next). The
// simulator holds no Link and no Driver, so nothing done to it reaches the
// rover whatever the link is doing, and its telemetry reaches only a program
// and its view, never the scan fan or the readouts. Only the rover's scheme
// crosses over, the other way: while the rover is the target the simulator
// takes it, so a switch to the simulator starts from the rover's scheme.
// From there the toggle shows and sets the simulator's own, so what it
// passes on here is that (the target's block, next). If its scripts did not
// load, the page offers the rover alone.
let simView = null;
if (typeof SimTarget === "function" && typeof SimView === "function") {
  const simulator = new SimTarget({ bearings: BEARINGS });
  targets.simulator = simulator;
  simView = new SimView(byId("simSlot"), simulator, { layout: document.querySelector(".shell") });
  schemeToggle.onChange((scheme) => {
    if (scheme !== null) simulator.setScheme(scheme);
  });
}

/* --- the target: the rover or the simulator ------------------------------ */

// One switch, in the header, for the whole page: what the Drive tab's
// controls drive and what a program runs on. On the simulator the Driver's
// commands go to it in the Link's place (driven, above). A switch is a new
// way to lose control, so it lets go of everything first, on the target
// left behind: a running program stops, and the held controls are let go,
// with one STOP if this panel was driving. The switch was the Program
// tab's once, and its choice is read from the key it had then.
const targetSwitch = new TargetSwitch({
  group: byId("target"),
  targets,
  storageKey: "rover.target",
  formerKey: "rover.programTarget",
});
const autoButton = byId("auto");
const autoTitle = autoButton.getAttribute("title");
// On the simulator target the toggles are the simulator's, and the link
// chip in the top's first cell still speaks for the rover: "Rover:" before
// its word, or the rover's glyph where the cell is narrow, on that target
// alone (on the rover's, the target says whose it is). After the link's
// word, each in a slot of its own, amber, it says what needs the operator
// about the rover while nothing on screen says it already: a motor shield
// that did not answer, while the view shows no scan (the simulator target,
// or the view folded on the Program tab), whose fault line says it there;
// and on the simulator target a rover that explores, since one sent
// exploring before the switch must not move unseen (on the rover target
// the Autonomous toggle says so). Both at once where both are so, and the
// link's word always (the critics' round 3: one alert in the word's place
// hid the other, and hid "No data"). A rover last seen exploring stays so,
// dashed, after its link goes stale or is lost, or a new one is tried:
// nothing says it stopped until a frame says MANUAL, or a Stop goes out
// over the link (Stop with no link cannot reach it). Its popover says each
// in words, and so does the chip's title, before the link's own.
const chip = byId("linkChip");
const chipFor = byId("chipFor");
const linkAlert = byId("linkAlert");
const programTabPanel = byId("programTab");
const programConnect = byId("programConnect");
const ALERTS = Object.freeze({
  motors: {
    element: byId("alertMotors"),
    why: () => "No motors: the rover's motor shield did not answer when it booted, so the wheels cannot move. Check its wiring and power, then reset the rover with its wheels off the ground: after a power-on or the EN button it starts exploring.",
  },
  exploring: {
    element: byId("alertExploring"),
    why: (live) => (live
      ? "Rover exploring: the rover reports that it is driving itself. The simulator target leaves it be; Stop stops it."
      : "Rover exploring, as last reported: the link to it has gone or gone quiet, so it may still be driving itself. Stop stops it once the link is back."),
  },
});
let roverExploring = false; // the rover's mode as last reported, kept when its link goes
let modeHeard = false; // whether this link, up now, has reported it
link.onTelemetry((data) => {
  if (typeof data.mode !== "string") return;
  roverExploring = data.mode === MODE_AUTONOMOUS;
  modeHeard = true;
});
link.onState((state) => {
  if (state !== "up") modeHeard = false;
});
// A Stop that went out over the link: the rover was told to stop
// exploring, and its next frame says whether it did.
function stopReachedRover() {
  if (link.state !== "up" && link.state !== "stale") return;
  roverExploring = false;
  markAlert();
}
function viewShowsScan() {
  if (driven.simulator) return false;
  return programTabPanel.hidden || programTabPanel.dataset.view !== "hidden";
}
function markAlert() {
  const reporting = link.state === "up" || link.state === "stale";
  const live = link.state === "up" && modeHeard;
  const on = Object.keys(ALERTS).filter((key) => (key === "motors"
    ? reporting && readouts.motorsReady === false && !viewShowsScan()
    : Boolean(driven.simulator) && roverExploring));
  const whys = on.map((key) => ALERTS[key].why(live));
  for (const [key, alert] of Object.entries(ALERTS)) {
    alert.element.hidden = !on.includes(key);
    alert.element.title = on.includes(key) ? ALERTS[key].why(live) : "";
  }
  ALERTS.exploring.element.dataset.known = live ? "now" : "last";
  chip.dataset.alert = on.join(" ");
  chip.title = [...whys, link.title].join(" ");
  linkAlert.textContent = whys.join(" ");
  linkAlert.hidden = on.length === 0;
  offerConnect();
}
// With no link on the rover target, the Program tab's console says why Run
// is off, and beside it a press of Connect does the next thing, while the
// view, and the connect card over its scan, is folded away: on a phone it
// starts folded on that tab, and the link chip was the only way to connect
// (the critic's round 2). Not while the card is there too: two Connect
// buttons asked which to press (round 1). Hidden by its attribute, so no
// style follows the target or the link (the view test). Again whenever the
// alert is marked, which is as the link, the target, the tab or the view
// changes.
function offerConnect() {
  programConnect.hidden = Boolean(driven.simulator) || link.state !== "down" || viewShowsScan();
}
link.onTelemetry(markAlert);
link.onState(markAlert);
// The chip's title names the field's address while there is no link
// (Link): the alerts go back before it as one is typed.
byId("host").addEventListener("input", markAlert);
// Again as the tab or the View toggle changes what the view shows (below),
// and as anything else does (a switch of target folding the view).
if (typeof MutationObserver === "function") {
  new MutationObserver(markAlert).observe(programTabPanel, { attributes: true, attributeFilter: ["hidden", "data-view"] });
}
// The scheme toggle shows and sets the target's scheme: the simulator's is
// its own, so Normal | Advanced work with no rover, and the Drive tab's
// family follows it as it follows the rover's. The Autonomous toggle shows
// the target's mode.
function driveTarget(kind) {
  driven.simulator = kind === "simulator" ? targets.simulator : null;
  schemeToggle.bind(driven.simulator);
  autoToggle.bind(driven.simulator);
  document.body.dataset.target = kind;
  chipFor.hidden = !driven.simulator;
  // The view pane shows the target: the simulated room on the simulator,
  // the rover's scan otherwise (panel.css). Hidden, not only undrawn, so
  // the view knows it is out of sight and an idle one draws nothing.
  byId("simSlot").hidden = !driven.simulator;
  markAlert();
  autoButton.setAttribute("title", driven.simulator
    ? "Autonomous (T), on the simulator: on, the simulated rover takes the mode, but exploring is not simulated, so it stands still; off, it stops. The rover is left alone."
    : autoTitle);
}
driveTarget(targetSwitch.kind);
targetSwitch.onChange((kind) => {
  runner.abort(`the target was switched to the ${kind}.`);
  driver.standDown("target");
  driveTarget(kind);
});

// A press of a drive control takes the simulated rover over from a preview,
// as a press takes the rover over from a program (RoverTarget). One
// microtask later, as there, so that Stop's and Autonomous's own reasons,
// given as they act, are the ones the console shows.
driver.onManualInput(() => {
  if (driven.simulator) Promise.resolve().then(() => runner.abort("the simulated rover was driven by hand."));
});

// The one view of the simulator, in the view pane beside both tabs. While
// the Drive tab's controls drive it, it runs at 1x: the Driver re-sends a
// held move every 200 ms of real time, each lasting 400 ms of the
// simulator's (SimView.holdPlayback). On the Program tab it plays at the
// operator's speed. Out of sight (the rover target, or the view hidden on
// the Program tab) an idle view draws nothing (SimView).
const driveTab = byId("driveTab");
function holdSimPlayback() {
  if (!simView) return;
  const driving = !driveTab.hidden && targetSwitch.kind === "simulator";
  simView.holdPlayback(driving
    ? "Driven from the Drive tab, the simulator runs in real time: 2× and 4× are for previews on the Program tab."
    : null);
}

/* --- the Program tab ----------------------------------------------------- */

// Programs run on the target the switch picks. A program reaches the rover
// only through its Target, which drives it through the Driver like any held
// control. Every question the tab asks is the page's one AskDialog.
const ask = new AskDialog({
  dialog: byId("ask"),
  text: byId("askText"),
  yes: byId("askYes"),
  no: byId("askNo"),
});
// The view pane shows with the editor at first where the screen has room
// for both: wide enough to put them side by side (panel.css), or a tablet
// upright, tall enough for its band over the editor. On a phone it starts
// folded on either target (it squeezed the editor to a strip); the tab's
// View toggle shows or hides it.
const roomForView = typeof matchMedia === "function" && matchMedia("(min-width: 960px) and (min-height: 521px), (min-width: 720px) and (min-height: 900px)").matches;
const programTab = new ProgramTab({
  runner,
  targetSwitch,
  examples: RoverBlocks.EXAMPLES,
  ask,
  showView: roomForView,
  ui: {
    run: byId("programRun"),
    runLabel: byId("programRunLabel"),
    runShort: byId("programRunShort"),
    stop: byId("programStop"),
    menu: byId("programMenu"),
    menuList: byId("programMenuList"),
    examples: byId("programExamples"),
    exportButton: byId("programExport"),
    importButton: byId("programImport"),
    importFile: byId("programFile"),
    clear: byId("programClear"),
    tab: byId("programTab"),
    workspace: byId("programWorkspace"),
    hint: byId("programHint"),
    offline: byId("programOffline"),
    viewToggle: byId("viewToggle"),
    state: byId("programState"),
    log: byId("programLog"),
    logToggle: byId("programLogToggle"),
    logCount: byId("programLogCount"),
  },
});

// The console's Connect (offerConnect(), above) is a press of the
// popover's, whatever that does now; its view starts as ProgramTab left it.
programConnect.addEventListener("click", () => byId("connect").click());
offerConnect();

// Every other way a program stops: the Target reports its own losses
// (program.js). Stop and Autonomous stop a program on any target, a preview
// included: an operator reaching for Stop means everything. The tab's own
// Stop program is the operator ending their program, which the console
// says plainly; every other stop says why, in amber.
byId("programStop").addEventListener("click", () => runner.abort("Stop was pressed on the Program tab.", { own: true }));
byId("stop").addEventListener("click", () => runner.abort("Stop was pressed."));
byId("auto").addEventListener("click", () => runner.abort("Autonomous was pressed."));

// Run on the rover needs a live link, and asks before it drives a pivot
// unless the rover reports ADVANCED; under NORMAL, the target's, the editor
// marks each pivot before Run is pressed.
link.onState(() => programTab.refresh());
programTab.setScheme(schemeToggle.scheme);
schemeToggle.onChange((scheme) => programTab.setScheme(scheme));

// A program driving the rover from the Program tab goes on while the Drive
// tab shows, and nothing there said so: the tab itself is marked while one
// runs, and says so on hover. A press of any drive control takes over, as
// ever. Its own title, what the tab is, comes back after.
const programTabButton = byId("tabProgram");
const programTabTitle = programTabButton.getAttribute("title");
runner.onState((state, { kind }) => {
  if (state !== "idle" && kind === "rover") {
    programTabButton.dataset.running = "yes";
    programTabButton.setAttribute("title", "A program is driving the rover. Any drive press, Stop or Autonomous takes over.");
  } else {
    delete programTabButton.dataset.running;
    programTabButton.setAttribute("title", programTabTitle);
  }
});

// Leaving the Drive tab lets go of the held sticks (one STOP, only if one
// was driving): hidden, a stick can no longer be steered or centred, since
// joy.js throws on every move of a canvas with no layout, and the last move
// went on repeating until the thumb lifted. On the rover a held rotate
// button carries on, as it has nothing to steer and its release still
// arrives; a program or an exploring rover is left alone. On the simulator
// it goes too: off the Drive tab the view plays at the operator's speed,
// and at 4x each re-sent move ran out before the next (holdSimPlayback).
//
// Blockly sizes its workspace from its container, and a hidden tab has no
// size: fit it again whenever the tab is shown. So with the sticks, whose
// look or size may have changed while they were hidden (Driver.shown). The
// simulator's playback is held at 1x on the Drive tab alone.
tabs.onChange((tab) => {
  if (tab.id === "tabDrive") driver.shown();
  else if (driven.simulator) driver.standDown("tab");
  else driver.releaseSticks();
  holdSimPlayback();
  if (tab.id === "tabProgram") programTab.shown();
  markAlert();
});
// The View toggle folds the scan away on the Program tab, and with it the
// fault line: the chip says it instead (after ProgramTab's own listener).
byId("viewToggle").addEventListener("click", markAlert);
targetSwitch.onChange(holdSimPlayback);
holdSimPlayback();

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
const lookPicker = new LookPicker({ flavours: byId("flavourChoice"), themes: byId("lookChoice") });
new Popover(byId("options"), byId("optionsPanel"));

// Whatever took the look's colours as plain values when it was built takes
// the new look's: the stick's knob, which joy.js paints into its canvas,
// and the block editor's Blockly theme (look.js paints the browser's own
// bar). Anything styled with var() follows by itself. Rebuilt, the sticks
// let go of what they hold (one STOP, only if a stick was driving), and the
// caption of each that was deflected asks for a fresh press; nothing else is
// sent.
lookPicker.onChange(() => {
  for (const stick of driver.restyle()) familySelector.awaitPress(stick, true);
  programTab.restyle();
});

/* --- firmware updates ---------------------------------------------------- */

// New firmware for the rover, sent over the link from the Options popover.
// The rover stands itself down for an update, and ends one that anything
// drives it during: a program left running would only end the update, so
// starting one ends the program.
const firmwareUpdate = new FirmwareUpdate({
  link,
  ui: {
    build: byId("firmwareBuild"),
    choose: byId("firmwareChoose"),
    file: byId("firmwareFile"),
    chosen: byId("firmwareChosen"),
    password: byId("firmwarePassword"),
    start: byId("firmwareStart"),
    cancel: byId("firmwareCancel"),
    progress: byId("firmwareProgress"),
    status: byId("firmwareStatus"),
  },
});
link.onTelemetry((data) => firmwareUpdate.show(data));
link.onState((state) => firmwareUpdate.linkState(state));
link.onOta((message) => firmwareUpdate.reply(message));
firmwareUpdate.onStart(() => {
  if (runner.target === targets.rover) runner.abort("the rover's firmware is being updated.");
});

/* --- the top's words, where they fit -------------------------------------- */

// Each of the top's cells says as much as its width allows: fitSteps tries
// its steps of data-fit (panel.css) from the most words to the fewest,
// measured, so it follows the fonts the device has. Each control in a cell
// is a slot as wide whatever it says, so the step follows the cell's width
// alone, never the link, the target or the rover's state, and nothing in
// either cell moves as they change (the critic's round 2: a badge or a
// switch to the simulator moved Autonomous 58 px). What comes and goes in
// the chip, the rover's name on the simulator target and the two alerts,
// is measured shown, all three (data-fitting, panel.css), so it always has
// its room; out of it, it takes none. Again whenever a cell changes size.
// Where the cells share a row, the first as wide as what it holds and the
// second the rest, either can run over, so both count, and the row. The
// address only on a screen 1280 px wide or more. Neither cell's height can
// change: a cell is one line whatever it says. The second cell keeps its
// 13 px words and Advanced whole down to a 375 px phone ("snug"), and gives
// up a size, then Advanced, only past that (a 320 px phone): at 12 px on a
// 375 px phone and on a phone on its side, its words were a size under the
// first cell's (the critic's round 1).
const cellsRow = document.querySelector(".cells");
const firstCell = document.querySelector(".hcell.drives");
const secondCell = document.querySelector(".hcell.hands");
const wideTop = typeof matchMedia === "function" ? matchMedia("(min-width: 1280px)") : null;
const runsOver = () => [firstCell, secondCell, cellsRow].some((box) => box.scrollWidth > box.clientWidth);
// The second cell first: where the two share a row, the first takes what
// the second leaves.
function fitTheTop() {
  cellsRow.dataset.fitting = "yes";
  firstCell.dataset.fit = "lamp";
  fitSteps(secondCell, ["words", "tight", "snug", "small", "short"], runsOver);
  fitSteps(firstCell, [...(wideTop && wideTop.matches ? ["host"] : []), "words", "glyphs", "short", "snug", "small", "lamp"], runsOver);
  delete cellsRow.dataset.fitting;
  placeLinkPanel();
}
// The link's popover hangs from the chip's left edge (the critics' round
// 3: from the cells' left, it read as the first control's), below the
// cells: the chip's place in them, which only the fit above moves, since
// nothing before it changes width.
function placeLinkPanel() {
  const x = chip.getBoundingClientRect().left - cellsRow.getBoundingClientRect().left;
  byId("linkPanel").style.setProperty("--chip-x", `${Math.max(0, Math.round(x))}px`);
}
if (typeof ResizeObserver === "function") new ResizeObserver(fitTheTop).observe(cellsRow);
// The address, which the chip names at the first step, is no state: it
// changes only as the operator connects somewhere else, or edits it with no
// link (Link sets the chip's data-host).
if (typeof MutationObserver === "function") new MutationObserver(fitTheTop).observe(byId("linkChip"), { attributes: true, attributeFilter: ["data-host"] });
fitTheTop();

// The readouts' line the same way: the chip's temperature goes first, the
// least needed, then the values take the smaller type, and only then do
// the captions go (each cell titled with its own), before a value is cut
// short, as each frame changes what it says: without its caption, a bare
// "STOP" read like a button (the critic's round 3). One line, one height,
// whatever it holds.
const readoutsLine = document.querySelector(".readouts");
// Its values shrink to fit, cut short: the line overflows where one is. A
// cell put out of sight (the chip's, past the first step) is 1 px wide, its
// value not cut short but not shown: counted as cut, every line that let
// the chip go let the captions go too.
const cutShort = (line) => [...line.querySelectorAll("output")].some((value) => value.parentNode.getBoundingClientRect().width > 1 && value.scrollWidth > value.clientWidth);
const fitReadouts = () => fitSteps(readoutsLine, ["words", "nochip", "small", "bare"], cutShort);
if (typeof ResizeObserver === "function") new ResizeObserver(fitReadouts).observe(readoutsLine);
if (typeof MutationObserver === "function") {
  new MutationObserver(fitReadouts).observe(readoutsLine, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["hidden"] });
}
fitReadouts();

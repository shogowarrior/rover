// The keyboard (js/keys.js): client/drive.py's keys on the panel, through
// the real page against fake-dom.js's DOM, WebSocket and clock.
//
// Each test makes many small checks and reports every one that failed, not
// only the first, so one run shows the whole of a regression.
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const nodeTest = require("node:test");
const harness = require("./harness.js");
const { loadPage, all, connectOpen } = require("./fake-dom.js");
const { CODES, NAMES, telemetry } = require("./firmware.js");

let failed = null; // the running test's failed checks
let passes = 0;
function check(cond, what) {
  if (cond) passes++;
  else failed.push(what);
}
function test(name, fn) {
  harness.test(name, async () => {
    failed = [];
    await fn();
    assert.deepEqual(failed, [], `${failed.length} check(s) failed:\n  ${failed.join("\n  ")}`);
  });
}
nodeTest.after(() => console.log(`keys.test.js: ${passes} checks passed`));

/* --- helpers ------------------------------------------------------------- */

function connected(frame = telemetry({ mode: "MANUAL" }), options) {
  const page = loadPage(options);
  const ws = connectOpen(page);
  ws.serverMsg(frame);
  return { page, ws };
}
const names = (ws, from = 0) => ws.moves().slice(from).map((m) => NAMES[m.move]);
const count = (ws) => ws.sent.length;

// A key going down, or up, at what has the focus (the body unless a test
// focuses something), as a browser fires it. Returns the event, to read
// whether the page cancelled it.
function down(page, key, extra = {}) {
  return page.fire(extra.target || page.doc.activeElement, "keydown", { key, repeat: false, ...extra });
}
function up(page, key, extra = {}) {
  return page.fire(extra.target || page.doc.activeElement, "keyup", { key, ...extra });
}
const tap = (page, key, extra) => { down(page, key, extra); up(page, key, extra); };

// Focus an element as a browser would, and make it the target of keys.
function focus(page, element) {
  element.focus();
  return page.doc.activeElement === element;
}

const toSimulator = (page) => page.fire(page.$("target").children[1], "click");
const toProgram = (page) => page.fire(page.$("tabProgram"), "click");
const toDrive = (page) => page.fire(page.$("tabDrive"), "click");

// drive.py's KEYS, as {key: move name}, read from the file itself.
function drivePyKeys() {
  const text = fs.readFileSync(path.join(__dirname, "..", "..", "..", "client", "drive.py"), "utf8");
  const table = text.match(/^KEYS = \{\n([\s\S]*?)^\}/m);
  assert.ok(table, "client/drive.py has a KEYS table");
  return Object.fromEntries([...table[1].matchAll(/^\s*"(.)": \((\w+),/gm)].map(([, key, move]) => [key, move]));
}

/* --- the keys ------------------------------------------------------------ */

test("keys: the panel's keys are drive.py's, and Options lists every one", () => {
  const page = loadPage();
  const drive = page.evalIn("Keyboard.DRIVE");
  const py = drivePyKeys();
  for (const [key, move] of Object.entries(py)) {
    if (key === " ") check(move === "STOP", `drive.py's space is ${move}`);
    else if (key === "t") check(move === "RESUME_AUTONOMOUS", `drive.py's t is ${move}`);
    else check(NAMES[drive[key]] === move, `${key}: the panel's ${NAMES[drive[key]]}, drive.py's ${move}`);
  }
  check(Object.keys(drive).every((key) => key in py), `a drive key drive.py lacks: ${Object.keys(drive)}`);
  const text = fs.readFileSync(path.join(__dirname, "..", "..", "..", "client", "drive.py"), "utf8");
  const step = text.match(/speed = max\(0, speed - (\d+)\)/);
  check(step && Number(step[1]) === page.evalIn("Keyboard.SPEED_STEP"), `drive.py steps its speed by ${step && step[1]}`);
  check(page.evalIn("Keyboard.SLOWER").join() === "-,_" && page.evalIn("Keyboard.FASTER").join() === "+,=",
    "- and + step the speed, and _ and = too, as in drive.py");

  // Options' list: a row per entry, its keys as caps, and every key the
  // panel takes among them.
  const rows = page.$("keyList").children;
  const legend = page.evalIn("Keyboard.LEGEND");
  check(rows.length === legend.length, `${rows.length} rows for ${legend.length} entries`);
  const caps = all(page.$("keyList")).filter((n) => n.tagName === "KBD").map((n) => n.textContent);
  for (const key of Object.keys(drive)) check(caps.includes(key.toUpperCase()), `Options lists ${key.toUpperCase()}: ${caps}`);
  for (const key of ["Space", "T", "−", "+"]) check(caps.includes(key), `Options lists ${key}: ${caps}`);
  check(rows.every((row) => row.children.map((n) => n.tagName).join() === "DT,DD"), "each row is a key and what it does");
  check(page.$("optionsPanel").getAttribute("data-keys") === "own", "Options keeps its keys while it has the focus");

  // The buttons the keys stand for say so to assistive technology.
  check(page.$("stop").getAttribute("aria-keyshortcuts") === "Space" && page.$("auto").getAttribute("aria-keyshortcuts") === "T"
    && page.$("ccw").getAttribute("aria-keyshortcuts") === "Q" && page.$("cw").getAttribute("aria-keyshortcuts") === "E",
    "Stop, Autonomous and the rotate buttons name their keys");
  check(page.errors.length === 0, `errors ${page.errors}`);
});

test("keys: each drive key drives while it is held, re-sent, and its release sends one STOP", () => {
  const { page, ws } = connected();
  const speed = Number(page.$("speed").value);
  for (const [key, move] of Object.entries(page.evalIn("Keyboard.DRIVE"))) {
    const from = count(ws);
    down(page, key);
    page.clock.advance(450);
    const sent = ws.moves().slice(from);
    check(sent.length === 3 && sent.every((m) => m.move === move && m.speed === speed && m.duration === page.evalIn("MOVE_DURATION_MS")),
      `${key}: held, ${JSON.stringify(sent)}`);
    up(page, key);
    page.clock.advance(1000);
    check(names(ws, from + 3).join() === "STOP", `${key}: let go, ${names(ws, from + 3)}`);
  }
  // A capital, Shift or Caps Lock, is the same key, and so is its release.
  const from = count(ws);
  down(page, "W");
  up(page, "w");
  down(page, "w");
  up(page, "W");
  check(names(ws, from).join() === "MOVE_FORWARD,STOP,MOVE_FORWARD,STOP", `W and w: ${names(ws, from)}`);
  check(page.errors.length === 0, `errors ${page.errors}`);
});

test("keys: auto-repeat is not a press, and a key let go of drives again only from a fresh press", () => {
  const { page, ws } = connected();
  down(page, "w", { repeat: true });
  page.clock.advance(500);
  check(count(ws) === 0, `a repeat with nothing held: ${names(ws)}`);

  down(page, "w");
  down(page, "w", { repeat: true });
  down(page, "w", { repeat: true });
  page.clock.advance(150);
  check(names(ws).join() === "MOVE_FORWARD", `repeats change nothing: ${names(ws)}`);

  // Stop lets go of the key under the finger: its repeats do not take the
  // rover back, its keyup sends nothing, and a fresh press drives.
  page.fire(page.$("stop"), "click");
  const stopped = count(ws);
  down(page, "w", { repeat: true });
  page.clock.advance(500);
  up(page, "w");
  page.clock.advance(500);
  check(count(ws) === stopped, `after Stop: ${names(ws, stopped)}`);
  down(page, "w");
  check(names(ws, stopped).join() === "MOVE_FORWARD", `a fresh press: ${names(ws, stopped)}`);
  up(page, "w");
  check(page.errors.length === 0, `errors ${page.errors}`);
});

test("keys: the rotate button or key pressed last wins, and letting go hands back to the one still held", () => {
  const { page, ws } = connected();
  down(page, "w");
  down(page, "d");
  check(names(ws).join() === "MOVE_FORWARD,MOVE_RIGHT", `W then D strafes, one move at a time: ${names(ws)}`);
  up(page, "d");
  check(names(ws).slice(-1)[0] === "MOVE_FORWARD", `D let go: forward again, ${names(ws)}`);

  page.fire(page.$("ccw"), "pointerdown", { pointerId: 1, button: 0 });
  check(names(ws).slice(-1)[0] === "ROTATE_COUNTERCLOCKWISE", `a rotate button over a key: ${names(ws)}`);
  down(page, "e");
  check(names(ws).slice(-1)[0] === "ROTATE_CLOCKWISE", `a key over a rotate button: ${names(ws)}`);
  up(page, "e");
  check(names(ws).slice(-1)[0] === "ROTATE_COUNTERCLOCKWISE", `back to the button: ${names(ws)}`);
  page.fire(page.$("ccw"), "pointerup", { pointerId: 1, button: 0 });
  check(names(ws).slice(-1)[0] === "MOVE_FORWARD", `back to W: ${names(ws)}`);
  const from = count(ws);
  up(page, "w");
  page.clock.advance(1000);
  check(names(ws, from).join() === "STOP", `all let go: ${names(ws, from)}`);

  // A key wins over a held stick, which drives again when the key is let go.
  const c = page.canvas;
  const touch = (dx, dy) => ({ identifier: 0, target: c, pageX: c.width / 2 + dx, pageY: c.height / 2 + dy });
  page.fire(c, "touchstart", { targetTouches: [touch(0, 0)], changedTouches: [touch(0, 0)] });
  page.fire(c, "touchmove", { targetTouches: [touch(0, -80)], changedTouches: [touch(0, -80)] });
  down(page, "s");
  check(names(ws).slice(-2).join() === "MOVE_FORWARD,MOVE_BACKWARD", `the stick, then S over it: ${names(ws)}`);
  up(page, "s");
  check(names(ws).slice(-1)[0] === "MOVE_FORWARD", `S let go: the stick again, ${names(ws)}`);
  check(page.errors.length === 0, `errors ${page.errors}`);
});

test("keys: Space stops and T explores, on either tab, as the buttons do", () => {
  // An exploring rover, nothing held: Space is still a STOP, as Stop is.
  const { page, ws } = connected(telemetry());
  const space = down(page, " ");
  check(space.defaultPrevented, "Space's keydown is cancelled: the page does not scroll");
  check(names(ws).join() === "STOP", `Space: ${names(ws)}`);
  down(page, " ", { repeat: true });
  check(names(ws).join() === "STOP", `a held Space stops once: ${names(ws)}`);
  check(up(page, " ").defaultPrevented, "and its keyup");
  tap(page, "t");
  check(names(ws).join() === "STOP,RESUME_AUTONOMOUS", `T: ${names(ws)}`);
  down(page, "t", { repeat: true });
  check(count(ws) === 2, `a held T asks once: ${names(ws)}`);

  // On the Program tab too, where the foot bar's buttons are as well.
  toProgram(page);
  tap(page, " ");
  tap(page, "T");
  check(names(ws, 2).join() === "STOP,RESUME_AUTONOMOUS", `on the Program tab: ${names(ws, 2)}`);
  check(page.errors.length === 0, `errors ${page.errors}`);
});

test("keys: with Autonomous, Run or Connect focused, Space sends one STOP and clicks nothing", () => {
  const { page, ws } = connected(telemetry());
  let clicks = 0;
  for (const id of ["auto", "programRun", "connect"]) page.$(id).addEventListener("click", () => clicks++);
  for (const id of ["auto", "connect"]) {
    const from = count(ws);
    check(focus(page, page.$(id)), `${id} took the focus`);
    const keydown = down(page, " ");
    const keyup = up(page, " ");
    check(keydown.defaultPrevented && keyup.defaultPrevented, `${id}: Space's keydown and keyup are cancelled, so the browser clicks nothing`);
    check(names(ws, from).join() === "STOP", `${id}: ${names(ws, from)}`);
  }
  toProgram(page);
  const run = page.$("programRun");
  run.disabled = false; // as with a program in the editor
  const from = count(ws);
  check(focus(page, run), "Run took the focus");
  check(down(page, " ").defaultPrevented && up(page, " ").defaultPrevented, "Run: Space is cancelled both ways");
  check(names(ws, from).join() === "STOP", `Run: ${names(ws, from)}`);
  check(clicks === 0, `${clicks} of the focused buttons were clicked by the page`);
  check(page.errors.length === 0, `errors ${page.errors}`);
});

test("keys: the drive and speed keys act on the Drive tab alone", () => {
  const { page, ws } = connected();
  toProgram(page);
  for (const key of ["w", "a", "s", "d", "q", "e"]) tap(page, key);
  tap(page, "+");
  page.clock.advance(500);
  check(count(ws) === 0, `off the Drive tab: ${names(ws)}`);
  check(page.$("speed").value === "64", `the speed: ${page.$("speed").value}`);
  toDrive(page);
  down(page, "w");
  check(names(ws).join() === "MOVE_FORWARD", `back on the Drive tab: ${names(ws)}`);
  up(page, "w");
  check(page.errors.length === 0, `errors ${page.errors}`);
});

test("keys: - and + step the speed as drive.py does, and a held key follows", () => {
  const { page, ws } = connected();
  const speed = page.$("speed");
  const out = page.$("speedOut");
  tap(page, "+");
  check(speed.value === "80" && out.textContent === "80", `+: ${speed.value}, shown ${out.textContent}`);
  tap(page, "=");
  check(speed.value === "96", `=: ${speed.value}`);
  tap(page, "-");
  tap(page, "_");
  check(speed.value === "64" && out.textContent === "64", `- and _: ${speed.value}, shown ${out.textContent}`);
  check(count(ws) === 0, `a change of speed alone sends nothing: ${names(ws)}`);

  down(page, "w");
  page.clock.advance(150);
  down(page, "+", { repeat: false });
  page.clock.advance(100);
  check(ws.moves().slice(-1)[0].speed === 80, `a held key takes the new speed: ${JSON.stringify(ws.moves())}`);
  up(page, "w");

  // At either end it stays there.
  for (let i = 0; i < 40; i++) tap(page, "-");
  check(speed.value === "0", `down to ${speed.value}`);
  for (let i = 0; i < 40; i++) down(page, "+", { repeat: i > 0 });
  check(Number(speed.value) === Number(speed.getAttribute("max")), `up to ${speed.value}: held, + repeats`);
  check(page.errors.length === 0, `errors ${page.errors}`);
});

test("keys: a keydown is not the panel's where the focus has keys of its own", () => {
  const { page, ws } = connected(telemetry());
  const tryAll = (what) => {
    const from = count(ws);
    const speed = page.$("speed").value;
    const events = ["w", " ", "t", "+"].map((key) => [down(page, key), up(page, key)]);
    page.clock.advance(500);
    check(count(ws) === from, `${what}: sent ${names(ws, from)}`);
    check(page.$("speed").value === speed, `${what}: the speed went to ${page.$("speed").value}`);
    check(!events[1][0].defaultPrevented && !events[1][1].defaultPrevented, `${what}: Space is left alone`);
  };

  check(focus(page, page.$("host")), "the address took the focus");
  tryAll("the address");

  // The simulator's room and speed are selects, and its settings take Space.
  toSimulator(page);
  const room = page.doc.documentElement.querySelector("select");
  check(room && focus(page, room), "a select took the focus");
  tryAll("a select");
  const more = page.$("simMore");
  check(more && more.getAttribute("data-keys") === "own", "the simulator's settings keep their keys");
  page.fire(page.doc.documentElement.querySelector(".sim-settings"), "click");
  const toggle = more.querySelector("button");
  check(focus(page, toggle), "a setting took the focus");
  tryAll("the simulator's settings");
  page.fire(page.doc.documentElement.querySelector(".sim-settings"), "click");
  page.fire(page.$("target").children[0], "click");

  // Options and the File menu, open.
  page.fire(page.$("options"), "click");
  const look = all(page.$("optionsPanel")).find((n) => n.tagName === "INPUT" || n.tagName === "BUTTON");
  check(look && focus(page, look), "a look took the focus");
  tryAll("Options");
  page.fire(page.$("options"), "click");

  toProgram(page);
  const menu = page.$("programMenu");
  menu.disabled = false;
  page.fire(menu, "click");
  const item = page.$("programExport");
  item.disabled = false;
  check(focus(page, item), "a File menu item took the focus");
  tryAll("the File menu");
  page.fire(menu, "click");

  // The block editor, and the pop-ups Blockly adds to the page outside it.
  const workspace = page.$("programWorkspace");
  const inEditor = page.doc.createElement("div");
  inEditor.setAttribute("tabindex", "0");
  workspace.appendChild(inEditor);
  check(focus(page, inEditor), "the editor took the focus");
  tryAll("the block editor");
  for (const cls of ["blocklyWidgetDiv", "blocklyDropDownDiv"]) {
    const popup = page.doc.createElement("div");
    popup.setAttribute("class", cls);
    const inside = page.doc.createElement("div");
    popup.appendChild(inside);
    page.doc.body.appendChild(popup);
    check(focus(page, inside), `${cls} took the focus`);
    tryAll(cls);
  }
  toDrive(page);

  // The page's dialog, open: every key is its.
  page.doc.body.focus();
  page.evalIn("ask.ask({ title: 'Test', text: 'A question', yes: 'Go' })");
  check(page.$("ask").open && page.doc.activeElement === page.$("askNo"), "the dialog is open, Cancel focused");
  tryAll("the dialog");
  page.doc.activeElement = page.doc.body; // the page behind it is inert, but a key can still land there
  tryAll("the page behind the dialog");
  page.$("ask").close("no");

  // Typing in a field Blockly or anything else marks editable.
  const editable = page.doc.createElement("div");
  editable.isContentEditable = true;
  page.doc.body.appendChild(editable);
  check(focus(page, editable), "an editable took the focus");
  tryAll("an editable element");

  // Mid-composition (an input method), and a key the page has already acted on.
  page.doc.activeElement = page.doc.body;
  const from = count(ws);
  down(page, "w", { isComposing: true });
  down(page, "w", { defaultPrevented: true });
  check(count(ws) === from, `composing, or already acted on: ${names(ws, from)}`);
  check(page.errors.length === 0, `errors ${page.errors}`);
});

test("keys: the slider, the tabs and the simulator's rover leave the drive keys working", () => {
  const { page, ws } = connected();
  check(focus(page, page.$("speed")), "the slider took the focus");
  down(page, "w");
  check(names(ws).join() === "MOVE_FORWARD", `the slider focused: ${names(ws)}`);
  up(page, "w");
  check(focus(page, page.$("tabDrive")), "a tab took the focus");
  down(page, "a");
  check(names(ws).slice(-1)[0] === "MOVE_LEFT", `a tab focused: ${names(ws)}`);
  up(page, "a");

  // Q and E turn the focused simulator rover, and drive nothing; W drives
  // the simulator, which the Drive tab drives here.
  toSimulator(page);
  page.evalIn("globalThis.__took = []; { const s = targets.simulator, c = s.command.bind(s); s.command = (m, sp, d) => { __took.push(m); c(m, sp, d); }; }");
  const rover = page.doc.documentElement.querySelector(".sim-rover");
  check(rover && focus(page, rover), "the simulator's rover took the focus");
  const heading = page.evalIn("targets.simulator.state.pose.heading");
  const q = down(page, "q");
  up(page, "q");
  check(q.defaultPrevented && page.evalIn("targets.simulator.state.pose.heading") !== heading, "Q turned the simulator's rover");
  check(page.evalIn("__took").length === 0, `Q drove: ${page.evalIn("__took").map((m) => NAMES[m])}`);
  down(page, "w");
  up(page, "w");
  check(page.evalIn("__took").map((m) => NAMES[m]).join() === "MOVE_FORWARD,STOP", `W drove the simulator: ${page.evalIn("__took").map((m) => NAMES[m])}`);
  check(page.errors.length === 0, `errors ${page.errors}`);
});

test("keys: a keyup counts wherever the focus has gone", () => {
  const { page, ws } = connected();
  down(page, "w");
  focus(page, page.$("host"));
  up(page, "w");
  page.clock.advance(1000);
  check(names(ws).join() === "MOVE_FORWARD,STOP", `let go in the address: ${names(ws)}`);
  check(page.errors.length === 0, `errors ${page.errors}`);
});

test("keys: Ctrl, Alt or Cmd let go of every held key, and take no key of their own", () => {
  const { page, ws } = connected(telemetry());
  for (const modifier of ["metaKey", "ctrlKey", "altKey"]) {
    const from = count(ws);
    down(page, "w");
    down(page, "a");
    // Cmd going down: macOS sends no keyup for a key let go while it is held.
    down(page, modifier === "metaKey" ? "Meta" : modifier === "ctrlKey" ? "Control" : "Alt", { [modifier]: true });
    page.clock.advance(1000);
    check(names(ws, from).join() === "MOVE_FORWARD,MOVE_LEFT,STOP", `${modifier}: ${names(ws, from)}`);
    // The keys' own repeats, once it is let go, take nothing back.
    down(page, "w", { repeat: true });
    page.clock.advance(500);
    check(count(ws) === from + 3, `${modifier}, then a repeat: ${names(ws, from)}`);
    up(page, "w");
    up(page, "a");
    // A shortcut is not a key of the panel's: Cmd+W, Ctrl+T, Alt+Space.
    down(page, "w", { [modifier]: true });
    down(page, "t", { [modifier]: true });
    const space = down(page, " ", { [modifier]: true });
    page.clock.advance(500);
    check(count(ws) === from + 3 && !space.defaultPrevented, `${modifier} shortcuts: ${names(ws, from)}`);
  }
  // With nothing held, a modifier sends nothing: an exploring rover explores on.
  const from = count(ws);
  down(page, "Meta", { metaKey: true });
  check(count(ws) === from, `a modifier with nothing held: ${names(ws, from)}`);
  // It lets go of keys alone: a rotate button held under the mouse rotates on.
  page.fire(page.$("ccw"), "pointerdown", { pointerId: 1, button: 0 });
  down(page, "w");
  down(page, "Control", { ctrlKey: true });
  check(names(ws, from).join() === "ROTATE_COUNTERCLOCKWISE,MOVE_FORWARD,ROTATE_COUNTERCLOCKWISE", `a rotate button held: ${names(ws, from)}`);
  page.fire(page.$("ccw"), "pointerup", { pointerId: 1, button: 0 });
  check(page.errors.length === 0, `errors ${page.errors}`);
});

test("keys: blur and a hidden page let go of a held key, which drives again only from a fresh press", () => {
  for (const loss of ["blur", "hidden", "pagehide"]) {
    const { page, ws } = connected();
    down(page, "w");
    if (loss === "blur") page.fire(page.win, "blur", { bubbles: false });
    else if (loss === "pagehide") page.fire(page.win, "pagehide", { bubbles: false });
    else {
      page.doc.hidden = true;
      page.fire(page.doc, "visibilitychange", { bubbles: false });
      page.doc.hidden = false;
    }
    page.clock.advance(1000);
    check(names(ws).join() === "MOVE_FORWARD,STOP", `${loss}: ${names(ws)}`);
    down(page, "w", { repeat: true });
    up(page, "w");
    page.clock.advance(500);
    check(count(ws) === 2, `${loss}, then the key's repeat and release: ${names(ws)}`);
    check(page.errors.length === 0, `errors ${page.errors}`);
  }
});

test("keys: on the simulator target they drive the simulator, and Space stops the rover too", () => {
  const { page, ws } = connected(telemetry());
  toSimulator(page);
  const state = () => page.evalIn("targets.simulator.state");
  down(page, "e");
  page.clock.advance(450);
  check(state().move === CODES.ROTATE_CLOCKWISE && state().moving, `E turns the simulated rover: ${state().move}`);
  up(page, "e");
  check(!state().moving, "let go, it stops");
  check(count(ws) === 0, `nothing reached the rover: ${names(ws)}`);
  tap(page, " ");
  check(names(ws).join() === "STOP", `Space stops a connected rover too, as Stop does: ${names(ws)}`);
  tap(page, "t");
  check(state().mode === "AUTONOMOUS" && count(ws) === 1, "T takes the simulated rover's mode and leaves the rover alone");
  check(page.errors.length === 0, `errors ${page.errors}`);
});

test("keys: a drive key is a press, and answers a stick's request for one", () => {
  const { page } = connected();
  page.evalIn("globalThis.__presses = []; driver.onManualInput((stick) => __presses.push(String(stick)))");
  page.evalIn("familySelector.awaitPress('move', true)");
  check(page.$("stickLabel").textContent === page.evalIn("FamilySelector.PRESS_AGAIN"), "the caption asks for a press");
  down(page, "w");
  down(page, "w", { repeat: true });
  check(page.evalIn("__presses").join() === "undefined", `one press, the repeat none: ${page.evalIn("__presses")}`);
  check(page.$("stickLabel").textContent === page.evalIn("FamilySelector.TRANSLATE"), "a key press answers it, as any drive press does");
  up(page, "w");
  check(page.evalIn("__presses").length === 1, "a release is not a press");
  check(page.errors.length === 0, `errors ${page.errors}`);
});

test("keys: holdKey() takes a motion code, and a key held twice is held once", () => {
  const page = loadPage();
  const ws = connectOpen(page);
  page.evalIn("globalThis.__presses = 0; driver.onManualInput(() => __presses++)");
  page.evalIn("driver.holdKey('w', MOVE_FORWARD); driver.holdKey('w', MOVE_FORWARD)");
  check(page.evalIn("__presses") === 1, `${page.evalIn("__presses")} presses`);
  page.evalIn("driver.releaseKey('w')");
  page.clock.advance(1000);
  check(names(ws).join() === "MOVE_FORWARD,STOP", `one release lets go: ${names(ws)}`);
  for (const move of [0, 19, 20, "1", null]) {
    let threw = null;
    try { page.evalIn(`driver.holdKey("w", ${JSON.stringify(move)})`); } catch (err) { threw = err; }
    check(threw && threw.name === "RangeError", `holdKey with ${JSON.stringify(move)}: ${threw}`);
  }
});

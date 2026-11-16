// What the rover says and holds beyond its scan, on the real page against
// fake-dom.js's DOM, WebSocket and clock: the frames told apart by their
// key, its settings and checks in Options, the sonar's aim on the fan, who
// has control, and its log and graphs under the scan. The frames are the
// firmware's own, from test/vectors/ (stream.json, telemetry.json).
//
// Each test makes many small checks and reports every one that failed, not
// only the first, so one run shows the whole of a regression.
"use strict";
const assert = require("node:assert/strict");
const nodeTest = require("node:test");
const harness = require("./harness.js");
const { loadPage, all, flush, connectOpen } = require("./fake-dom.js");
const { vectors, CODES, NAMES, FRAMES, telemetry } = require("./firmware.js");
const { stylesheet, cssRules, outside } = require("./css.js");

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
nodeTest.after(() => console.log(`rover.test.js: ${passes} checks passed`));

/* --- helpers ------------------------------------------------------------- */

const STREAM = vectors("stream.json");
const [DEFAULTS, AIMING, SWEEPING] = STREAM.settings;
const MANUAL = telemetry({ mode: "MANUAL" });

// A page whose link is up, with a first telemetry frame and, unless told
// otherwise, the rover's settings first, as the firmware sends them.
function connected({ frame = MANUAL, settings = DEFAULTS, options } = {}) {
  const page = loadPage(options);
  // The page's wall clock follows its virtual one, for the history's times.
  page.evalIn("Date.now = () => 1.7e12 + performance.now();");
  const ws = connectOpen(page);
  if (settings) ws.serverMsg(settings);
  if (frame) ws.serverMsg(frame);
  return { page, ws };
}
// What the panel sent, parsed: its commands' move names, and its settings.
const sent = (ws, from = 0) => ws.moves().slice(from);
const commands = (ws, from = 0) => sent(ws, from).filter((m) => "move" in m).map((m) => NAMES[m.move]);
const settingsSent = (ws, from = 0) => sent(ws, from).filter((m) => "settings" in m).map((m) => m.settings);
const count = (ws) => ws.sent.length;
// A segment of one of the Rover section's controls, by the value it sends.
const seg = (page, id, value) => page.$(id).children.find((b) => b.dataset.value === String(value));
const pressed = (page, id) => {
  const on = page.$(id).children.filter((b) => b.getAttribute("aria-pressed") === "true");
  return on.length === 1 ? on[0].dataset.value : on.length ? "several" : null;
};
const click = (page, el) => page.fire(el, "click");
const press = (page, el, pointerId) => page.fire(el, "pointerdown", { pointerId, button: 0 });
const lift = (page, el, pointerId) => page.fire(el, "pointerup", { pointerId, button: 0 });
const toSimulator = (page) => click(page, page.$("target").children[1]);
const toRover = (page) => click(page, page.$("target").children[0]);
// The priority as the section shows it, and a row's arrows.
const priority = (page) => page.$("priorityList").children.map((li) => li.children[1].textContent).join(",");
const arrows = (page, rank) => {
  const buttons = page.$("priorityList").children[rank].children.filter((n) => n.tagName === "BUTTON");
  return { up: buttons[0], down: buttons[1] };
};
async function answer(page, how) {
  page.fire(page.$(how === "yes" ? "askYes" : "askNo"), "click");
  await flush();
}
// The checks started, held by this panel, on a rover that reports its
// settings.
async function startChecks(frame = MANUAL) {
  const { page, ws } = connected({ frame });
  click(page, page.$("runChecks"));
  await answer(page, "yes");
  return { page, ws };
}
const checksSent = (ws, from = 0) => commands(ws, from).filter((n) => n === "RUN_CHECKS").length;
// A thumb on the translate stick's canvas, (dx, dy) from its centre.
function stickTouch(page) {
  const c = page.canvas;
  const touch = (dx, dy) => ({ identifier: 0, target: c, pageX: c.width / 2 + dx, pageY: c.height / 2 + dy });
  return {
    start(dx = 0, dy = 0) { page.fire(c, "touchstart", { targetTouches: [touch(dx, dy)], changedTouches: [touch(dx, dy)] }); },
    end() { page.fire(c, "touchend", { targetTouches: [], changedTouches: [{ identifier: 0 }] }); },
  };
}
// The scan's svg laid out at its wide shape, so a pointer on it has a
// bearing, and a pointer at a bearing and distance (in the drawing's
// units) from the rover.
function fanAt(page) {
  const svg = page.$("scan");
  svg.clientWidth = 420;
  svg.clientHeight = 200;
  const [CX, CY] = [page.evalIn("ScanView.CX"), page.evalIn("ScanView.CY")];
  return (bearing, r = 100) => {
    const a = ((90 + bearing) * Math.PI) / 180;
    return { clientX: CX + r * Math.cos(a), clientY: CY - r * Math.sin(a) };
  };
}
const shown = (node) => node.getAttribute("display") !== "none";

/* --- frames by their key ------------------------------------------------- */

test("frames: a log line, metrics and settings never reach telemetry, and keep no link fresh", () => {
  const { page, ws } = connected({ frame: FRAMES.sweeping });
  const before = {
    mode: page.$("mode").textContent,
    move: page.$("move").textContent,
    auto: page.$("auto").getAttribute("aria-pressed"),
    readings: all(page.$("scan")).filter((n) => n.getAttribute("class") === "reading").map((n) => n.textContent).join(),
  };
  for (const frame of [...STREAM.log, ...STREAM.metrics, ...STREAM.settings]) ws.serverMsg(frame);
  const after = {
    mode: page.$("mode").textContent,
    move: page.$("move").textContent,
    auto: page.$("auto").getAttribute("aria-pressed"),
    readings: all(page.$("scan")).filter((n) => n.getAttribute("class") === "reading").map((n) => n.textContent).join(),
  };
  check(JSON.stringify(after) === JSON.stringify(before), `telemetry's readouts untouched: ${JSON.stringify(before)} then ${JSON.stringify(after)}`);
  check(page.$("phase").textContent === "SWEEP" && !page.$("phaseCell").hidden, "the phase still shown");
  check(page.errors.length === 0, `errors ${page.errors}`);

  // The rover's other frames say nothing of whether telemetry still comes.
  const staleMs = page.evalIn("Link.STALE_MS");
  for (let t = 0; t <= staleMs + 500; t += 250) {
    ws.serverMsg(STREAM.metrics[0]);
    ws.serverMsg({ ...STREAM.log[2], seq: 1000 + t });
    page.clock.advance(250);
  }
  check(page.doc.body.dataset.link === "stale", `stale with no telemetry, whatever else came: ${page.doc.body.dataset.link}`);
  ws.serverMsg(FRAMES.sweeping);
  check(page.doc.body.dataset.link === "up", "telemetry makes it live again");
});

test("readouts: the check under way in the phase's place, captioned Check", () => {
  const { page, ws } = connected({ frame: FRAMES.checking });
  check(!page.$("phaseCell").hidden, "shown in manual mode while a check runs");
  check(page.$("phaseLabel").textContent === "Check" && page.$("phase").textContent === "wheel FL", `${page.$("phaseLabel").textContent} ${page.$("phase").textContent}`);
  check(page.$("phaseCell").title === "The check under way" && page.$("phase").dataset.tone === "", page.$("phaseCell").title);
  ws.serverMsg(MANUAL);
  check(page.$("phaseCell").hidden && page.$("phaseLabel").textContent === "Phase", "gone with the check");
  ws.serverMsg(FRAMES.cruising);
  check(page.$("phaseLabel").textContent === "Phase" && page.$("phase").textContent === "CRUISE", "a phase again while exploring");
});

/* --- the rover's settings ------------------------------------------------ */

test("settings: off, saying why, with no link, before the rover's settings, and on the simulator", () => {
  const page = loadPage();
  const why = page.evalIn("RoverSettings.WHY_OFF");
  const offEverywhere = (what) => {
    const buttons = all(page.$("roverSettings")).filter((n) => n.tagName === "BUTTON");
    check(buttons.length >= 3 + 2 + 2 + 6 + 1, `${what}: the section's buttons, ${buttons.length}`);
    check(buttons.every((b) => b.disabled), `${what}: every button off: ${buttons.filter((b) => !b.disabled).map((b) => b.textContent)}`);
    check(page.$("aim").disabled, `${what}: the aim off`);
    check(buttons.every((b) => b.title), `${what}: every button titled`);
  };
  check(page.$("roverStatus").textContent === why.down && page.$("roverSettings").dataset.state === "off", `no link: ${page.$("roverStatus").textContent}`);
  check(page.$("runChecks").title.includes(why.down), `Run checks says why: ${page.$("runChecks").title}`);
  offEverywhere("no link");
  check(page.$("aimRow").hidden && priority(page) === "—,—,—" && pressed(page, "sonarChoice") === null, "nothing shown that the rover has not reported");

  const ws = connectOpen(page);
  check(page.$("roverStatus").textContent === why.unreported, `before its settings: ${page.$("roverStatus").textContent}`);
  ws.serverMsg(MANUAL);
  check(page.$("roverStatus").textContent === why.tooOld, `telemetry with no settings frame, firmware from before them: ${page.$("roverStatus").textContent}`);
  offEverywhere("no settings");
  for (const id of ["sonarChoice", "padChoice", "bootChecksChoice"]) for (const b of page.$(id).children) click(page, b);
  click(page, arrows(page, 0).down);
  page.$("aim").value = "-30";
  page.fire(page.$("aim"), "input");
  page.clock.advance(500);
  check(settingsSent(ws).length === 0, `nothing asked of a rover that has not said it takes settings: ${JSON.stringify(settingsSent(ws))}`);

  // A part of a frame shows nothing: every setting or none.
  ws.serverMsg({ settings: { sonar: "AIM" } });
  check(pressed(page, "sonarChoice") === null, "a partial frame is not taken");

  ws.serverMsg(DEFAULTS);
  check(page.$("roverStatus").textContent === "" && page.$("roverSettings").dataset.state === "on", `on: '${page.$("roverStatus").textContent}'`);
  check(pressed(page, "sonarChoice") === "FRONT" && pressed(page, "padChoice") === "ON" && pressed(page, "bootChecksChoice") === "false", "the defaults");
  check(priority(page) === "USB,Pad,WiFi", `the priority: ${priority(page)}`);
  check(page.$("aimRow").hidden, "no aim while the sonar looks ahead");
  check(!page.$("runChecks").disabled, "Run checks on");
  check(arrows(page, 0).up.disabled && !arrows(page, 0).down.disabled && arrows(page, 2).down.disabled && !arrows(page, 2).up.disabled, "the first up and the last down off");
  check(arrows(page, 0).down.getAttribute("aria-label") === "Move USB down" && /Pad takes control over it/.test(arrows(page, 0).down.title), `an arrow named and titled: ${arrows(page, 0).down.title}`);
  check(page.$("padState").textContent === "This build has no pad.", `a frame with no pad: ${page.$("padState").textContent}`);

  ws.serverMsg(AIMING);
  check(pressed(page, "sonarChoice") === "AIM" && !page.$("aimRow").hidden, "aiming: the aim shown");
  check(page.$("aim").value === "80" && page.$("aimOut").textContent === "80° right", `the slider's value is the aim's negative, left at its left end: ${page.$("aim").value} ${page.$("aimOut").textContent}`);
  check(page.$("aim").getAttribute("aria-valuetext") === "80° right", "read out in words");
  check(pressed(page, "padChoice") === "OFF" && pressed(page, "bootChecksChoice") === "true" && priority(page) === "WiFi,USB,Pad", "every setting as reported");
  ws.serverMsg(FRAMES.aiming);
  check(page.$("padState").textContent === "Connected.", `the pad's state: ${page.$("padState").textContent}`);

  toSimulator(page);
  check(page.$("roverStatus").textContent === why.simulator, `the simulator: ${page.$("roverStatus").textContent}`);
  offEverywhere("the simulator");
  const n = count(ws);
  click(page, seg(page, "sonarChoice", "SWEEP"));
  check(count(ws) === n, "nothing goes to the rover from the simulator target");
  toRover(page);
  check(page.$("roverStatus").textContent === "", "back on the rover");

  ws.serverDrop();
  check(page.$("roverStatus").textContent === why.down && priority(page) === "—,—,—", "a link that goes takes the settings with it");
});

test("settings: a press asks the rover in a settings message of its own, never a command, pending until a frame says so", () => {
  const { page, ws } = connected({ frame: FRAMES.sweeping }); // exploring
  const confirmMs = page.evalIn("RoverSettings.CONFIRM_MS");
  click(page, seg(page, "sonarChoice", "SWEEP"));
  check(JSON.stringify(sent(ws)) === '[{"settings":{"sonar":"SWEEP"}}]', `one message, the sonar alone: ${JSON.stringify(sent(ws))}`);
  check(seg(page, "sonarChoice", "SWEEP").dataset.pending === "yes" && pressed(page, "sonarChoice") === "FRONT", "pending, the reported one still pressed");
  check(/Asked of the rover/.test(seg(page, "sonarChoice", "SWEEP").title), "its title says so");
  click(page, seg(page, "sonarChoice", "SWEEP"));
  check(count(ws) === 1, "asked once");
  ws.serverMsg(SWEEPING);
  check(pressed(page, "sonarChoice") === "SWEEP" && !seg(page, "sonarChoice", "SWEEP").dataset.pending, "settled by the frame");
  click(page, seg(page, "sonarChoice", "SWEEP"));
  check(count(ws) === 1, "what the rover reports already asks nothing");

  click(page, seg(page, "padChoice", "OFF"));
  click(page, seg(page, "bootChecksChoice", true));
  check(JSON.stringify(settingsSent(ws, 1)) === '[{"pad":"OFF"},{"checksAtBoot":true}]', `each its own: ${JSON.stringify(settingsSent(ws, 1))}`);
  page.clock.advance(confirmMs + 10);
  check(!seg(page, "padChoice", "OFF").dataset.pending && pressed(page, "padChoice") === "ON", "a request no frame confirms lapses, and shows what the rover reports");

  // The priority: the whole list, a row moved; a second move goes on from
  // the first while it is pending.
  const from = count(ws);
  // Reported: PAD, WIFI, USB. WiFi down, then Pad down from what was asked.
  click(page, arrows(page, 1).down);
  click(page, arrows(page, 0).down);
  check(JSON.stringify(settingsSent(ws, from)) === '[{"priority":["PAD","USB","WIFI"]},{"priority":["USB","PAD","WIFI"]}]',
    `the whole list each time: ${JSON.stringify(settingsSent(ws, from))}`);
  check(page.$("priorityList").dataset.pending === "yes" && priority(page) === "Pad,WiFi,USB", "pending, the reported order shown");
  ws.serverMsg(DEFAULTS);
  check(!page.$("priorityList").dataset.pending && priority(page) === "USB,Pad,WiFi", "settled");

  check(commands(ws).length === 0, `no command among them, so an exploring rover explores on: ${commands(ws)}`);
  check(sent(ws).every((m) => !("move" in m) && Object.keys(m).join() === "settings"), "settings alone in every message");

  // Stale: shown, faded, and nothing offered.
  page.clock.advance(page.evalIn("Link.STALE_MS") + 10);
  check(page.$("roverSettings").dataset.state === "stale" && pressed(page, "sonarChoice") === "FRONT", "stale: the last report shown, faded");
  const n = count(ws);
  click(page, seg(page, "sonarChoice", "AIM"));
  check(count(ws) === n && seg(page, "sonarChoice", "AIM").disabled, "nothing asked over a quiet link");
});

/* --- the sonar's aim ----------------------------------------------------- */

test("aim: a drag on the fan and the slider aim the sonar, as a setting, at most every 100 ms, the latest last", () => {
  const { page, ws } = connected();
  const at = fanAt(page);
  const svg = page.$("scan");
  check(svg.dataset.aim === "yes", "the fan aims while the settings can change");
  const wish = all(svg).find((n) => n.getAttribute("class") === "aimWish");

  page.fire(svg, "pointerdown", { pointerId: 1, button: 0, ...at(0) });
  check(JSON.stringify(settingsSent(ws)) === '[{"sonar":"AIM","aim":0}]', `straight ahead, at once: ${JSON.stringify(settingsSent(ws))}`);
  check(shown(wish), "the drag's ray drawn");
  page.fire(svg, "pointermove", { pointerId: 1, ...at(20) });
  page.fire(svg, "pointermove", { pointerId: 1, ...at(30.4) });
  check(settingsSent(ws).length === 1, "not again within 100 ms");
  page.clock.advance(100);
  check(JSON.stringify(settingsSent(ws, 1)) === '[{"sonar":"AIM","aim":30}]', `the latest, rounded, positive left: ${JSON.stringify(settingsSent(ws, 1))}`);
  page.clock.advance(150);
  page.fire(svg, "pointermove", { pointerId: 2, ...at(-50) });
  page.clock.advance(150);
  check(settingsSent(ws).length === 2, "another pointer aims nothing");
  page.fire(svg, "pointermove", { pointerId: 1, ...at(-170) });
  page.clock.advance(150);
  check(JSON.stringify(settingsSent(ws, 2)) === '[{"sonar":"AIM","aim":-80}]', `behind the rover, its reach's nearer end: ${JSON.stringify(settingsSent(ws, 2))}`);
  page.fire(svg, "pointerup", { pointerId: 1, button: 0 });
  check(!shown(wish), "the drag's ray gone with the drag");

  page.$("aim").value = "-45";
  page.fire(page.$("aim"), "input");
  page.clock.advance(150);
  check(JSON.stringify(settingsSent(ws, 3)) === '[{"sonar":"AIM","aim":45}]', `the slider: its value the aim's negative: ${JSON.stringify(settingsSent(ws, 3))}`);
  check(commands(ws).length === 0, `never a command: ${commands(ws)}`);

  // A press on the rover's own dot points nowhere.
  const n = count(ws);
  page.fire(svg, "pointerdown", { pointerId: 3, button: 0, ...at(0, 2) });
  page.clock.advance(150);
  check(count(ws) === n, "a press on the rover aims nothing");
  page.fire(svg, "pointerup", { pointerId: 3, button: 0 });

  // Not with the settings off.
  toSimulator(page);
  check(svg.dataset.aim === "no", "not on the simulator target");
  page.fire(svg, "pointerdown", { pointerId: 4, button: 0, ...at(10) });
  page.clock.advance(150);
  check(count(ws) === n && !shown(wish), "a drag there aims nothing");
});

test("aim: the fan draws where the rover aims and what it reads there, and dims the bearings it no longer measures", () => {
  const { page, ws } = connected({ frame: FRAMES.aiming });
  const svg = page.$("scan");
  const part = (name) => all(svg).find((n) => n.getAttribute("class") === name);
  const group = part("aim");
  check(shown(group) && group.getAttribute("data-deg") === "-30", "the rover's aim drawn");
  check(part("aimReading").textContent === "42cm" && part("aimHit").getAttribute("d") !== "", `its reading: ${part("aimReading").textContent}`);
  const ray = part("aimRay").getAttribute("d").match(/-?[\d.]+/g).map(Number);
  const [CX, CY] = [page.evalIn("ScanView.CX"), page.evalIn("ScanView.CY")];
  const bearing = (Math.atan2(CY - ray[3], ray[2] - CX) * 180) / Math.PI - 90;
  check(Math.abs(bearing - -30) < 0.5, `the ray at the aim, to the right: ${bearing}`);
  const held = () => all(svg).filter((n) => n.getAttribute("class") === "wedge").map((n) => n.getAttribute("data-held") === "yes");
  check(held().every(Boolean), "aimed between bearings, none of the five is measured");

  ws.serverMsg(FRAMES.aimingBeforeAReading);
  check(part("aimReading").textContent === "…" && part("aimHit").getAttribute("d") === "", "no reading there yet");
  ws.serverMsg({ ...FRAMES.aiming, aim: 35, aimCm: 999 });
  check(part("aimReading").textContent === "no echo", "no echo");
  check(held().join() === "true,false,true,true,true", `aimed at FL, FL is measured: ${held()}`);
  ws.serverMsg(telemetry({ mode: "MANUAL", sonar: "FRONT" }));
  check(!shown(group) && held().join() === "true,true,false,true,true", `held ahead: no ray, F measured: ${held()}`);
  ws.serverMsg(FRAMES.cruising);
  check(held().every((h) => !h), "exploring sweeps, whatever the setting");
  ws.serverMsg(MANUAL);
  check(!shown(group) && held().every((h) => !h), "sweeping");
});

/* --- the checks ---------------------------------------------------------- */

test("checks: Run checks asks first, then holds RUN_CHECKS every REPEAT_MS until telemetry shows them over", async () => {
  const { page, ws } = connected();
  const REPEAT_MS = page.evalIn("REPEAT_MS");
  click(page, page.$("runChecks"));
  check(page.$("ask").open, "asked");
  const question = page.$("askText").textContent;
  check(/stand/.test(question) && /forward/.test(question) && /sideways/.test(question) && /open and in front/.test(question), `it says why the stand, and that it holds them: ${question}`);
  check(page.$("askYes").textContent === "Run checks" && page.$("ask").getAttribute("aria-label") === "Run the rover's checks?", "the yes names what it does");
  check(count(ws) === 0, "nothing sent while it asks");
  await answer(page, "no");
  page.clock.advance(1000);
  check(count(ws) === 0 && !page.evalIn("driver.checking"), "no: nothing");

  click(page, page.$("runChecks"));
  await answer(page, "yes");
  check(commands(ws).join() === "RUN_CHECKS" && sent(ws)[0].move === CODES.RUN_CHECKS, `RUN_CHECKS at once: ${commands(ws)}`);
  check(page.evalIn("driver.checking"), "held");
  for (let i = 0; i < 4; i++) {
    page.clock.advance(REPEAT_MS);
    if (i === 1) ws.serverMsg(FRAMES.checking);
  }
  check(checksSent(ws) === 5 && commands(ws).every((n) => n === "RUN_CHECKS"), `again every REPEAT_MS: ${commands(ws)}`);
  const gaps = ws.sentAt.slice(1).map((t, i) => t - ws.sentAt[i]);
  check(gaps.every((g) => g === REPEAT_MS), `each ${REPEAT_MS} ms after the last: ${gaps}`);
  check(/Check under way: wheel FL/.test(page.$("roverStatus").textContent) && /stop if it closes/.test(page.$("roverStatus").textContent), `the status says the panel holds them: ${page.$("roverStatus").textContent}`);
  check(page.$("runChecks").disabled && /Stop ends them/.test(page.$("runChecks").title), `no second run while one is under way: ${page.$("runChecks").title}`);

  // A frame without "check" after one with it: they ran their course.
  page.clock.advance(100);
  ws.serverMsg(MANUAL);
  const n = count(ws);
  page.clock.advance(1000);
  check(count(ws) === n && !page.evalIn("driver.checking"), `let go once over, sending nothing more: ${commands(ws, n)}`);
  check(page.$("roverStatus").textContent === "" && !page.$("runChecks").disabled, "and offered again");
});

test("checks: let go of when no frame shows them within 1.5 s, sending nothing more", async () => {
  const { page, ws } = await startChecks();
  const confirmMs = page.evalIn("Checks.CONFIRM_MS");
  check(confirmMs === 1500, `about 1.5 s: ${confirmMs}`);
  for (let t = 0; t < confirmMs + 1000; t += 250) {
    page.clock.advance(250);
    if (t % 500 === 0) ws.serverMsg(MANUAL); // the rover refused them, or knows none
  }
  const n = checksSent(ws);
  check(n === Math.floor(confirmMs / page.evalIn("REPEAT_MS")) + 1, `re-sent until then: ${n}`);
  check(!page.evalIn("driver.checking") && commands(ws).every((c) => c === "RUN_CHECKS"), `let go, no STOP: ${commands(ws)}`);
});

test("checks: every let-go of a held move lets go of them, sending nothing more", async () => {
  const lettingGo = [
    ["a blur", (page) => page.fire(page.win, "blur", { bubbles: false }), []],
    ["a hidden page", (page) => { page.doc.hidden = true; page.fire(page.doc, "visibilitychange", { bubbles: false }); }, []],
    ["a page closing", (page) => page.fire(page.win, "pagehide", { bubbles: false }), []],
    ["Stop", (page) => click(page, page.$("stop")), ["STOP"]],
    ["Space", (page) => page.fire(page.doc.body, "keydown", { key: " ", code: "Space", repeat: false }), ["STOP"]],
    ["Autonomous", (page) => click(page, page.$("auto")), ["RESUME_AUTONOMOUS"]],
    ["a stick pressed, not yet pushed", (page) => stickTouch(page).start(), []],
    ["a rotate button", (page) => { press(page, page.$("cw"), 5); lift(page, page.$("cw"), 5); }, ["ROTATE_CLOCKWISE", "STOP"]],
    ["a switch of target", (page) => toSimulator(page), []],
    ["the link lost", (page, ws) => ws.serverDrop(), []],
  ];
  for (const [what, act, then] of lettingGo) {
    const { page, ws } = await startChecks();
    page.clock.advance(page.evalIn("REPEAT_MS"));
    ws.serverMsg(FRAMES.checking);
    check(page.evalIn("driver.checking") && checksSent(ws) === 2, `${what}: held before`);
    const n = count(ws);
    act(page, ws);
    page.clock.advance(1500);
    check(!page.evalIn("driver.checking"), `${what}: let go`);
    check(commands(ws, n).join() === then.join(), `${what}: sent ${commands(ws, n)}, not ${then}`);
    check(page.errors.length === 0, `${what}: errors ${page.errors}`);
  }

  // Stale: telemetry stops, once a frame has shown them, while the
  // re-sends go on.
  const { page, ws } = await startChecks();
  const staleMs = page.evalIn("Link.STALE_MS");
  page.clock.advance(page.evalIn("REPEAT_MS"));
  ws.serverMsg(FRAMES.checking);
  page.clock.advance(staleMs - 10);
  check(page.evalIn("driver.checking"), "held while telemetry comes");
  page.clock.advance(20);
  check(page.doc.body.dataset.link === "stale" && !page.evalIn("driver.checking"), "a stale link lets go");
  const n = count(ws);
  page.clock.advance(1000);
  check(count(ws) === n, `nothing more over a stale link: ${commands(ws, n)}`);
  check(commands(ws).every((c) => c === "RUN_CHECKS"), `nothing but the re-sends before: ${commands(ws)}`);
});

// Every RUN_CHECKS is a command, and the rover ends an update on any
// motion: an update that begins lets go of the checks, sending nothing more
// of them.
test("checks: a firmware update that begins lets go of them", async () => {
  const { page, ws } = await startChecks();
  page.clock.advance(page.evalIn("REPEAT_MS"));
  ws.serverMsg(FRAMES.checking);
  const bytes = new Uint8Array(4321);
  for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 151 + 7) & 0xff;
  bytes[0] = 0xe9;
  bytes[12] = 0;
  bytes[13] = 0;
  bytes.set([0x32, 0x54, 0xcd, 0xab], 32); // an ESP32 app image, as ota.test.js builds one
  page.fire(page.$("firmwareChoose"), "click");
  page.$("firmwareFile").files = [{ name: "firmware.bin", size: bytes.length, arrayBuffer: async () => bytes.slice().buffer }];
  page.fire(page.$("firmwareFile"), "change");
  await flush();
  page.$("firmwarePassword").value = "secret";
  check(!page.$("firmwareStart").disabled, `Update on: ${page.$("firmwareStatus").textContent}`);
  const n = count(ws);
  click(page, page.$("firmwareStart"));
  await flush();
  page.clock.advance(1000);
  check(!page.evalIn("driver.checking"), "let go");
  check(sent(ws, n).every((m) => !("move" in m)) && sent(ws, n).some((m) => m.ota === "begin"), `the update's begin, and no command: ${JSON.stringify(sent(ws, n))}`);
});

test("checks: off on the simulator, with no link, before the rover's settings and while they run; a yes looks again", async () => {
  // The simulator target.
  {
    const { page, ws } = connected();
    toSimulator(page);
    check(page.$("runChecks").disabled && /simulator/.test(page.$("runChecks").title), `the simulator: ${page.$("runChecks").title}`);
    click(page, page.$("runChecks"));
    check(!page.$("ask").open && count(ws) === 0, "not even asked");
  }
  // No settings frame: firmware from before the checks.
  {
    const { page, ws } = connected({ settings: null });
    check(page.$("runChecks").disabled, "a rover that reports no settings");
    click(page, page.$("runChecks"));
    check(!page.$("ask").open && count(ws) === 0, "not asked");
  }
  // Under way already, someone else's.
  {
    const { page, ws } = connected({ frame: FRAMES.checking });
    check(page.$("runChecks").disabled && /Stop ends them/.test(page.$("runChecks").title), page.$("runChecks").title);
    check(/Stop ends them/.test(page.$("roverStatus").textContent) && !/panel holds/.test(page.$("roverStatus").textContent), `another's run: ${page.$("roverStatus").textContent}`);
    click(page, page.$("runChecks"));
    check(!page.$("ask").open && count(ws) === 0, "not asked");
  }
  // The link goes while the question is open: a yes sends nothing.
  {
    const { page, ws } = connected();
    click(page, page.$("runChecks"));
    ws.serverDrop();
    await answer(page, "yes");
    page.clock.advance(1000);
    check(!page.evalIn("driver.checking") && page.sockets.every((s) => s.sent.length === 0), "nothing sent after the link went");
  }
});

/* --- who has control ----------------------------------------------------- */

test("control: a line says the pad or the USB console has control, while this panel presses and is refused", () => {
  const { page, ws } = connected({ frame: FRAMES.aiming }); // control PAD
  const line = page.$("heldBy");
  check(line.hidden, "not while this panel presses nothing");
  press(page, page.$("cw"), 1);
  check(!line.hidden && page.$("heldByWho").textContent === "The pad has control", `pressing: ${page.$("heldByWho").textContent}`);
  check(/refused/.test(line.textContent + line.title) && /Stop still stops/.test(line.title), `it says what that means: ${line.title}`);
  page.clock.advance(500);
  ws.serverMsg(FRAMES.aiming);
  check(!line.hidden, "while it drives");
  lift(page, page.$("cw"), 1);
  page.clock.advance(page.evalIn("CONTROL_HOLD_MS") - 100);
  check(!line.hidden, "for the hold after the press");
  page.clock.advance(200);
  check(line.hidden, "gone once the press has had its hold");

  ws.serverMsg(FRAMES.checking); // control USB
  press(page, page.$("ccw"), 2);
  check(!line.hidden && page.$("heldByWho").textContent === "The USB console has control", page.$("heldByWho").textContent);
  ws.serverMsg(FRAMES.deadShield); // control WIFI: this panel's own
  check(line.hidden, "WiFi's control is this panel's own");
  ws.serverMsg(MANUAL); // no one's
  check(line.hidden, "no one's");
  ws.serverMsg(FRAMES.aiming);
  check(!line.hidden, "the pad again, still pressing");
  toSimulator(page);
  check(line.hidden, "not on the simulator target");
  toRover(page);
  press(page, page.$("ccw"), 3);
  ws.serverMsg(FRAMES.aiming);
  check(!line.hidden, "back on the rover");
  ws.serverDrop();
  check(line.hidden, "not with no link");
  const css = cssRules(outside(stylesheet("rover.css"), "@container"));
  check(css.some((r) => /body\[data-target="simulator"\] \.view > :is\(\.roverLog, \.heldBy\)/.test(r.selector) && /display:\s*none/.test(r.body)), "hidden on the simulator target by the stylesheet too");
});

/* --- the log and the graphs ---------------------------------------------- */

test("log: each line once, by seq, newest last, whose and warnings marked, filtered and cleared", () => {
  const { page, ws } = connected();
  const lines = () => page.$("logLines").children;
  const visible = () => lines().filter((li) => !li.hidden);
  for (const frame of STREAM.log) ws.serverMsg(frame);
  check(lines().length === STREAM.log.length, `every line: ${lines().length}`);
  for (const frame of STREAM.log) ws.serverMsg(frame); // a link that comes back resends them
  check(lines().length === STREAM.log.length, `once each: ${lines().length}`);
  const texts = lines().map((li) => li.children[2].children.map((n) => n.textContent).join(" "));
  check(texts[texts.length - 1].endsWith(STREAM.log[STREAM.log.length - 1].log), "the newest last");
  check(lines().map((li) => li.children[0].textContent).join() === "0:00.3,0:00.3,1:01.2,1193:02:47,1:02.0,1:02.1", `the rover's clock: ${lines().map((li) => li.children[0].textContent)}`);
  check(lines().map((li) => li.children[1].textContent).join() === "Rover,Rover,Rover,WiFi,Pad,USB", `whose: ${lines().map((li) => li.children[1].textContent)}`);
  const warned = lines().filter((li) => li.dataset.warn === "yes");
  check(warned.length === STREAM.log.filter((f) => f.warn).length && warned.every((li) => /^Warning/.test(li.children[2].children[0].textContent)), "a warning marked, in words");
  check(texts.includes(`Warning ${STREAM.log[3].log}`), "the text as sent, quotes and backslash too");

  // Log's count of warnings while the drawer is closed.
  check(page.$("roverLog").hidden && page.$("logBadge").textContent === "3" && !page.$("logBadge").hidden, `the count: ${page.$("logBadge").textContent}`);
  check(/3 new warnings/.test(page.$("logToggle").title), page.$("logToggle").title);
  click(page, page.$("logToggle"));
  check(!page.$("roverLog").hidden && page.$("logToggle").getAttribute("aria-expanded") === "true" && page.$("logBadge").hidden, "open: the count gone");

  const filter = (value) => click(page, page.$("logFilter").children.find((b) => b.textContent === value || b.children.some((s) => s.textContent === value)));
  filter("Pad");
  check(visible().length === 1 && visible()[0].dataset.src === "PAD", "Pad's alone");
  filter("Rover");
  check(visible().length === 3 && visible().every((li) => li.dataset.src === "ROVER"), "the rover's own");
  click(page, page.$("logWarnings"));
  check(visible().length === 1 && page.$("logWarnings").getAttribute("aria-pressed") === "true", "the rover's warnings");
  filter("USB");
  check(visible().length === 1 && visible()[0].dataset.warn === "yes", "USB's warnings");
  filter("Pad");
  check(visible().length === 0 && !page.$("logEmpty").hidden && /No warnings from Pad/.test(page.$("logEmpty").textContent), page.$("logEmpty").textContent);
  click(page, page.$("logWarnings"));
  filter("All");
  check(visible().length === STREAM.log.length && page.$("logEmpty").hidden, "every line again");

  click(page, page.$("logClear"));
  check(lines().length === 0 && /Nothing yet/.test(page.$("logEmpty").textContent) && page.$("logClear").disabled, "cleared");
  for (const frame of STREAM.log) ws.serverMsg(frame);
  check(lines().length === 0, "a link that comes back brings none back");
  ws.serverMsg({ ...STREAM.log[0], seq: 7 });
  check(lines().length === 1, "a new line shows");

  // The last 500.
  for (let seq = 100; seq < 700; seq++) ws.serverMsg({ log: `line ${seq}`, seq, t: seq, src: "ROVER" });
  check(lines().length === 500 && lines()[0].children[2].textContent === "" && /line 200$/.test(lines()[0].children[2].children[0].textContent), `the last 500: ${lines().length}`);
  check(page.evalIn("roverHistory.lines.length") === 500, "and so does the history");

  // Space with the focus on the drawer's buttons stops the rover, as with
  // the page's other buttons: the drawer has no keys of its own.
  page.$("logSave").focus();
  const n = count(ws);
  const e = page.fire(page.$("logSave"), "keydown", { key: " ", code: "Space", repeat: false });
  check(commands(ws, n).join() === "STOP" && e.defaultPrevented, `Space stops: ${commands(ws, n)}`);
  check(all(page.$("roverLog")).every((node) => node.getAttribute("data-keys") !== "own"), "nothing in it keeps its keys");
  click(page, page.$("logToggle"));
  check(page.$("roverLog").hidden, "Log closes it");
});

test("log: Save hands over every line and sample, by when it came, as recorder.py's import_lines() reads", () => {
  const { page, ws } = connected({ frame: null });
  page.evalIn(`
    globalThis.__saved = [];
    globalThis.Blob = class { constructor(parts, options) { this.text = parts.join(""); this.type = options.type; } };
    globalThis.URL = { createObjectURL(blob) { __saved.push(blob); return "blob:rover"; }, revokeObjectURL() {} };
  `);
  const clicked = [];
  for (const frame of STREAM.log) ws.serverMsg(frame);
  const frames = [];
  for (let t = 0; t < 3000; t += 250) {
    const frame = telemetry({ mode: "MANUAL", distanceFront: 100 + t / 10 });
    ws.serverMsg(frame);
    frames.push(frame);
    if (t % 2000 === 0) ws.serverMsg(STREAM.metrics[0]);
    page.clock.advance(250);
  }
  ws.serverMsg(SWEEPING);
  click(page, page.$("logToggle"));
  check(!page.$("logSave").disabled, "Save on");
  page.$("roverLog").appendChild = ((append) => function (child) {
    if (child.tagName === "A") clicked.push(child.getAttribute("download"));
    return append.call(this, child);
  })(page.$("roverLog").appendChild);
  click(page, page.$("logSave"));
  const saved = page.evalIn("__saved");
  check(saved.length === 1 && saved[0].type === "application/x-ndjson", `one file: ${saved.length}`);
  check(clicked.length === 1 && /^rover-\d{8}-\d{6}\.jsonl$/.test(clicked[0]), `named for when: ${clicked}`);
  check(page.$("roverLog").querySelectorAll("a").length === 0, "the link gone after");
  const entries = saved[0].text.trim().split("\n").map((line) => JSON.parse(line));
  check(entries.every((e) => Object.keys(e).join() === "at,frame" && typeof e.at === "number" && e.frame && typeof e.frame === "object"), "each {at, frame}");
  check(entries.every((e, i) => i === 0 || e.at >= entries[i - 1].at), "by when it came");
  check(entries.every((e) => e.at > 1.6e12), "at in ms since 1970");
  const kinds = (key) => entries.filter((e) => key in e.frame);
  check(kinds("log").length === STREAM.log.length, `every line: ${kinds("log").length}`);
  check(JSON.stringify(kinds("log").map((e) => e.frame)) === JSON.stringify(STREAM.log), "each line as received");
  check(kinds("metrics").length === 2 && kinds("settings").length === 2, `every metrics and settings frame: ${kinds("metrics").length} ${kinds("settings").length}`);
  const samples = kinds("mode");
  const gaps = samples.slice(1).map((e, i) => e.at - samples[i].at);
  check(samples.length === 3 && gaps.every((g) => g >= 1000), `telemetry at most once a second: ${samples.length}, ${gaps}`);
  check(samples.every((e) => frames.some((f) => JSON.stringify(f) === JSON.stringify(e.frame))), "each sample as received");
});

test("graphs: five charts over the last 10 minutes, a line broken where nothing came or no echo", () => {
  const { page, ws } = connected({ frame: null });
  click(page, page.$("logToggle"));
  const chart = (key) => page.$("graphs").children.find((f) => f.getAttribute("data-key") === key);
  const now = (key) => chart(key).children[0].children[1].textContent;
  const line = (key) => all(chart(key)).find((n) => n.getAttribute("class") === "graphLine").getAttribute("d");
  check(page.$("graphs").children.map((f) => f.getAttribute("data-key")).join() === "loopHz,heap,rssi,temperature,distanceFront", "the five");
  check(now("loopHz") === "—" && line("loopHz") === "" && /nothing received/.test(chart("loopHz").title), "nothing yet");
  for (let t = 0; t < 20000; t += 500) {
    // No echo for a while, then the link quiet for 10 s.
    const front = t >= 4000 && t < 6000 ? 999 : 80 + t / 1000;
    if (t < 10000 || t >= 15000) ws.serverMsg(telemetry({ mode: "MANUAL", distanceFront: front, temperature: 40 + t / 10000 }));
    if (t % 2000 === 0 && (t < 10000 || t >= 15000)) ws.serverMsg({ metrics: { ...STREAM.metrics[0].metrics, loopHz: 400 + t / 1000 } });
    page.clock.advance(500);
  }
  check(now("loopHz") === "418 Hz" && now("heap") === "197 KB" && now("rssi") === "-58 dBm", `metrics: ${now("loopHz")} ${now("heap")} ${now("rssi")}`);
  // Telemetry sampled once a second: the last sample is the frame at 19 s.
  check(now("temperature") === "41.9°C" && now("distanceFront") === "99 cm", `telemetry: ${now("temperature")} ${now("distanceFront")}`);
  const pieces = (d) => (d.match(/M/g) || []).length;
  check(pieces(line("distanceFront")) === 3, `the front's line broken by the no echo and by the quiet: ${line("distanceFront")}`);
  check(pieces(line("temperature")) === 2 && pieces(line("loopHz")) === 2, `the others by the quiet alone: ${pieces(line("temperature"))} ${pieces(line("loopHz"))}`);
  check(/from 400 Hz to 418 Hz/.test(chart("loopHz").title) && all(chart("loopHz")).find((n) => n.tagName === "SVG").getAttribute("aria-label") === chart("loopHz").title, chart("loopHz").title);
  const xs = line("loopHz").match(/[ML]-?[\d.]+/g).map((s) => Number(s.slice(1)));
  check(xs.every((x) => x >= 0 && x <= page.evalIn("RoverGraphs.W")), "inside the window");
  // 20 s of samples span the chart's last minute, not a sliver of ten.
  check(Math.min(...xs) > 0.6 * page.evalIn("RoverGraphs.W"), `a fresh link fills the last minute: ${Math.min(...xs)}`);
  check(/over the last minute/.test(chart("loopHz").title), chart("loopHz").title);
  // Two minutes of samples span the two minutes, from the first.
  for (let t = 0; t < 120000; t += 2000) {
    ws.serverMsg({ metrics: { ...STREAM.metrics[0].metrics, loopHz: 400 } });
    page.clock.advance(2000);
  }
  const xs2 = line("loopHz").match(/[ML]-?[\d.]+/g).map((s) => Number(s.slice(1)));
  check(Math.min(...xs2) < 1 && /over the last 2 minutes/.test(chart("loopHz").title), `${Math.min(...xs2)} ${chart("loopHz").title}`);

  // Ten minutes on, the old samples are gone.
  page.clock.advance(10 * 60 * 1000);
  ws.serverMsg(telemetry({ mode: "MANUAL", distanceFront: 50 }));
  check(page.evalIn("roverHistory.telemetry.length") === 1, `only the last 10 minutes kept: ${page.evalIn("roverHistory.telemetry.length")}`);
  check(pieces(line("distanceFront")) === 1 && now("distanceFront") === "50 cm", "drawn from what is kept");
});

test("the drawer: under the scan, in the view, taking its height from the scan's card", () => {
  const page = loadPage();
  const view = page.$("view");
  const kids = view.children.map((n) => n.id || (n.getAttribute("class") || "").split(" ")[0]);
  check(kids.indexOf("roverLog") === kids.indexOf("readouts") + 1, `after the readouts: ${kids}`);
  check(page.$("logToggle").parentNode === page.$("move").parentNode.parentNode, "Log in the readouts' line");
  check(page.$("logToggle").getAttribute("aria-controls") === "roverLog", "it controls the drawer");
  const rules = cssRules(outside(stylesheet("rover.css"), "@container"));
  const body = rules.filter((r) => r.selector === ".roverLog").map((r) => r.body).join("");
  check(/flex:\s*1\.4 1 0;/.test(body) && /min-height:\s*0;/.test(body) && /container:\s*roverlog \/ inline-size;/.test(body), `it shares the view's height, down to nothing: ${body}`);
  check(!/position:|transform:|contain:\s*(size|layout|paint|strict|content)/.test(body), "nothing that could become a stick's containing block");
  check(!/#[0-9a-fA-F]{3,8}\b|rgb\(|hsl\(/.test(stylesheet("rover.css").replace(/\/\*[\s\S]*?\*\//g, "")), "no literal colour");
});

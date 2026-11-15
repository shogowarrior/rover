// The panel's regression harness: the real joystick.html, joy.js and panel
// scripts, run against fake-dom.js's DOM, WebSocket and virtual clock.
//
//   node --test extras/joystick/test/
//
// Each test makes many small checks and reports every one that failed, not
// only the first, so one run shows the whole of a regression.
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const nodeTest = require("node:test");
const harness = require("./harness.js");
const { loadPage, all, PANEL_ROOT, flush, connectOpen, pageFrames } = require("./fake-dom.js");
const { vectors, CODES, NAMES, FRAMES, telemetry } = require("./firmware.js");
const { stylesheet, cssRules, blockRules, outside, lookBlocks, tokensOf } = require("./css.js");
const { degrees, fitSteps } = require("../js/support.js");

let failed = null; // the running test's failed checks
let passes = 0;
function check(cond, what) {
  if (cond) passes++;
  else failed.push(what);
}
// Under harness.js's time limit, so a program that never ends fails by name
// rather than hanging the run. node:test runs a file's tests one after
// another, so they can share `failed`.
function test(name, fn) {
  harness.test(name, async () => {
    failed = [];
    await fn();
    assert.deepEqual(failed, [], `${failed.length} check(s) failed:\n  ${failed.join("\n  ")}`);
  });
}
nodeTest.after(() => console.log(`panel.test.js: ${passes} checks passed`));

/* --- helpers ------------------------------------------------------------- */

// A page whose link is up and has had its first telemetry frame.
function connected(frame, options) {
  const page = loadPage(options);
  const ws = connectOpen(page);
  ws.serverMsg(frame);
  return { page, ws };
}
const names = (ws, from = 0) => ws.moves().slice(from).map((m) => NAMES[m.move]);
const count = (ws) => ws.sent.length;

// A thumb on a stick's canvas as it is now, the translate stick's unless
// another is given; (dx, dy) is from its centre.
function stickTouch(page, id = 0, c = page.canvas) {
  const touch = (dx, dy) => ({ identifier: id, target: c, pageX: c.width / 2 + dx, pageY: c.height / 2 + dy });
  return {
    start(dx = 0, dy = 0) { page.fire(c, "touchstart", { targetTouches: [touch(dx, dy)], changedTouches: [touch(dx, dy)] }); },
    move(dx, dy) { page.fire(c, "touchmove", { targetTouches: [touch(dx, dy)], changedTouches: [touch(dx, dy)] }); },
    end() { page.fire(c, "touchend", { targetTouches: [], changedTouches: [{ identifier: id }] }); },
    cancel() { page.fire(c, "touchcancel", { targetTouches: [], changedTouches: [{ identifier: id }] }); },
  };
}
// A thumb on the pivot stick's canvas.
const pivotTouch = (page, id = 0) => stickTouch(page, id, page.pivotCanvas);
// Whether the pivot stick and its selector are on, every way the page says
// so: "on", "off", or what disagrees.
function pivotsState(page) {
  const say = [page.$("family").dataset.off, page.$("pivotPad").dataset.off, ...all(page.$("familyChoice")).filter((n) => n.dataset.family).map((b) => (b.disabled ? "yes" : "no"))];
  const driver = page.evalIn("driver.pivots");
  if (say.every((v) => v === "no") && driver === true) return "on";
  if (say.every((v) => v === "yes") && driver === false) return "off";
  return `mixed ${say} driver ${driver}`;
}
const press = (page, el, pointerId, extra = {}) => page.fire(el, "pointerdown", { pointerId, button: 0, ...extra });
const lift = (page, el, pointerId, type = "pointerup") => page.fire(el, type, { pointerId, button: 0 });
// Each bearing of BEARINGS with the wedge and reading the fan drew for it,
// found in the SVG, where they are laid out in BEARINGS order.
function scanBearings(page) {
  const nodes = all(page.$("scan"));
  const wedges = nodes.filter((n) => n.getAttribute("class") === "wedge");
  const readings = nodes.filter((n) => n.getAttribute("class") === "reading");
  return page.evalIn("BEARINGS").map((b, i) => ({ ...b, wedge: wedges[i], reading: readings[i] }));
}
// Whether script a is in the page's order before script b.
const loadsBefore = (order, a, b) => order.includes(a) && order.includes(b) && order.indexOf(a) < order.indexOf(b);

/* --- tests --------------------------------------------------------------- */

test("loads clean from the HTML: scripts, ids, initial state", () => {
  const page = loadPage();
  const order = page.scripts;
  // support.js and look.js in <head>, so the look is on before the first
  // paint; the vendored joy.js first in <body>.
  check(order.slice(0, 3).join() === "js/support.js,js/look.js,joy.js" && order[order.length - 1] === "js/app.js",
    `support.js, look.js and joy.js first, app.js last: ${order}`);
  check(new Set(order).size === order.length, `each script once: ${order}`);
  for (const [a, b] of [
    ["js/support.js", "js/link.js"], ["js/support.js", "js/drive.js"], ["js/support.js", "js/tabs.js"],
    ["js/protocol.js", "js/mecanum.js"], ["js/protocol.js", "js/link.js"], ["js/protocol.js", "js/scan.js"],
    ["js/mecanum.js", "js/drive.js"], ["js/look.js", "js/drive.js"], ["js/look.js", "js/blocks.js"],
    ["js/support.js", "js/firmware.js"], ["js/protocol.js", "js/firmware.js"], ["js/md5.js", "js/firmware.js"],
  ]) check(loadsBefore(order, a, b), `${a} loads before ${b}: ${order}`);
  check(page.errors.length === 0, `errors ${page.errors}`);
  check(page.doc.body.dataset.link === "down", "link down");
  check(page.$("connect").textContent === "Connect", "button Connect");
  check(page.$("linkState").textContent === "Not connected", `the chip says ${page.$("linkState").textContent}`);
  check(page.$("linkChip").dataset.say === "down", `the chip's colour: ${page.$("linkChip").dataset.say}`);
  check(/^Not connected to the rover \(192\.168\.0\.115\)/.test(page.$("linkChip").title), `the chip's title names the address: ${page.$("linkChip").title}`);
  check(page.$("linkPanel").hidden && page.$("linkChip").getAttribute("aria-expanded") === "false", "the link's popover closed at load");
  check(page.$("note").textContent === "Enter the rover's address and connect.", "help note");
  check(page.$("phaseCell").hidden === true, "phase hidden at load");
  const wedges = all(page.$("scan")).filter((n) => n.getAttribute("class") === "wedge");
  check(wedges.length === 5, `5 wedges, got ${wedges.length}`);
  check(page.canvas !== undefined, "joy.js canvas inside #stick");
  check(page.sockets.length === 0, "no socket until asked");
});

// Classic scripts share one scope, and a second top-level declaration of a
// name stops the later script from loading. So app.js's header names what
// each script declares at top level for the others, and a class that one
// script keeps for itself lives inside the class that uses it.
test("app.js names every class a script declares at top level", () => {
  const read = (file) => fs.readFileSync(path.join(PANEL_ROOT, file), "utf8");
  const roster = {}; // script -> what app.js's header says it declares
  let entry = null;
  for (const line of read("js/app.js").split("*/")[0].split("\n")) {
    const first = line.match(/^ \*   (\S+\.js)\s+(.*)$/);
    const more = line.match(/^ \*\s{6,}(\S.*)$/);
    if (first) roster[(entry = first[1])] = first[2];
    else if (entry && more) roster[entry] += ` ${more[1]}`;
    else entry = null;
  }
  const scripts = loadPage().scripts.filter((src) => src.startsWith("js/") && src !== "js/app.js");
  check(scripts.length >= 10, `the page's scripts: ${scripts}`);
  for (const src of scripts) {
    const named = roster[src.slice("js/".length)];
    check(named !== undefined, `app.js's header has a line for ${src}`);
    for (const [, name] of read(src).matchAll(/^class\s+([A-Za-z_$][\w$]*)/gm)) {
      check(new RegExp(`\\b${name}\\b`).test(named || ""), `app.js's header names ${name}, a class ${src} declares at top level`);
    }
  }
});

test("hover across a rotate button sends nothing (autonomous, idle)", () => {
  const { page, ws } = connected(telemetry(), { touch: false });
  for (const b of ["cw", "ccw"]) {
    page.fire(page.$(b), "pointerover", { pointerId: 1, button: -1 });
    page.fire(page.$(b), "pointerleave", { pointerId: 1, button: -1 });
    page.fire(page.$(b), "pointerup", { pointerId: 1, button: 0 }); // mouse pressed elsewhere, released here
    page.fire(page.$(b), "pointercancel", { pointerId: 1, button: -1 });
  }
  page.clock.advance(1000);
  check(count(ws) === 0, `sent ${names(ws)}`);
});

test("a mouse hover does not release a button held by a finger", () => {
  const page = loadPage();
  const ws = connectOpen(page);
  press(page, page.$("cw"), 7);
  check(names(ws).join() === "ROTATE_CLOCKWISE", `press sent ${names(ws)}`);
  page.fire(page.$("cw"), "pointerleave", { pointerId: 1, button: -1 }); // the mouse passing over
  page.clock.advance(1000);
  check(!names(ws).includes("STOP"), "no STOP from the hover");
  check(page.$("cw").dataset.held === "yes", "still lit");
  const before = count(ws);
  lift(page, page.$("cw"), 7);
  page.fire(page.$("cw"), "pointerleave", { pointerId: 7, button: -1 }); // touch lift also fires leave
  check(names(ws, before).join() === "STOP", `release sent ${names(ws, before)}`);
  check(page.$("cw").dataset.held === undefined, "unlit");
  const after = count(ws);
  page.clock.advance(1000);
  check(count(ws) === after, "repeat stopped");
});

test("right-click on a rotate button sends nothing", () => {
  const page = loadPage({ touch: false });
  const ws = connectOpen(page);
  press(page, page.$("ccw"), 1, { button: 2 });
  page.clock.advance(500);
  check(count(ws) === 0, `sent ${names(ws)}`);
});

test("blur / hidden / pagehide while autonomous and idle send nothing", () => {
  const { page, ws } = connected(telemetry());
  page.fire(page.win, "blur", { bubbles: false });
  page.doc.hidden = true;
  page.fire(page.doc, "visibilitychange", { bubbles: false });
  page.fire(page.win, "pagehide", { bubbles: false });
  page.clock.advance(1000);
  check(count(ws) === 0, `sent ${names(ws)}`);
});

test("blur while driving sends exactly one STOP and ends the repeat", () => {
  const page = loadPage();
  const ws = connectOpen(page);
  const s = stickTouch(page);
  s.start(); s.move(0, -50);
  page.clock.advance(1000);
  const drove = names(ws);
  check(drove.length >= 5 && drove.every((n) => n === "MOVE_FORWARD"), `drove ${drove}`);
  const before = count(ws);
  page.fire(page.win, "blur", { bubbles: false });
  page.doc.hidden = true;
  page.fire(page.doc, "visibilitychange", { bubbles: false }); // often follows blur
  page.fire(page.win, "pagehide", { bubbles: false });
  page.clock.advance(2000);
  check(names(ws, before).join() === "STOP", `after blur ${names(ws, before)}`);
});

test("Enter while connected: one socket, no stale handler effects", () => {
  const page = loadPage();
  const ws1 = connectOpen(page);
  ws1.serverMsg(telemetry({ mode: "MANUAL" }));
  // driving on ws1 when Enter is pressed: STOP goes out on ws1 before it closes
  const s = stickTouch(page);
  s.start(); s.move(0, -50);
  page.fire(page.$("host"), "keydown", { key: "Enter" });
  check(page.sockets.length === 2, `sockets ${page.sockets.length}`);
  check(ws1.closeCalls === 1, "old socket closed");
  check(names(ws1).slice(-1)[0] === "STOP", `ws1 ended with ${names(ws1).slice(-1)}`);
  const ws2 = page.sockets[1];
  check(page.evalIn("link.state") === "connecting", "the new socket is the current one, connecting");
  check(page.$("connect").textContent === "Cancel", "Cancel while connecting");
  ws2.serverOpen();
  ws2.serverMsg(telemetry({ mode: "AUTONOMOUS" }));
  // start driving on ws2 before ws1's close arrives
  s.start(); s.move(50, 0);
  check(names(ws2).join() === "MOVE_RIGHT", `ws2 ${names(ws2)}`);
  // late traffic from the old socket must be ignored
  ws1.serverMsg(telemetry({ mode: "MANUAL", distanceFront: 10 }));
  check(page.$("mode").textContent === "AUTONOMOUS", "stale telemetry not rendered");
  page.clock.advance(60); // ws1's close event fires now
  check(ws1.readyState === 3, "ws1 closed");
  check(page.doc.body.dataset.link === "up", `link ${page.doc.body.dataset.link}`);
  check(page.$("connect").textContent === "Disconnect", "button still Disconnect");
  check(page.$("note").textContent === "", `note '${page.$("note").textContent}'`);
  page.clock.advance(600);
  const ws2Names = names(ws2);
  check(!ws2Names.includes("STOP") && ws2Names.length >= 3, `ws2 still driving: ${ws2Names}`);
  // exactly one live socket, and connected ones other than ws2 are closed
  check(page.sockets.filter((w) => w.readyState < 2).length === 1, "one live socket");
  check(page.errors.length === 0, `errors ${page.errors}`);
});

test("Enter while connecting replaces the connecting socket", () => {
  const page = loadPage();
  page.$("host").value = "10.0.0.7";
  page.fire(page.$("connect"), "click");
  page.fire(page.$("host"), "keydown", { key: "Enter" });
  page.fire(page.$("host"), "keydown", { key: "Enter" });
  check(page.sockets.length === 3, "three attempts");
  check(page.sockets.slice(0, 2).every((w) => w.closeCalls === 1), "earlier ones closed");
  page.clock.advance(100); // their close events fire
  check(page.doc.body.dataset.link === "connecting", `link ${page.doc.body.dataset.link}`);
  check(!/Not reachable/.test(page.$("note").textContent), `note ${page.$("note").textContent}`);
});

test("Connect is Cancel while connecting, and cancel is a neutral disconnect", () => {
  const page = loadPage();
  page.$("host").value = "10.0.0.7";
  page.fire(page.$("connect"), "click");
  check(page.$("connect").textContent === "Cancel", "Cancel label");
  check(page.$("linkState").textContent === "Connecting…", `Connecting label: ${page.$("linkState").textContent}`);
  check(/^Connecting to the rover at 10\.0\.0\.7/.test(page.$("linkChip").title), `the chip's title names the address being tried: ${page.$("linkChip").title}`);
  page.fire(page.$("connect"), "click");
  check(page.sockets.length === 1, "no second socket");
  check(page.sockets[0].closeCalls === 1, "closed");
  page.clock.advance(100);
  check(page.$("note").textContent === "Disconnected.", `note '${page.$("note").textContent}'`);
  check(page.$("note").dataset.tone === "", "neutral tone");
  check(page.$("connect").textContent === "Connect", "Connect again");
});

test("deliberate disconnect: neutral note, no stale relabel, no timers left", () => {
  const { page, ws } = connected(telemetry());
  page.fire(page.$("connect"), "click");
  check(count(ws) === 0, `autonomous idle rover not stopped: ${names(ws)}`);
  page.clock.advance(3000);
  check(page.doc.body.dataset.link === "down", `link ${page.doc.body.dataset.link}`);
  check(page.$("note").textContent === "Disconnected.", `note '${page.$("note").textContent}'`);
  check(page.$("connect").textContent === "Connect", "Connect");
  check(page.clock.pending() === 0, `timers pending ${page.clock.pending()}`);
});

test("stale telemetry, then a dropped link, stays down", () => {
  const { page, ws } = connected(telemetry());
  const staleMs = page.evalIn("Link.STALE_MS");
  // Two frames missed, and the next one late, is a slow link, not a dead one.
  const late = 2 * page.evalIn("TELEMETRY_MS") + 100;
  page.clock.advance(late);
  check(page.doc.body.dataset.link === "up", `up after ${late} ms of silence, with STALE_MS ${staleMs}`);
  page.clock.advance(staleMs - late - 1);
  check(page.doc.body.dataset.link === "up", "up until STALE_MS");
  page.clock.advance(1);
  check(page.doc.body.dataset.link === "stale", `stale after STALE_MS (${staleMs} ms) of silence`);
  check(page.$("connect").textContent === "Disconnect", "Disconnect while stale");
  ws.serverMsg(telemetry());
  check(page.doc.body.dataset.link === "up" && page.$("note").textContent === "", "fresh again");
  ws.serverDrop();
  check(page.doc.body.dataset.link === "down", "down on close");
  check(/Lost the link/.test(page.$("note").textContent) && page.$("note").dataset.tone === "bad", `note ${page.$("note").textContent}`);
  page.clock.advance(3000);
  check(page.doc.body.dataset.link === "down", `still down, got ${page.doc.body.dataset.link}`);
  check(page.$("connect").textContent === "Connect", "button Connect");
  check(page.clock.pending() === 0, `timers pending ${page.clock.pending()}`);
});

test("unreachable host reports Not reachable", () => {
  const page = loadPage();
  page.$("host").value = "10.0.0.99";
  page.fire(page.$("connect"), "click");
  page.sockets[0].serverDrop();
  check(/^Not reachable at ws:\/\/10\.0\.0\.99:81\./.test(page.$("note").textContent), page.$("note").textContent);
  check(page.$("note").dataset.tone === "bad", "bad tone");
  page.$("host").value = "localhost:8081";
  page.fire(page.$("connect"), "click");
  check(page.sockets[1].url === "ws://localhost:8081", page.sockets[1].url);
});

// A rover that never answered is not a link that went: the chip, the card
// and its button say which (the critics' round 3: both read "Link lost"),
// while the Driver, the program and the readouts hear "linkLost" for both,
// since nothing can reach the rover either way.
test("a socket that never opens reads Not reachable, one that went reads Link lost; both stand down as linkLost", () => {
  const page = loadPage();
  const heard = listen(page);
  page.$("host").value = "10.0.0.99";
  page.fire(page.$("connect"), "click");
  page.sockets[0].serverDrop();
  check(page.$("linkChip").dataset.say === "unreachable", `said ${page.$("linkChip").dataset.say}`);
  check(page.$("linkState").textContent === "Not reachable", `chip ${page.$("linkState").textContent}`);
  check(page.$("connectTitle").textContent === "Not reachable", `card ${page.$("connectTitle").textContent}`);
  check(page.$("connectGo").textContent === "Try again", `card button ${page.$("connectGo").textContent}`);
  check(/^Not reachable: no rover answered at 10\.0\.0\.99\./.test(page.$("linkChip").title), `chip title ${page.$("linkChip").title}`);
  check(page.doc.body.dataset.link === "down" && heard.downs() === "linkLost", `down as ${heard.downs()}`);
  page.fire(page.$("connectGo"), "click"); // Try again is a press of Connect
  check(page.sockets.length === 2 && page.sockets[1].url === "ws://10.0.0.99:81", `tried again: ${page.sockets.map((w) => w.url)}`);
  check(page.$("connectTitle").textContent === "Connecting to 10.0.0.99…", `card ${page.$("connectTitle").textContent}`);
  check(page.$("connectGo").textContent === "Cancel", `card button ${page.$("connectGo").textContent}`);
  page.sockets[1].serverOpen();
  page.evalIn("__downs.length = 0");
  page.sockets[1].serverDrop();
  check(page.$("linkChip").dataset.say === "lost" && page.$("linkState").textContent === "Link lost", `chip ${page.$("linkState").textContent}`);
  check(page.$("connectTitle").textContent === "Link lost" && page.$("connectGo").textContent === "Reconnect", `card ${page.$("connectTitle").textContent} / ${page.$("connectGo").textContent}`);
  check(heard.downs() === "linkLost", `down as ${heard.downs()}`);
  page.fire(page.$("connect"), "click");
  page.fire(page.$("connect"), "click"); // Cancel: a deliberate disconnect
  check(page.$("linkChip").dataset.say === "down" && page.$("linkState").textContent === "Not connected", `chip ${page.$("linkState").textContent}`);
  check(page.$("connectTitle").textContent === "Not connected" && page.$("connectGo").textContent === "Connect to 10.0.0.99", `card ${page.$("connectTitle").textContent} / ${page.$("connectGo").textContent}`);
  check(page.errors.length === 0, `errors ${page.errors}`);
});

// The chip says the link's state in one word at every width, never what a
// press would do ("Connect" read as a button and as a state at once): the
// critics' round 3. Each state has its word, and every word has a sizer in
// the chip's slot, so a change of state moves nothing.
test("the chip names each state in its own word, never a verb", () => {
  const page = loadPage();
  const said = () => page.$("linkState").textContent;
  const sizers = page.$("linkChip").querySelectorAll(".chipSizer").map((each) => each.textContent);
  const words = Object.values(page.evalIn("Link.LABEL"));
  check(new Set(words).size === words.length, `one word per state: ${words}`);
  check(words.every((word) => sizers.includes(word)), `a sizer for each: ${sizers}`);
  check(words.every((word) => !/^(Connect|Reconnect|Disconnect|Cancel)$/.test(word)), `no verbs: ${words}`);
  check(said() === "Not connected", `at load ${said()}`);
  const ws = connectOpen(page);
  check(said() === "Connected", `open ${said()}`);
  ws.serverMsg(telemetry());
  page.clock.advance(page.evalIn("Link.STALE_MS"));
  check(said() === "No data", `stale ${said()}`);
  check(page.$("linkChip").querySelector(".caret") !== null, "the caret is always there");
});

// With no socket, the chip, the card and its button name the address a
// press of Connect will use, the field's, whatever a socket that has gone
// was opened to (the critics' round 3: "Connect to" the old address).
test("once the socket goes, the card names the field's address, not the old link's", () => {
  for (const [how, end] of [["Disconnect", (page) => page.fire(page.$("connect"), "click")], ["a dropped link", (page, ws) => ws.serverDrop()]]) {
    const page = loadPage();
    page.$("host").value = "10.0.0.7";
    page.fire(page.$("connect"), "click");
    const ws = page.sockets[0];
    ws.serverOpen();
    ws.serverMsg(telemetry());
    page.$("host").value = "10.0.0.8";
    page.fire(page.$("host"), "input");
    check(/10\.0\.0\.7/.test(page.$("linkChip").title), `${how}: while up the chip names the link's own: ${page.$("linkChip").title}`);
    end(page, ws);
    const go = page.$("connectGo");
    check(/10\.0\.0\.8/.test(go.textContent + go.title) && !/10\.0\.0\.7/.test(go.textContent + go.title), `${how}: card button ${go.textContent} / ${go.title}`);
    check(/10\.0\.0\.8/.test(page.$("linkChip").title) && !/10\.0\.0\.7/.test(page.$("linkChip").title), `${how}: chip title ${page.$("linkChip").title}`);
    page.fire(go, "click");
    check(page.sockets[1].url === "ws://10.0.0.8:81", `${how}: connected to ${page.sockets[1].url}`);
    check(page.$("connectTitle").textContent === "Connecting to 10.0.0.8…", `${how}: card ${page.$("connectTitle").textContent}`);
  }
});

test("link lost while driving: repeat ends, inputs forgotten", () => {
  const page = loadPage();
  const ws = connectOpen(page);
  press(page, page.$("cw"), 3);
  page.clock.advance(500);
  ws.serverDrop();
  check(page.evalIn("driver.driving") === null && page.clock.pending() === 0, "not repeating");
  check(page.$("cw").dataset.held === undefined, "button unlit");
  const ws2 = connectOpen(page);
  page.clock.advance(1000);
  check(count(ws2) === 0, `nothing resent after reconnect: ${names(ws2)}`);
  lift(page, page.$("cw"), 3); // the finger finally lifts
  check(count(ws2) === 0, `stale release sent ${names(ws2)}`);
});

test("touchcancel on the stick stops the repeat and recentres the knob", () => {
  const page = loadPage();
  const ws = connectOpen(page);
  const s = stickTouch(page, 0);
  s.start(); s.move(0, -50);
  page.clock.advance(1000);
  check(names(ws).every((n) => n === "MOVE_FORWARD") && count(ws) >= 5, `drove ${names(ws)}`);
  check(page.joy.GetY() !== "0", "knob deflected");
  const before = count(ws);
  s.cancel(); // dispatched on the canvas, bubbles to #stick
  page.clock.advance(3000);
  check(names(ws, before).join() === "STOP", `after cancel ${names(ws, before)}`);
  check(page.joy.GetX() === "0" && page.joy.GetY() === "0", `knob at ${page.joy.GetX()},${page.joy.GetY()}`);
  check(page.errors.length === 0, `errors ${page.errors}`);
});

test("touchcancel of the stick leaves a held rotate button driving", () => {
  const page = loadPage();
  const ws = connectOpen(page);
  const s = stickTouch(page, 0);
  s.start(); s.move(0, -50);
  press(page, page.$("ccw"), 5);
  const before = count(ws);
  s.cancel();
  page.clock.advance(1000);
  const after = names(ws, before);
  check(!after.includes("STOP") && after.length >= 4 && after.every((n) => n === "ROTATE_COUNTERCLOCKWISE"), `after ${after}`);
});

test("touchcancel with an empty changedTouches still releases", () => {
  const page = loadPage();
  const ws = connectOpen(page);
  const s = stickTouch(page, 0);
  s.start(); s.move(0, -50);
  const before = count(ws);
  page.fire(page.canvas, "touchcancel", { targetTouches: [], changedTouches: [] });
  page.clock.advance(1000);
  check(names(ws, before).join() === "STOP", `after ${names(ws, before)}`);
});

test("two thumbs: releasing the rotate button resumes the held stick", () => {
  const page = loadPage();
  const ws = connectOpen(page);
  const s = stickTouch(page, 0);
  s.start(); s.move(0, -50);
  let mark = count(ws);
  press(page, page.$("cw"), 2);
  check(names(ws, mark).join() === "ROTATE_CLOCKWISE", `rotate ${names(ws, mark)}`);
  check(ws.sentAt[mark] === page.clock.now(), "rotate went out immediately");
  page.clock.advance(600);
  mark = count(ws);
  lift(page, page.$("cw"), 2);
  check(names(ws, mark).join() === "MOVE_FORWARD", `after lift ${names(ws, mark)}`);
  page.clock.advance(600);
  check(!names(ws, mark).includes("STOP") && names(ws, mark).every((n) => n === "MOVE_FORWARD"), `stick kept ${names(ws, mark)}`);
  mark = count(ws);
  s.end();
  page.clock.advance(600);
  check(names(ws, mark).join() === "STOP", `stick release ${names(ws, mark)}`);
});

test("two thumbs: tapping the stick leaves a held rotate button driving", () => {
  const page = loadPage();
  const ws = connectOpen(page);
  press(page, page.$("cw"), 2);
  const s = stickTouch(page, 1);
  s.start(); s.end(); // a tap: joy.js reports centre
  s.start(); s.move(10, -40); s.end(); // a flick
  page.clock.advance(1000);
  const sent = names(ws);
  check(!sent.includes("STOP") && sent.every((n) => n === "ROTATE_CLOCKWISE"), `sent ${sent}`);
  check(page.$("cw").dataset.held === "yes", "button still lit");
});

test("both rotate buttons: the latest wins, releasing it falls back", () => {
  const page = loadPage();
  const ws = connectOpen(page);
  press(page, page.$("cw"), 2);
  press(page, page.$("ccw"), 3);
  lift(page, page.$("ccw"), 3);
  lift(page, page.$("cw"), 2);
  check(names(ws).join() === "ROTATE_CLOCKWISE,ROTATE_COUNTERCLOCKWISE,ROTATE_CLOCKWISE,STOP", names(ws).join());
});

test("mouse-driven stick: hovering a rotate button mid-drag does not stop it", () => {
  const page = loadPage({ touch: false });
  const ws = connectOpen(page);
  page.fire(page.canvas, "mousedown", { button: 0 });
  page.fire(page.canvas, "mousemove", { pageX: 115, pageY: 60 });
  page.fire(page.$("cw"), "pointerleave", { pointerId: 1, button: -1 });
  page.clock.advance(600);
  check(!names(ws).includes("STOP") && count(ws) >= 3, `drag ${names(ws)}`);
  const mark = count(ws);
  page.fire(page.doc, "mouseup", {});
  page.clock.advance(600);
  check(names(ws, mark).join() === "STOP", `mouseup ${names(ws, mark)}`);
});

/* --- the stick latches, primary presses only, repeat phase ---------------- */

// A mouse on a stick's canvas, the translate stick's unless another is
// given; (dx, dy) is from its centre. joy.js follows a drag on the
// document, as it does the release.
function mouseStick(page, c = page.canvas) {
  return {
    down(extra = {}) { page.fire(c, "mousedown", { button: 0, ...extra }); },
    move(dx, dy) { page.fire(page.doc, "mousemove", { pageX: c.width / 2 + dx, pageY: c.height / 2 + dy }); },
    up() { page.fire(page.doc, "mouseup", { button: 0 }); },
  };
}

test("mouse: blur mid-drag with the mouseup lost, then a bare mousemove sends nothing", () => {
  const page = loadPage({ touch: false });
  const ws = connectOpen(page);
  const m = mouseStick(page);
  m.down(); m.move(0, -95);
  page.clock.advance(250);
  check(count(ws) >= 2 && names(ws).every((n) => n === "MOVE_FORWARD"), `drove ${names(ws)}`);
  let mark = count(ws);
  page.fire(page.win, "blur", { bubbles: false });
  check(names(ws, mark).join() === "STOP", `blur ${names(ws, mark)}`);
  mark = count(ws);
  ws.serverMsg(telemetry()); // exploring again, from elsewhere
  page.clock.advance(2000);
  m.move(185, 0); // back on the page, no button down; joy.js still thinks it is pressed
  page.clock.advance(1000);
  check(count(ws) === mark, `sent ${names(ws, mark)}`);
  // A fresh press drives again.
  m.down(); m.move(95, 0);
  check(names(ws, mark).join() === "MOVE_RIGHT", `fresh press ${names(ws, mark)}`);
});

test("touch: Stop under a resting thumb latches until the thumb presses again", () => {
  const page = loadPage();
  const ws = connectOpen(page);
  const s = stickTouch(page, 5);
  s.start(); s.move(0, -80);
  page.clock.advance(250);
  let mark = count(ws);
  page.fire(page.$("stop"), "click");
  check(names(ws, mark).join() === "STOP", `stop ${names(ws, mark)}`);
  mark = count(ws);
  page.clock.advance(1000);
  s.move(0, -82); s.move(20, -60); // the thumb twitches
  page.clock.advance(1000);
  check(count(ws) === mark, `twitch sent ${names(ws, mark)}`);
  s.end(); // lifting sends nothing either: nothing is being driven
  check(count(ws) === mark, `lift sent ${names(ws, mark)}`);
  s.start(); s.move(0, -80);
  check(names(ws, mark).join() === "MOVE_FORWARD", `new press ${names(ws, mark)}`);
});

test("touch: Autonomous under a resting thumb sends only RESUME_AUTONOMOUS", () => {
  const page = loadPage();
  const ws = connectOpen(page);
  const s = stickTouch(page, 5);
  s.start(); s.move(0, -80);
  page.clock.advance(250);
  const mark = count(ws);
  page.fire(page.$("auto"), "click");
  page.clock.advance(500);
  s.move(1, -80);
  page.clock.advance(1000);
  check(names(ws, mark).join() === "RESUME_AUTONOMOUS", `sent ${names(ws, mark)}`);
});

test("link lost with the mouse holding the stick: the new link is not driven by a bare move", () => {
  const page = loadPage({ touch: false });
  const ws = connectOpen(page);
  const m = mouseStick(page);
  m.down(); m.move(0, -95);
  ws.serverDrop();
  const ws2 = connectOpen(page);
  m.move(0, -90);
  page.clock.advance(1000);
  check(count(ws2) === 0, `sent ${names(ws2)}`);
});

test("right-click and ctrl-click on the stick never drive, menu suppressed", () => {
  for (const press of [{ button: 2 }, { button: 0, ctrlKey: true }, { button: 1 }]) {
    const { page, ws } = connected(telemetry(), { touch: false });
    const m = mouseStick(page);
    m.down(press);
    const menu = page.fire(page.canvas, "contextmenu", { button: 2 });
    check(menu.defaultPrevented, `${JSON.stringify(press)}: context menu suppressed`);
    // The worst case: the release is lost and the mouse wanders over the page.
    m.move(185, 85);
    m.move(-100, 40);
    page.clock.advance(1000);
    check(count(ws) === 0, `${JSON.stringify(press)}: sent ${names(ws)}`);
  }
});

test("a right-drag after a normal left press-and-release does not drive", () => {
  const { page, ws } = connected(telemetry(), { touch: false });
  const m = mouseStick(page);
  m.down(); m.up(); // a plain click on the stick: joy.js reports centre, nothing driven
  m.down({ button: 2 }); m.move(0, -95);
  page.clock.advance(1000);
  check(count(ws) === 0, `sent ${names(ws)}`);
});

test("ctrl-click on a rotate button sends nothing; its menu is suppressed", () => {
  const { page, ws } = connected(telemetry(), { touch: false });
  for (const b of ["cw", "ccw"]) {
    press(page, page.$(b), 1, { ctrlKey: true });
    const menu = page.fire(page.$(b), "contextmenu", { button: 0, ctrlKey: true });
    check(menu.defaultPrevented, `${b}: context menu suppressed`);
    check(page.$(b).dataset.held === undefined, `${b}: not lit`);
  }
  page.clock.advance(1000);
  check(count(ws) === 0, `sent ${names(ws)}`);
});

test("repeat counts from the last send: no second speed a frame after a stick send", () => {
  const page = loadPage();
  const ws = connectOpen(page);
  const s = stickTouch(page, 1);
  s.start();
  s.move(0, -40);                         // t=0: sent at once (new direction)
  page.clock.advance(180); s.move(0, -50); // t=180: new speed, 180 ms since the last send: sent
  page.clock.advance(16); s.move(0, -60);  // t=196: new speed again: throttled
  page.clock.advance(400);
  const t = ws.sentAt.map((x) => x - ws.sentAt[0]);
  const speeds = ws.moves().map((m) => m.speed);
  check(t.slice(0, 3).join() === "0,180,380", `send times ${t}`);
  check(speeds[2] === page.evalIn("driver.driving").speed && speeds[2] !== speeds[1], `the repeat carries the throttled speed: ${speeds}`);
  let close = 0;
  for (let i = 1; i < t.length; i++) if (t[i] - t[i - 1] < 100) close++;
  check(close === 0, `sends closer than 100 ms: ${t}`);
});

test("a held rotate button is refreshed every 200 ms, well inside its 400 ms move", () => {
  const page = loadPage();
  const ws = connectOpen(page);
  press(page, page.$("cw"), 2);
  page.clock.advance(1000);
  const t = ws.sentAt.map((x) => x - ws.sentAt[0]);
  check(t.join() === "0,200,400,600,800,1000", `send times ${t}`);
});

test("stick throttle: same move at most every 100 ms, direction change at once", () => {
  const page = loadPage();
  const ws = connectOpen(page);
  const s = stickTouch(page, 0);
  s.start();
  // 1 s of a wobbling forward push: an event every 10 ms, the speed changing each time
  for (let i = 0; i < 100; i++) {
    s.move(i % 2 ? 3 : -3, -20 - (i % 30));
    page.clock.advance(10);
  }
  const sent = ws.moves();
  check(sent.every((m) => m.move === CODES.MOVE_FORWARD), "all forward");
  check(sent.length <= 16 && sent.length >= 10, `sends in 1 s from 100 events: ${sent.length}`);
  // No two sends of the same move closer than 100 ms -- repeat ticks included --
  // and never more than 200 ms between sends while held.
  let bad = 0;
  for (let i = 1; i < ws.sentAt.length; i++) {
    const gap = ws.sentAt[i] - ws.sentAt[i - 1];
    if (gap < 100 || gap > 200) bad++;
  }
  check(bad === 0, `${bad} gaps outside 100..200 ms: ${ws.sentAt.map((t, i) => (i ? t - ws.sentAt[i - 1] : 0))}`);
  // The latest speed still arrives, carried by the repeat.
  const lastWanted = page.evalIn("driver.driving").speed;
  page.clock.advance(200);
  check(ws.moves().slice(-1)[0].speed === lastWanted, "repeat carries the latest speed");
  // A direction change goes out immediately, even inside the window.
  const mark = count(ws);
  s.move(40, 0);
  check(names(ws, mark).join() === "MOVE_RIGHT" && ws.sentAt[mark] === page.clock.now(), `change ${names(ws, mark)}`);
  // An unchanged stick sends nothing extra: only the repeat.
  const mark2 = count(ws);
  for (let i = 0; i < 50; i++) { s.move(40, 0); page.clock.advance(10); }
  check(count(ws) - mark2 === 2 || count(ws) - mark2 === 3, `unchanged stick for 500 ms sent ${count(ws) - mark2}`);
});

// Green, amber and red come close for red-green colour blindness, so a clear
// way is told apart by its shape too: open, where closing in and STOP are
// solid.
test("the scan draws a clear way open: a faint body inside a green edge", () => {
  const clear = cssRules(panelCss()).filter((rule) => rule.selector === '.wedge[data-zone="clear"]');
  check(clear.length === 1, `one rule for it: ${clear.length}`);
  const opacity = Number((clear[0].body.match(/fill-opacity:\s*([\d.]+)/) || [])[1]);
  check(opacity > 0 && opacity <= 0.4, `its body faint: ${opacity}`);
  // In --ok-body, which a look on a blue ground makes yellower than its
  // --ok, or the mix would be teal (looks.test.js checks every look).
  check(/(^|[^-])fill:\s*var\(--ok-body\)/.test(clear[0].body), `its body in --ok-body: ${clear[0].body}`);
  check(/stroke:\s*var\(--ok\)/.test(clear[0].body) && /stroke-width:/.test(clear[0].body), `its edge in green: ${clear[0].body}`);
  const HISTORY = 'body:not([data-link="up"]) .wedge[data-zone="clear"]';
  const solid = cssRules(panelCss()).filter((rule) => /\.wedge\b/.test(rule.selector) && ![".wedge[data-zone=\"clear\"]", HISTORY].includes(rule.selector) && /(^|[\s;])(fill-opacity|stroke)\s*:/.test(rule.body));
  check(solid.length === 0, `nothing else outlines or fades a wedge: ${solid.map((rule) => rule.selector)}`);
  // A link that goes fades the fan to a quarter: a green that faint over
  // Blueprint's navy or pale blue mixes to teal, so history's clear way
  // greys, still open. By its colours: WebKit applies no CSS filter to an
  // SVG shape.
  const history = cssRules(panelCss()).filter((rule) => rule.selector === HISTORY);
  check(history.length === 1 && /(^|[^-])fill:\s*var\(--dim\)/.test(history[0].body) && /stroke:\s*var\(--dim\)/.test(history[0].body) && !/filter/.test(history[0].body),
    `a stale clear way greyed by its colours: ${history.map((rule) => rule.body)}`);
  // A zone change eases the body's opacity with its colour, or for a moment
  // a clear way turning amber is solid green: the shape for closing in.
  const wedge = cssRules(panelCss()).find((rule) => rule.selector === ".wedge");
  check(wedge && /transition:[^;]*fill-opacity/.test(wedge.body), `the body's opacity eases: ${wedge && wedge.body}`);
});

test("look: Blockly's own rules do not outrank the look's ink on a flyout button", () => {
  // The renderer injects .zelos-renderer.rover-theme .blocklyText (white),
  // which a plainer selector loses to: white on a light look's button.
  const rule = cssRules(stylesheet("program.css")).find((r) => /\.blocklyFlyoutButton \.blocklyText$/.test(r.selector));
  check(rule && rule.selector.startsWith(".zelos-renderer.rover-theme ") && /fill:\s*var\(--readout\)/.test(rule.body), `outranks the renderer: ${rule && rule.selector}`);
});

test("telemetry: five wedges coloured by STOP/GO, no echo faded at full reach", () => {
  const { page, ws } = connected(telemetry({ distanceLeft: 20, distanceFrontLeft: 30, distanceFront: 150, distanceFrontRight: 999, distanceRight: 25 }));
  const B = scanBearings(page);
  const by = Object.fromEntries(B.map((b) => [b.key, b]));
  for (const b of B) check(b.wedge.getAttribute("d") !== "", `${b.key} drawn`);
  check(by.distanceLeft.wedge.getAttribute("fill") === "var(--stop)", "20 cm red");
  check(by.distanceRight.wedge.getAttribute("fill") === "var(--stop)", "25 cm (= STOP) red");
  check(by.distanceFrontLeft.wedge.getAttribute("fill") === "var(--warn)", "30 cm amber");
  check(by.distanceFront.wedge.getAttribute("fill") === "var(--ok)", "150 cm green");
  // Every echo at opacity 1 (a clear one's body is faded by CSS, its edge
  // whole): looks.test.js audits the wedges at full strength, and the red
  // one falls under 3:1 in Console Dark and Blueprint Dark at 0.85.
  check(["distanceLeft", "distanceFrontLeft", "distanceFront"].every((key) => by[key].wedge.getAttribute("opacity") === "1"), "an echo at full opacity");
  const fr = by.distanceFrontRight;
  check(fr.wedge.getAttribute("fill") === "var(--dim)" && fr.wedge.getAttribute("opacity") === "0.4", "no echo faded");
  // Each wedge says where it falls, so the clear way can be drawn open.
  const zones = B.map((b) => b.wedge.getAttribute("data-zone")).join();
  check(zones === "stop,warn,clear,none,stop", `zones ${zones}`);
  check(fr.wedge.getAttribute("d").includes("A140.0 140.0"), "no echo at full reach");
  check(fr.reading.textContent === "no echo", fr.reading.textContent);
  check(by.distanceLeft.reading.textContent === "20cm", by.distanceLeft.reading.textContent);
  ws.serverMsg(telemetry({ distanceFrontLeft: 40 }));
  check(by.distanceFrontLeft.wedge.getAttribute("fill") === "var(--warn)", "40 cm (= GO) amber");
  ws.serverMsg(telemetry({ distanceFrontLeft: 41 }));
  check(by.distanceFrontLeft.wedge.getAttribute("fill") === "var(--ok)" && by.distanceFrontLeft.wedge.getAttribute("data-zone") === "clear", "41 cm green, clear");

  // Screen placement: the rover's left is the panel's left.
  const firstX = (b) => Number(b.wedge.getAttribute("d").match(/^M([\d.]+)/)[1]);
  check(firstX(by.distanceLeft) < 210 && firstX(by.distanceRight) > 210, "left drawn on the left");

  // Distances missing (fresh boot): every wedge cleared, not left standing.
  ws.serverMsg(FRAMES.manualBeforeScan);
  for (const b of B) {
    check(b.wedge.getAttribute("d") === "", `${b.key} cleared`);
    check(b.reading.textContent === "—" && !b.wedge.hasAttribute("data-zone"), `${b.key} reading and zone cleared`);
  }
  // One key missing only clears that one.
  ws.serverMsg(telemetry({ distanceFront: undefined }));
  check(by.distanceFront.wedge.getAttribute("d") === "" && by.distanceLeft.wedge.getAttribute("d") !== "", "partial");
  for (const junk of ["not json", "null", "42", "[]", '"x"', '{"distanceFront":"12"}', '{"distanceFront":-1}']) ws.serverMsg(junk);
  check(page.errors.length === 0, `errors ${page.errors}`);
});

// A halt reads as what it is, alone, in amber: "Halted: boxed in", its
// "Phase" caption out of sight (the critic's round 3: "CRUISE: boxed in"
// read as a cruise).
test("phase readout: autonomous only, halt reason shown", () => {
  const { page, ws } = connected(telemetry({ phase: "CRUISE" }));
  check(!page.$("phaseCell").hidden && page.$("phase").textContent === "CRUISE", page.$("phase").textContent);
  check(page.$("phaseCell").dataset.halted === "no" && page.$("phaseCell").title === "Exploration phase", "a phase, captioned");
  check(page.$("auto").getAttribute("aria-pressed") === "true", "auto pressed");
  ws.serverMsg(telemetry({ phase: "HALTED", halt: "boxed in" }));
  check(page.$("phase").textContent === "Halted: boxed in", page.$("phase").textContent);
  check(page.$("phase").dataset.tone === "warn", "halt tone");
  check(page.$("phaseCell").dataset.halted === "yes" && /halted/.test(page.$("phaseCell").title), `the halt's own words, titled: ${page.$("phaseCell").title}`);
  ws.serverMsg(telemetry({ phase: "CRUISE", halt: "sensor silent" }));
  check(page.$("phase").textContent === "Halted: sensor silent", `a halt whatever the phase says: ${page.$("phase").textContent}`);
  const caption = cssRules(panelCss()).find((r) => r.selector === '#phaseCell[data-halted="yes"] .label');
  check(caption && /clip-path:\s*inset\(50%\)/.test(caption.body), "the halt's caption out of sight, still read");
  ws.serverMsg(telemetry({ mode: "MANUAL", move: "MOVE_FORWARD" }));
  check(page.$("phaseCell").hidden === true, "hidden in manual");
  check(page.$("auto").getAttribute("aria-pressed") === "false", "auto not pressed");
  check(page.$("move").textContent === "MOVE_FORWARD", "move shown");
  check(page.$("temp").textContent === "41.5°C", page.$("temp").textContent);
  ws.serverMsg(telemetry({ phase: "SWEEP" }));
  check(!page.$("phaseCell").hidden && page.$("phase").textContent === "SWEEP" && page.$("phase").dataset.tone === "", "back");
});

// The frames test/test_protocol checks writeTelemetry() against, each read as
// the operator reads it: sweeping, cruising, halted, manual before a scan,
// and a dead shield with readings of 0 and no echo.
test("telemetry: the page shows every frame in test/vectors/telemetry.json", () => {
  const { FAR_CM } = require("../js/protocol.js");
  for (const [what, is] of [
    ["a halt", (f) => "halt" in f],
    ["no scan yet", (f) => !("distanceFront" in f)],
    ["a dead shield", (f) => f.motorsReady === false],
    ["no echo", (f) => Object.values(f).includes(FAR_CM)],
    ["a reading of 0", (f) => Object.values(f).includes(0)],
  ]) check(Object.values(FRAMES).some(is), `no frame has ${what} any more`);
  for (const [name, frame] of Object.entries(FRAMES)) {
    const { page } = connected(frame);
    const exploring = frame.mode === "AUTONOMOUS";
    check(page.$("mode").textContent === frame.mode && page.$("auto").getAttribute("aria-pressed") === String(exploring),
      `${name}: mode ${page.$("mode").textContent}, Autonomous pressed ${page.$("auto").getAttribute("aria-pressed")}`);
    check(page.$("phaseCell").hidden === !exploring, `${name}: the phase shown only while exploring`);
    if ("phase" in frame) {
      const phase = page.$("phase");
      check(phase.textContent === (frame.halt ? `Halted: ${frame.halt}` : frame.phase), `${name}: phase '${phase.textContent}'`);
      check(phase.dataset.tone === (frame.halt ? "warn" : ""), `${name}: phase tone '${phase.dataset.tone}'`);
    }
    check(page.$("move").textContent === frame.move, `${name}: move ${page.$("move").textContent}`);
    check(page.$("temp").textContent === `${frame.temperature.toFixed(1)}°C`, `${name}: temperature ${page.$("temp").textContent}`);
    const fault = page.$("motorsFault");
    check(shield(fault) === (frame.motorsReady ? "hidden/yes" : "shown/no"), `${name}: shield warning ${shield(fault)}`);
    for (const { key, wedge, reading } of scanBearings(page)) {
      const cm = frame[key];
      const want = cm === undefined ? "—" : cm >= FAR_CM ? "no echo" : `${Math.round(cm)}cm`;
      check(reading.textContent === want && (wedge.getAttribute("d") === "") === (cm === undefined), `${name}: ${key} reads '${reading.textContent}'`);
    }
    check(shownScheme(page) === frame.scheme, `${name}: scheme ${shownScheme(page)}`);
    check(page.errors.length === 0, `${name}: errors ${page.errors}`);
  }
});

test("Stop always sends STOP; the Autonomous toggle sends RESUME when off and STOP when on, and ends the repeat", () => {
  const { page, ws } = connected(telemetry());
  page.fire(page.$("stop"), "click");
  check(names(ws).join() === "STOP", `idle stop ${names(ws)}`);
  press(page, page.$("cw"), 4);
  let mark = count(ws);
  page.fire(page.$("stop"), "click");
  page.clock.advance(1000);
  check(names(ws, mark).join() === "STOP", `stop while rotating ${names(ws, mark)}`);
  check(page.$("cw").dataset.held === undefined, "unlit");
  mark = count(ws);
  lift(page, page.$("cw"), 4);
  check(count(ws) === mark, "later release sends nothing");

  // Off, the rover in manual: RESUME_AUTONOMOUS alone, the stick let go.
  ws.serverMsg(telemetry({ mode: "MANUAL" }));
  check(page.$("auto").getAttribute("aria-pressed") === "false", "off");
  const s = stickTouch(page, 0);
  s.start(); s.move(0, -50);
  mark = count(ws);
  page.fire(page.$("auto"), "click");
  page.clock.advance(1000);
  check(names(ws, mark).join() === "RESUME_AUTONOMOUS", `auto off: ${names(ws, mark)}`);
  check(page.$("auto").getAttribute("aria-pressed") === "false", "lit only once the rover reports it");

  // On, the rover exploring: STOP alone, a held rotate button let go.
  ws.serverMsg(telemetry({ mode: "AUTONOMOUS" }));
  check(page.$("auto").getAttribute("aria-pressed") === "true", "on");
  press(page, page.$("cw"), 5);
  mark = count(ws);
  page.fire(page.$("auto"), "click");
  page.clock.advance(1000);
  check(names(ws, mark).join() === "STOP", `auto on: ${names(ws, mark)}`);
  check(page.$("cw").dataset.held === undefined, "unlit");
});

test("speed slider re-speeds a held move (throttled)", () => {
  const page = loadPage();
  const ws = connectOpen(page);
  press(page, page.$("cw"), 2);
  page.clock.advance(150);
  page.$("speed").value = "128";
  page.fire(page.$("speed"), "input");
  check(page.$("speedOut").textContent === "128", "output");
  check(ws.moves().slice(-1)[0].speed === 128, `speed ${ws.moves().slice(-1)[0].speed}`);
  check(ws.moves().every((m) => m.duration === 400), "400 ms moves");
});

// The slider is the operator's speed cap, and the stick sends a share of it:
// its deflection, out of 100, measured from the centre and capped at full.
// joy.js clamps each axis on its own, so a full diagonal reaches 141.
test("stick speed is its deflection times the slider, capped at the slider, and nothing inside the deadzone", () => {
  const { page, ws } = connected(telemetry({ mode: "MANUAL" }));
  page.$("speed").value = "128";
  page.fire(page.$("speed"), "input");
  const reach = page.canvas.width / 4; // joy.js's full travel (pushTo)
  const s = stickTouch(page);
  const last = () => ws.moves().slice(-1)[0];
  s.start(); s.move(0, -reach);
  check(last().move === CODES.MOVE_FORWARD && last().speed === 128, `full push ${NAMES[last().move]}@${last().speed}`);
  page.clock.advance(300);
  s.move(reach, -reach);
  check(last().move === CODES.MOVE_DIAGONAL45 && last().speed === 128, `full diagonal ${NAMES[last().move]}@${last().speed}, not over the slider`);
  page.clock.advance(300);
  s.move(0, -reach / 2);
  check(last().move === CODES.MOVE_FORWARD && Math.abs(last().speed - 64) <= 2, `half push ${NAMES[last().move]}@${last().speed}`);
  s.end();
  page.clock.advance(300);

  // Just inside the deadzone, nothing; just outside it, its share.
  const deadzone = page.evalIn("Driver.DEADZONE");
  const mark = count(ws);
  s.start(); s.move((reach * (deadzone - 2)) / 100, 0);
  page.clock.advance(1000);
  check(count(ws) === mark, `a ${deadzone - 2}/100 push sent ${names(ws, mark)}`);
  s.move((reach * (deadzone + 2)) / 100, 0);
  const share = Math.round(((deadzone + 2) / 100) * 128);
  check(last().move === CODES.MOVE_RIGHT && Math.abs(last().speed - share) <= 2, `a ${deadzone + 2}/100 push ${NAMES[last().move]}@${last().speed}, not ${share}`);
  s.end();
});

test("blocked localStorage does not stop the panel", () => {
  for (const storage of ["throws", "null"]) {
    const page = loadPage({ storage });
    check(page.errors.length === 0, `${storage}: errors ${page.errors}`);
    check(page.$("host").value === "192.168.0.115", `${storage}: default host`);
    check(page.$("linkState").textContent === "Not connected", `${storage}: initial state rendered`);
    page.$("host").value = "10.1.1.1";
    page.fire(page.$("connect"), "click");
    check(page.sockets.length === 1 && page.sockets[0].url === "ws://10.1.1.1:81", `${storage}: connected`);
  }
  const page = loadPage();
  page.$("host").value = "10.2.2.2";
  page.fire(page.$("connect"), "click");
  check(page.store["rover.host"] === "10.2.2.2", "remembered when storage works");
});

/* --- motorsReady ----------------------------------------------------------- */

// The shield warning, and its data-ready, which the page's CSS keys on:
// "shown/no", "hidden/yes" or "hidden/unknown".
const shield = (fault) => `${fault.hidden ? "hidden" : "shown"}/${fault.dataset.ready}`;

test("motorsReady: false shows the shield warning; missing or true does not", () => {
  const page = loadPage();
  const fault = page.$("motorsFault");
  check(fault !== null, "#motorsFault exists");
  check(shield(fault) === "hidden/unknown", `at load: ${shield(fault)}`);
  check(fault.getAttribute("role") === "alert", "announced as an alert");
  // One line says what is wrong; what to do is a press away (a disclosure,
  // closed): four lines of it took the scan's height on a phone.
  const said = fault.children.filter((c) => c.tagName && c.tagName !== "#TEXT");
  check(fault.tagName === "DETAILS" && !fault.hasAttribute("open") && said[0].tagName === "SUMMARY" && /^No motor shield: the wheels can't move$/.test(all(said[0]).map((n) => n.textContent || "").join("").trim()), `says what is wrong in a line: ${said.map((c) => c.tagName)}`);
  check(said[1] && /I2C wiring and\s+power/.test(said[1].textContent) && /wheels off the ground/.test(said[1].textContent), "and what to do, behind it");

  const ws = connectOpen(page);
  ws.serverMsg(telemetry({ motorsReady: undefined })); // no motorsReady key at all: older firmware
  check(shield(fault) === "hidden/unknown", `missing key is unknown, not false: ${shield(fault)}`);
  ws.serverMsg(telemetry({ motorsReady: true }));
  check(shield(fault) === "hidden/yes", `true: ${shield(fault)}`);
  ws.serverMsg(telemetry({ motorsReady: false }));
  check(shield(fault) === "shown/no", `false: ${shield(fault)}`);
  for (const junk of ["not json", "null", "42", "[]"]) ws.serverMsg(junk);
  check(shield(fault) === "shown/no", `frames that are not objects change nothing: ${shield(fault)}`);
  for (const odd of ["false", 0, null, "no"]) {
    ws.serverMsg(telemetry({ motorsReady: false }));
    ws.serverMsg(telemetry({ motorsReady: odd }));
    check(shield(fault) === "hidden/unknown", `motorsReady ${JSON.stringify(odd)} is not an explicit false: ${shield(fault)}`);
  }
  ws.serverMsg(telemetry({ motorsReady: false }));
  ws.serverMsg(telemetry({ motorsReady: undefined }));
  check(shield(fault) === "hidden/unknown", `a frame without the key hides it again: ${shield(fault)}`);
  ws.serverMsg(telemetry({ motorsReady: true, mode: "MANUAL" }));
  check(shield(fault) === "hidden/yes", `rebooted with the shield: ${shield(fault)}`);
  check(page.errors.length === 0, `errors ${page.errors}`);
});

test("motorsReady: the warning goes with its link, and controls still send", () => {
  const page = loadPage();
  const fault = page.$("motorsFault");
  let ws = connectOpen(page);
  ws.serverMsg(telemetry({ mode: "MANUAL", motorsReady: false }));
  check(shield(fault) === "shown/no", `shown: ${shield(fault)}`);
  // Nothing is disabled: the operator can still drive, stop and resume.
  press(page, page.$("cw"), 3);
  lift(page, page.$("cw"), 3);
  page.fire(page.$("stop"), "click");
  page.fire(page.$("auto"), "click");
  check(names(ws).join() === "ROTATE_CLOCKWISE,STOP,STOP,RESUME_AUTONOMOUS", `sent ${names(ws)}`);

  ws.serverDrop();
  check(shield(fault) === "hidden/unknown", `cleared when the link drops: ${shield(fault)}`);
  check(/Lost the link/.test(page.$("note").textContent), "link note unaffected");

  ws = connectOpen(page);
  ws.serverMsg(telemetry({ motorsReady: false }));
  check(shield(fault) === "shown/no", `shown again on the new link: ${shield(fault)}`);
  page.fire(page.$("connect"), "click"); // deliberate disconnect
  check(shield(fault) === "hidden/unknown", `cleared on disconnect: ${shield(fault)}`);
  page.clock.advance(100);
  check(shield(fault) === "hidden/unknown", `still clear after the close event: ${shield(fault)}`);

  // Replaced by Enter: late telemetry from the old socket must not raise it.
  const ws1 = connectOpen(page);
  ws1.serverMsg(telemetry({ motorsReady: true }));
  page.fire(page.$("host"), "keydown", { key: "Enter" });
  const ws2 = page.sockets[page.sockets.length - 1];
  ws2.serverOpen();
  ws1.serverMsg(telemetry({ motorsReady: false }));
  check(fault.hidden === true, "stale socket cannot raise the warning");
  ws2.serverMsg(telemetry({ motorsReady: false }));
  check(fault.hidden === false, "current socket can");
  page.clock.advance(100); // ws1's close arrives late
  check(fault.hidden === false, "a stale close does not clear the current link's warning");
  check(page.errors.length === 0, `errors ${page.errors}`);
});

test("a new link starts the scan and readouts from nothing; a link that went keeps them, dimmed", () => {
  const page = loadPage();
  const B = scanBearings(page);
  const shown = () => [
    `${B.filter((b) => b.wedge.getAttribute("d") !== "").length} wedges`,
    B.map((b) => b.reading.textContent).join(" "),
    page.$("mode").textContent, page.$("move").textContent, page.$("temp").textContent,
    page.$("phaseCell").hidden ? "no phase" : page.$("phase").textContent,
    `auto ${page.$("auto").getAttribute("aria-pressed")}`,
  ].join(" | ");
  const clear = "0 wedges | — — — — — | — | — | — | no phase | auto false";
  check(shown() === clear, `at load: ${shown()}`);
  const all150 = Object.fromEntries(B.map((b) => [b.key, 150]));
  let ws = connectOpen(page);
  ws.serverMsg(telemetry({ ...all150, phase: "CRUISE", move: "MOVE_FORWARD", temperature: 41.5 }));
  const live = "5 wedges | 150cm 150cm 150cm 150cm 150cm | AUTONOMOUS | MOVE_FORWARD | 41.5°C | CRUISE | auto true";
  check(shown() === live, `live: ${shown()}`);

  // The link goes: what it last reported stays, for panel.css to dim.
  ws.serverDrop();
  check(page.doc.body.dataset.link === "down" && shown() === live, `down: ${shown()}`);

  // A new link is up as its socket opens, before the rover says anything
  // over it: nothing from the last link may show as live meanwhile.
  ws = connectOpen(page);
  check(page.doc.body.dataset.link === "up" && shown() === clear, `a new link, no frame yet: ${shown()}`);
  ws.serverMsg(telemetry({ mode: "MANUAL", distanceFront: 30 }));
  check(/^5 wedges \| .* 30cm .* \| MANUAL \| STOP \|/.test(shown()), `its first frame: ${shown()}`);

  // Replaced by Enter, the same.
  page.fire(page.$("host"), "keydown", { key: "Enter" });
  check(page.doc.body.dataset.link === "connecting" && shown() === clear, `replaced: ${shown()}`);
  check(page.errors.length === 0, `errors ${page.errors}`);
});

// The view is the rover's while it is the target (F3c, F8): with no link it
// says so and offers the next thing to do, over the faint fan, in its own
// place and at its full size, rather than look broken. The scan itself
// still knows when it has nothing to draw: a link that goes leaves its
// scan, dimmed, as history.
test("the scan: a connect card over it while no link is up, and the scan empty until the first frame", () => {
  const page = loadPage();
  const empty = () => page.$("scan").dataset.empty;
  const go = page.$("connectGo");
  check(empty() === "yes", `at load: ${empty()}`);
  check(go.textContent === "Connect to 192.168.0.115" && /192\.168\.0\.115/.test(go.title), `the card names the address: ${go.textContent} | ${go.title}`);
  // The card's button is a press of Connect, whatever Connect does now.
  page.fire(go, "click");
  check(page.sockets.length === 1 && page.doc.body.dataset.link === "connecting", "a press connects");
  check(go.textContent === "Cancel", `connecting, it cancels: ${go.textContent}`);
  page.fire(go, "click");
  check(page.doc.body.dataset.link === "down" && go.textContent === "Connect to 192.168.0.115", `cancelled: ${go.textContent}`);
  let ws = connectOpen(page);
  check(empty() === "yes", "up, before a frame: still nothing to draw");
  ws.serverMsg(FRAMES.manualBeforeScan);
  check(empty() === "no", "a frame without distances is a frame: the rover is there");
  ws.serverDrop();
  check(page.doc.body.dataset.link === "down" && empty() === "no", "gone: its last scan stays, as history");
  check(go.textContent === "Reconnect" && /again/.test(go.title), `after a lost link: ${go.textContent} | ${go.title}`);
  ws = connectOpen(page);
  check(empty() === "yes", "a new link starts from nothing");
  ws.serverMsg(telemetry({ distanceFront: 80 }));
  check(empty() === "no", "until its first frame");
  page.fire(page.$("host"), "keydown", { key: "Enter" });
  check(page.doc.body.dataset.link === "connecting" && empty() === "yes", "replaced: nothing again");
  page.fire(page.$("connect"), "click");
  // The card names the address Connect would use: the field's, as typed.
  page.$("host").value = "rover.local";
  page.fire(page.$("host"), "input");
  check(go.textContent === "Connect to rover.local", `the field's address: ${go.textContent}`);

  // Change address opens the link's popover, as the chip does, with the
  // focus in the address; pressed with it open, it leaves it open.
  check(page.$("linkPanel").hidden, "the popover closed");
  for (let i = 0; i < 2; i++) {
    page.fire(page.$("changeAddress"), "pointerdown");
    page.fire(page.$("changeAddress"), "click");
    check(!page.$("linkPanel").hidden && page.$("linkChip").getAttribute("aria-expanded") === "true", `open (${i})`);
    check(page.doc.activeElement === page.$("host"), `the focus in the address (${i})`);
  }

  // panel.css shows the card while no link is up, on either tab: with a
  // link up and its first frame still to come, the link chip says so.
  const shown = cssRules(panelCss()).filter((r) => /\.connectCard\b/.test(r.selector) && /display:\s*grid/.test(r.body));
  check(shown.length === 1, `one rule shows it: ${shown.map((r) => r.selector)}`);
  const selector = shown.length ? shown[0].selector : "";
  const states = (selector.match(/data-link="(\w+)"/g) || []).map((m) => m.slice(11, -1)).sort().join();
  check(states === "connecting,down", `only with no link up: ${states}`);
  check(!/data-tab|tabpanel|#(drive|program)Tab/.test(selector), `on either tab: ${selector}`);
  // The card and the fan share one cell that takes what the legend's row
  // leaves: an auto row sized by the card, in a small scan, let the fan
  // spill out of it. The auto row is the rings' legend's, and the fault's
  // in its place while there is one, the legend keeping its height under
  // it: in a row of its own the fault took the fan's height, readings down
  // to 9 px on a phone (the review's phones 1).
  const card = cssRules(panelCss()).find((r) => r.selector === ".scan" && /grid-template:/.test(r.body));
  check(card && /grid-template:\s*auto minmax\(0, 1fr\) \/ minmax\(0, 1fr\);/.test(card.body), `the card's cell: ${card && card.body}`);
  const cell = (selector) => cssRules(panelCss()).filter((r) => r.selector === selector).map((r) => r.body).join("");
  check(/grid-area:\s*2 \/ 1;/.test(cell(".scan > *")) && /grid-area:\s*1 \/ 1;/.test(cell(".scan > :is(.fault, .scanLegend)")) && /visibility:\s*hidden/.test(cell(".scan:has(> .fault:not([hidden])) > .scanLegend")), `the card and the fan in the cell, the fault in the legend's place over them: ${cell(".scan > *")} | ${cell(".scan > :is(.fault, .scanLegend)")}`);
  const px = (selector, prop) => Number((cell(selector).match(new RegExp(`${prop}:\\s*(\\d+)px`)) || [])[1]);
  check(px(".fault summary", "height") + 2 === px(".scanLegend", "line-height") && /padding:\s*0 /.test(cell(".fault")), `the fault closed the legend's height, its edge included: ${px(".fault summary", "height")} + 2 vs ${px(".scanLegend", "line-height")}`);
  const own = cssRules(panelCss()).find((r) => r.selector === ".connectCard");
  check(own && /display:\s*none/.test(own.body), "otherwise not shown");
  // Under the card, with no link and no scan from one, the whole fan is
  // faint, its rings included, and nothing in it reads: no bearing's name
  // or reading stuck out at the card's corners (the critic's round 3).
  // The legend keeps its row, unseen, so the first frame moves nothing.
  // A link that went keeps its last scan, dimmed, legible, as history.
  const faint = (selector) => cssRules(panelCss()).filter((r) => r.selector === selector).map((r) => r.body).join("");
  check(/opacity:\s*0\.3\d?;/.test(faint('body:not([data-link="up"]) #scan[data-empty="yes"]')), `the empty fan faint: ${faint('body:not([data-link="up"]) #scan[data-empty="yes"]')}`);
  check(/display:\s*none/.test(faint('body:not([data-link="up"]) #scan[data-empty="yes"] :is(.tick, .reading)')), "its names and its readings' dashes out of sight");
  check(/visibility:\s*hidden/.test(faint('body:not([data-link="up"]) .scan:has(> #scan[data-empty="yes"]) > .scanLegend')), "the legend out of sight, keeping its place");
  check(/opacity:\s*0\.25/.test(faint('body:not([data-link="up"]) .wedge')) && /fill:\s*var\(--dim\)/.test(faint('body:not([data-link="up"]) .reading')), "a lost link's last scan dimmed, its readings still there");
  // Its stop and go rings grey with it, their dashes kept: in red and
  // amber over a greyed fan they were the loudest things in the view (the
  // review's laptops 7). The legend's swatches keep their colours.
  const rings = faint('body:not([data-link="up"]) #scan .ring:is(.go, .stop)');
  check(/stroke:\s*var\(--dim\)/.test(rings) && !/stroke-dasharray/.test(rings), `a lost link's rings grey, dashed still: ${rings}`);
  check(page.$("scan").parentNode.querySelectorAll(".connectCard").length === 1, "in the scan's own card");
  check(page.$("connectGo").title && page.$("changeAddress").getAttribute("title"), "both its buttons titled");
  check(page.errors.length === 0, `errors ${page.errors}`);
});

test("a JSON array is not telemetry: wedges and warning untouched", () => {
  const { page, ws } = connected(telemetry({ motorsReady: false }));
  const B = scanBearings(page);
  ws.serverMsg("[]");
  ws.serverMsg("[1,2,3]");
  check(B.every((b) => b.wedge.getAttribute("d") !== ""), "wedges still drawn");
  check(page.$("motorsFault").hidden === false, "warning still shown");
});

test("Autonomous button explains that it also retries a halt", () => {
  const page = loadPage();
  check(/halted/.test(page.$("auto").getAttribute("title") || ""), `title '${page.$("auto").getAttribute("title")}'`);
});

/* --- geometry ------------------------------------------------------------ */

test("scan geometry: rings from constants, convex wedges, labels clear of wedges", () => {
  const page = loadPage();
  const g = (n) => page.evalIn(n);
  const [CX, CY, RMIN, RMAX, HW] = ["CX", "CY", "R_MIN", "R_MAX", "HALF_WIDTH"].map((n) => g(`ScanView.${n}`));
  const [W, H] = [g("ScanView.VIEW_W"), g("ScanView.VIEW_H")];
  const [TX, TW] = [g("ScanView.TALL_X"), g("ScanView.TALL_W")];
  const svg = page.$("scan");
  check(svg.getAttribute("viewBox") === `0 0 ${W} ${H}` && svg.dataset.layout === "wide", "viewBox set, wide until measured");
  const nodes = all(svg);
  // The rings' legend is the card's, one line in its corner, not the
  // drawing's: in the fan's corner it floated with the fan.
  check(!nodes.some((n) => /scanLegend/.test(n.getAttribute("class") || "")), "no legend in the drawing");
  const fan = nodes;
  const rings = fan.filter((n) => /^ring/.test(n.getAttribute("class") || ""));
  const radii = rings.map((n) => Number(n.getAttribute("d").match(/A([\d.]+)/)[1]));
  const want = [g("ScanView.RANGE_CM"), 100, g("GO_CM"), g("STOP_CM")].map((cm) => page.evalIn(`ScanView.radiusFor(${cm})`));
  check(radii.length === 4 && radii.every((r, i) => Math.abs(r - want[i]) < 0.06), `ring radii ${radii} vs ${want}`);
  check(Math.abs(radii[0] - RMAX) < 0.06, "outer ring at full reach");
  check(rings[3].getAttribute("class").includes("stop") && rings[2].getAttribute("class").includes("go"), "ring classes");

  // Arc centres: every arc in every wedge path must be centred on the rover.
  const ws = connectOpen(page);
  ws.serverMsg(telemetry({ distanceLeft: 20, distanceFrontLeft: 60, distanceFront: 199, distanceFrontRight: 999, distanceRight: 5 }));
  for (const b of scanBearings(page)) {
    const d = b.wedge.getAttribute("d");
    const nums = d.match(/-?[\d.]+/g).map(Number);
    // M ax ay L dx dy A r r 0 0 0 cx cy L bx by A R R 0 0 1 ax ay Z
    const [ax, ay, dx, dy, r1, , , , sweep1, cx, cy, bx, by, r2, , , , sweep2] = nums;
    const c1 = arcCentre(dx, dy, cx, cy, r1, sweep1);
    const c2 = arcCentre(bx, by, ax, ay, r2, sweep2);
    check(near(c1, [CX, CY]) && near(c2, [CX, CY]), `${b.key}: arc centres ${c1} ${c2}`);
  }
  for (const n of rings) {
    const [x0, y0, r, , , , sweep, x1, y1] = n.getAttribute("d").match(/-?[\d.]+/g).map(Number);
    check(near(arcCentre(x0, y0, x1, y1, r, sweep), [CX, CY]), "ring centred");
    check(y0 < CY && y1 < CY, "ring above the baseline");
  }

  // In either layout, text boxes (worst-case strings, at the size each
  // label is drawn in units at that scale) must stay inside the view, off
  // every wedge's largest possible sector, and off each other.
  const texts = fan.filter((n) => n.tagName === "TEXT");
  const sector = (b) => {
    let hits = 0;
    for (let x = b.x0; x <= b.x1; x += 0.5) {
      for (let y = b.y0; y <= b.y1; y += 0.5) {
        const r = Math.hypot(x - CX, CY - y);
        const ang = degrees(Math.atan2(CY - y, x - CX));
        if (r < RMIN || r > RMAX) continue;
        for (const brg of g("BEARINGS")) if (Math.abs(ang - (90 + brg.bearing)) <= HW) hits++;
      }
    }
    return hits;
  };
  // The legend: one line of the card's, each ring's dashes before its
  // distance, with its unit, and what it means, the stop ring first.
  const legend = svg.parentNode.querySelectorAll(".scanLegend")[0];
  check(legend && legend.parentNode === svg.parentNode, "the legend in the scan's card");
  const items = legend ? legend.children : [];
  const words = items.map((item) => item.children.filter((n) => n.tagName === "SPAN").map((n) => n.textContent).join(""));
  check(words.join(",") === `${g("STOP_CM")} cm stop,${g("GO_CM")} cm go,100 cm`, `the legend, the stop ring first: ${words}`);
  const swatches = items.map((item) => all(item).filter((n) => n.tagName === "PATH").map((n) => n.getAttribute("class")).join());
  check(swatches.join("|") === "ring stop|ring go|ring", `each ring's own dashes: ${swatches.join("|")}`);
  check(items.map((item) => item.getAttribute("class")).join() === "legendItem stop,legendItem go,legendItem far", `the items by ring: ${items.map((item) => item.getAttribute("class"))}`);
  check(legend && legend.getAttribute("aria-hidden") === "true", "the legend is decoration: the rings' meaning is in the fan's title and the readings");
  // The type's sizes in units at a scale: the drawing's own, capped on
  // screen (panel.css, mirrored in ScanView for the names' places).
  const [RS, RMAXPX] = [g("ScanView.READING_UNITS"), g("ScanView.READING_MAX_PX")];
  const rootVar = (name) => Number((panelCss().match(new RegExp(`${name}:\\s*([\\d.]+)px;`)) || [])[1]);
  check(RS === rootVar("--scan-reading"), `ScanView's reading size is panel.css's: ${RS} vs ${rootVar("--scan-reading")}`);
  check(new RegExp(`calc\\(${RMAXPX}px / var\\(--scan-k, 1\\)\\)`).test(cssRules(outside(panelCss(), "@media")).filter((r) => r.selector === ".reading").map((r) => r.body).join("")), `and its cap: ${RMAXPX}px`);
  const TS = rootVar("--scan-tick");
  for (const [layout, x0, x1, shape] of [["wide", 0, W, (k) => [W * k, H * k * 1.02]], ["tall", TX, TX + TW, (k) => [TW * k, H * k * 1.5]]]) {
    // From where no reading fits at 12 px, past where the names show, to
    // three times the drawing's size.
    for (const k of [0.4, 0.5, 0.55, 0.6, 0.72, 0.79, 0.8, 0.9, 1.2, 2, 3.2]) {
      page.evalIn(`scanView.fit(${shape(k).join(", ")})`);
      check(svg.dataset.layout === layout, `${layout} at ${k}: ${svg.dataset.layout}`);
      check(svg.getAttribute("viewBox") === `${x0} 0 ${x1 - x0} ${H}`, `${layout}: its box: ${svg.getAttribute("viewBox")}`);
      check(svg.style.getPropertyValue("--scan-k") === k.toFixed(3), `${layout} at ${k}: --scan-k ${svg.style.getPropertyValue("--scan-k")}`);
      // A reading 12 px on screen at least, as a name is (the review's
      // phones 1: 8 to 10 px on a phone), as panel.css draws it.
      const RP = g("ScanView.READING_MIN_PX");
      check(RP === 12 && new RegExp(`max\\(calc\\(${RP}px / var\\(--scan-k, 1\\)\\), min\\(var\\(--scan-reading\\)`).test(cssRules(outside(panelCss(), "@media")).filter((r) => r.selector === ".reading").map((r) => r.body).join("")), `a reading's floor: ${RP} px`);
      const rs = Math.max(RP / k, Math.min(RS, RMAXPX / k)) / RS;
      // A name 12 px on screen at least (ScanView.TICK_PX), so it shows
      // only where 12 px takes no more units than a reading.
      const TP = g("ScanView.TICK_PX");
      const ts = Math.max(TP / k, Math.min(TS, 14 / k)) / TS;
      const labels = svg.dataset.labels;
      const names = labels === "all";
      check(names === (TP / k <= RS) && ["all", "readings", "front", "none"].includes(labels), `${layout} at ${k}: names shown only at ${TP} px or more: ${labels}`);
      check(!names || ts * TS * k >= TP - 1e-9, `${layout} at ${k}: a name ${ts * TS * k} px on screen`);
      check(rs * RS * k >= RP - 1e-9, `${layout} at ${k}: a reading ${rs * RS * k} px on screen`);
      // Where the five do not fit at 12 px, the side ones go first, and
      // only then the front three: never all of them while three fit, nor
      // the side ones while five do (the boxes below hold whatever shows).
      const outer = texts.filter((n) => n.getAttribute("data-outer") === "yes");
      check(outer.length === 2 && outer.every((n) => n.getAttribute("class") === "reading"), "L and R marked, which go first");
      if (k >= 0.6) check(labels === "all" || labels === "readings", `${layout} at ${k}: all five readings at 12 px: ${labels}`);
      if (k >= 0.55 || (layout === "wide" && k >= 0.45)) check(labels !== "none", `${layout} at ${k}: the front three at least: ${labels}`);
      const shown = (n) => n.getAttribute("class") === "reading" ? labels !== "none" && (labels !== "front" || n.getAttribute("data-outer") !== "yes") : names;
      const boxes = texts.filter(shown).map((n) => {
        const big = n.getAttribute("class") === "reading";
        const str = big ? "no echo" : n.textContent;
        const em = big ? rs : ts;
        const tw = str.length * (big ? 9.0 : 6.8) * em;
        const x = Number(n.getAttribute("x"));
        const y = Number(n.getAttribute("y"));
        const a = n.getAttribute("text-anchor");
        const left = a === "end" ? x - tw : a === "start" ? x : x - tw / 2;
        return { str, x0: left, x1: left + tw, y0: y - (big ? 11 : 7) * em, y1: y + (big ? 3 : 1) * em };
      });
      check(texts.every((n) => n.getAttribute("text-anchor")), `${layout}: every label anchored`);
      for (const b of boxes) {
        check(b.x0 >= x0 && b.x1 <= x1 && b.y0 >= 0 && b.y1 <= H, `${layout} at ${k}: '${b.str}' inside view: ${JSON.stringify(b)}`);
        const hits = sector(b);
        check(hits === 0, `${layout} at ${k}: '${b.str}' overlaps a wedge (${hits} samples)`);
      }
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          const p = boxes[i], q = boxes[j];
          const overlap = p.x0 < q.x1 && q.x0 < p.x1 && p.y0 < q.y1 && q.y0 < p.y1;
          check(!overlap, `${layout} at ${k}: '${p.str}' overlaps '${q.str}'`);
        }
      }
      // A name sits right over its reading, wherever the names show.
      if (names) for (const b of scanBearings(page)) {
        const label = texts.find((n) => n !== b.reading && n.getAttribute("x") === b.reading.getAttribute("x") && n.getAttribute("class") === "tick");
        const gap = label && Number(b.reading.getAttribute("y")) - Number(label.getAttribute("y"));
        check(label && gap > 0 && gap <= RS * rs + 2.1, `${layout} at ${k}: ${b.key}'s name over its reading: ${gap}`);
      }
    }
  }
  // A box with no size (the view hidden) changes nothing.
  page.evalIn("scanView.fit(0, 0)");
  check(svg.dataset.layout === "tall", "an unmeasured box keeps the layout");
  const tickTexts = texts.filter((n) => n.getAttribute("class").startsWith("tick")).map((n) => n.textContent);
  check(["L", "FL", "F", "FR", "R"].every((t) => tickTexts.includes(t)) && tickTexts.length === 5, `ticks ${tickTexts}`);
  check(!tickTexts.some((t) => /°/.test(t)), "no servo-angle ticks");
});

// The fan fits its box as the box changes: the layout that draws it larger,
// tall wherever the box is squarer than the wide one's shape by a tenth, so
// a box sized to the wide layout (the Program tab's view) never flips; and
// labels that would be a smudge go.
test("scan fit: the larger layout for the box, measured as it changes, and smudged labels gone", () => {
  const page = loadPage({ frames: true });
  const svg = page.$("scan");
  check(svg.resizeObserved, "the fan's box observed");
  const fitTo = (w, h) => {
    svg.clientWidth = w;
    svg.clientHeight = h;
    page.resized();
  };
  fitTo(712, 488);
  check(svg.dataset.layout === "tall" && svg.style.getPropertyValue("--scan-k") === (712 / 304).toFixed(3), `an iPad's pane: tall: ${svg.dataset.layout} ${svg.style.getPropertyValue("--scan-k")}`);
  fitTo(470, 228);
  check(svg.dataset.layout === "wide", `a box the wide layout's shape: wide: ${svg.dataset.layout}`);
  fitTo(400, 200);
  check(svg.dataset.layout === "wide", `a box 2:1: still wide: ${svg.dataset.layout}`);
  fitTo(380, 200);
  check(svg.dataset.layout === "tall", `squarer by more than a tenth: tall: ${svg.dataset.layout}`);
  const labels = (w, h) => {
    fitTo(w, h);
    return svg.dataset.labels;
  };
  check(labels(350, 393) === "all" && labels(180, 120) === "readings" && labels(210, 100) === "front" && labels(100, 80) === "none", "the bearings' names go first, then the side readings, then the rest");
  const css = panelCss();
  const hides = cssRules(css).filter((r) => /#scan\[data-labels/.test(r.selector) && /display:\s*none/.test(r.body)).map((r) => r.selector).join(" ");
  check(/#scan:is\(\[data-labels="readings"\], \[data-labels="front"\]\) \.tick/.test(hides) && /#scan\[data-labels="front"\] \.reading\[data-outer="yes"\]/.test(hides) && /data-labels="none"\] :is\(\.tick, \.reading\)/.test(hides), `panel.css hides them: ${hides}`);
  // Never larger on screen than a reading or a name needs, whatever the
  // fan's scale, and a name never under 12 px; the legend at the page's
  // smallest type, in the dim ink, never over the fan or taking a press.
  const rule = (selector) => cssRules(outside(css, "@media")).filter((r) => r.selector === selector).map((r) => r.body).join("");
  check(/font-size:\s*max\(calc\(12px \/ var\(--scan-k, 1\)\), min\(var\(--scan-reading\), calc\(28px \/ var\(--scan-k, 1\)\)\)\);/.test(rule(".reading")), `readings capped, and floored at 12 px: ${rule(".reading")}`);
  check(/font-size:\s*max\(calc\(12px \/ var\(--scan-k, 1\)\), min\(var\(--scan-tick\), calc\(14px \/ var\(--scan-k, 1\)\)\)\);/.test(rule(".tick")), `names capped, and floored at 12 px: ${rule(".tick")}`);
  check(page.evalIn("ScanView.TICK_PX") === 12, "the floor scan.js lays the names out for");
  const legend = rule(".scanLegend");
  check(/font-size:\s*var\(--t-sm\);/.test(legend) && /color:\s*var\(--dim\);/.test(legend) && /white-space:\s*nowrap;/.test(legend) && /pointer-events:\s*none;/.test(legend) && /justify-self:\s*start;/.test(legend), `the legend quiet, one line, in the corner: ${legend}`);
  check(/width:\s*20px;/.test(rule(".legendSwatch")), `its dashes long enough to tell apart: ${rule(".legendSwatch")}`);
  check(page.errors.length === 0, `errors ${page.errors}`);
});

function arcCentre(x1, y1, x2, y2, r, sweep) {
  // SVG endpoint -> centre conversion for a circle (rx = ry, no rotation, small arc).
  const mx = (x1 - x2) / 2, my = (y1 - y2) / 2;
  const d2 = mx * mx + my * my;
  const k = Math.sqrt(Math.max(0, (r * r - d2) / d2)) * (sweep === 1 ? 1 : -1); // SVG F.6.5.2 with fA = 0: + when fS != fA
  const cxp = k * my, cyp = -k * mx;
  return [cxp + (x1 + x2) / 2, cyp + (y1 + y2) / 2].map((v) => Math.round(v * 10) / 10);
}
function near(a, b) { return Math.abs(a[0] - b[0]) < 0.6 && Math.abs(a[1] - b[1]) < 0.6; }

/* --- the Driver's extension points ------------------------------------------ */

// Records what the Driver reports, in the page: __downs (onStandDown reasons,
// with whether anything was still being driven) and __pressed (onManualInput,
// the stick named or "-" for another control).
function listen(page) {
  page.evalIn(`
    globalThis.__downs = [];
    globalThis.__pressed = [];
    driver.onStandDown((reason) => __downs.push(reason + (driver.driving ? " while driving" : "")));
    driver.onManualInput((stick) => { __pressed.push(stick || "-"); });
  `);
  return {
    downs: () => page.evalIn("__downs.join()"),
    presses: () => page.evalIn("__pressed.length"),
    pressed: () => page.evalIn("__pressed.join()"),
  };
}

// Advance the clock as a live rover would, with telemetry carrying `fields`
// every 500 ms, so the link never goes stale (a stale link ends a program).
function liveFor(page, ws, ms, fields = { mode: "MANUAL" }) {
  for (let left = ms; left > 0; left -= 500) {
    page.clock.advance(Math.min(500, left));
    ws.serverMsg(telemetry(fields));
  }
}

test("setFamily: a held pivot stick re-steers at once, into the family's quadrant move", () => {
  const page = loadPage();
  const ws = connectOpen(page);
  check(page.evalIn("driver.family") === "PIVOT", `default family ${page.evalIn("driver.family")}`);
  page.evalIn("driver.enablePivots(true)");

  // Nothing held: changing the family sends nothing.
  page.evalIn("driver.setFamily(FAMILY_PIVOT_SIDEWAYS)");
  page.evalIn("driver.setFamily(FAMILY_PIVOT)");
  page.clock.advance(500);
  check(count(ws) === 0, `idle setFamily sent ${names(ws)}`);

  const s = pivotTouch(page, 0);
  s.start(); s.move(0, -50);
  check(names(ws).join() === "PIVOT_RIGHT_FORWARD", `pivot ${names(ws)}`); // on an axis: right and forward
  page.clock.advance(30); // inside STICK_SEND_MS: only a new direction may go now
  let mark = count(ws);
  page.evalIn("driver.setFamily(FAMILY_PIVOT_SIDEWAYS)");
  check(names(ws, mark).join() === "PIVOT_SIDEWAYS_FORWARD_RIGHT", `sideways ${names(ws, mark)}`);
  check(ws.sentAt[mark] === page.clock.now(), "sent at once");
  check(page.evalIn("driver.family") === "PIVOT_SIDEWAYS", "family getter");

  mark = count(ws);
  s.move(-60, 40); // down and left
  check(names(ws, mark).join() === "PIVOT_SIDEWAYS_BACKWARD_LEFT", `quadrant ${names(ws, mark)}`);

  // The same family again changes nothing; the repeat carries the pivot.
  mark = count(ws);
  page.evalIn("driver.setFamily(FAMILY_PIVOT_SIDEWAYS)");
  check(count(ws) === mark, `same family sent ${names(ws, mark)}`);
  page.clock.advance(450);
  check(names(ws, mark).length === 2 && names(ws, mark).every((n) => n === "PIVOT_SIDEWAYS_BACKWARD_LEFT"), `repeat ${names(ws, mark)}`);

  // Anything but a pivot family throws and changes nothing: the translate
  // stick is the other stick, not a family of this one.
  for (const family of ["FAMILY_TRANSLATE", '"SIDEWAYS"']) {
    mark = count(ws);
    let threw = null;
    try { page.evalIn(`driver.setFamily(${family})`); } catch (err) { threw = err; }
    check(threw && threw.name === "RangeError", `${family}: ${threw}`);
    check(page.evalIn("driver.family") === "PIVOT_SIDEWAYS" && count(ws) === mark, `${family} changed something`);
  }

  // The translate stick is not a pivot family's: a family change leaves a
  // held translate stick, pressed last, alone.
  const t = stickTouch(page, 1);
  mark = count(ws);
  t.start(); t.move(0, -50);
  check(names(ws, mark).join() === "MOVE_FORWARD", `the translate stick, pressed last ${names(ws, mark)}`);
  mark = count(ws);
  page.evalIn("driver.setFamily(FAMILY_PIVOT)");
  check(count(ws) === mark, `re-steered the translate stick: ${names(ws, mark)}`);
  t.end();
  check(names(ws, mark).join() === "PIVOT_LEFT_BACKWARD", `the pivot stick again ${names(ws, mark)}`);

  // A rotate button still wins over the stick, whatever the family.
  press(page, page.$("cw"), 4);
  mark = count(ws);
  page.evalIn("driver.setFamily(FAMILY_PIVOT_SIDEWAYS)");
  check(count(ws) === mark, `re-steered under a held rotate: ${names(ws, mark)}`);
  lift(page, page.$("cw"), 4);
  check(names(ws, mark).join() === "PIVOT_SIDEWAYS_BACKWARD_LEFT", `stick again ${names(ws, mark)}`);
  check(page.errors.length === 0, `errors ${page.errors}`);
});

test("program: a manual press wins; endProgram sends STOP only when the program was driving", () => {
  const page = loadPage();
  const ws = connectOpen(page);
  const heard = listen(page);

  page.evalIn("driver.program(MOVE_FORWARD, 100)");
  liveFor(page, ws, 450);
  check(names(ws).join() === "MOVE_FORWARD,MOVE_FORWARD,MOVE_FORWARD", `program ${names(ws)}`);
  check(ws.moves().every((m) => m.speed === 100 && m.duration === 400), "absolute speed, not the slider's 64");
  check(ws.sentAt.map((t) => t - ws.sentAt[0]).join() === "0,200,400", `repeat ${ws.sentAt}`);

  // A rotate button wins; ending the program under it sends nothing.
  let mark = count(ws);
  press(page, page.$("cw"), 1);
  check(names(ws, mark).join() === "ROTATE_CLOCKWISE" && ws.moves()[mark].speed === 64, `rotate ${names(ws, mark)}`);
  mark = count(ws);
  page.evalIn("driver.endProgram()");
  check(count(ws) === mark, `endProgram under a held button sent ${names(ws, mark)}`);
  liveFor(page, ws, 250);
  lift(page, page.$("cw"), 1);
  check(names(ws, mark).join() === "ROTATE_CLOCKWISE,STOP", `release ${names(ws, mark)}`);

  // The stick wins too, and letting go of it hands the rover back to the program.
  page.evalIn("driver.program(MOVE_LEFT, 90)");
  const s = stickTouch(page, 0);
  mark = count(ws);
  s.start(); s.move(0, -50);
  check(names(ws, mark).join() === "MOVE_FORWARD", `stick ${names(ws, mark)}`);
  mark = count(ws);
  s.end();
  check(names(ws, mark).join() === "MOVE_LEFT" && ws.moves()[mark].speed === 90, `program again ${names(ws, mark)}`);

  // Ended while it drives: one STOP, and nothing more.
  mark = count(ws);
  page.evalIn("driver.endProgram()");
  liveFor(page, ws, 1000);
  check(names(ws, mark).join() === "STOP", `endProgram while driving ${names(ws, mark)}`);

  // Ended with none running: nothing.
  mark = count(ws);
  page.evalIn("driver.endProgram()");
  check(count(ws) === mark, `endProgram with none sent ${names(ws, mark)}`);

  // Speeds are clamped and rounded; only motions are accepted.
  page.evalIn("driver.program(MOVE_RIGHT, 999)");
  liveFor(page, ws, 150);
  page.evalIn("driver.program(MOVE_RIGHT, 12.6)");
  liveFor(page, ws, 150);
  page.evalIn("driver.program(MOVE_RIGHT, -5)");
  const speeds = ws.moves().slice(mark).map((m) => m.speed);
  check(speeds.join() === "255,13,0", `clamped speeds ${speeds}`);
  page.evalIn("driver.endProgram()");
  mark = count(ws);
  for (const bad of ["STOP, 50", "RESUME_AUTONOMOUS, 50", "20, 50", "MOVE_FORWARD, NaN", "MOVE_FORWARD", "MOVE_FORWARD, '50'"]) {
    let threw = null;
    try { page.evalIn(`driver.program(${bad})`); } catch (err) { threw = err; }
    check(threw && threw.name === "RangeError", `program(${bad}) threw ${threw}`);
  }
  liveFor(page, ws, 500);
  check(count(ws) === mark, `a refused program sent ${names(ws, mark)}`);

  // Stop ends a program, and so does a stand-down.
  page.evalIn("driver.program(MOVE_BACKWARD, 80)");
  mark = count(ws);
  page.fire(page.$("stop"), "click");
  liveFor(page, ws, 1000);
  check(names(ws, mark).join() === "STOP", `Stop over a program ${names(ws, mark)}`);
  page.evalIn("driver.program(MOVE_BACKWARD, 80)");
  mark = count(ws);
  page.fire(page.win, "blur", { bubbles: false });
  liveFor(page, ws, 1000);
  check(names(ws, mark).join() === "STOP", `blur over a program ${names(ws, mark)}`);
  check(heard.downs() === "stop,blur", `stand-downs ${heard.downs()}`);
  check(page.errors.length === 0, `errors ${page.errors}`);
});

test("onStandDown: blur, hidden, pagehide, link loss, stale, disconnect, Stop and Autonomous", () => {
  const page = loadPage();
  let ws = connectOpen(page);
  const heard = listen(page);
  ws.serverMsg(telemetry());

  page.fire(page.win, "blur", { bubbles: false });
  page.doc.hidden = false;
  page.fire(page.doc, "visibilitychange", { bubbles: false }); // shown again: not a stand-down
  page.doc.hidden = true;
  page.fire(page.doc, "visibilitychange", { bubbles: false });
  page.doc.hidden = false;
  page.fire(page.win, "pagehide", { bubbles: false });
  check(heard.downs() === "blur,hidden,pagehide", `attention ${heard.downs()}`);
  check(count(ws) === 0, `an idle stand-down sent ${names(ws)}`);

  // Each fires after the stand-down: nothing is being driven any more.
  press(page, page.$("cw"), 1);
  page.fire(page.win, "blur", { bubbles: false });
  check(heard.downs().endsWith(",blur"), `blur while driving ${heard.downs()}`);

  page.evalIn("__downs.length = 0");
  page.clock.advance(1900); // no telemetry: stale
  check(page.doc.body.dataset.link === "stale", "stale");
  ws.serverDrop();
  check(heard.downs() === "stale,linkLost", `link ${heard.downs()}`);

  page.evalIn("__downs.length = 0");
  ws = connectOpen(page);
  page.fire(page.$("host"), "keydown", { key: "Enter" }); // replaces the link
  page.sockets[page.sockets.length - 1].serverOpen();
  page.fire(page.$("connect"), "click"); // Disconnect
  check(heard.downs() === "disconnect,disconnect", `disconnects ${heard.downs()}`);

  page.evalIn("__downs.length = 0");
  ws = connectOpen(page);
  page.fire(page.$("stop"), "click");
  page.fire(page.$("auto"), "click");
  check(heard.downs() === "stop,autonomous", `buttons ${heard.downs()}`);
  check(names(ws).join() === "STOP,RESUME_AUTONOMOUS", `buttons sent ${names(ws)}`);
  check(page.errors.length === 0, `errors ${page.errors}`);
});

test("a stale link ends a program, but a held stick drives on as before", () => {
  const { page, ws } = connected(telemetry({ mode: "MANUAL" }));
  page.evalIn("driver.program(MOVE_FORWARD, 100)");
  page.clock.advance(1900);
  check(page.doc.body.dataset.link === "stale", "stale");
  let after = names(ws).slice(-1).join();
  check(after === "STOP", `program ended with ${after}`);
  let mark = count(ws);
  page.clock.advance(1000);
  check(count(ws) === mark, `after stale ${names(ws, mark)}`);

  ws.serverMsg(telemetry({ mode: "MANUAL" }));
  const s = stickTouch(page, 0);
  s.start(); s.move(0, -50);
  page.clock.advance(1900); // stale again, the stick still held
  check(page.doc.body.dataset.link === "stale", "stale again");
  mark = count(ws);
  page.clock.advance(1000);
  after = names(ws, mark);
  check(after.length === 5 && after.every((n) => n === "MOVE_FORWARD"), `stick through stale ${after}`);
});

test("onManualInput: an armed stick press and a rotate press, never a hover or a right-click", () => {
  const { page, ws } = connected(telemetry(), { touch: false });
  const heard = listen(page);

  for (const b of ["cw", "ccw"]) {
    page.fire(page.$(b), "pointerover", { pointerId: 1, button: -1 });
    page.fire(page.$(b), "pointerleave", { pointerId: 1, button: -1 });
    press(page, page.$(b), 1, { button: 2 });
    press(page, page.$(b), 1, { ctrlKey: true });
    press(page, page.$(b), 1, { button: 1 });
  }
  const m = mouseStick(page);
  for (const extra of [{ button: 2 }, { button: 1 }, { button: 0, ctrlKey: true }]) { m.down(extra); m.up(); }
  m.move(40, -40);
  check(heard.presses() === 0, `hover and other buttons: ${heard.presses()}`);
  check(count(ws) === 0, `sent ${names(ws)}`);

  m.down();
  check(heard.presses() === 1, `armed stick press: ${heard.presses()}`);
  m.up();
  press(page, page.$("cw"), 2);
  check(heard.presses() === 2, `rotate press: ${heard.presses()}`);
  press(page, page.$("cw"), 3); // a second pointer on a button already held
  check(heard.presses() === 2, `already held: ${heard.presses()}`);
  lift(page, page.$("cw"), 2);
  check(heard.presses() === 2, `release: ${heard.presses()}`);
  page.fire(page.$("stop"), "click");
  page.fire(page.$("auto"), "click");
  check(heard.presses() === 4, `Stop and Autonomous: ${heard.presses()}`);
  // The pivot stick takes no press while it is off, and names itself once on.
  mouseStick(page, page.pivotCanvas).down();
  page.fire(page.doc, "mouseup", { button: 0 });
  ws.serverMsg(telemetry({ scheme: "ADVANCED" }));
  mouseStick(page, page.pivotCanvas).down();
  check(heard.pressed() === "move,-,-,-,pivot", `named: ${heard.pressed()}`);

  const touch = loadPage();
  connectOpen(touch);
  const touched = listen(touch);
  stickTouch(touch, 0).start();
  pivotTouch(touch, 1).start(); // off: the scheme is unknown
  check(touched.pressed() === "move", `touch on the sticks: ${touched.pressed()}`);
  check(page.errors.length === 0 && touch.errors.length === 0, `errors ${page.errors} ${touch.errors}`);
});

test("a listener that throws is reported, and the panel still stops the rover", () => {
  const page = loadPage();
  const ws = connectOpen(page);
  page.evalIn(`
    driver.onStandDown(() => { throw new Error("stand-down listener"); });
    link.onState(() => { throw new Error("state listener"); });
  `);
  press(page, page.$("cw"), 1);
  let mark = count(ws);
  page.fire(page.win, "blur", { bubbles: false });
  check(names(ws, mark).join() === "STOP", `blur ${names(ws, mark)}`);
  press(page, page.$("cw"), 1);
  mark = count(ws);
  page.fire(page.$("connect"), "click"); // Disconnect
  check(names(ws, mark).join() === "STOP" && ws.closeCalls === 1, `disconnect ${names(ws, mark)}, closed ${ws.closeCalls}`);
  check(page.doc.body.dataset.link === "down", "down");
  check(page.errors.length === 3 && page.errors.every((e) => /listener/.test(e.message)), `reported ${page.errors}`);
});

/* --- tabs ----------------------------------------------------------------- */

const tabIds = ["tabDrive", "tabProgram"];
const shown = (page) => tabIds.filter((id) => page.$(id).getAttribute("aria-selected") === "true").join();

test("tabs: click and arrow keys switch, and switching sends nothing", () => {
  const { page, ws } = connected(telemetry()); // exploring: any frame would take control
  const [drive, program] = tabIds.map((id) => page.$(id));
  const [drivePanel, programPanel] = ["driveTab", "programTab"].map((id) => page.$(id));

  check(page.$("tabDrive").parentNode.getAttribute("role") === "tablist", "a tablist");
  check(tabIds.every((id) => page.$(id).getAttribute("role") === "tab"), "tabs");
  check(drivePanel.getAttribute("role") === "tabpanel" && programPanel.getAttribute("role") === "tabpanel", "tabpanels");
  check(drivePanel.getAttribute("aria-labelledby") === "tabDrive" && programPanel.getAttribute("aria-labelledby") === "tabProgram", "labelled");
  check(shown(page) === "tabDrive" && !drivePanel.hidden && programPanel.hidden, "Drive at load");
  check(drive.getAttribute("tabindex") === "0" && program.getAttribute("tabindex") === "-1", "roving tabindex");

  page.fire(program, "click");
  check(shown(page) === "tabProgram" && drivePanel.hidden && !programPanel.hidden, "Program by click");
  check(page.store["rover.tab"] === "tabProgram", "remembered");
  check(drive.getAttribute("tabindex") === "-1" && program.getAttribute("tabindex") === "0", "tabindex follows");

  const keys = [["ArrowRight", "tabDrive"], ["ArrowRight", "tabProgram"], ["ArrowLeft", "tabDrive"], ["ArrowLeft", "tabProgram"], ["Home", "tabDrive"], ["End", "tabProgram"]];
  for (const [key, want] of keys) {
    const from = page.doc.activeElement && tabIds.includes(page.doc.activeElement.id) ? page.doc.activeElement : page.$(shown(page));
    const e = page.fire(from, "keydown", { key });
    check(shown(page) === want && page.doc.activeElement === page.$(want), `${key} from ${from.id}: ${shown(page)}, focus ${page.doc.activeElement.id}`);
    check(e.defaultPrevented, `${key} handled`);
  }
  const other = page.fire(program, "keydown", { key: "a" });
  check(!other.defaultPrevented && shown(page) === "tabProgram", "other keys ignored");

  page.fire(drive, "click");
  page.clock.advance(1000);
  check(count(ws) === 0, `tab switching sent ${names(ws)}`);
  check(page.errors.length === 0, `errors ${page.errors}`);
});

test("tabs: switching leaves a held control driving, and Stop and Autonomous on every tab", () => {
  const page = loadPage();
  const ws = connectOpen(page);
  press(page, page.$("ccw"), 1);
  page.fire(page.$("tabProgram"), "click");
  page.fire(page.$("tabDrive"), "click");
  page.fire(page.$("tabProgram"), "click");
  page.clock.advance(1000);
  check(names(ws).length === 6 && names(ws).every((n) => n === "ROTATE_COUNTERCLOCKWISE"), `held through tab switches ${names(ws)}`);
  lift(page, page.$("ccw"), 1);
  check(names(ws).slice(-1).join() === "STOP", "released");

  // Stop and Autonomous, the scan and the readouts sit outside both panels.
  const inside = (id, panel) => all(page.$(panel)).some((n) => n.id === id);
  for (const id of ["stop", "auto", "scan", "mode", "move", "temp", "motorsFault"]) {
    check(!inside(id, "driveTab") && !inside(id, "programTab"), `#${id} outside the tabs`);
  }
  const mark = count(ws);
  page.fire(page.$("stop"), "click"); // from the Program tab
  check(names(ws, mark).join() === "STOP", `Stop on the Program tab ${names(ws, mark)}`);

  // The scheme toggle sits outside the tabs, in the header's cell beside
  // them, as Stop does; both sticks, and the family selector that belongs to
  // the pivot stick, on the Drive tab.
  const bar = page.doc.documentElement.querySelector(".bar");
  for (const id of ["scheme", "stop", "auto", "target", "linkChip"]) {
    check(page.$(id) !== null && bar && all(bar).includes(page.$(id)) && !inside(id, "driveTab") && !inside(id, "programTab"), `#${id} in the header, outside the tabs`);
  }
  for (const id of ["family", "movePad", "pivotPad"]) check(page.$(id) !== null && inside(id, "driveTab"), `#${id} on the Drive tab`);
  check(page.$("programTab").tagName === "SECTION", "#programTab is a section");
});

// In a browser, joy.js throws on every move of a canvas with no layout (its
// offsetParent is null), so a stick held as the Drive tab hid could neither
// be steered nor centred: its last move repeated until the thumb lifted.
test("tabs: leaving the Drive tab lets go of a held stick: one STOP, then nothing until a fresh press", () => {
  {
    const page = loadPage();
    const ws = connectOpen(page);
    const thumb = stickTouch(page, 0);
    thumb.start(); thumb.move(0, -50);
    page.clock.advance(250);
    check(count(ws) >= 2 && names(ws).every((n) => n === "MOVE_FORWARD"), `drove ${names(ws)}`);
    let mark = count(ws);
    page.fire(page.$("tabProgram"), "click");
    check(names(ws, mark).join() === "STOP" && ws.sentAt[count(ws) - 1] === page.clock.now(), `the switch sent ${names(ws, mark)}`);
    mark = count(ws);
    thumb.move(0, 0); thumb.move(0, 50);
    page.clock.advance(1000);
    thumb.end();
    check(count(ws) === mark, `the thumb on the hidden stick sent ${names(ws, mark)}`);
    page.fire(page.$("tabDrive"), "click");
    const fresh = stickTouch(page, 1);
    fresh.start(); fresh.move(0, -50);
    check(names(ws, mark).join() === "MOVE_FORWARD", `a fresh press drove ${names(ws, mark)}`);
    check(page.errors.length === 0, `errors ${page.errors}`);
  }

  // Both sticks held: one STOP for the two, and each drives again only from
  // a fresh press of its own.
  {
    const { page, ws } = connected(telemetry({ mode: "MANUAL", scheme: "ADVANCED" }));
    const move = stickTouch(page, 0);
    const pivot = pivotTouch(page, 1);
    move.start(); move.move(0, -50);
    pivot.start(); pivot.move(50, 0);
    check(names(ws).join() === "MOVE_FORWARD,PIVOT_RIGHT_FORWARD", `both sticks ${names(ws)}`);
    let mark = count(ws);
    page.fire(page.$("tabProgram"), "click");
    check(names(ws, mark).join() === "STOP", `the switch sent ${names(ws, mark)}`);
    page.fire(page.$("tabDrive"), "click");
    mark = count(ws);
    move.move(0, -60); pivot.move(60, 0);
    page.clock.advance(1000);
    check(count(ws) === mark, `the thumbs on the sticks let go of sent ${names(ws, mark)}`);
    move.end(); pivot.end();
    pivotTouch(page, 2).start();
    pivotTouch(page, 2).move(-50, 0);
    check(names(ws, mark).join() === "PIVOT_LEFT_FORWARD", `a fresh press of the pivot stick drove ${names(ws, mark)}`);
    check(page.errors.length === 0, `errors ${page.errors}`);
  }

  // A stick pressed but centred has nothing to stop, and an exploring rover
  // explores on; a held rotate button drives on under the stick.
  {
    const { page, ws } = connected(telemetry());
    const thumb = stickTouch(page, 0);
    thumb.start();
    page.fire(page.$("tabProgram"), "click");
    page.clock.advance(1000);
    check(count(ws) === 0, `a centred stick sent ${names(ws)}`);
  }
  {
    const page = loadPage();
    const ws = connectOpen(page);
    const thumb = stickTouch(page, 0);
    thumb.start(); thumb.move(0, -50);
    press(page, page.$("cw"), 4);
    const mark = count(ws);
    page.fire(page.$("tabProgram"), "click");
    page.clock.advance(1000);
    const after = names(ws, mark);
    check(after.length >= 4 && after.every((n) => n === "ROTATE_CLOCKWISE"), `rotate through the switch ${after}`);
  }
});

test("tabs: the last tab comes back, with the stick sized before it was hidden", () => {
  const page = loadPage({ stored: { "rover.tab": "tabProgram" } });
  check(shown(page) === "tabProgram" && page.$("driveTab").hidden && !page.$("programTab").hidden, `restored ${shown(page)}`);
  check(page.canvas.width === 230 && page.canvas.height === 230, `stick canvas ${page.canvas.width}x${page.canvas.height}`);
  check(page.errors.length === 0, `errors ${page.errors}`);

  for (const stored of [{ "rover.tab": "nonsense" }, {}]) {
    const fresh = loadPage({ stored });
    check(shown(fresh) === "tabDrive", `${JSON.stringify(stored)}: ${shown(fresh)}`);
  }
  for (const storage of ["throws", "null"]) {
    const blocked = loadPage({ storage });
    check(shown(blocked) === "tabDrive", `${storage}: ${shown(blocked)}`);
    blocked.fire(blocked.$("tabProgram"), "click");
    check(shown(blocked) === "tabProgram" && blocked.errors.length === 0, `${storage}: switched, errors ${blocked.errors}`);
  }
});

/* --- the stick follows its box's size ------------------------------------ */

// joy.js sizes its canvas once, as it is built; the Driver builds it again
// when the stick's box settles at a new size, and lets go of a held stick
// when a window resize moves or resizes its box. The rebuilds need the page's
// ResizeObserver, which loadPage gives with frames.

// The box as a resize leaves it, the observer's callbacks, and the settling
// time after the last of them.
function resizeStick(page, size, settle = true) {
  page.$("stick").clientWidth = size;
  page.$("stick").clientHeight = size;
  page.resized();
  if (settle) page.clock.advance(page.evalIn("Driver.REFIT_MS"));
}
const stickCanvases = (page) => page.$("stick").children.filter((n) => n.tagName === "CANVAS");

test("stick: a resize rebuilds the canvas at the new size once it settles, and sends nothing", () => {
  const { page, ws } = connected(telemetry(), { frames: true, stickSize: 352 }); // exploring: any frame would take control
  const first = page.canvas;
  check(first.width === 352 && first.height === 352, `built at ${first.width}x${first.height}`);

  // A window edge dragged for longer than REFIT_MS, a new size every half of
  // it: nothing is rebuilt until the last size has held for REFIT_MS, and
  // then once, at that size.
  const refitMs = page.evalIn("Driver.REFIT_MS");
  for (const size of [300, 280, 260, 230]) {
    resizeStick(page, size, false);
    page.clock.advance(refitMs / 2);
    check(page.canvas === first, `rebuilt while the size was still changing, at ${page.canvas.width}`);
  }
  page.clock.advance(refitMs / 2 - 1);
  check(page.canvas === first, `rebuilt before the last size had held for REFIT_MS, at ${page.canvas.width}`);
  page.clock.advance(1);
  const [second] = stickCanvases(page);
  check(stickCanvases(page).length === 1 && second !== first && first.parentNode === null, `one new canvas in place of the old: ${stickCanvases(page).length}`);
  check(second.width === 230 && second.height === 230, `rebuilt at ${second.width}x${second.height}`);
  check(page.joy.GetWidth() === 230, "the JoyStick drawing it is the new one");

  // Hidden behind the Program tab the box has no size, and shown again it
  // has the one it had: neither is a new canvas.
  page.fire(page.$("tabProgram"), "click");
  resizeStick(page, 230);
  page.fire(page.$("tabDrive"), "click");
  resizeStick(page, 230);
  check(page.canvas === second, "not rebuilt for a tab switch");
  page.clock.advance(1000);
  check(count(ws) === 0, `an idle rebuild sent ${names(ws)}`);

  // The new canvas drives, by touch.
  const s = stickTouch(page, 0);
  s.start(); s.move(0, -50);
  s.end();
  check(names(ws).join() === "MOVE_FORWARD,STOP", `the new canvas drove ${names(ws)}`);
  check(page.errors.length === 0, `errors ${page.errors}`);
});

// The held move goes on until the size settles, and the rebuild ends it with
// one STOP, at once.
function stoppedByRebuild(page, ws, from, move) {
  const sent = names(ws, from);
  return sent.pop() === "STOP" && sent.every((n) => n === move) && ws.sentAt[count(ws) - 1] === page.clock.now();
}

test("stick: a rebuild under a held stick sends one STOP, then nothing until a fresh press", () => {
  // By touch: the thumb stays on the old canvas, and moves on it.
  {
    const page = loadPage({ frames: true });
    const ws = connectOpen(page);
    const thumb = stickTouch(page, 0);
    thumb.start(); thumb.move(0, -50);
    page.clock.advance(250);
    check(count(ws) >= 2 && names(ws).every((n) => n === "MOVE_FORWARD"), `drove ${names(ws)}`);
    let mark = count(ws);
    resizeStick(page, 180);
    check(stoppedByRebuild(page, ws, mark, "MOVE_FORWARD"), `rebuilt under the thumb ${names(ws, mark)}`);
    check(page.canvas.width === 180, `rebuilt at ${page.canvas.width}`);
    mark = count(ws);
    thumb.move(30, -60); thumb.move(0, -80);
    page.clock.advance(1000);
    check(count(ws) === mark, `the thumb on the old canvas sent ${names(ws, mark)}`);
    thumb.end();
    check(count(ws) === mark, `lifting it sent ${names(ws, mark)}`);
    const fresh = stickTouch(page, 1);
    fresh.start(); fresh.move(0, -50);
    check(names(ws, mark).join() === "MOVE_FORWARD", `a fresh press drove ${names(ws, mark)}`);
    // The old JoyStick still listens on the document, and still holds the
    // first thumb's identifier: another finger given it, lifting elsewhere,
    // must not stop the stick the new thumb holds.
    page.fire(page.$("cw"), "touchend", { targetTouches: [], changedTouches: [{ identifier: 0 }] });
    check(names(ws, mark).join() === "MOVE_FORWARD", `the old JoyStick's report stopped the new stick: ${names(ws, mark)}`);
    fresh.end();
    check(names(ws, mark).join() === "MOVE_FORWARD,STOP", `the fresh press let go of ${names(ws, mark)}`);
    check(page.errors.length === 0, `errors ${page.errors}`);
  }

  // By mouse, held through the rebuild and let go of after it.
  {
    const { page, ws } = connected(telemetry({ mode: "MANUAL" }), { frames: true, touch: false });
    const m = mouseStick(page);
    m.down(); m.move(95, 0);
    check(names(ws).join() === "MOVE_RIGHT", `mouse ${names(ws)}`);
    let mark = count(ws);
    resizeStick(page, 300);
    check(stoppedByRebuild(page, ws, mark, "MOVE_RIGHT"), `rebuilt under the mouse ${names(ws, mark)}`);
    mark = count(ws);
    m.move(90, -20);
    page.clock.advance(1000);
    check(count(ws) === mark, `the mouse still down sent ${names(ws, mark)}`);
    m.up();
    check(count(ws) === mark, `the mouseup sent ${names(ws, mark)}`);
    const fresh = mouseStick(page);
    fresh.down(); fresh.move(0, -95);
    check(names(ws, mark).join() === "MOVE_FORWARD", `a fresh click drove ${names(ws, mark)}`);
    check(page.errors.length === 0, `errors ${page.errors}`);
  }

  // A held rotate button drives on: a rebuild lets go of the stick alone.
  {
    const page = loadPage({ frames: true });
    const ws = connectOpen(page);
    const thumb = stickTouch(page, 0);
    thumb.start(); thumb.move(0, -50);
    press(page, page.$("cw"), 4);
    const mark = count(ws);
    resizeStick(page, 200);
    page.clock.advance(1000);
    const after = names(ws, mark);
    check(after.length >= 4 && after.every((n) => n === "ROTATE_CLOCKWISE"), `rotate through a rebuild ${after}`);
  }
});

// A resize of the window that leaves the stick's box at (left, top), its
// size unchanged (one that changes the size builds the stick again, which
// the rebuild tests hold). joy.js measures a thumb against where the box
// is now.
function moveStick(page, left, top, id = "stick") {
  page.$(id).offsetLeft = left;
  page.$(id).offsetTop = top;
  page.fire(page.win, "resize", { bubbles: false });
}

test("stick: a resize that moves the stick under a held stick sends one STOP at once, then nothing until a fresh press", () => {
  // By touch, on a phone turned: the stick moves up under a thumb holding
  // it forward, and the thumb, resting where it was, is now behind its
  // centre. Before, that drove the rover backward with no STOP between.
  {
    const page = loadPage();
    const ws = connectOpen(page);
    const thumb = stickTouch(page, 0);
    thumb.start(); thumb.move(0, -50);
    page.clock.advance(250);
    check(count(ws) >= 2 && names(ws).every((n) => n === "MOVE_FORWARD"), `drove ${names(ws)}`);
    let mark = count(ws);
    moveStick(page, 8, -100);
    check(names(ws, mark).join() === "STOP" && ws.sentAt[count(ws) - 1] === page.clock.now(), `turned under the thumb ${names(ws, mark)}`);
    check(page.canvas.width === 230, "the same size: no rebuild");
    mark = count(ws);
    thumb.move(0, -50); thumb.move(0, -60);
    page.clock.advance(1000);
    check(count(ws) === mark, `the thumb resting on the moved stick sent ${names(ws, mark)}`);
    thumb.end();
    check(count(ws) === mark, `lifting it sent ${names(ws, mark)}`);
    // A fresh press is measured where the stick is now.
    const fresh = stickTouch(page, 1);
    fresh.start(); fresh.move(0, -50 - 100);
    check(names(ws, mark).join() === "MOVE_FORWARD", `a fresh press drove ${names(ws, mark)}`);
    check(page.errors.length === 0, `errors ${page.errors}`);
  }

  // By mouse, a window resized under a held button.
  {
    const { page, ws } = connected(telemetry({ mode: "MANUAL" }), { touch: false });
    const m = mouseStick(page);
    m.down(); m.move(95, 0);
    check(names(ws).join() === "MOVE_RIGHT", `mouse ${names(ws)}`);
    let mark = count(ws);
    moveStick(page, 150, 0);
    check(names(ws, mark).join() === "STOP", `moved under the mouse ${names(ws, mark)}`);
    mark = count(ws);
    m.move(95, 0);
    page.clock.advance(1000);
    check(count(ws) === mark, `the mouse still down sent ${names(ws, mark)}`);
    m.up();
    check(count(ws) === mark, `the mouseup sent ${names(ws, mark)}`);
    const fresh = mouseStick(page);
    fresh.down(); fresh.move(150, -95);
    check(names(ws, mark).join() === "MOVE_FORWARD", `a fresh click drove ${names(ws, mark)}`);
    check(page.errors.length === 0, `errors ${page.errors}`);
  }

  // A resize that leaves the stick where it was (a phone's address bar
  // coming or going) lets go of nothing; a thumb resting on a stick it was
  // not deflecting is let go of without a STOP.
  {
    const page = loadPage();
    const ws = connectOpen(page);
    const thumb = stickTouch(page, 0);
    thumb.start(); thumb.move(0, -50);
    moveStick(page, 0, 0);
    page.clock.advance(1000);
    check(names(ws).length >= 5 && names(ws).every((n) => n === "MOVE_FORWARD"), `drove on through a resize that moved nothing ${names(ws)}`);
    thumb.end();
    const mark = count(ws);
    const resting = stickTouch(page, 1);
    resting.start();
    moveStick(page, 0, 40);
    resting.move(0, -50);
    page.clock.advance(1000);
    check(count(ws) === mark, `a centred stick let go of sent ${names(ws, mark)}`);
  }

  // A held rotate button drives on, and an exploring rover idle under a
  // resize is left alone.
  {
    const page = loadPage();
    const ws = connectOpen(page);
    const thumb = stickTouch(page, 0);
    thumb.start(); thumb.move(0, -50);
    press(page, page.$("cw"), 4);
    const mark = count(ws);
    moveStick(page, 0, -100);
    page.clock.advance(1000);
    const after = names(ws, mark);
    check(after.length >= 4 && after.every((n) => n === "ROTATE_CLOCKWISE"), `rotate through a move ${after}`);
  }
  {
    const { page, ws } = connected(telemetry());
    moveStick(page, 0, -100);
    page.clock.advance(1000);
    check(count(ws) === 0, `an idle resize sent ${names(ws)}`);
  }
});

test("stick: a resize that changes the stick's size lets go of a held stick at once, not when the size settles", () => {
  const page = loadPage({ frames: true });
  const ws = connectOpen(page);
  const thumb = stickTouch(page, 0);
  thumb.start(); thumb.move(0, -50);
  page.clock.advance(250);
  const mark = count(ws);
  // The window's resize event comes with the new size, before the observer
  // has settled on it.
  resizeStick(page, 180, false);
  page.fire(page.win, "resize", { bubbles: false });
  check(names(ws, mark).join() === "STOP" && ws.sentAt[count(ws) - 1] === page.clock.now(), `resized under the thumb ${names(ws, mark)}`);
  page.clock.advance(page.evalIn("Driver.REFIT_MS"));
  check(page.canvas.width === 180, `rebuilt at ${page.canvas.width}`);
  check(names(ws, mark).join() === "STOP", `the rebuild sent ${names(ws, mark)}`);
  check(page.errors.length === 0, `errors ${page.errors}`);
});

// A move of the stick that no resize reports: a row above it coming or going
// (on a short phone, the address put away as the link comes up), or
// the page scrolling. joy.js measures the resting thumb against the box where
// it is now, so its next report would be another motion.
test("stick: a move no resize reports lets go of a held stick at its next report, then nothing until a fresh press", () => {
  {
    const page = loadPage();
    const ws = connectOpen(page);
    const thumb = stickTouch(page, 0);
    thumb.start(); thumb.move(40, -40);
    page.clock.advance(250);
    check(count(ws) >= 2 && names(ws).every((n) => n === "MOVE_DIAGONAL45"), `drove ${names(ws)}`);
    let mark = count(ws);
    // The stick moves 25 px up, and nothing tells the window: the thumb,
    // resting where it was, is now nearly level with its centre. Before,
    // that report drove the rover right, with no STOP between.
    page.$("stick").offsetTop = -25;
    thumb.move(40, -40);
    check(names(ws, mark).join() === "STOP" && ws.sentAt[count(ws) - 1] === page.clock.now(), `the next report sent ${names(ws, mark)}`);
    mark = count(ws);
    thumb.move(40, -60); thumb.move(0, -80);
    page.clock.advance(1000);
    check(count(ws) === mark, `the thumb resting on the moved stick sent ${names(ws, mark)}`);
    thumb.end();
    check(count(ws) === mark, `lifting it sent ${names(ws, mark)}`);
    // A fresh press is measured where the stick is now.
    const fresh = stickTouch(page, 1);
    fresh.start(); fresh.move(0, -50 - 25);
    check(names(ws, mark).join() === "MOVE_FORWARD", `a fresh press drove ${names(ws, mark)}`);
    check(page.errors.length === 0, `errors ${page.errors}`);
  }

  // A held rotate button drives on; an idle stick on a moved box sends
  // nothing, so an exploring rover is left alone.
  {
    const page = loadPage();
    const ws = connectOpen(page);
    const thumb = stickTouch(page, 0);
    thumb.start(); thumb.move(0, -50);
    press(page, page.$("cw"), 4);
    const mark = count(ws);
    page.$("stick").offsetTop = 40;
    thumb.move(0, -50);
    page.clock.advance(1000);
    const after = names(ws, mark);
    check(after.length >= 4 && after.every((n) => n === "ROTATE_CLOCKWISE"), `rotate through a move ${after}`);
  }
  {
    const { page, ws } = connected(telemetry());
    const m = mouseStick(page);
    m.move(0, -95);
    page.$("stick").offsetTop = 40;
    m.move(0, -95);
    page.clock.advance(1000);
    check(count(ws) === 0, `an idle stick on a moved box sent ${names(ws)}`);
  }
});

// A press's own redraw can move the stick: the caption asking for a fresh
// press goes back to the family's name as the press lands. The box the
// thumb pressed into is the one after that redraw, so the press drives.
test("stick: a press is measured against the box its own redraw leaves", () => {
  const page = loadPage();
  const ws = connectOpen(page);
  page.evalIn(`driver.onManualInput(() => { document.getElementById("stick").offsetTop = 8; })`);
  const thumb = stickTouch(page, 0);
  thumb.start(0, 8); thumb.move(0, -50 + 8);
  page.clock.advance(1000);
  check(count(ws) >= 5 && names(ws).every((n) => n === "MOVE_FORWARD"), `the press drove ${names(ws)}`);
  thumb.end();
  check(names(ws).slice(-1).join() === "STOP", `let go ${names(ws).slice(-1)}`);
});

/* --- two sticks ------------------------------------------------------------ */

// The translate stick and the pivot stick, held at once by two thumbs, as
// on a gamepad. Each JoyStick follows only the touch that started on its
// own canvas (joy.js checks the touch's target and identifier), and the
// Driver tracks each stick apart.

test("sticks: two thumbs at once: the stick pressed last drives, and letting go of it hands the rover to the other", () => {
  const { page, ws } = connected(telemetry({ mode: "MANUAL", scheme: "ADVANCED" }));
  const limit = Number(page.$("speed").value);
  const move = stickTouch(page, 0);
  const pivot = pivotTouch(page, 1);
  move.start(); pushTo(page, move, 0, 70);
  pivot.start(); pushTo(page, pivot, 60, 60);
  check(names(ws).join() === "MOVE_FORWARD,PIVOT_RIGHT_FORWARD", `the pivot stick, pressed last ${names(ws)}`);

  // The translate thumb steering changes nothing sent while the pivot
  // stick holds the rover; it is remembered.
  let mark = count(ws);
  page.clock.advance(150);
  pushTo(page, move, -70, 0);
  page.clock.advance(40);
  check(names(ws, mark).every((n) => n === "PIVOT_RIGHT_FORWARD"), `under the pivot stick ${names(ws, mark)}`);

  // Lifting the pivot thumb hands the rover to the translate stick, in its
  // latest direction and at its own deflection, at once.
  mark = count(ws);
  pivot.end();
  check(names(ws, mark).join() === "MOVE_LEFT" && ws.sentAt[mark] === page.clock.now(), `handed back ${names(ws, mark)}`);
  check(ws.moves()[mark].speed === Math.round(0.7 * limit), `at the translate stick's speed: ${ws.moves()[mark].speed}`);

  // A fresh press of the pivot stick takes the rover again; centred under
  // the thumb, the stick hands it back, and deflected, takes it again: it
  // is still the stick pressed last.
  mark = count(ws);
  const again = pivotTouch(page, 2);
  again.start(); pushTo(page, again, -60, -60);
  pushTo(page, again, 2, 2);
  pushTo(page, again, -60, -60);
  check(names(ws, mark).join() === "PIVOT_LEFT_BACKWARD,MOVE_LEFT,PIVOT_LEFT_BACKWARD", `centred and back ${names(ws, mark)}`);

  // Lifting the stick not driving changes nothing; lifting both stops once.
  mark = count(ws);
  move.end();
  check(count(ws) === mark, `lifting the translate thumb sent ${names(ws, mark)}`);
  again.end();
  page.clock.advance(1000);
  check(names(ws, mark).join() === "STOP", `both lifted ${names(ws, mark)}`);

  // A rotate button wins over both, and lets go to the stick pressed last.
  mark = count(ws);
  const t = stickTouch(page, 3);
  t.start(); pushTo(page, t, 0, 70);
  press(page, page.$("cw"), 9);
  const p = pivotTouch(page, 4);
  p.start(); pushTo(page, p, 60, -60);
  lift(page, page.$("cw"), 9);
  check(names(ws, mark).join() === "MOVE_FORWARD,ROTATE_CLOCKWISE,PIVOT_RIGHT_BACKWARD", `rotate over both ${names(ws, mark)}`);
  check(page.errors.length === 0, `errors ${page.errors}`);
});

test("sticks: a touchcancel lets go of its own stick, and the other drives on", () => {
  const { page, ws } = connected(telemetry({ mode: "MANUAL", scheme: "ADVANCED" }));
  const move = stickTouch(page, 0);
  const pivot = pivotTouch(page, 1);
  move.start(); pushTo(page, move, 0, 70);
  pivot.start(); pushTo(page, pivot, 60, 60);
  let mark = count(ws);
  pivot.cancel();
  check(names(ws, mark).join() === "MOVE_FORWARD", `the pivot touch taken away ${names(ws, mark)}`);
  check(page.pivotJoy.GetX() === "0" && page.joy.GetY() !== "0", `the pivot knob recentred, the translate knob held: ${page.pivotJoy.GetX()} ${page.joy.GetY()}`);
  mark = count(ws);
  page.clock.advance(450);
  check(names(ws, mark).join() === "MOVE_FORWARD,MOVE_FORWARD", `the translate stick drives on ${names(ws, mark)}`);
  move.cancel();
  check(names(ws, mark).join() === "MOVE_FORWARD,MOVE_FORWARD,STOP", `then the other ${names(ws, mark)}`);

  // A touch taken from a stick held but not driving sends nothing: the
  // stick pressed last drives on, with no STOP between.
  {
    const { page, ws } = connected(telemetry({ mode: "MANUAL", scheme: "ADVANCED" }));
    const pivot = pivotTouch(page, 0);
    const move = stickTouch(page, 1);
    pivot.start(); pushTo(page, pivot, 60, 60);
    move.start(); pushTo(page, move, 0, 70);
    const mark = count(ws);
    pivot.cancel();
    page.clock.advance(450);
    check(names(ws, mark).join() === "MOVE_FORWARD,MOVE_FORWARD", `the pivot touch taken away while the translate stick drove: ${names(ws, mark)}`);
    check(page.pivotJoy.GetX() === "0" && page.joy.GetY() !== "0", `the pivot knob recentred, the translate knob held: ${page.pivotJoy.GetX()} ${page.joy.GetY()}`);
  }
});

test("sticks: the pivot stick takes no press while off, and turning it off stops only what it was driving", () => {
  // Off, on an exploring rover: a press and a push send nothing and take
  // nothing from exploration.
  {
    const { page, ws } = connected(telemetry({ scheme: "NORMAL" })); // exploring
    const heard = listen(page);
    const p = pivotTouch(page, 0);
    p.start(); pushTo(page, p, 60, 60);
    page.clock.advance(1000);
    p.end();
    check(count(ws) === 0 && heard.presses() === 0, `sent ${names(ws)}, presses ${heard.presses()}`);
    check(page.evalIn("driver.enablePivots(false)") === false, "turning it off again let go of nothing");
  }

  // On, held but not pressed last: turned off, it lets go without a STOP,
  // and the translate stick drives on.
  {
    const { page, ws } = connected(telemetry({ mode: "MANUAL", scheme: "ADVANCED" }));
    const p = pivotTouch(page, 0);
    const t = stickTouch(page, 1);
    p.start(); pushTo(page, p, 60, 60);
    t.start(); pushTo(page, t, 0, 70);
    const mark = count(ws);
    check(page.evalIn("driver.enablePivots(false)") === true, "let go of a deflected stick");
    page.clock.advance(450);
    check(names(ws, mark).join() === "MOVE_FORWARD,MOVE_FORWARD", `the translate stick drove on ${names(ws, mark)}`);
    t.end();
    page.evalIn("driver.enablePivots(true)");
    pushTo(page, p, 60, -60);
    page.clock.advance(450);
    check(names(ws, mark).join() === "MOVE_FORWARD,MOVE_FORWARD,STOP", `the translate stick's STOP, and nothing from the pivot thumb, never pressed again: ${names(ws, mark)}`);
  }

  // Pressed but centred: nothing to let go of, nothing sent.
  {
    const { page, ws } = connected(telemetry({ scheme: "ADVANCED" })); // exploring
    pivotTouch(page, 0).start();
    check(page.evalIn("driver.enablePivots(false)") === false && count(ws) === 0, `a centred stick: ${names(ws)}`);
  }
});

test("sticks: a resize that moves the pivot stick under its thumb lets go of it at once, and leaves the translate stick driving", () => {
  const { page, ws } = connected(telemetry({ mode: "MANUAL", scheme: "ADVANCED" }));
  const move = stickTouch(page, 0);
  const pivot = pivotTouch(page, 1);
  move.start(); pushTo(page, move, 0, 70);
  pivot.start(); pushTo(page, pivot, 60, 60);
  let mark = count(ws);
  moveStick(page, 8, -100, "pivotStick");
  check(names(ws, mark).join() === "MOVE_FORWARD" && ws.sentAt[mark] === page.clock.now(), `moved under the pivot thumb ${names(ws, mark)}`);
  mark = count(ws);
  pivot.move(40, -40);
  page.clock.advance(450);
  check(names(ws, mark).join() === "MOVE_FORWARD,MOVE_FORWARD", `the resting pivot thumb sent ${names(ws, mark)}`);
  check(page.errors.length === 0, `errors ${page.errors}`);
});

test("sticks: a rebuild of either stick lets go of both: one STOP, then nothing until a fresh press of each", () => {
  const page = loadPage({ frames: true });
  const ws = connectOpen(page);
  ws.serverMsg(telemetry({ mode: "MANUAL", scheme: "ADVANCED" }));
  const move = stickTouch(page, 0);
  const pivot = pivotTouch(page, 1);
  move.start(); pushTo(page, move, 0, 70);
  pivot.start(); pushTo(page, pivot, 60, 60);
  const translateCanvas = page.canvas;
  let mark = count(ws);
  page.$("pivotStick").clientWidth = 180;
  page.$("pivotStick").clientHeight = 180;
  page.resized();
  page.clock.advance(page.evalIn("Driver.REFIT_MS"));
  check(stoppedByRebuild(page, ws, mark, "PIVOT_RIGHT_FORWARD"), `rebuilt under both thumbs ${names(ws, mark)}`);
  check(page.pivotCanvas.width === 180 && page.canvas === translateCanvas, "the pivot stick alone built again");
  check(page.$("stick").resizeObserved && page.$("pivotStick").resizeObserved, "both boxes watched for a new size");
  mark = count(ws);
  move.move(-60, 0); pivot.move(40, -40);
  page.clock.advance(1000);
  move.end(); pivot.end();
  check(count(ws) === mark, `the thumbs let go of sent ${names(ws, mark)}`);
  const fresh = stickTouch(page, 2);
  fresh.start(); pushTo(page, fresh, 0, 70);
  pivotTouch(page, 3).start();
  pivotTouch(page, 3).move(0, -50);
  check(names(ws, mark).join() === "MOVE_FORWARD,PIVOT_RIGHT_FORWARD", `fresh presses drove ${names(ws, mark)}`);
  check(page.errors.length === 0, `errors ${page.errors}`);
});

/* --- mirrored constants -------------------------------------------------- */

// tools/check_protocol.py compares protocol.js with src/ (CI and the build
// hook run it); this checks only the page: no later script redefines one.
test("the page runs protocol.js's values as the file writes them", () => {
  const written = Object.entries(require("../js/protocol.js"));
  check(written.length > 0, "protocol.js exports its values");
  const page = loadPage();
  for (const [name, value] of written) check(page.evalIn(name) === value, `the page's ${name} is ${JSON.stringify(value)}`);
});

/* --- schemes -------------------------------------------------------------- */

// The scheme toggle, the family selector and the rule that a scheme change
// never redirects a held stick (app.js, "control scheme").

const SCHEMES = ["NORMAL", "ADVANCED"];
const schemeButton = (page, scheme) => all(page.$("schemeChoice")).find((n) => n.dataset.scheme === scheme);
const familyButton = (page, family) => all(page.$("familyChoice")).find((n) => n.dataset.family === family);
const isPressed = (button) => button.getAttribute("aria-pressed") === "true";
// The scheme the toggle shows (the target's), or "unknown".
const shownScheme = (page) => SCHEMES.filter((s) => isPressed(schemeButton(page, s))).join() || "unknown";
const pendingScheme = (page) => SCHEMES.filter((s) => schemeButton(page, s).dataset.pending === "yes").join() || null;
const hintMoves = (page) => all(page.$("stickHints")).filter((n) => n.dataset.corner).map((n) => `${n.dataset.corner}:${n.dataset.move}`).join();

// Push the stick so that joy.js reports (x, yUp): it reads a deflection of
// maxMoveStick pixels as 100, and that is (w - (w/2 + 10))/2 + 5 for a
// canvas w wide.
function pushTo(page, s, x, yUp) {
  const w = page.canvas.width;
  const reach = (w - (w / 2 + 10)) / 2 + 5;
  s.move((x * reach) / 100, (-yUp * reach) / 100);
}

test("schemes: scheme.js and family.js load after what they use, before app.js", () => {
  const page = loadPage();
  const order = page.scripts;
  for (const [a, b] of [
    ["js/support.js", "js/scheme.js"], ["js/protocol.js", "js/scheme.js"], ["js/scheme.js", "js/app.js"],
    ["js/support.js", "js/family.js"], ["js/mecanum.js", "js/family.js"], ["js/family.js", "js/app.js"],
  ]) check(loadsBefore(order, a, b), `${a} loads before ${b}: ${order}`);
  check(page.errors.length === 0, `errors ${page.errors}`);
});

// Unknown is not broken: the owner read a greyed toggle with no rover as
// a fault (docs/features.md, F8). So both segments take a press, and a press
// is a wish the next frame that names a scheme settles; until then nothing
// is pressed, nothing is sent, and the pivots stay off.
test("schemes: until telemetry names a scheme nothing is pressed, both segments take a wish, and nothing is sent", () => {
  const page = loadPage();
  const group = page.$("scheme");
  const unknown = (when) => {
    check(shownScheme(page) === "unknown", `${when}: shows ${shownScheme(page)}`);
    check(SCHEMES.every((s) => schemeButton(page, s).disabled === false), `${when}: both take a press`);
    check(group.dataset.state === "unknown", `${when}: state ${group.dataset.state}`);
    check(page.evalIn("schemeToggle.scheme") === null, `${when}: no scheme, a wish is not one`);
    check(pivotsState(page) === "off" && page.evalIn("driver.family") === "PIVOT", `${when}: pivots ${pivotsState(page)}, family ${page.evalIn("driver.family")}`);
  };
  check(SCHEMES.every((s) => schemeButton(page, s) !== undefined), "two segments built");
  unknown("at load");
  check(/has not reported its control scheme/.test(schemeButton(page, "NORMAL").title), `the segments say why neither is lit: ${schemeButton(page, "NORMAL").title}`);

  const ws = connectOpen(page);
  unknown("connected, no telemetry yet");
  // Firmware from before schemes, a scheme this panel does not know, junk:
  // a wish waits through each, and is replaced or dropped as pressed.
  for (const scheme of [undefined, "EXPERT", "advanced", 1, null, { name: "ADVANCED" }]) {
    ws.serverMsg(telemetry({ scheme }));
    unknown(`scheme ${JSON.stringify(scheme)}`);
    for (const s of SCHEMES) page.fire(schemeButton(page, s), "click");
    check(page.evalIn("schemeToggle.wanted") === "ADVANCED" && pendingScheme(page) === "ADVANCED", `scheme ${JSON.stringify(scheme)}: the later press replaced the wish: ${page.evalIn("schemeToggle.wanted")}, marked ${pendingScheme(page)}`);
    unknown(`scheme ${JSON.stringify(scheme)}, wishing`);
    page.fire(schemeButton(page, "ADVANCED"), "click");
    check(page.evalIn("schemeToggle.wanted") === null && pendingScheme(page) === null, `scheme ${JSON.stringify(scheme)}: a press on the wish dropped it`);
  }
  check(count(ws) === 0, `a wish sent ${ws.sent}`);

  ws.serverMsg(telemetry({ scheme: "NORMAL" }));
  check(shownScheme(page) === "NORMAL" && group.dataset.state === "known", `NORMAL: ${shownScheme(page)} ${group.dataset.state}`);
  check(SCHEMES.every((s) => schemeButton(page, s).disabled === false), "enabled");
  check(page.evalIn("schemeToggle.scheme") === "NORMAL", "scheme getter");
  check(pivotsState(page) === "off", `NORMAL: pivots ${pivotsState(page)}`);
  ws.serverMsg(telemetry({ scheme: "ADVANCED" }));
  check(shownScheme(page) === "ADVANCED", `follows telemetry, as after the pad's SELECT: ${shownScheme(page)}`);
  check(pivotsState(page) === "on", `ADVANCED: pivots ${pivotsState(page)}`);
  ws.serverMsg(telemetry({ scheme: undefined })); // a frame that names none says nothing is known
  unknown("a frame without scheme");
  check(count(ws) === 0, `sent ${ws.sent}`);
  check(page.errors.length === 0, `errors ${page.errors}`);
});

test("schemes: a wish made before connecting goes to the rover with its first frame, once, and the rover explores on", () => {
  const page = loadPage();
  page.fire(schemeButton(page, "ADVANCED"), "click");
  const wished = schemeButton(page, "ADVANCED");
  check(pendingScheme(page) === "ADVANCED" && shownScheme(page) === "unknown", `wished: marked ${pendingScheme(page)}, shown ${shownScheme(page)}`);
  check(/^Advanced: .* Sent to the rover as soon as it reports its scheme/.test(wished.title), `the wished segment says what will happen: ${wished.title}`);
  check(!/Sent to the rover/.test(schemeButton(page, "NORMAL").title), `the other does not: ${schemeButton(page, "NORMAL").title}`);
  check(page.$("scheme").getAttribute("aria-busy") === "true", "busy while wished");
  check(page.sockets.length === 0 && pivotsState(page) === "off", `a wish connects nothing and turns no pivot on: ${pivotsState(page)}`);

  const ws = connectOpen(page);
  const heard = listen(page);
  check(count(ws) === 0, `sent before any frame: ${ws.sent}`);
  ws.serverMsg(telemetry({ scheme: "NORMAL" })); // exploring, on NORMAL
  check(ws.sent.join() === '{"scheme":"ADVANCED"}', `the first frame sent ${ws.sent}`);
  check(page.evalIn("schemeToggle.wanted") === null, "the wish is spent");
  check(pendingScheme(page) === "ADVANCED" && shownScheme(page) === "NORMAL" && page.$("scheme").dataset.state === "pending", `pending as a press's: ${pendingScheme(page)}, shown ${shownScheme(page)}`);
  check(!/Sent to the rover as soon/.test(wished.title), `no longer titled as a wish: ${wished.title}`);
  liveFor(page, ws, 500, { scheme: "NORMAL" });
  check(count(ws) === 1, `a frame before the rover's answer sent ${ws.sent}`);
  liveFor(page, ws, 1000, { scheme: "ADVANCED" });
  check(shownScheme(page) === "ADVANCED" && pendingScheme(page) === null && pivotsState(page) === "on", `confirmed: ${shownScheme(page)}, pivots ${pivotsState(page)}`);
  check(ws.sent.join() === '{"scheme":"ADVANCED"}', `sent ${ws.sent}`);
  check(heard.presses() === 0 && heard.downs() === "", `a wish is no manual input: ${heard.presses()}, stand-downs '${heard.downs()}'`);
  check(page.$("auto").getAttribute("aria-pressed") === "true", "the rover explores on");
  check(page.errors.length === 0, `errors ${page.errors}`);
});

test("schemes: a wish the rover's first frame already meets sends nothing, and a wish waits through a link going", () => {
  const page = loadPage();
  page.fire(schemeButton(page, "ADVANCED"), "click");
  let ws = connectOpen(page);
  ws.serverMsg(telemetry({ scheme: "ADVANCED" }));
  check(count(ws) === 0, `sent ${ws.sent}`);
  check(shownScheme(page) === "ADVANCED" && pendingScheme(page) === null && page.evalIn("schemeToggle.wanted") === null, `met: ${shownScheme(page)}, marked ${pendingScheme(page)}`);
  check(page.$("scheme").getAttribute("aria-busy") === "false", "not busy");

  // The link goes, the scheme is unknown again, and a wish made then goes
  // out on the next link's first frame.
  ws.serverDrop();
  check(shownScheme(page) === "unknown", `lost: ${shownScheme(page)}`);
  page.fire(schemeButton(page, "NORMAL"), "click");
  check(pendingScheme(page) === "NORMAL", `wished with no link: ${pendingScheme(page)}`);
  ws = connectOpen(page);
  ws.serverMsg(telemetry({ scheme: "ADVANCED" }));
  check(ws.sent.join() === '{"scheme":"NORMAL"}', `the next link's first frame sent ${ws.sent}`);
  check(page.errors.length === 0, `errors ${page.errors}`);
});

test("schemes: a press on the other segment replaces a wish, and a press on the wished one drops it", () => {
  const page = loadPage();
  page.fire(schemeButton(page, "NORMAL"), "click");
  page.fire(schemeButton(page, "ADVANCED"), "click");
  check(pendingScheme(page) === "ADVANCED" && page.evalIn("schemeToggle.wanted") === "ADVANCED", `replaced: marked ${pendingScheme(page)}`);
  check(!/Sent to the rover/.test(schemeButton(page, "NORMAL").title), "the replaced one no longer titled as the wish");
  let ws = connectOpen(page);
  ws.serverMsg(telemetry({ scheme: "NORMAL", mode: "MANUAL" }));
  check(ws.sent.join() === '{"scheme":"ADVANCED"}', `the replacement went: ${ws.sent}`);
  ws.serverDrop();

  page.fire(schemeButton(page, "NORMAL"), "click");
  page.fire(schemeButton(page, "NORMAL"), "click");
  check(pendingScheme(page) === null && page.evalIn("schemeToggle.wanted") === null, `dropped: marked ${pendingScheme(page)}`);
  check(page.$("scheme").getAttribute("aria-busy") === "false" && !/Sent to the rover/.test(schemeButton(page, "NORMAL").title), "not busy, and titled as unknown again");
  ws = connectOpen(page);
  ws.serverMsg(telemetry({ scheme: "ADVANCED", mode: "MANUAL" }));
  liveFor(page, ws, 2000, { scheme: "ADVANCED" });
  check(count(ws) === 0, `a dropped wish sent ${ws.sent}`);
  check(page.errors.length === 0, `errors ${page.errors}`);
});

// A wish in words, where a touch screen shows it (it shows no title): on
// the connect card over the rover's scan while there is no link, and in
// the link's popover, behind a dashed ring as the segment is drawn (the
// reviewer's round 1, on an iPad). Gone with the wish.
test("schemes: a wish is said in words on the connect card and in the link's popover, and only while it waits", () => {
  const page = loadPage();
  const notes = () => [page.$("connectWish"), page.$("linkWish")];
  const said = () => notes().map((n) => (n.hidden ? "-" : n.textContent)).join(" | ");
  check(notes().every((n) => n.hidden), `nothing to say at first: ${said()}`);
  check(all(page.$("view")).includes(page.$("connectWish")) && all(page.$("view")).filter((n) => /\bconnectCard\b/.test(n.getAttribute("class") || "")).some((card) => all(card).includes(page.$("connectWish"))), "one on the connect card");
  check(all(page.$("linkPanel")).includes(page.$("linkWish")), "one in the link's popover");
  page.fire(schemeButton(page, "ADVANCED"), "click");
  check(notes().every((n) => !n.hidden && n.textContent === "Advanced goes to the rover once it connects."), `wished: ${said()}`);
  page.fire(schemeButton(page, "NORMAL"), "click");
  check(notes().every((n) => n.textContent === "Normal goes to the rover once it connects."), `replaced: ${said()}`);
  page.fire(schemeButton(page, "NORMAL"), "click");
  check(notes().every((n) => n.hidden), `dropped: ${said()}`);

  // Connected to firmware that names no scheme: still waiting, and said so.
  page.fire(schemeButton(page, "ADVANCED"), "click");
  const ws = connectOpen(page);
  check(page.$("linkWish").textContent === "Advanced goes to the rover once it connects.", `connected, no frame yet: ${said()}`);
  ws.serverMsg(telemetry({ scheme: undefined }));
  check(page.$("linkWish").textContent === "Advanced goes to the rover once it reports its scheme." && !page.$("linkWish").hidden, `a frame that names none: ${said()}`);
  ws.serverMsg(telemetry({ scheme: "NORMAL" }));
  check(notes().every((n) => n.hidden) && ws.sent.join() === '{"scheme":"ADVANCED"}', `sent, and said no more: ${said()}, ${ws.sent}`);
  ws.serverDrop();
  page.fire(schemeButton(page, "NORMAL"), "click");
  check(page.$("connectWish").textContent === "Normal goes to the rover once it connects.", `a wish after the link went: ${said()}`);

  // Drawn as the wished segment is: --dim words behind a dashed ring in
  // --live. In the compact row a short view makes of the card (a phone's
  // Drive tab), its title gone, the note a line over the buttons, as wide
  // as they are; gone only where the view is narrow too, Change address
  // with it, where the link's popover still says it.
  const rules = cssRules(panelCss());
  const ring = rules.find((r) => r.selector === ".schemeWish::before");
  check(ring && /border:\s*1px dashed var\(--live\)/.test(ring.body), `the dashed ring: ${ring && ring.body}`);
  const words = rules.find((r) => r.selector === ".schemeWish");
  check(words && /color:\s*var\(--dim\)/.test(words.body), `its words: ${words && words.body}`);
  const short = blockRules(panelCss(), "@container scan (max-height: 259.98px) {") || [];
  const shortHidden = short.filter((r) => /display:\s*none;/.test(r.body)).map((r) => r.selector).join();
  const shortNote = short.filter((r) => r.selector === ".connectCard .schemeWish").map((r) => r.body).join("");
  check(/\.connectTitle/.test(shortHidden) && !/schemeWish/.test(shortHidden), `a short card's title gone, the note kept: ${shortHidden}`);
  check(/grid-row:\s*1;/.test(shortNote) && /grid-column:\s*1 \/ span 2;/.test(shortNote) && /width:\s*0;/.test(shortNote) && /min-width:\s*100%;/.test(shortNote)
    && short.some((r) => r.selector === ".connectCard > button" && /grid-row:\s*2;/.test(r.body)), `a short card's note a line over its buttons, as wide as they are: ${shortNote}`);
  const narrowHidden = (blockRules(panelCss(), "@container scan (max-height: 259.98px) and (max-width: 329.98px) {") || []).filter((r) => /display:\s*none;/.test(r.body)).map((r) => r.selector).join();
  check(/\.connectCard \.schemeWish/.test(narrowHidden), `gone where the short view is narrow too: ${narrowHidden}`);
  check(page.errors.length === 0, `errors ${page.errors}`);
});

test("schemes: Advanced sends one {\"scheme\":\"ADVANCED\"} and nothing else, and the rover explores on", () => {
  const { page, ws } = connected(telemetry({ scheme: "NORMAL" })); // exploring
  const heard = listen(page);

  page.fire(schemeButton(page, "ADVANCED"), "click");
  check(ws.sent.join() === '{"scheme":"ADVANCED"}', `sent ${ws.sent}`);
  // Pending: marked, not lit, until the rover reports it.
  check(pendingScheme(page) === "ADVANCED" && shownScheme(page) === "NORMAL", `pending ${pendingScheme(page)}, shown ${shownScheme(page)}`);
  check(page.$("scheme").dataset.state === "pending" && page.$("scheme").getAttribute("aria-busy") === "true", "busy while pending");
  check(pivotsState(page) === "off", `pivots before the rover reports ADVANCED: ${pivotsState(page)}`);
  page.fire(schemeButton(page, "ADVANCED"), "click"); // again, impatiently
  check(count(ws) === 1, `a second click on the pending scheme sent ${ws.sent}`);

  liveFor(page, ws, 500, { scheme: "ADVANCED" });
  check(shownScheme(page) === "ADVANCED" && pendingScheme(page) === null, `confirmed: ${shownScheme(page)}, pending ${pendingScheme(page)}`);
  check(page.$("scheme").getAttribute("aria-busy") === "false", "not busy");
  check(page.$("mode").textContent === "AUTONOMOUS" && page.$("auto").getAttribute("aria-pressed") === "true", `mode ${page.$("mode").textContent}`);
  check(pivotsState(page) === "on", `pivots ${pivotsState(page)}`);
  page.fire(schemeButton(page, "ADVANCED"), "click"); // the scheme already in force
  liveFor(page, ws, 2000, { scheme: "ADVANCED" });
  check(count(ws) === 1, `sent ${ws.sent}`);
  check(heard.presses() === 0 && heard.downs() === "", `manual input ${heard.presses()}, stand-downs '${heard.downs()}'`);

  page.fire(schemeButton(page, "NORMAL"), "click");
  liveFor(page, ws, 500, { scheme: "NORMAL" });
  check(ws.sent.join(" ") === '{"scheme":"ADVANCED"} {"scheme":"NORMAL"}', `sent ${ws.sent.join(" ")}`);
  check(shownScheme(page) === "NORMAL" && pivotsState(page) === "off", `back to NORMAL: pivots ${pivotsState(page)}`);
  check(page.$("mode").textContent === "AUTONOMOUS", "still exploring");
  check(page.errors.length === 0, `errors ${page.errors}`);
});

test("schemes: the toggle bypasses the Driver: a held stick drives on until the rover reports the change", () => {
  // The translate stick sends the same moves under either scheme, so it
  // drives on through the change, confirmed or not.
  const { page, ws } = connected(telemetry({ mode: "MANUAL", scheme: "NORMAL" }));
  const s = stickTouch(page, 0);
  s.start(); pushTo(page, s, 0, 80);
  page.clock.advance(50);
  page.fire(schemeButton(page, "ADVANCED"), "click"); // a second finger
  const frames = ws.sent.map((f) => JSON.parse(f));
  check(frames.length === 2 && frames[1].scheme === "ADVANCED" && !("move" in frames[1]), `frames ${ws.sent}`);
  check(page.evalIn("driver.driving.move") === CODES.MOVE_FORWARD, "the stick still drives");
  let mark = count(ws);
  page.clock.advance(400); // no telemetry yet: the repeat carries on
  check(names(ws, mark).join() === "MOVE_FORWARD,MOVE_FORWARD", `repeat ${names(ws, mark)}`);
  mark = count(ws);
  ws.serverMsg(telemetry({ mode: "MANUAL", scheme: "ADVANCED" }));
  page.clock.advance(400);
  check(names(ws, mark).join() === "MOVE_FORWARD,MOVE_FORWARD", `confirmed under the translate stick ${names(ws, mark)}`);
  s.end();

  // The pivot stick drives on under ADVANCED until the rover reports
  // NORMAL, and then lets go.
  const p = pivotTouch(page, 1);
  p.start(); pushTo(page, p, 0, 80);
  mark = count(ws);
  page.fire(schemeButton(page, "NORMAL"), "click");
  page.clock.advance(400);
  check(ws.sent[mark] === '{"scheme":"NORMAL"}' && names(ws, mark + 1).join() === "PIVOT_RIGHT_FORWARD,PIVOT_RIGHT_FORWARD", `before the rover reports NORMAL ${ws.sent.slice(mark)}`);
  mark = count(ws);
  ws.serverMsg(telemetry({ mode: "MANUAL", scheme: "NORMAL" }));
  check(names(ws, mark).join() === "STOP", `confirmed under the pivot stick ${names(ws, mark)}`);
});

test("schemes: an unconfirmed request stops showing as pending after CONFIRM_MS", () => {
  const { page, ws } = connected(telemetry({ scheme: "NORMAL" }));
  check(page.evalIn("SchemeToggle.CONFIRM_MS") === 1500, "CONFIRM_MS");
  page.fire(schemeButton(page, "ADVANCED"), "click");
  liveFor(page, ws, 1000, { scheme: "NORMAL" }); // the rover never takes it
  page.clock.advance(499);
  check(pendingScheme(page) === "ADVANCED", `still pending at 1499 ms: ${pendingScheme(page)}`);
  page.clock.advance(1);
  check(pendingScheme(page) === null && shownScheme(page) === "NORMAL", `gave up: pending ${pendingScheme(page)}, shown ${shownScheme(page)}`);
  check(page.$("scheme").dataset.state === "known" && page.$("scheme").getAttribute("aria-busy") === "false", "settled");
  check(count(ws) === 1, `sent ${ws.sent}`);
  page.fire(schemeButton(page, "ADVANCED"), "click"); // asking again sends again
  check(count(ws) === 2 && pendingScheme(page) === "ADVANCED", `asked again: ${ws.sent}`);

  // A later click replaces the request, and only the scheme last asked for
  // settles it: the rover takes them in order.
  page.fire(schemeButton(page, "NORMAL"), "click");
  check(ws.sent.slice(2).join() === '{"scheme":"NORMAL"}' && pendingScheme(page) === "NORMAL", `changed mind: ${ws.sent}`);
  ws.serverMsg(telemetry({ scheme: "ADVANCED" })); // the first request landed
  check(shownScheme(page) === "ADVANCED" && pendingScheme(page) === "NORMAL", `in between: ${shownScheme(page)}, pending ${pendingScheme(page)}`);
  ws.serverMsg(telemetry({ scheme: "NORMAL" }));
  check(shownScheme(page) === "NORMAL" && pendingScheme(page) === null, "the last request settles it");

  // Losing the link ends a request too.
  page.fire(schemeButton(page, "ADVANCED"), "click");
  ws.serverDrop();
  check(pendingScheme(page) === null && shownScheme(page) === "unknown", `after link loss: pending ${pendingScheme(page)}`);
  page.clock.advance(3000);
  check(page.errors.length === 0, `errors ${page.errors}`);
});

// The transform that mirrors an icon, drawn for up-and-right in a 16-unit
// box, into each corner of the stick.
const MIRROR = {
  upRight: "matrix(1 0 0 1 0 0)",
  upLeft: "matrix(-1 0 0 1 16 0)",
  downRight: "matrix(1 0 0 -1 0 16)",
  downLeft: "matrix(-1 0 0 -1 16 16)",
};
let ICONS; // FamilySelector.ICONS, read from the first page loaded below

test("schemes: the pivot stick and its family are off under NORMAL and on under ADVANCED; its corners always name its moves", () => {
  const page = loadPage();
  const ws = connectOpen(page);
  const heard = listen(page);
  const note = page.$("pivotNote");
  const noteSays = () => `${note.textContent}/${note.dataset.tone}`;
  const OFF = `${page.evalIn("FamilySelector.OFF")}/off`;
  const CAVEAT = `${page.evalIn("FamilySelector.CAVEAT")}/caveat`;
  check(familyButton(page, "PIVOT") && familyButton(page, "PIVOT_SIDEWAYS") && !familyButton(page, "TRANSLATE"), "two segments built, the pivots'");

  // Each segment is its family's word alone, a sleek segment as every
  // switch on the page is (F8), titled with what the family does. The
  // corners draw the family's icon: drawn, not typed, since the arrow
  // characters fell back to fonts of different weights.
  ICONS = page.evalIn("FamilySelector.ICONS");
  check(Object.keys(ICONS).join() === "PIVOT,PIVOT_SIDEWAYS" && new Set(Object.values(ICONS)).size === 2 && Object.values(ICONS).every((d) => /^M[\d. ]/.test(d)), `two icons ${JSON.stringify(ICONS)}`);
  for (const [family, word] of [["PIVOT", "Pivot"], ["PIVOT_SIDEWAYS", "Sideways"]]) {
    const button = familyButton(page, family);
    check(button.children.length === 1 && button.children[0].textContent === word, `${family}: the word ${word} alone, got ${button.children.map((n) => n.tagName + ":" + n.textContent)}`);
    check(new RegExp(`^${family === "PIVOT" ? "Pivot" : "Pivot sideways"}: `).test(button.title), `${family}: titled with what it does: ${button.title}`);
  }

  const want = {
    PIVOT: "upLeft:PIVOT_LEFT_FORWARD,upRight:PIVOT_RIGHT_FORWARD,downLeft:PIVOT_LEFT_BACKWARD,downRight:PIVOT_RIGHT_BACKWARD",
    PIVOT_SIDEWAYS: "upLeft:PIVOT_SIDEWAYS_FORWARD_LEFT,upRight:PIVOT_SIDEWAYS_FORWARD_RIGHT,downLeft:PIVOT_SIDEWAYS_BACKWARD_LEFT,downRight:PIVOT_SIDEWAYS_BACKWARD_RIGHT",
  };

  // Off, and saying why, until the rover reports ADVANCED; shown all the
  // same, with the moves its corners would send.
  const off = (when) => {
    check(pivotsState(page) === "off" && noteSays() === OFF, `${when}: pivots ${pivotsState(page)}, note ${noteSays()}`);
    check(page.$("pivotPad").title.length > 0 && !page.$("family").hidden && !page.$("pivotPad").hidden && !page.$("stickHints").hidden, `${when}: shown, with a title`);
    check(page.$("stickLabel").textContent === "Translate", `${when}: caption ${page.$("stickLabel").textContent}`);
  };
  off("before telemetry");
  check(isPressed(familyButton(page, "PIVOT")) && hintMoves(page) === want.PIVOT, `the default family's corners ${hintMoves(page)}`);
  ws.serverMsg(telemetry({ scheme: "NORMAL" }));
  off("NORMAL");
  page.fire(familyButton(page, "PIVOT_SIDEWAYS"), "click"); // disabled, so not clickable; and if it were
  check(page.evalIn("driver.family") === "PIVOT" && hintMoves(page) === want.PIVOT, `an off selector changed the family to ${page.evalIn("driver.family")}`);

  ws.serverMsg(telemetry({ scheme: "ADVANCED" }));
  check(pivotsState(page) === "on" && isPressed(familyButton(page, "PIVOT")), `ADVANCED: pivots ${pivotsState(page)}, at Pivot`);
  check(noteSays() === CAVEAT && page.$("pivotPad").title === "", `ADVANCED: note ${noteSays()}, title '${page.$("pivotPad").title}'`);

  for (const [family, hints] of Object.entries(want).reverse()) {
    page.fire(familyButton(page, family), "click");
    check(page.evalIn("driver.family") === family && page.evalIn("familySelector.family") === family, `${family}: driver ${page.evalIn("driver.family")}`);
    check(["PIVOT", "PIVOT_SIDEWAYS"].every((f) => isPressed(familyButton(page, f)) === (f === family)), `${family}: one segment pressed`);
    check(page.$("stickLabel").textContent === "Translate" && noteSays() === CAVEAT, `${family}: caption ${page.$("stickLabel").textContent}, note ${noteSays()}`);
    check(hintMoves(page) === hints, `${family}: hints ${hintMoves(page)}`);
    // Each corner reads as mecanum.js names the move, beside the family's
    // icon mirrored into the corner's quadrant.
    for (const hint of all(page.$("stickHints")).filter((n) => n.dataset.corner)) {
      const motion = page.evalIn(`MOTIONS.find((m) => m.name === "${hint.dataset.move}")`);
      const [icon, text] = hint.children;
      check(text.textContent === motion.short, `${hint.dataset.corner}: '${text.textContent}'`);
      check(icon.tagName === "SVG" && icon.getAttribute("aria-hidden") === "true", `${hint.dataset.corner}: a hidden svg icon`);
      const drawn = icon.children[0];
      check(drawn.getAttribute("d") === ICONS[family] && drawn.getAttribute("transform") === MIRROR[hint.dataset.corner],
        `${hint.dataset.corner}: drew ${drawn.getAttribute("d")} with ${drawn.getAttribute("transform")}`);
    }
  }

  page.clock.advance(1000);
  check(count(ws) === 0 && heard.presses() === 0, `choosing families sent ${ws.sent}, presses ${heard.presses()}`);

  // NORMAL turns the pivots off and keeps the family chosen: ADVANCED again
  // offers the one left behind.
  page.fire(familyButton(page, "PIVOT_SIDEWAYS"), "click");
  ws.serverMsg(telemetry({ scheme: "NORMAL" }));
  off("NORMAL again");
  check(page.evalIn("driver.family") === "PIVOT_SIDEWAYS" && hintMoves(page) === want.PIVOT_SIDEWAYS, `kept ${page.evalIn("driver.family")}`);
  ws.serverMsg(telemetry({ scheme: "ADVANCED" }));
  check(pivotsState(page) === "on" && isPressed(familyButton(page, "PIVOT_SIDEWAYS")), "offered again at the family left behind");
  check(count(ws) === 0, `sent ${ws.sent}`);
  check(page.errors.length === 0, `errors ${page.errors}`);
});

// The phone-on-its-side block's opening, as css/panel.css writes it, and the
// rules inside one @media block of panel.css (css.js).
const LANDSCAPE_PHONE = "@media (orientation: landscape) and (max-height: 520px) {";
// The side-by-side layout's blocks, as css/panel.css opens them: from 960
// by 521 px, its Drive tab where the height limits the sticks (F3i), and
// 640 px or less.
const WIDE = "@media (min-width: 960px) and (min-height: 521px) {";
// Where the pills were their lamps alone, before the top's two cells: no
// block of its own now (the top's test checks it is gone).
const WIDE_LAMPS = "@media (min-width: 960px) and (max-width: 1279.98px) and (min-height: 521px) {";
const WIDE_SHORT = "@media (min-width: 960px) and (min-height: 521px) and (max-height: 640px) {";
// The shell with the Drive tab showing, as the wide blocks select it.
const DRIVE_SHELL = ".shell:has(> #driveTab:not([hidden]))";
const panelCss = () => stylesheet("panel.css");
// A selector list split at its own commas, not those inside :is() or :not().
const selectorsOf = (list) => list.replace(/\([^()]*\)/g, (inner) => inner.replace(/,/g, "\u0000")).split(",").map((each) => each.replace(/\u0000/g, ",").trim());
const mediaRules = (opening) => blockRules(panelCss(), opening);

// A declaration that makes an element the containing block of positioned
// descendants, and so the offsetParent of one of them: a position other
// than static, or a transform, filter, perspective, containment and the
// like with any value but none. Not text-transform.
const CONTAINING_BLOCK = /(?<![\w-])(?:position\s*:\s*(?:relative|absolute|fixed|sticky)|(?:transform|translate|rotate|scale|perspective|filter|backdrop-filter|contain|container|container-type|content-visibility|will-change)\s*:(?!\s*(?:none|normal|visible)\s*[;!]|\s*(?:none|normal|visible)\s*$))/;

// Whether the last compound of a selector (".a > .b#c.d[e]") could match
// node. Pseudo-classes are ignored, which can only make it match more; a
// pseudo-element styles a box of its own, not the node, so never matches.
function lastCompoundMatches(selector, node) {
  let s = selector;
  while (/\([^()]*\)/.test(s)) s = s.replace(/\([^()]*\)/g, ""); // :not(...), :has(...)
  const last = s.split(/\s*[>+~]\s*|\s+/).filter(Boolean).pop() || "";
  if (/::|:(?:before|after|first-line|first-letter|marker|placeholder)\b/.test(last)) return false;
  const bare = last.replace(/:[\w-]+/g, "");
  const attrs = [...bare.matchAll(/\[([\w-]+)(?:=["']?([^"'\]]*)["']?)?\]/g)];
  const plain = bare.replace(/\[[^\]]*\]/g, "");
  const tag = (plain.match(/^[a-zA-Z][\w-]*/) || [""])[0];
  const ids = [...plain.matchAll(/#([\w-]+)/g)].map((m) => m[1]);
  const classes = [...plain.matchAll(/\.([\w-]+)/g)].map((m) => m[1]);
  const nodeClasses = (node.getAttribute("class") || "").split(/\s+/);
  return (!tag || tag === "*" || tag.toLowerCase() === node.tagName.toLowerCase()) &&
    ids.every((id) => node.id === id) &&
    classes.every((c) => nodeClasses.includes(c)) &&
    attrs.every(([, name, value]) => node.hasAttribute(name) && (value === undefined || node.getAttribute(name) === value)) &&
    Boolean(tag || ids.length || classes.length || attrs.length);
}

test("schemes: the stick hints cannot take a touch from joy.js, and nothing above either stick is positioned", () => {
  // Every stylesheet the page links, not only panel.css: a rule in any of
  // them can reach the stick's ancestors.
  const html = fs.readFileSync(path.join(PANEL_ROOT, "joystick.html"), "utf8");
  const sheets = [...html.matchAll(/<link\b[^>]*>/g)].map(([tag]) => tag)
    .filter((tag) => /\brel=["']?stylesheet\b/.test(tag))
    .map((tag) => tag.match(/\bhref=["']([^"']+)["']/)[1]);
  check(sheets.includes("css/panel.css") && sheets.length >= 1, `stylesheets ${sheets}`);
  check(sheets.every((href) => !/^[a-z]+:/i.test(href)), `a remote stylesheet cannot be checked: ${sheets}`);
  const rules = sheets.flatMap((href) =>
    cssRules(fs.readFileSync(path.join(PANEL_ROOT, href), "utf8")).map((rule) => ({ ...rule, sheet: href })));

  const hints = rules.find((r) => r.sheet === "css/panel.css" && r.selector === ".hints");
  check(hints && /pointer-events:\s*none/.test(hints.body), `.hints lets touches through: ${hints && hints.body}`);
  // Off, the pivot stick is deaf to touches, and its pad takes them as the
  // stick would: no pan, zoom or callout, which would move the page and the
  // other stick under its thumb.
  const offStick = rules.find((r) => r.sheet === "css/panel.css" && r.selector === '#pivotPad[data-off="yes"] #pivotStick');
  check(offStick && /pointer-events:\s*none/.test(offStick.body), `the off pivot stick takes no touch: ${offStick && offStick.body}`);
  const offPad = rules.find((r) => r.sheet === "css/panel.css" && r.selector === '#pivotPad[data-off="yes"]');
  check(offPad && /touch-action:\s*none/.test(offPad.body) && /-webkit-touch-callout:\s*none/.test(offPad.body), `the off pad pans and calls out nothing: ${offPad && offPad.body}`);

  // joy.js places a touch by its canvas's offsetParent: no ancestor of
  // either stick's canvas may become one, by a stylesheet or its own style
  // attribute.
  const page = loadPage();
  const ancestors = [];
  for (const canvas of [page.canvas, page.pivotCanvas]) {
    for (let n = canvas.parentNode; n && n.tagName !== "BODY"; n = n.parentNode) if (!ancestors.includes(n)) ancestors.push(n);
  }
  check(["stick", "pivotStick", "movePad", "pivotPad", "driveTab"].every((id) => ancestors.some((n) => n.id === id)), `ancestors ${ancestors.map((n) => n.id || n.tagName)}`);
  let checked = 0;
  for (const rule of rules) {
    if (!CONTAINING_BLOCK.test(rule.body)) continue;
    for (const selector of rule.selector.split(",").map((s) => s.trim())) {
      checked++;
      const hit = ancestors.find((n) => lastCompoundMatches(selector, n));
      check(!hit, `${rule.sheet}: '${selector}' would make <${hit && hit.tagName.toLowerCase()} ${hit && (hit.id || hit.getAttribute("class"))}> the stick canvas's offsetParent`);
    }
  }
  check(checked > 0, "found the page's positioned rules to check");
  for (const n of ancestors) {
    check(!CONTAINING_BLOCK.test(n.getAttribute("style") || ""), `<${n.tagName.toLowerCase()} ${n.id}> style="${n.getAttribute("style")}"`);
  }

  // The rule reader and matcher themselves, on cases the page does not have
  // today. Each would put joy.js's touches off by the ancestor's offset.
  const node = { tagName: "SECTION", id: "driveTab", getAttribute: (n) => ({ class: "controls", role: "tabpanel" })[n] ?? null, hasAttribute: (n) => n === "class" || n === "role" };
  const caught = (css) => cssRules(css).some((r) => CONTAINING_BLOCK.test(r.body) && r.selector.split(",").some((s) => lastCompoundMatches(s.trim(), node)));
  for (const css of [
    ".controls { position: relative; }",
    "@media (max-width: 620px) { .controls { transform: translateX(0); } }",
    "main > #driveTab { contain: layout; }",
    "[role=\"tabpanel\"] { translate: 0 0; }",
    "section.controls:not(.x) { will-change: transform; }",
    ".shell .controls { container-type: size; }",
  ]) check(caught(css), `missed: ${css}`);
  for (const css of [
    ".controls { text-transform: uppercase; }",
    ".controls::before { position: absolute; }",
    ".controls { transform: none; }",
    ".controls .pad { position: relative; }",
    ".controls[hidden] { position: relative; }",
  ]) check(!caught(css), `flagged harmless: ${css}`);
});

// Layout the fake DOM cannot lay out, held by the stylesheet's words. The
// motor-fault card is in the view pane, over the scan (F8): it takes
// height from the scan inside the pane, never from the shell. At its own
// height the page grew and the stick slid half off a 568 x 320 screen, or
// under the Stop bar there was at 375 x 667. And a line clamp in a card the
// grid stretches cut the text mid-sentence and still showed the lines after
// its ellipsis.
test("motorsReady: the fault trades height with the scan inside the view, never moving the dock, and no fault card clamps its lines", () => {
  const page = loadPage();
  // In the scan's own card, at its top: a bar of its own over the card read
  // as a third row under the top's two cells (the critic's round 2).
  const card = page.$("scan").parentNode;
  check(page.$("motorsFault").parentNode === card && card.getAttribute("class") === "scan", "the fault is in the scan's card");
  check(card.parentNode === page.$("view"), "the card in the view pane");
  const base = cssRules(outside(panelCss(), "@media"));
  const rule = (selector) => base.filter((r) => r.selector === selector).map((r) => r.body).join("");
  // The pane's size is the grid's: its content counts for nothing.
  check(/min-height:\s*0;/.test(rule(".view")) && /grid-area:\s*view;/.test(rule(".view")) && /contain:\s*size;/.test(rule(".view")), `the pane sized by its grid area: ${rule(".view")}`);
  // The card is a size container: the fault's row takes height from the
  // fan, never from the pane.
  check(/container:\s*scan \/ size;/.test(rule(".scan")) && /flex:\s*1 1 0;/.test(rule(".scan")) && /min-height:\s*0;/.test(rule(".scan")), `the scan takes what the pane gives: ${rule(".scan")}`);
  const fault = rule(".fault");
  check(/min-height:\s*0;/.test(fault) && /overflow-y:\s*auto;/.test(fault), `the fault gives way and scrolls: ${fault}`);
  // As wide as its line, 520 px at most, its caret right after its words:
  // across a wide view it read as a page-wide banner, its caret 900 px
  // from the words (the critic's round 3).
  check(/justify-self:\s*start;/.test(fault) && /max-width:\s*520px;/.test(fault), `the fault as wide as its line: ${fault}`);
  const caret = rule(".fault summary::after");
  check(caret && !/\bauto\b/.test(caret) && !/flex:\s*1/.test(rule(".fault strong")), `its caret right after its words: ${caret}`);
  const cap = (fault.match(/max-height:\s*(\d+)cqh;/) || [])[1];
  check(cap && Number(cap) <= 50, `at most half the card: ${cap}`);
  // No row of the shell's is the fault's, on any layout: it never opens one
  // above a stick.
  const rows = cssRules(panelCss()).filter((r) => /grid-template-areas:[^;]*\bfault\b/.test(r.body) || /grid-area:\s*fault/.test(r.body));
  check(rows.length === 0, `no row of its own: ${rows.map((r) => r.selector)}`);
  const contained = cssRules(panelCss()).filter((r) => /\.fault\b/.test(r.selector) && /\bcontain:(?!\s*none\b)/.test(r.body));
  check(contained.length === 0, `no fault contained to its floor: ${contained.map((r) => r.selector)}`);
  const clamped = cssRules(panelCss()).filter((r) => /\.fault\b/.test(r.selector) && /line-clamp/.test(r.body));
  check(clamped.length === 0, `clamped: ${clamped.map((r) => r.selector)}`);
});

// The readouts' line is one line of one height: where it cannot hold every
// caption and value, the chip's temperature goes first (out of sight,
// still read out), then the values take the smaller type, and only then
// the captions go the same way, so the move and the phase are never cut
// short (the critic's round 1), and keep their captions while they can: a
// bare "STOP" read like a button (round 3). Measured, as the top's cells
// are, and again as each frame changes what it says. Each cell is titled
// with its caption. Without a live link the values are history, dimmed.
test("readouts: the chip's temperature, then the captions go before a value is cut short, each cell titled with its own", () => {
  const app = fs.readFileSync(path.join(PANEL_ROOT, "js", "app.js"), "utf8");
  check(/fitSteps\(readoutsLine, \["words", "nochip", "small", "nophase", "bare"\], cutShort\)/.test(app) && /value\.scrollWidth > value\.clientWidth/.test(app) && /new MutationObserver\(fitReadouts\)/.test(app) && /new ResizeObserver\(fitReadouts\)/.test(app), "measured, again as it changes");
  const hidden = cssRules(panelCss()).find((r) => r.selector.includes('.readouts:is([data-fit="nochip"], [data-fit="small"], [data-fit="nophase"], [data-fit="bare"]) .cell:has(> #temp)'));
  check(hidden && /clip-path:\s*inset\(50%\)/.test(hidden.body) && !/display:\s*none/.test(hidden.body), `first the chip's temperature, out of sight, still read: ${hidden && hidden.body}`);
  check(hidden && hidden.selector.includes('.readouts[data-fit="bare"] .cell .label') && !/nochip"?\]?[^,]*\.label|small"\][^,]*\.label/.test(hidden.selector), `last, the captions, the same way: ${hidden && hidden.selector}`);
  // The phase's caption before the move's: a phase says what it is, and
  // "FORWARD · CRUISE" bare read as buttons at 480 x 320 (the review's
  // phones 11).
  check(hidden && hidden.selector.includes('.readouts[data-fit="nophase"] #phaseCell .label') && !/nophase"\][^,]*\.cell \.label/.test(hidden.selector), `the phase's caption first: ${hidden && hidden.selector}`);
  const smaller = cssRules(panelCss()).find((r) => r.selector === '.readouts:is([data-fit="small"], [data-fit="nophase"], [data-fit="bare"]) .cell output');
  check(smaller && /font-size:\s*var\(--t-sm\);/.test(smaller.body), `then the values the smaller type: ${smaller && smaller.body}`);
  const dim = cssRules(panelCss()).find((r) => r.selector === 'body:not([data-link="up"]) .readouts :is(output, #phase)');
  check(dim && /color:\s*var\(--dim\);/.test(dim.body) && /opacity:\s*0\.[5-7]\d*;/.test(dim.body), "with no live link the values dimmed and faded, with the scan over them");
  const order = cssRules(outside(panelCss(), "@media")).map((r) => r.selector);
  check(order.indexOf('body:not([data-link="up"]) .readouts :is(output, #phase)') > order.indexOf('#phase[data-tone="warn"]'), "the halt's amber dimmed too");
  check(!cssRules(panelCss()).some((r) => r.selector.split(",").some((part) => /\.readouts/.test(part) && /#(move|phase)|\.cell:first-child|#phaseCell/.test(part) && !/\.label\s*$/.test(part)) && /display:\s*none|clip-path/.test(r.body)), "the move and the phase never hidden");
  const line = cssRules(outside(panelCss(), "@media")).find((r) => r.selector === ".readouts");
  check(line && /height:\s*var\(--readouts-h\);/.test(line.body) && /white-space:\s*nowrap;/.test(line.body), "one line, one height");
  const page = loadPage();
  const cells = all(page.doc.documentElement.querySelector(".readouts")).filter((n) => (n.getAttribute && n.getAttribute("class")) === "cell");
  check(cells.length === 3 && cells.every((c) => (c.getAttribute("title") || "").length > 0), `each cell titled: ${cells.map((c) => c.getAttribute("title"))}`);
  check(page.doc.documentElement.querySelector(".readouts").dataset.fit === "words", "a page that cannot measure keeps every word");
  // Measured: a line too narrow for every word lets the chip go and keeps
  // the captions. The chip's cell, out of sight, is 1 px wide and its value
  // wider: counted as cut, it took every caption with it (320 x 568).
  const readouts = page.doc.documentElement.querySelector(".readouts");
  const measure = (id, widths) => {
    const value = page.$(id);
    Object.defineProperty(value, "scrollWidth", { configurable: true, get: () => widths().scroll });
    Object.defineProperty(value, "clientWidth", { configurable: true, get: () => widths().client });
    Object.defineProperty(value.parentNode, "clientWidth", { configurable: true, get: () => widths().cell, set() {} });
  };
  const fit = () => readouts.dataset.fit;
  measure("move", () => (fit() === "words" ? { scroll: 40, client: 22, cell: 60 } : { scroll: 40, client: 40, cell: 78 }));
  measure("temp", () => (fit() === "words" ? { scroll: 52, client: 52, cell: 90 } : { scroll: 52, client: 0, cell: 1 }));
  check(page.evalIn("fitReadouts()") === "nochip", `the chip gone, the captions kept: ${fit()}`);
  measure("move", () => (fit() === "bare" ? { scroll: 40, client: 40, cell: 40 } : { scroll: 40, client: 22, cell: 60 }));
  check(page.evalIn("fitReadouts()") === "bare", `the captions only where a value would be cut short: ${fit()}`);
  measure("move", () => (fit() === "bare" || fit() === "nophase" ? { scroll: 40, client: 40, cell: 40 } : { scroll: 40, client: 22, cell: 60 }));
  check(page.evalIn("fitReadouts()") === "nophase", `the move's caption kept while it fits: ${fit()}`);
  check(page.errors.length === 0, `errors ${page.errors}`);
});

// A phone on its side, held like a gamepad: a stick down each edge, and
// between them the top's two cells, Stop and Autonomous among them, and
// the view under them.
// Layout itself is measured in a browser (568 x 320 to 1000 x 500); this
// holds the shape, and the rules that keep the sticks where they are.
test("on its side: a stick down each edge, Stop between them, and nothing in the middle moves a stick", () => {
  const side = mediaRules(LANDSCAPE_PHONE) || [];
  const narrow = mediaRules("@media (orientation: landscape) and (max-height: 520px) and (max-width: 779.98px) {") || [];
  const body = (rules, selector) => rules.filter((r) => r.selector.replace(/\s+/g, " ") === selector).map((r) => r.body).join("");
  const areas = (text) => ((text.match(/grid-template-areas:([^;]*);/) || ["", ""])[1].match(/"[^"]*"/g) || []).map((row) => row.replace(/\s+/g, " ")).join(" ");
  // The shell's columns and the dock's are the same three, the dock's
  // middle left empty for the top and the view.
  const columns = "grid-template-columns: var(--stick) minmax(0, 1fr) var(--stick);";
  check(body(side, ".shell").includes(columns) && body(side, ".controls").includes(columns), "the shell's columns are the dock's");
  check(areas(body(side, ".shell")) === '". head ." ". view ."', `the middle column: ${areas(body(side, ".shell"))}`);
  // The view lies over the dock's empty middle: positioned, so it is over
  // the dock spanning the screen behind it, and takes its own presses. It
  // is no stick's ancestor (the stick-ancestor test reads every rule).
  check(/position:\s*relative;/.test(cssRules(outside(panelCss(), "@media")).filter((r) => r.selector === ".view").map((r) => r.body).join("")), "the view over the dock");
  // The pivot stick's line in its own column alone: the view lies over the
  // middle, so the line never reaches across it, only over the gap beside
  // its column (the schemes' test).
  check(areas(body(side, ".controls")) === '"label . family" ". . note" "move . pivot" "spin . speed"', `a stick down each edge: ${areas(body(side, ".controls"))}`);
  // Stop is in the top's second cell. Beside the Program tab the top keeps
  // to the middle of the screen, as on the Drive tab, so a switch of tab
  // moves neither Stop nor anything beside it: the shell's columns are the
  // same three with the middle one split in two (the second makes the
  // view's 40%), and the top spans both halves. Under it the editor takes
  // the width, the view shown or hidden: two panes at most, never the
  // view, the editor and the console side by side (the critic's round 1).
  const split = "grid-template-columns: var(--stick) max(0px, 40% - var(--stick)) minmax(0, 1fr) var(--stick);";
  check(body(side, ".shell:has(> #programTab:not([hidden]))").includes(split), `the middle column split in two: ${body(side, ".shell:has(> #programTab:not([hidden]))")}`);
  const expected = { ".shell:has(> #programTab:not([hidden]))": "view view main main", '.shell:has(> #programTab[data-view="hidden"]:not([hidden]))': "main main main main" };
  for (const [selector, under] of Object.entries(expected)) {
    const program = areas(body(side, selector)).split('" "').map((row) => row.replace(/"/g, "").trim().split(/\s+/));
    check(program[0] && program[0].join(" ") === ". head head .", `${selector}: the top in the middle, over both halves: ${program.map((row) => row.join(" ")).join(" / ")}`);
    check(program[1] && program[1].join(" ") === under, `${selector}: the editor under it, to the right edge: ${program.map((row) => row.join(" ")).join(" / ")}`);
  }
  // The tab in its area under the top, a column as on every layout: the
  // toolbar one slim row over the editor, the console under the editor.
  // In the bands beside the top, the toolbar was two rows there, and four
  // 240 px slabs before that (the critic's round 2): nothing in the rules
  // for every width on its side places the tab, the toolbar or its
  // controls on the shell's tracks, and nothing lays the console beside
  // the editor.
  const tab = body(side, "#programTab:not([hidden])");
  check(!/grid-(row|column|area|template)/.test(tab) && !/display:/.test(tab), `the tab in its area, a column: ${tab}`);
  const programSide = blockRules(stylesheet("program.css"), LANDSCAPE_PHONE) || [];
  const where = (selector) => body(programSide, selector);
  const placed = [...programSide, ...side].filter((r) => /programBar|#programRun|#programStop|menuHolder|#viewToggle|programStage/.test(r.selector) && /grid-|display:/.test(r.body));
  check(placed.length === 0, `the toolbar a row over the editor, as everywhere: ${placed.map((r) => r.selector)}`);
  check(!/flex-direction:\s*row/.test(where(".programStage")) && !programSide.some((r) => /programConsole/.test(r.selector)), `the console under the editor: ${where(".programStage")}`);
  // From 568 px wide (568 x 320, 844 x 390) the cells are a cell a row in
  // the middle, and the bands beside them were empty while the editor
  // under them had about 90 px (the review's phones 0): the toolbar takes
  // them, Run over Stop program on the left and File over View on the
  // right, a row a cell's, and the editor's card starts under the cells,
  // the width the view leaves it. Two rows of two, never the four slabs.
  const bands = mediaRules("@media (orientation: landscape) and (max-height: 520px) and (min-width: 568px) {") || [];
  const banded = (selector) => body(bands, selector);
  check(/grid-area:\s*1 \/ 1 \/ -1 \/ -1;/.test(banded("#programTab:not([hidden])")) && /grid-template-columns:\s*subgrid;/.test(banded("#programTab:not([hidden])")) && /container-type:\s*normal;/.test(banded("#programTab:not([hidden])")),
    `from 568 px: the tab on the shell's tracks, no container: ${banded("#programTab:not([hidden])")}`);
  check(/grid-area:\s*1 \/ 1 \/ 2 \/ -1;/.test(banded("#programTab .programBar")) && /grid-template-rows:\s*var\(--ctl\) var\(--ctl\);/.test(banded("#programTab .programBar")),
    `from 568 px: the toolbar two rows of the top's height, beside it: ${banded("#programTab .programBar")}`);
  const spot = { "#programRun": "1 / 1", "#programStop": "2 / 1", "#programTab .menuHolder": "1 / -2", "#viewToggle": "2 / -2" };
  for (const [selector, area] of Object.entries(spot)) check(banded(selector).includes(`grid-area: ${area};`), `from 568 px: ${selector} in its band: ${banded(selector)}`);
  check(/grid-area:\s*2 \/ 3 \/ 3 \/ -1;/.test(banded("#programTab .programStage")) && /grid-area:\s*2 \/ 1 \/ 3 \/ -1;/.test(banded('#programTab[data-view="hidden"] .programStage')),
    "from 568 px: the editor's card under the cells, beside the view or the screen's width");
  // At no width on its side does the Program tab put the cells anywhere
  // the Drive tab does not: from 700 px they once took one row across the
  // screen on this tab alone, and a switch of tab moved Stop 198 px
  // across and 46 up at 844 x 390 (the merge's round 2). Stop stays put on
  // a switch of tab, on every layout.
  const sideBlocks = panelCss().match(/@media \(orientation: landscape\) and \(max-height: 520px\)[^{]*\{/g) || [];
  const cellsMoved = sideBlocks.flatMap((head) => mediaRules(head) || []).filter((r) => /programTab/.test(r.selector) && /\.(cells|hcell)\b/.test(r.selector));
  check(cellsMoved.length === 0, `on its side, nothing lays the cells out by tab: ${cellsMoved.map((r) => r.selector)}`);
  const sideHeads = sideBlocks.flatMap((head) => mediaRules(head) || []).filter((r) => /^\.shell:has\(> #programTab/.test(r.selector) && /grid-template-areas/.test(r.body)).map((r) => areas(r.body).split('" "')[0].replace(/"/g, "").trim());
  check(sideHeads.every((row) => row === ". head head ." || row === "head head head head"), `on its side, the top where the Drive tab has it: ${sideHeads}`);
  // File's menu hangs from its button as on every layout, never moved, and
  // stops at the screen's foot under the top and the toolbar (in the
  // bands, under the cells' first row), scrolling inside past that:
  // uncapped, it ran past the foot and opening it scrolled the toolbar
  // under the top.
  const fileMenu = where("#programMenuList");
  check(!/\btop:/.test(fileMenu)
    && /max-height:\s*calc\(100 \* var\(--svh\) - 2 \* var\(--cell-h\) - 6px - 3 \* var\(--s-2\) - var\(--ctl\) - var\(--s-1\) - env\(safe-area-inset-top, 0px\) - env\(safe-area-inset-bottom, 0px\)\);/.test(fileMenu)
    && /overflow-y:\s*auto;/.test(fileMenu), `the File menu under the toolbar, under both rows of cells, on the screen: ${fileMenu}`);
  const bandMenu = body(blockRules(stylesheet("program.css"), "@media (orientation: landscape) and (max-height: 520px) and (min-width: 568px) {") || [], "#programMenuList");
  // In the band its right edge stays at its button's, but it hangs from
  // the cells' foot, 4 px under them: from its button, 208 px wide, it
  // slid under the second cell, "Examples" read "mples", and a press on
  // its first example landed on the top (the review's phones 0; measured
  // in a browser at 568 x 320 to 932 x 430: no item meets a cell). Its top
  // is the cells' two rows and the 6 px between them, less the band's
  // padding over its button, and 4 px.
  check(/top:\s*calc\(2 \* var\(--cell-h\) \+ 6px - \(var\(--cell-h\) - var\(--ctl\)\) \/ 2 \+ var\(--s-1\)\);/.test(bandMenu) && /max-height:\s*calc\(100 \* var\(--svh\) - 2 \* var\(--cell-h\) - 6px - var\(--s-1\) - 2 \* var\(--s-2\) - env\(safe-area-inset-top, 0px\) - env\(safe-area-inset-bottom, 0px\)\);/.test(bandMenu) && !/\b(left|right):/.test(bandMenu),
    `in the band, from the cells' foot to the screen's, its right edge at its button's: ${bandMenu}`);
  const band = mediaRules("@media (orientation: landscape) and (max-height: 520px) and (min-width: 568px) {") || [];
  check(/padding-top:\s*calc\(\(var\(--cell-h\) - var\(--ctl\)\) \/ 2\);/.test(body(band, "#programTab .programBar")) && /grid-area:\s*1 \/ -2;/.test(body(band, "#programTab .menuHolder")), "its button in the band's first row, at the cells' first row");
  // Under 568 px (480 x 320) the top spans the screen, a cell a row, and
  // leaves no bands: the toolbar in the top's row lay under the cells, Run
  // out of reach (the merge of the cells' and the Program tab's round 2).
  // There the toolbar heads the editor's card, a row under the top, and
  // the File menu stops at the foot under both rows of cells (the rule
  // for every width on its side, above, which the bands' overrides).
  const narrowSide = mediaRules("@media (orientation: landscape) and (max-height: 520px) and (max-width: 567.98px) {") || [];
  check(areas(body(narrowSide, ".shell:has(> #programTab:not([hidden]))")).startsWith('"head head head head"'), `under 568 px: the top across the screen: ${body(narrowSide, ".shell:has(> #programTab:not([hidden]))")}`);
  // The tab starts under the top, on the shell's tracks, its toolbar a
  // row across the screen and the editor's card under it, beside the view
  // or the screen's width; the view, shown, starts level with the card.
  // Beside a 40% view the card was 245 px, and its toolbar needs 277: View
  // lay past its edge (measured headless).
  check(/grid-area:\s*2 \/ 1 \/ -1 \/ -1;/.test(body(narrowSide, "#programTab:not([hidden])")) && /grid-template-columns:\s*subgrid;/.test(body(narrowSide, "#programTab:not([hidden])")) && /container-type:\s*normal;/.test(body(narrowSide, "#programTab:not([hidden])")),
    `under 568 px: the tab under the top, on the shell's tracks: ${body(narrowSide, "#programTab:not([hidden])")}`);
  check(/grid-area:\s*1 \/ 1 \/ 2 \/ -1;/.test(body(narrowSide, "#programTab .programBar")) && /grid-area:\s*2 \/ 3 \/ 3 \/ -1;/.test(body(narrowSide, "#programTab .programStage")) && /grid-area:\s*2 \/ 1 \/ 3 \/ -1;/.test(body(narrowSide, '#programTab[data-view="hidden"] .programStage')),
    "under 568 px: the toolbar a row across under the top, the editor's card under it");
  check(/margin-top:\s*calc\(var\(--ctl\) \+ var\(--s-2\)\);/.test(body(narrowSide, ".shell:has(> #programTab:not([hidden])) > .view")), "under 568 px: the view level with the editor's card, under the toolbar");
  // The bands' rules start at 568 px: nothing else on its side places the
  // toolbar in the top's row.
  check((panelCss().match(/@media \(orientation: landscape\) and \(max-height: 520px\)[^{]*\{/g) || []).every((head) => /min-width: 568px|max-width: 567\.98px/.test(head) || !(mediaRules(head) || []).some((r) => /programBar|#programRun|#programStop|menuHolder|#viewToggle/.test(r.selector))), "the toolbar placed only by the bands' rules and the narrow ones");
  // The state one line on every layout, never a height that follows what
  // it says (program.css's base rule; the program tests hold it), and
  // nothing on its side makes it more: the reason Run is off is short on
  // the line, and whole on Run's title and the line's.
  check(!programSide.some((r) => /programState/.test(r.selector) && /white-space|line-height|max-height/.test(r.body)), "the state one line on its side too");
  for (const rules of [side, narrow]) {
    const shell = (body(rules, ".shell, .controls") + body(rules, ".shell")).match(/column-gap:\s*([^;]+);/);
    const dockGap = (body(rules, ".shell, .controls") + body(rules, ".controls")).match(/column-gap:\s*([^;]+);/);
    check(shell && dockGap && shell[1].trim() === dockGap[1].trim(), `the shell's columns and the dock's close up together: ${shell && shell[1]}, ${dockGap && dockGap[1]}`);
  }
  // The dock spans every row, and the middle column outgrows a short screen
  // with no rover connected (568 x 320): the dock stops at the screen's
  // height, less the shell's padding above (the top's, --shell-top, which
  // the sticky top takes as its own), so the sticks at its foot stay where
  // they are as lines come and go.
  const dock = body(side, ".shell > .dock:not([hidden])");
  check(/grid-row:\s*1 \/ -1;/.test(dock), `the dock spans every row: ${dock}`);
  const top = (body(side, ".shell").match(/--shell-top:\s*calc\(([^;]+)\);/) || [])[1];
  const cap = (dock.match(/max-height:\s*calc\(100 \* var\(--svh\) - ([^;]+)\);/) || [])[1];
  check(top === "var(--s-2) + env(safe-area-inset-top, 0px)" && cap === "var(--s-2) - env(safe-area-inset-top, 0px)", `the dock as tall as the screen less the padding above it: padding ${top}, cap ${cap}`);
  // The sticks' rows at the dock's foot, so the captions over them (Pivot |
  // Sideways, Translate) sit clear below the top's two cells: centred,
  // the family lay level with the second cell, 15 px from the gear, and
  // read as a third switch of the top's (the review's phones 8).
  check(/align-content:\s*end;/.test(body(side, ".controls")) && !/align-content:\s*center;/.test(body(side, ".controls")), `the sticks at the foot of the dock: ${body(side, ".controls")}`);
  // Each stick takes what the height leaves (212 px: the shell's padding
  // above, the two cells, 12 px clear of them, the dock's four rows but the
  // sticks' and 4 px under them, and the notch's and the home bar's
  // insets) and what the width leaves the middle column: 336 px for the
  // two cells, a row each (212 px of half the width with the gutters and
  // gaps), and 288 px at their tightest under 780 px wide (180 px). The
  // rows' sum is the dock's own tokens': each a fixed height (the schemes'
  // test holds them).
  const stick = (rules) => (body(rules, ":root").match(/--stick:([^;]*);/) || [])[1] || "";
  const height = "100 * var(--svh) - 212px - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px)";
  check(stick(side).includes(height) && stick(side).includes("50vw - 212px"), `on its side: ${stick(side)}`);
  check(stick(narrow).includes(height) && stick(narrow).includes("50vw - 180px"), `under 780 px wide: ${stick(narrow)}`);
  const px = (name) => Number((body(cssRules(outside(panelCss(), "@media")), ":root").match(new RegExp(`--${name}:\\s*(\\d+)px;`)) || [])[1]);
  const rows = px("dock-cap") + px("dock-note") + px("dock-row") + 3 * px("dock-gap");
  const cells = 8 + 2 * px("cell-h") + 6; // the shell's padding above, and the two cells 6 px apart
  check(rows === 102 && cells + 12 + rows + 4 <= 212, `the dock's rows (${rows} px) under the cells (${cells}), 12 px clear of them and 4 over the foot, inside the 212 px kept from the height`);
  check(/padding:\s*0 0 calc\(var\(--s-1\) \+ env\(safe-area-inset-bottom, 0px\)\);/.test(dock), `the home bar's inset clear under the sticks, and 4 px: ${dock}`);
  // No foot bar: Stop and Autonomous are in the top's cells, in the middle
  // column on both tabs.
  check(!/\.actions\b/.test(panelCss()), "no .actions rule left in panel.css");
});

// The rotate buttons keep to their area and never outgrow it: at the
// stick's floor the icons beside the words did (Right across the gap into
// the speed at 960 x 521, under the Stop bar at 480 x 320 on its side).
// Narrower than icon and word need at full size, the arrows alone, at
// their full size: the words a size down to 11 px were the dock's smallest
// (the review's phones 20). On an upright phone they are their arrows
// alone beside the speed, which takes the rest of the row: under the pivot
// stick alone its slider was 64 to 84 px long (the review's phones 4).
test("layout: the rotate buttons keep to their area, their words where they fit, and the speed most of an upright phone's row", () => {
  const base = cssRules(outside(panelCss(), "@media"));
  const spin = base.filter((r) => r.selector === ".spin").map((r) => r.body).join("");
  check(/grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\);/.test(spin), `two columns that cannot grow past the area: ${spin}`);
  check(/container:\s*spin \/ inline-size;/.test(spin), `a container to ask: ${spin}`);
  // Under 156 px (an upright phone, a phone on its side, a short laptop's
  // stacked column) the words go and the arrows stay, at their size; that
  // is the only rule that hides either, and no rule makes either smaller.
  const narrow = blockRules(outside(panelCss(), "@media"), "@container spin (max-width: 155.98px) {") || [];
  check(narrow.length === 1 && narrow[0].selector === ".spinWord" && /display:\s*none/.test(narrow[0].body), `under 156 px the arrows alone: ${narrow.map((r) => r.selector)}`);
  const hidden = cssRules(panelCss()).filter((r) => /\.spin (\.icon|\.spinWord)|\.spinWord|\.spin \.icon/.test(r.selector) && /display:\s*none/.test(r.body));
  check(hidden.length === 1 && hidden[0].selector === ".spinWord", `nothing else hides a word, nothing an arrow: ${hidden.map((r) => r.selector)}`);
  check(!cssRules(panelCss()).some((r) => /\.spin\b|\.spinWord/.test(r.selector) && /font-size:\s*var\(--t-xs\)/.test(r.body)), "no 11 px word on a rotate button");
  const page = loadPage();
  // The words in each button's name and title wherever they show.
  check(["ccw", "cw"].every((id) => /^Rotate (counter-)?clockwise$/.test(page.$(id).getAttribute("aria-label") || "")), "each named, whatever shows");
  const titled = ["ccw", "cw"].map((id) => page.$(id).getAttribute("title") || "");
  check(/^Rotate left \(Q\)/.test(titled[0]) && /^Rotate right \(E\)/.test(titled[1]), `each titled with its words: ${titled.join(" / ")}`);
  check(["ccw", "cw"].every((id) => all(page.$(id)).some((n) => n.tagName === "SVG") && all(page.$(id)).some((n) => n.getAttribute && n.getAttribute("class") === "spinWord")), "each its arrow and its word");
  // An upright phone: the rotate buttons' area two 44 px buttons and the
  // gap between them, under the 156 px where the words go, at the
  // translate stick's left edge; the speed the rest of the row, across
  // both sticks' columns. The three columns add up to the two sticks and
  // the gap between them, so neither stick moves; the caption keeps to the
  // first column, the family the rest of its row.
  const root = base.filter((r) => r.selector === ":root").map((r) => r.body).join("");
  check(/--spin-w:\s*calc\(2 \* var\(--tap\) \+ var\(--s-2\)\);/.test(root) && /--tap:\s*44px;/.test(root) && /--s-2:\s*8px;/.test(root) && 2 * 44 + 8 < 156, `two 44 px buttons, their words gone: ${root.match(/--spin-w:[^;]*;/)}`);
  const phone = blockRules(panelCss(), "@media (max-width: 599.98px) and (orientation: portrait) {") || [];
  const controls = phone.filter((r) => r.selector === ".controls").map((r) => r.body).join("");
  const areas = ((controls.match(/grid-template-areas:([^;]*);/) || ["", ""])[1].match(/"[^"]*"/g) || []).map((row) => row.replace(/\s+/g, " ")).join(" ");
  check(/grid-template-columns:\s*var\(--spin-w\) calc\(var\(--stick\) - var\(--spin-w\) - var\(--s-4\)\) var\(--stick\);/.test(controls), `the sticks' columns, the first split for the rotate buttons: ${controls}`);
  check(areas === '"label family family" "note note note" "move move pivot" "spin speed speed"', `the speed across both sticks: ${areas}`);
  check(!/grid-template-rows/.test(controls) && phone.every((r) => r.selector === ".controls"), "its rows the dock's own, and nothing else changed");
  // The corners' words on one line or not at all: under 180 px of corners
  // nothing, after the rules that lay a corner out (before them, those
  // showed every corner again, words overlapping at 320 px). Bare arrows
  // said nothing, and looked like controls (the review's phones 22);
  // wrapped to two lines they crowded the ring.
  // At 12 px, the dock's least: at 11 they were under it (the reviews'
  // phones 12, tablets 7), so under 190 px.
  const corners = blockRules(outside(panelCss(), "@media"), "@container hints (max-width: 189.98px) {") || [];
  check(corners.length === 1 && corners[0].selector === ".hint" && /display:\s*none/.test(corners[0].body), `under 190 px of corners, none: ${corners.map((r) => r.selector)}`);
  const text = outside(panelCss(), "@media");
  check(text.indexOf("@container hints (max-width: 189.98px)") > text.lastIndexOf(".hint[data-corner="), "the corners hidden after the rules that place them");
  const hint = base.filter((r) => r.selector === ".hint").map((r) => r.body).join("");
  check(/white-space:\s*nowrap;/.test(hint) && /font-size:\s*var\(--t-sm\);/.test(hint), `a corner's words never wrap, at 12 px: ${hint}`);
  // On its side the gauge goes and the slider takes the rest of the
  // column: with the gauge it was 64 px, 2 px a step (the review's phones
  // 5). The caption still names it.
  const sideSpeed = (mediaRules(LANDSCAPE_PHONE) || []).filter((r) => /\.speed/.test(r.selector));
  check(sideSpeed.some((r) => r.selector === ".speed .icon" && /display:\s*none/.test(r.body)) && sideSpeed.some((r) => r.selector === ".speed" && /grid-template-columns:\s*auto minmax\(0, 1fr\);/.test(r.body)), `on its side, no gauge, the slider the rest: ${sideSpeed.map((r) => r.selector)}`);
  // The speed one row on every layout. Under 230 px, where the caption
  // would leave the slider under about 140 px, a gauge in the caption's
  // place; under 150 the value a size down too. The caption over the value
  // read as two lines (the critic's round 2). The caption still names the
  // slider.
  const speedNarrow = blockRules(outside(panelCss(), "@media"), "@container speed (max-width: 229.98px) {") || [];
  check(speedNarrow.some((r) => r.selector === "#speedLabel" && /display:\s*none/.test(r.body)) && speedNarrow.some((r) => r.selector === ".speed .icon" && /display:\s*block/.test(r.body)), "under 230 px, the gauge in the caption's place");
  const speedNarrower = blockRules(outside(panelCss(), "@media"), "@container speed (max-width: 149.98px) {") || [];
  check(speedNarrower.length === 1 && speedNarrower[0].selector === "#speedOut" && /font-size:\s*var\(--t-ctl\)/.test(speedNarrower[0].body), `under 150 px, the value a size down: ${speedNarrower.map((r) => r.selector)}`);
  check(![...speedNarrow, ...speedNarrower].some((r) => /grid-(area|row|column)/.test(r.body)), "narrow, still one row");
  check(/display:\s*none/.test(base.filter((r) => r.selector === ".speed .icon").map((r) => r.body).join("")), "the gauge only where the caption gives way");
  const gauge = all(page.$("speed").parentNode).find((n) => n.tagName === "SVG");
  check(gauge && gauge.getAttribute("aria-hidden") === "true" && page.$("speed").getAttribute("aria-labelledby") === "speedLabel" && page.$("speedLabel").textContent === "Speed", "the slider named by its caption, the gauge silent");
  // One size on every layout (F8: 36 px rows under the sticks), so the
  // one threshold holds everywhere: no layout makes them larger again.
  const button = base.filter((r) => r.selector === ".spin button").map((r) => r.body).join("");
  check(/height:\s*var\(--dock-row\);/.test(button) && /min-height:\s*0;/.test(button), `the dock's row height: ${button}`);
  const baseKeys = new Set(base.map((r) => `${r.selector}{${r.body}`));
  const resized = cssRules(panelCss()).filter((r) => /\.spin (button|\.icon)/.test(r.selector) && !baseKeys.has(`${r.selector}{${r.body}`) && /(^|[\s;{])(min-|max-)?(height|width|font-size|padding)\s*:/.test(r.body));
  check(resized.length === 0, `no layout resizes them: ${resized.map((r) => r.selector)}`);
});

// Blockly draws the grid's lines once, with its colour as their stroke
// attribute: a literal would stay in the look the page loaded in. (That
// every token a script reads is declared, and the stop block's copy of
// --stop, are looks.test.js's.)
test("Blockly draws the grid in the look's --raised-hi, through var()", () => {
  const blocks = fs.readFileSync(path.join(PANEL_ROOT, "js", "blocks.js"), "utf8");
  const grid = blocks.match(/\bgrid:\s*\{[^}]*\}/);
  check(grid && /\bcolour:\s*"var\(--raised-hi\)"/.test(grid[0]), `the grid's colour: ${grid}`);
});

test("schemes: each quadrant of each family sends the move test/vectors/stick_moves.json gives it", () => {
  const { cases: stickCases } = vectors("stick_moves.json");
  // The translate stick under either scheme, the pivot stick in each family.
  const runs = [["NORMAL", "TRANSLATE"], ["ADVANCED", "TRANSLATE"], ["ADVANCED", "PIVOT"], ["ADVANCED", "PIVOT_SIDEWAYS"]];
  for (const [scheme, family] of runs) {
    const { page, ws } = connected(telemetry({ mode: "MANUAL", scheme }));
    const pivot = family !== "TRANSLATE";
    if (pivot) {
      page.fire(familyButton(page, family), "click");
      check(page.evalIn("driver.family") === family, `${scheme}/${family}: driver ${page.evalIn("driver.family")}`);
    }
    const cases = stickCases.filter((c) => c.family === family);
    check(cases.length >= 5, `${family}: ${cases.length} cases`);
    const s = pivot ? pivotTouch(page, 0) : stickTouch(page, 0);
    for (const { x, yUp, move } of cases) {
      const mark = count(ws);
      s.start(); pushTo(page, s, x, yUp);
      check(names(ws, mark).join() === move, `${scheme}/${family} (${x}, ${yUp}): want ${move}, sent ${names(ws, mark)}`);
      s.end();
      check(names(ws, mark + 1).join() === "STOP", `${scheme}/${family} (${x}, ${yUp}): release ${names(ws, mark + 1)}`);
    }
    check(page.errors.length === 0, `errors ${page.errors}`);
  }

  // Under NORMAL the pivot stick sends nothing, in any quadrant.
  {
    const { page, ws } = connected(telemetry({ mode: "MANUAL", scheme: "NORMAL" }));
    const s = pivotTouch(page, 0);
    for (const { x, yUp } of stickCases.filter((c) => c.family === "PIVOT")) {
      s.start(); pushTo(page, s, x, yUp); page.clock.advance(250); s.end();
    }
    check(count(ws) === 0, `the pivot stick under NORMAL sent ${names(ws)}`);
  }

  // The headline case: ADVANCED, Pivot, the pivot stick up and to the right.
  const { page, ws } = connected(telemetry({ mode: "MANUAL", scheme: "ADVANCED" }));
  const s = pivotTouch(page, 0);
  s.start(); pushTo(page, s, 60, 60);
  check(ws.moves()[0].move === 9 && names(ws).join() === "PIVOT_RIGHT_FORWARD", `up-right under Pivot sent ${ws.sent}`);
});

test("schemes: the operator's family change re-steers a held pivot stick at once", () => {
  const { page, ws } = connected(telemetry({ mode: "MANUAL", scheme: "ADVANCED" }));
  const s = pivotTouch(page, 0);
  s.start(); pushTo(page, s, 60, 60);
  check(names(ws).join() === "PIVOT_RIGHT_FORWARD", `pivot ${names(ws)}`);
  for (const [family, move] of [["PIVOT_SIDEWAYS", "PIVOT_SIDEWAYS_FORWARD_RIGHT"], ["PIVOT", "PIVOT_RIGHT_FORWARD"]]) {
    page.clock.advance(30); // inside STICK_SEND_MS: only a new direction may go now
    const mark = count(ws);
    page.fire(familyButton(page, family), "click");
    check(names(ws, mark).join() === move && ws.sentAt[mark] === page.clock.now(), `${family}: ${names(ws, mark)} at once`);
  }
  // A held rotate button wins over the stick: the family changes nothing sent.
  press(page, page.$("ccw"), 4);
  const mark = count(ws);
  page.fire(familyButton(page, "PIVOT_SIDEWAYS"), "click");
  check(count(ws) === mark, `under a held rotate: ${names(ws, mark)}`);
  lift(page, page.$("ccw"), 4);
  check(names(ws, mark).join() === "PIVOT_SIDEWAYS_FORWARD_RIGHT", `the stick again, in its new family: ${names(ws, mark)}`);
});

test("schemes: telemetry flipping the scheme mid-hold lets go of the pivot stick alone: one STOP, then nothing until a fresh press", () => {
  // NORMAL to ADVANCED, by touch: the translate stick sends the same moves
  // under either scheme, and drives on.
  {
    const { page, ws } = connected(telemetry({ mode: "MANUAL", scheme: "NORMAL" }));
    const s = stickTouch(page, 0);
    s.start(); pushTo(page, s, 0, 70);
    liveFor(page, ws, 500, { mode: "MANUAL", scheme: "NORMAL" });
    ws.serverMsg(telemetry({ mode: "MANUAL", scheme: "ADVANCED" })); // the pad's SELECT, say
    liveFor(page, ws, 1000, { mode: "MANUAL", scheme: "ADVANCED" });
    ws.serverMsg(telemetry({ mode: "MANUAL", scheme: "NORMAL" }));
    liveFor(page, ws, 500, { mode: "MANUAL", scheme: "NORMAL" });
    check(count(ws) >= 9 && names(ws).every((n) => n === "MOVE_FORWARD"), `drove on through both flips ${names(ws)}`);
    check(page.errors.length === 0, `errors ${page.errors}`);
  }

  // ADVANCED to NORMAL, by touch: the pivot under the thumb stops, and the
  // thumb drives it again only from a fresh press once ADVANCED is back,
  // however long it rests there.
  {
    const { page, ws } = connected(telemetry({ mode: "MANUAL", scheme: "ADVANCED" }));
    const s = pivotTouch(page, 0);
    s.start(); pushTo(page, s, 60, 60);
    liveFor(page, ws, 500, { mode: "MANUAL", scheme: "ADVANCED" });
    check(count(ws) >= 3 && names(ws).every((n) => n === "PIVOT_RIGHT_FORWARD"), `pivoted ${names(ws)}`);
    let mark = count(ws);
    ws.serverMsg(telemetry({ mode: "MANUAL", scheme: "NORMAL" }));
    check(names(ws, mark).join() === "STOP" && pivotsState(page) === "off", `flip ${names(ws, mark)}, pivots ${pivotsState(page)}`);
    mark = count(ws);
    for (let i = 0; i < 5; i++) { pushTo(page, s, 10 * i, 60); liveFor(page, ws, 150, { mode: "MANUAL", scheme: "NORMAL" }); }
    ws.serverMsg(telemetry({ mode: "MANUAL", scheme: "ADVANCED" })); // and back, under the same thumb
    for (let i = 0; i < 5; i++) { pushTo(page, s, 10 * i, 60); liveFor(page, ws, 150, { mode: "MANUAL", scheme: "ADVANCED" }); }
    check(count(ws) === mark, `the thumb still down sent ${names(ws, mark)}`);
    s.end();
    check(count(ws) === mark, `lifting sent ${names(ws, mark)}`);
    s.start(); pushTo(page, s, 60, 60);
    check(names(ws, mark).join() === "PIVOT_RIGHT_FORWARD", `a fresh press drives: ${names(ws, mark)}`);
    check(page.errors.length === 0, `errors ${page.errors}`);
  }

  // Both sticks held, the pivot stick pressed last: the flip hands the
  // rover to the translate stick, as lifting the pivot thumb would.
  {
    const { page, ws } = connected(telemetry({ mode: "MANUAL", scheme: "ADVANCED" }));
    const move = stickTouch(page, 0);
    const pivot = pivotTouch(page, 1);
    move.start(); pushTo(page, move, 0, 70);
    pivot.start(); pushTo(page, pivot, -60, 60);
    check(names(ws).join() === "MOVE_FORWARD,PIVOT_LEFT_FORWARD", `both ${names(ws)}`);
    const mark = count(ws);
    ws.serverMsg(telemetry({ mode: "MANUAL", scheme: "NORMAL" }));
    liveFor(page, ws, 500, { mode: "MANUAL", scheme: "NORMAL" });
    check(names(ws, mark).length >= 2 && names(ws, mark).every((n) => n === "MOVE_FORWARD"), `the translate stick took over ${names(ws, mark)}`);
  }

  // By mouse, held through the change and released afterwards; under
  // NORMAL a click on the pivot stick drives nothing.
  {
    const { page, ws } = connected(telemetry({ mode: "MANUAL", scheme: "ADVANCED" }), { touch: false });
    const m = mouseStick(page, page.pivotCanvas);
    m.down(); m.move(95, 0);
    check(names(ws).join() === "PIVOT_RIGHT_FORWARD", `mouse ${names(ws)}`);
    let mark = count(ws);
    ws.serverMsg(telemetry({ mode: "MANUAL", scheme: "NORMAL" }));
    m.move(90, -20);
    liveFor(page, ws, 1000, { mode: "MANUAL", scheme: "NORMAL" });
    check(names(ws, mark).join() === "STOP", `mouse flip ${names(ws, mark)}`);
    mark = count(ws);
    m.up();
    m.down(); m.move(0, -95); m.up();
    check(count(ws) === mark, `a click on the pivot stick under NORMAL sent ${names(ws, mark)}`);
    const t = mouseStick(page);
    t.down(); t.move(0, -95);
    check(names(ws, mark).join() === "MOVE_FORWARD", `a click on the translate stick drives: ${names(ws, mark)}`);
    check(page.errors.length === 0, `errors ${page.errors}`);
  }
});

test("schemes: a scheme flip leaves a held rotate button driving", () => {
  const { page, ws } = connected(telemetry({ mode: "MANUAL", scheme: "NORMAL" }));
  press(page, page.$("cw"), 2);
  ws.serverMsg(telemetry({ mode: "MANUAL", scheme: "ADVANCED" }));
  liveFor(page, ws, 1000, { mode: "MANUAL", scheme: "ADVANCED" });
  check(count(ws) >= 6 && names(ws).every((n) => n === "ROTATE_CLOCKWISE"), `rotate alone ${names(ws)}`);

  // The pivot stick under the rotate button lets go; the rotation does not.
  const s = pivotTouch(page, 1);
  s.start(); pushTo(page, s, 0, 80);
  let mark = count(ws);
  ws.serverMsg(telemetry({ mode: "MANUAL", scheme: "NORMAL" }));
  liveFor(page, ws, 1000, { mode: "MANUAL", scheme: "NORMAL" });
  check(!names(ws, mark).includes("STOP") && names(ws, mark).every((n) => n === "ROTATE_CLOCKWISE"), `rotate and stick ${names(ws, mark)}`);
  mark = count(ws);
  lift(page, page.$("cw"), 2);
  liveFor(page, ws, 1000, { mode: "MANUAL", scheme: "NORMAL" });
  check(names(ws, mark).join() === "STOP", `the pivot stick does not take over from a released rotate: ${names(ws, mark)}`);

  // The translate stick under it does, flip or not.
  press(page, page.$("ccw"), 3);
  const t = stickTouch(page, 2);
  t.start(); pushTo(page, t, 0, 80);
  ws.serverMsg(telemetry({ mode: "MANUAL", scheme: "ADVANCED" }));
  mark = count(ws);
  lift(page, page.$("ccw"), 3);
  check(names(ws, mark).join() === "MOVE_FORWARD", `the translate stick takes over from a released rotate: ${names(ws, mark)}`);
});

test("schemes: a scheme change with nothing held sends nothing, and an exploring rover explores on", () => {
  const page = loadPage();
  const ws = connectOpen(page);
  const heard = listen(page);
  for (const scheme of ["NORMAL", "ADVANCED", "NORMAL", undefined, "ADVANCED", "EXPERT", "ADVANCED"]) {
    ws.serverMsg(telemetry({ scheme }));
    if (scheme === "ADVANCED") page.fire(familyButton(page, "PIVOT_SIDEWAYS"), "click");
    page.clock.advance(500);
  }
  check(count(ws) === 0, `sent ${ws.sent}`);
  check(page.$("mode").textContent === "AUTONOMOUS", "exploring");
  check(heard.downs() === "" && heard.presses() === 0, `stand-downs '${heard.downs()}', presses ${heard.presses()}`);
});

test("schemes: the scheme first reported does not stop a stick held since the link opened", () => {
  for (const scheme of ["NORMAL", "ADVANCED"]) {
    const page = loadPage();
    const ws = connectOpen(page);
    const s = stickTouch(page, 0);
    s.start(); pushTo(page, s, 0, 70); // before any telemetry: the scheme is unknown
    ws.serverMsg(telemetry({ mode: "MANUAL", scheme }));
    liveFor(page, ws, 1000, { mode: "MANUAL", scheme });
    check(!names(ws).includes("STOP") && names(ws).every((n) => n === "MOVE_FORWARD"), `${scheme}: ${names(ws)}`);
  }
});

test("schemes: losing the link makes the scheme unknown and turns the pivots off, keeping the family", () => {
  const page = loadPage();
  let ws = connectOpen(page);
  ws.serverMsg(telemetry({ scheme: "ADVANCED" }));
  page.fire(familyButton(page, "PIVOT_SIDEWAYS"), "click");
  check(page.evalIn("driver.family") === "PIVOT_SIDEWAYS" && pivotsState(page) === "on", "pivoting sideways");
  ws.serverDrop();
  check(shownScheme(page) === "unknown" && SCHEMES.every((s) => !schemeButton(page, s).disabled), `lost: ${shownScheme(page)}, still taking a wish`);
  check(pivotsState(page) === "off" && page.evalIn("driver.family") === "PIVOT_SIDEWAYS", `pivots ${pivotsState(page)}, family ${page.evalIn("driver.family")}`);
  check(page.$("pivotNote").textContent === page.evalIn("FamilySelector.OFF"), `note '${page.$("pivotNote").textContent}'`);

  ws = connectOpen(page);
  check(shownScheme(page) === "unknown" && pivotsState(page) === "off", "off until the new link reports ADVANCED");
  ws.serverMsg(telemetry({ scheme: "ADVANCED" }));
  check(shownScheme(page) === "ADVANCED" && pivotsState(page) === "on" && isPressed(familyButton(page, "PIVOT_SIDEWAYS")), "reported again, at the family kept");
  page.fire(page.$("connect"), "click"); // a deliberate disconnect
  check(shownScheme(page) === "unknown" && pivotsState(page) === "off", "disconnect too");
  check(count(ws) === 0, `sent ${ws.sent}`);
  check(page.errors.length === 0, `errors ${page.errors}`);
});

test("schemes: a pivot stick a scheme change let go of asks for a fresh press once ADVANCED is back, until one comes", () => {
  const page = loadPage();
  const ws = connectOpen(page);
  const note = page.$("pivotNote");
  const caption = page.$("stickLabel");
  const PRESS_AGAIN = page.evalIn("FamilySelector.PRESS_AGAIN");
  const says = () => `${note.textContent}/${note.dataset.tone}`;
  const asking = () => says() === `${PRESS_AGAIN}/warn`;
  const caveat = () => says() === `${page.evalIn("FamilySelector.CAVEAT")}/caveat`;
  const off = () => says() === `${page.evalIn("FamilySelector.OFF")}/off`;
  const captionClear = () => caption.textContent === "Translate" && caption.dataset.tone === undefined;
  ws.serverMsg(telemetry({ mode: "MANUAL", scheme: "ADVANCED" }));

  // Nothing held: the line only follows the scheme.
  ws.serverMsg(telemetry({ mode: "MANUAL", scheme: "NORMAL" }));
  check(off(), `nothing held, NORMAL: ${says()}`);
  ws.serverMsg(telemetry({ mode: "MANUAL", scheme: "ADVANCED" }));
  check(caveat(), `nothing held, ADVANCED: ${says()}`);

  // Held: joy.js still draws the knob under the thumb, over a stopped rover.
  // Under NORMAL the line says the stick is off; with ADVANCED back, it asks
  // for the press. The translate stick's caption asks nothing: it was never
  // let go of.
  const s = pivotTouch(page, 0);
  s.start(); pushTo(page, s, 0, 70);
  ws.serverMsg(telemetry({ mode: "MANUAL", scheme: "NORMAL" }));
  check(off() && captionClear(), `held through the change: ${says()}, caption '${caption.textContent}'`);
  ws.serverMsg(telemetry({ mode: "MANUAL", scheme: "ADVANCED" }));
  check(asking() && captionClear(), `ADVANCED again: ${says()}, caption '${caption.textContent}'`);
  pushTo(page, s, 30, 70);
  liveFor(page, ws, 1000, { mode: "MANUAL", scheme: "ADVANCED" });
  s.end();
  check(asking(), `still asking after the thumb lifts: ${says()}`);
  const mark = count(ws);
  s.start(); // the fresh press it asked for
  check(caveat(), `answered: ${says()}`);
  pushTo(page, s, 0, 70);
  check(names(ws, mark).join() === "PIVOT_RIGHT_FORWARD", `and drives: ${names(ws, mark)}`);

  // A rotate button over the stick: the stick will not take over when it is
  // let go, so the line asks too; pressing anything answers it.
  press(page, page.$("cw"), 3);
  ws.serverMsg(telemetry({ mode: "MANUAL", scheme: "NORMAL" }));
  ws.serverMsg(telemetry({ mode: "MANUAL", scheme: "ADVANCED" }));
  check(asking(), `asked under a held rotate button: ${says()}`);
  lift(page, page.$("cw"), 3);
  press(page, page.$("ccw"), 4);
  check(caveat(), `a rotate press answers it: ${says()}`);
  lift(page, page.$("ccw"), 4);

  // Losing the link withdraws the request with everything else.
  s.end(); s.start(); pushTo(page, s, 0, 70);
  ws.serverMsg(telemetry({ mode: "MANUAL", scheme: "NORMAL" }));
  ws.serverMsg(telemetry({ mode: "MANUAL", scheme: "ADVANCED" }));
  check(asking(), "asked again");
  ws.serverDrop();
  const again = connectOpen(page);
  again.serverMsg(telemetry({ mode: "MANUAL", scheme: "ADVANCED" }));
  check(caveat(), `link lost and back: ${says()}`);
  check(page.errors.length === 0, `errors ${page.errors}`);
});

// What is above the stick holds its height as the family and the caption
// change, so the stick stays where a held thumb pressed it (js/drive.js). A
// browser measured it; this keeps the rules that made it so.
test("schemes: the caption and the pivot stick's line change nothing's height above the sticks", () => {
  const page = loadPage();
  // The caption's request fits the stick's narrowest column on one line, as
  // the pivot stick's line below does: no longer than the caveat measured
  // there. (A family's name was the bound while the longest was "Pivot
  // sideways"; its segment now says "Sideways".)
  const request = page.evalIn("FamilySelector.PRESS_AGAIN");
  const caveatWords = page.evalIn("FamilySelector.CAVEAT");
  check(request.length <= caveatWords.length && request.length <= 17, `the press-again request '${request}' is no longer than the caveat '${caveatWords}' (17 at most): it wrapped`);

  // The pivot stick's line says one of three things, each on one line, in
  // the same words on every layout (the critic's round 1: "Needs Advanced"
  // on a phone on its side, "Pivots need Advanced (at the top)"
  // elsewhere). Each fits the line's narrowest place at the dock's 13 px:
  // the pivot stick's column at its floor (112 px, on its side under about
  // 600 px wide) and the 12 px gap the line reaches into there, or a short
  // laptop's stacked column (120 px), with its dot: up to 118 px in DejaVu
  // Sans, measured headless, where 22 characters took 129 at 12 px. Off,
  // its words say what the stick is waiting for, as a need: "Advanced: top
  // bar" read as a label and its value, as if Advanced were on, and named
  // a bar the top no longer has (the review's phones 5, tablets 3,
  // laptops 5). It never hides, which would take its height too, and has
  // no second, shorter copy for a narrow row.
  const said = ["CAVEAT", "OFF", "PRESS_AGAIN"].map((name) => page.evalIn(`FamilySelector.${name}`));
  check(said.every((text) => text.length > 0 && text.length <= 17), `the line's words: ${said}`);
  const off = page.evalIn("FamilySelector.OFF");
  check(/^Needs? Advanced\b/.test(off) && !/\bbar\b|:/.test(off), `off, it says what the stick needs, not as a label and its value: '${off}'`);
  check(/^Untried: go slow$/.test(page.evalIn("FamilySelector.CAVEAT")), `on, the caveat: '${page.evalIn("FamilySelector.CAVEAT")}'`);
  check(/\bat the top\b/.test(page.evalIn("FamilySelector.OFF_TITLE")) && !/\btop bar\b/.test(page.evalIn("FamilySelector.OFF_TITLE")), `off, the pad's title says where: '${page.evalIn("FamilySelector.OFF_TITLE")}'`);
  check(page.evalIn("FamilySelector.OFF_SHORT") === undefined && page.doc.getElementById("pivotNoteShort") === null && page.$("pivotNote").parentNode.children.filter((n) => n.tagName === "P").length === 1, "one line, one wording: no short copy");
  const rules = cssRules(outside(panelCss(), "@media"));
  check(!/@container note\b/.test(panelCss()) && !/\.caveat\.short/.test(panelCss()), "no rule picks other words by the row's width");
  const landscapeLine = (mediaRules(LANDSCAPE_PHONE) || []).filter((r) => r.selector.split(/,\s*/).includes(".noteLine")).map((r) => r.body).join("");
  check(/margin-inline-start:\s*calc\(-1 \* var\(--s-3\)\);/.test(landscapeLine), `on its side, the line reaches over the 12 px gap beside the pivot stick's column: ${landscapeLine}`);
  const areas = (text) => ((text.match(/grid-template-areas:([^;]*);/) || ["", ""])[1].match(/"[^"]*"/g) || []).map((row) => row.replace(/\s+/g, " ")).join(" ");
  const controls = rules.filter((r) => r.selector === ".controls").map((r) => r.body).join("");
  check(areas(controls) === '"label family" "note note" "move pivot" "spin speed"', `upright and side by side, the line across both sticks: ${areas(controls)}`);
  // Every row of the dock is one fixed height, whatever it says: the
  // caption row, the line, the sticks' own (their box), and the rotate
  // buttons and the speed.
  check(/grid-template-rows:\s*var\(--dock-cap\) var\(--dock-note\) auto var\(--dock-row\);/.test(controls), `the rows' heights fixed: ${controls}`);
  // A wide screen 564 px tall or more stacks the sticks in one column (the
  // owner's "tile them vertically"), with the same rows one under the
  // other: still every one a fixed height, the sticks' boxes the only
  // auto ones, but for three empty rows that share what a column taller
  // than both sticks need leaves (from 892 px tall, the sticks at their
  // 280 px cap) evenly: over the translate stick's rows, between them and
  // the pivot stick's (at least 8 px), and under those. Only the viewport
  // sets them (the shell's grid), so the column is filled to its foot with
  // no band of empty card (one gap of 188 px between the sticks at 1920 x
  // 1080, the review's laptops 3). No other layout sets the rows.
  const rowsSet = cssRules(panelCss()).filter((r) => r.selector.replace(/\s+/g, " ") === ".controls" && /grid-template-rows/.test(r.body));
  const rowsOf = (r) => ((r.body.match(/grid-template-rows:([^;]*);/) || [])[1] || "").trim();
  const fixedRows = (value) => value !== "" && value.split(/\s+(?![^(]*\))/).every((row) => /^(auto|var\(--(dock-cap|dock-note|dock-row|s-\d)\)|minmax\((0|var\(--s-\d\)), 1fr\))$/.test(row));
  check(rowsSet.length === 2 && rowsSet.every((r) => fixedRows(rowsOf(r))), `no layout sizes a row by what it says: ${rowsSet.map(rowsOf).join(" | ")}`);
  const stacked = blockRules(panelCss(), "@media (min-width: 960px) and (min-height: 564px) {") || [];
  const stackedControls = stacked.filter((r) => r.selector === ".controls").map((r) => r.body).join("");
  check(/grid-template-rows:\s*minmax\(0, 1fr\) var\(--dock-cap\) auto var\(--dock-row\) minmax\(var\(--s-2\), 1fr\) var\(--dock-cap\) var\(--dock-note\) auto var\(--dock-row\) minmax\(0, 1fr\);/.test(stackedControls)
    && areas(stackedControls) === '"." "label" "move" "spin" "." "family" "note" "pivot" "speed" "."', `stacked: the translate stick's rows, then the pivot stick's, the line its own row, the empty rows over, between and under them the flexible ones: ${areas(stackedControls)}`);
  check(rowsSet.filter((r) => /1fr/.test(rowsOf(r))).length === 1, "no other layout has a flexible row");
  // The stacked sticks up to 280 px: 360 px was more stick than a laptop's
  // hand needs, and took the view's width (the review's laptops 3).
  const stackedRoot = stacked.filter((r) => r.selector === ":root").map((r) => r.body).join("");
  check(/--stick:\s*clamp\(120px, \(100 \* var\(--svh\) - 332px\) \/ 2, 280px\);/.test(stackedRoot) && /--dock-col:\s*max\(var\(--stick\), 230px\);/.test(stackedRoot) && /--drive:\s*calc\(var\(--dock-col\) \+ 32px\);/.test(stackedRoot), `stacked: up to 280 px, the column one stick wide, 230 px at the least: ${stackedRoot}`);
  // The rotate buttons and the speed across the whole column, centred
  // under their sticks, whose edges the captions keep: one stick wide, a
  // short laptop's lost 'Speed', 'Left' and 'Right' and kept an 80 px
  // slider (the review's laptops 5, tablets 7). The speed keeps its word
  // from 230 px.
  const across = stacked.filter((r) => r.selector.replace(/\s+/g, " ") === ".spin, .speed").map((r) => r.body).join("");
  check(/margin-inline:\s*calc\(\(var\(--stick\) - var\(--dock-col\)\) \/ 2\);/.test(across) && !stacked.some((r) => /grid-template-columns/.test(r.body) && r.selector === ".controls" && !/var\(--stick\)/.test(r.body)), `stacked: the rotate buttons and the speed the column's width: ${across}`);
  // The family and the line end at the pivot stick's right edge on every
  // layout, the stacked one's too: the line's dot, unpainted while off,
  // keeps its place before the words, so a line from the column's start
  // would start "Needs Advanced" 12 px in, under nothing.
  check(!stacked.some((r) => /^\.(family|noteLine)$/.test(r.selector)), "stacked: the family and the line where they are on every layout");
  for (const selector of [".caveat", "#stickLabel"]) {
    const rule = rules.find((r) => r.selector === selector);
    check(rule && /white-space:\s*nowrap/.test(rule.body), `${selector} never wraps: ${rule && rule.body.trim()}`);
  }
  const lineRule = rules.find((r) => r.selector === ".caveat");
  check(lineRule && /line-height:\s*var\(--dock-note\);/.test(lineRule.body) && /font-size:\s*var\(--t-ctl\);/.test(lineRule.body), `one line of the row's height, at the dock's 13 px (the review's laptops 16): ${lineRule && lineRule.body.trim()}`);
  // Off, no dot: a grey lamp before the words read as a status. Unpainted,
  // not removed, so nothing on the line moves as the scheme changes.
  const offDot = rules.filter((r) => r.selector === '.caveat[data-tone="off"]::before').map((r) => r.body).join("");
  check(/^\s*background:\s*none;\s*$/.test(offDot), `off, the dot unpainted: ${offDot}`);
  // Its dot close to its words: with the wider gap the caveat ran past the
  // stick at its floor.
  check(lineRule && /gap:\s*var\(--s-1\);/.test(lineRule.body), `the caveat's dot close to its words: ${lineRule && lineRule.body.trim()}`);
  const note = page.$("pivotNote");
  const lines = [];
  const look = () => lines.push(`${note.hidden ? "hidden" : "shown"} ${note.textContent}/${note.dataset.tone}`);
  look();
  const ws = connectOpen(page);
  ws.serverMsg(telemetry({ scheme: "ADVANCED" }));
  look();
  const thumb = pivotTouch(page);
  thumb.start(); thumb.move(0, -40);
  ws.serverMsg(telemetry({ scheme: "NORMAL" })); // lets go of the pivot stick held
  look();
  ws.serverMsg(telemetry({ scheme: "ADVANCED" })); // which waits for a fresh press
  look();
  const tones = ["off", "caveat", "off", "warn"];
  check(lines.join(" | ") === ["OFF", "CAVEAT", "OFF", "PRESS_AGAIN"].map((name, i) => `shown ${page.evalIn(`FamilySelector.${name}`)}/${tones[i]}`).join(" | "), `the line: ${lines.join(" | ")}`);
  check(page.errors.length === 0, `errors ${page.errors}`);
});

// Under NORMAL the pivot stick is drawn but off, and must look it: its
// knob in the operator's blue and its corners in blue read as a stick to
// use, behind a faded family (the review's phones 22, laptops 5). Each
// paints only, keyed on the pad's data-off, so nothing moves under a held
// stick (the sticks' test below). And the dock's words are one size: its
// captions and the line 13 px, the corners' 11 (the review's laptops 16);
// the family's segments 28 px as every switch's, in a caption row that
// holds their 32 px track (the review's phones 21, tablets 14).
test("dock: the pivot stick off looks off, grey not blue, and the dock's words and switch keep the page's sizes", () => {
  const css = panelCss();
  const base = cssRules(outside(css, "@media"));
  const body = (selector, rules = base) => rules.filter((r) => r.selector.split(/,\s*/).includes(selector)).map((r) => r.body).join("");
  // The knob grey: joy.js paints it once, in --live, so the canvas itself
  // is filtered, never an ancestor of it (the stick-ancestor test holds
  // that), and only while the pad is off.
  check(/^\s*filter:\s*grayscale\(1\);\s*$/.test(body('#pivotPad[data-off="yes"] canvas')), `off, the knob grey: ${body('#pivotPad[data-off="yes"] canvas')}`);
  check(!cssRules(css).some((r) => /filter\s*:/.test(r.body) && /#pivotStick|#stick\b|#movePad|canvas/.test(r.selector) && !/\[data-off="yes"\]/.test(r.selector)), "nothing filters a stick that is on");
  // Its corners grey, their arrows too, where on they are the page's blue.
  const offHint = body('#pivotPad[data-off="yes"] .hint');
  check(offHint === body('#pivotPad[data-off="yes"] .hint .glyph') && /^\s*color:\s*var\(--dim\);\s*$/.test(offHint), `off, the corners --dim: ${offHint}`);
  check(/color:\s*var\(--live\)/.test(body(".hint .glyph")), "on, their arrows the operator's blue");
  // The family's segments the page's 28 px (no smaller --seg of its own),
  // their track 4 px more, in the caption row's height; its touch target
  // 44 px as the top's are.
  const root = body(":root");
  const px = (name) => Number((root.match(new RegExp(`--${name}:\\s*(\\d+)px;`)) || [])[1]);
  check(px("seg") === 28 && px("dock-cap") === px("seg") + 4, `the caption row (${px("dock-cap")} px) holds a 28 px segment's track`);
  check(!cssRules(css).some((r) => /\.family/.test(r.selector) && /--seg\s*:/.test(r.body)), "no smaller segment for the family");
  check(/inset:\s*calc\(\(var\(--seg\) - var\(--tap\)\) \/ 2\) 0;/.test(body(".family .segmented button::before")), `its target 44 px: ${body(".family .segmented button::before")}`);
  // Its words step down by its own area's width: the family a container,
  // stretched over its area, its switch at the area's end.
  const family = body(".family");
  check(/container:\s*family \/ inline-size;/.test(family) && /justify-self:\s*stretch;/.test(family) && /justify-content:\s*flex-end;/.test(family), `the family's area its container: ${family}`);
  // The dock's captions and its line at 13 px, the corners at 11.
  for (const selector of ["#stickLabel", "#speedLabel", ".caveat"]) check(/font-size:\s*var\(--t-ctl\);/.test(body(selector)), `${selector} at 13 px: ${body(selector)}`);
  check(/font-size:\s*var\(--t-sm\);/.test(body(".hint")), "the corners at 12 px, the dock's least (the reviews' phones 12, tablets 7)");
  // On a phone on its side the family is quieter than the top's switches
  // beside it: no track, the family chosen raised rather than inverted, so
  // it reads as its stick's caption (the review's phones 8). It and the
  // line reach over the gap beside the pivot stick's column.
  const side = mediaRules(LANDSCAPE_PHONE) || [];
  check(/^\s*background:\s*none;\s*$/.test(body(".family .segmented", side)), `on its side, no track: ${body(".family .segmented", side)}`);
  const chosen = body('.family .segmented button[aria-pressed="true"]', side);
  check(/color:\s*var\(--readout\);/.test(chosen) && /background:\s*var\(--raised-hi\);/.test(chosen), `on its side, the chosen family raised: ${chosen}`);
  check(side.some((r) => r.selector.split(/,\s*/).includes(".family") && r.selector.split(/,\s*/).includes(".noteLine") && /margin-inline-start:\s*calc\(-1 \* var\(--s-3\)\);/.test(r.body)), "on its side, the family and the line over the gap beside them");
  // In the page: the pad off under NORMAL, on under ADVANCED, and the line
  // with it, what the rules above key on.
  const page = loadPage();
  const ws = connectOpen(page);
  ws.serverMsg(telemetry({ scheme: "NORMAL" }));
  check(page.$("pivotPad").dataset.off === "yes" && page.$("pivotNote").dataset.tone === "off", "NORMAL: the pad off, the line's dot unpainted");
  ws.serverMsg(telemetry({ scheme: "ADVANCED" }));
  check(page.$("pivotPad").dataset.off === "no" && page.$("pivotNote").dataset.tone === "caveat", "ADVANCED: the pad on, the line's amber dot");
  check(page.errors.length === 0, `errors ${page.errors}`);
});

// Where each stick is, and how large, follows from the viewport alone:
// measured headless at 26 sizes (320 x 568 to 1920 x 1080, upright, on
// its side and side by side), neither stick's box moved through a scheme
// change both ways, a motor fault, the rover exploring (the badges), stale
// telemetry, a lost link and a switch of target both ways. This holds the
// rules that made it so. The top's cells keep one height and the view's
// size is the grid's (their own tests); here, the sticks' size is a
// function of the viewport and constants, set on :root alone; every row of
// the dock is a fixed height (the schemes' test above); and no rule keyed
// on the page's state (a scheme, a tone, a held or pressed control, the
// link, the target) does more to the dock than paint it.
test("the sticks: sized from the viewport alone, in rows of fixed height, so no scheme, fault, link or target moves either", () => {
  const css = panelCss();
  const rules = cssRules(css);
  const declared = (name) => rules.filter((r) => new RegExp(`(^|[\\s;{])${name}\\s*:`).test(r.body));
  for (const name of ["--stick", "--stick-w", "--dock-col", "--drive", "--gutter", "--shell-max", "--svh", "--dock-cap", "--dock-note", "--dock-row", "--dock-gap"]) {
    const where = declared(name);
    check(where.length > 0 && where.every((r) => r.selector === ":root"), `${name} set on :root alone, never per state, tab or target: ${where.map((r) => r.selector)}`);
    for (const r of where) {
      const value = ((r.body.match(new RegExp(`(?:^|[\\s;{])${name}\\s*:([^;]*);`)) || [])[1] || "").trim();
      // What is left once the viewport's units, the insets, the tokens built
      // from them, numbers and arithmetic are taken out: nothing, or a
      // container's or the content's size (%, em, cq units) got in.
      const left = value
        .replace(/env\(safe-area-inset-(top|bottom|left|right), 0px\)/g, "")
        .replace(/var\(--(svh|stick-w|stick|dock-col|shell-max|gutter|s-\d)\)/g, "")
        .replace(/\b(clamp|min|max|calc|none)\b/g, "")
        .replace(/\d+(\.\d+)?(px|vw|vh|svh)?/g, "");
      check(value !== "" && /^[\s()+\-*/,]*$/.test(left), `${name}: from the viewport alone: '${value}' (left '${left.trim()}')`);
    }
  }
  // Every rule on the dock's parts keyed on a state only paints them.
  const dockPart = /\.dock\b|#driveTab|\.controls\b|#stickLabel|\.family\b|\.segmented\b|\.noteLine|\.caveat|#pivotNote|\.spin\b|\.speed\b|#speed|#movePad|#pivotPad|\.stickArea|#stick\b|#pivotStick|\.hints?\b/;
  // (A hint's corner is where it is built, once, not a state.)
  const keyedOnState = /data-(?!corner)|aria-|:active|:hover|:disabled|:checked/;
  const paints = /^(color|background(-color)?|border-color|border-style|opacity|box-shadow|outline(-color|-offset)?|animation|pointer-events|touch-action|-webkit-touch-callout|cursor|filter)\s*:/;
  // Each selector of a list on its own: a dock part keyed on a state.
  const parts = (selector) => {
    const out = [];
    let depth = 0;
    let from = 0;
    for (let i = 0; i < selector.length; i++) {
      if (selector[i] === "(") depth++;
      else if (selector[i] === ")") depth--;
      else if (selector[i] === "," && depth === 0) { out.push(selector.slice(from, i)); from = i + 1; }
    }
    return [...out, selector.slice(from)].map((part) => part.trim());
  };
  // (The top's cells are not the dock: their segments step their words down
  // by the cell's width, data-fit, in a cell of one fixed height.)
  const topCell = /^\.(hands|drives|hcell|cells|bar)\b/;
  const resizes = rules.filter((r) => parts(r.selector).some((part) => !topCell.test(part) && dockPart.test(part) && keyedOnState.test(part)))
    .filter((r) => !r.body.split(";").map((d) => d.trim()).filter(Boolean).every((d) => paints.test(d)));
  check(resizes.length === 0, `state rules that do more than paint the dock: ${resizes.map((r) => `${r.selector} { ${r.body.trim()} }`).join(" | ")}`);
  // And no state shows or hides the line.
  check(!rules.some((r) => parts(r.selector).some((part) => /\.caveat|#pivotNote\b|\.noteLine/.test(part) && keyedOnState.test(part)) && /display\s*:/.test(r.body)), "the line never shown or hidden by a state");
});

test("schemes: a stale link keeps the scheme shown, dimmed, and offers no change until telemetry resumes", () => {
  const page = loadPage();
  const ws = connectOpen(page);
  const group = page.$("scheme");
  const staleMs = page.evalIn("Link.STALE_MS");
  ws.serverMsg(telemetry({ scheme: "ADVANCED" }));
  page.fire(familyButton(page, "PIVOT_SIDEWAYS"), "click");

  page.clock.advance(staleMs - 100);
  page.fire(schemeButton(page, "NORMAL"), "click");
  check(pendingScheme(page) === "NORMAL" && count(ws) === 1, `asked: ${ws.sent}`);
  page.clock.advance(100); // telemetry has stopped
  check(page.$("linkState").textContent === "No data", `link ${page.$("linkState").textContent}`);
  check(group.dataset.state === "stale" && shownScheme(page) === "ADVANCED", `stale: ${group.dataset.state}, shows ${shownScheme(page)}`);
  check(pendingScheme(page) === null && group.getAttribute("aria-busy") === "false", "the request is given up: nothing can confirm it");
  check(SCHEMES.every((s) => schemeButton(page, s).disabled === true) && group.title.length > 0, "nothing offered, and the title says why");
  for (const s of SCHEMES) page.fire(schemeButton(page, s), "click");
  check(count(ws) === 1, `a stale link was sent ${ws.sent.slice(1)}`);
  // Stale is not lost: the pivot stick still drives in the family chosen.
  check(pivotsState(page) === "on" && page.evalIn("driver.family") === "PIVOT_SIDEWAYS", `the pivots stay: ${pivotsState(page)}, ${page.evalIn("driver.family")}`);

  ws.serverMsg(telemetry({ scheme: "ADVANCED" })); // telemetry resumes
  check(group.dataset.state === "known" && SCHEMES.every((s) => schemeButton(page, s).disabled === false), `resumed: ${group.dataset.state}`);
  page.fire(schemeButton(page, "NORMAL"), "click");
  check(ws.sent.slice(1).join() === '{"scheme":"NORMAL"}', `offered again: ${ws.sent.slice(1)}`);

  // A rover that rebooted is back on its default scheme, whatever was shown.
  page.clock.advance(staleMs);
  check(group.dataset.state === "stale", "stale again");
  ws.serverMsg(telemetry({ scheme: "NORMAL" }));
  check(shownScheme(page) === "NORMAL" && group.dataset.state === "known" && pivotsState(page) === "off", "the rebooted rover's scheme");
  check(page.errors.length === 0, `errors ${page.errors}`);
});

test("schemes: the pivots' corner labels are short and tell each family's four moves apart", () => {
  const { MOTIONS } = require("../js/mecanum.js");
  for (const family of ["PIVOT", "PIVOT_SIDEWAYS"]) {
    const shorts = MOTIONS.filter((m) => m.family === family).map((m) => m.short);
    check(shorts.length === 4 && new Set(shorts).size === 4, `${family}: ${shorts}`);
    check(shorts.every((t) => typeof t === "string" && t.length > 0 && t.length <= 10), `${family}: short enough for a corner: ${shorts}`);
  }
  check(MOTIONS.every((m) => typeof m.short === "string" && m.short.length > 0), "every motion has one");
});

/* --- program --------------------------------------------------------------- */

// The Program tab, its runner and the rover's Target, wired into the page.
// This page has no Blockly -- the fake DOM skips remote scripts, as a browser
// with no internet would -- so these check the tab's offline path too, and
// stand a hand-written program, or a stand-in editor, where blocks would be.

const BLOCKLY = "https://cdn.jsdelivr.net/npm/blockly@13.3.0/blockly.min.js";

// Time passes in small steps, with telemetry carrying `fields` every 500 ms,
// and the program's promises settle between the steps, as they would in a
// browser.
async function liveForAsync(page, ws, ms, { step = 50, frames = true, fields = { mode: "MANUAL" } } = {}) {
  for (let t = step; t <= ms; t += step) {
    page.clock.advance(step);
    if (frames && t % 500 === 0) ws.serverMsg(telemetry(fields));
    await flush();
  }
}

// Run a hand-written program on the page's runner and RoverTarget. __end is
// how it ended, once it has.
function startProgram(page, body = "await api.drive(MOVE_FORWARD, 50, 10); await api.log('after');") {
  page.evalIn(`
    globalThis.__end = null;
    runner.run(async (api) => { ${body} }, targets.rover).then((end) => { __end = end; });
  `);
}
const ended = (page) => page.evalIn("__end");
const logLines = (page) => page.$("programLog").children.map((li) => li.textContent);
const segments = (page) => page.$("target").children;

// What app.js would get from a BlockEditor, reduced to what the tab uses.
function standInEditor(page, program = "await api.step('b1'); await api.drive(MOVE_FORWARD, 50, 0.5); await api.log('hi');") {
  page.evalIn(`
    globalThis.__editor = {
      empty: false, stacks: 1, pivots: [], highlighted: [], readOnly: [], resized: 0, restyled: 0, loaded: [], cleared: 0, schemes: [],
      compile() { return async (api) => { ${program} }; },
      onChange() { return () => {}; },
      highlight(id) { this.highlighted.push(id); },
      setReadOnly(on) { this.readOnly.push(on); },
      setScheme(scheme) { this.schemes.push(scheme); },
      resize() { this.resized++; },
      restyle() { this.restyled++; },
      load(state) { this.loaded.push(state); },
      clear() { this.cleared++; },
      select() {}, save() { return {}; },
    };
    programTab.attachEditor(__editor);
  `);
}

// The page's question (#ask): every one it asks, in order, as the operator
// read it; the one open now, or null; and an answer to it -- "yes" (the
// button that names the action), "cancel", or "escape", which closes it
// with no answer at all.
function questionsAsked(page) {
  const dialog = page.$("ask");
  const asked = [];
  const showModal = dialog.showModal;
  dialog.showModal = function () {
    asked.push(page.$("askText").textContent);
    return showModal.call(this);
  };
  return asked;
}
const openQuestion = (page) => (page.$("ask").open ? page.$("askText").textContent : null);
async function answer(page, how) {
  if (how === "escape") page.$("ask").close();
  else page.fire(page.$(how === "yes" ? "askYes" : "askNo"), "click");
  await flush();
}
// The File menu's example items, and every item and the button that opens it.
const exampleItems = (page) => page.$("programExamples").children.filter((n) => n.getAttribute("role") === "menuitem");
const fileMenu = (page) => [page.$("programMenu"), ...exampleItems(page), page.$("programImport"), page.$("programExport"), page.$("programClear")];

test("program: the scripts load in order, and Blockly is the one remote script, pinned and deferred", () => {
  const page = loadPage();
  const order = page.allScripts;
  for (const [a, b] of [
    ["js/support.js", "js/program.js"], ["js/protocol.js", "js/program.js"], ["js/mecanum.js", "js/program.js"],
    ["js/scan.js", "js/blocks.js"], ["js/mecanum.js", "js/blocks.js"], ["js/program.js", "js/blocks.js"], ["js/support.js", "js/programtab.js"],
    ["js/programtab.js", "js/app.js"], ["js/blocks.js", "js/app.js"], [BLOCKLY, "js/app.js"],
  ]) check(loadsBefore(order, a, b), `${a} before ${b}: ${order}`);
  const remote = order.filter((src) => /^(?:[a-z]+:)?\/\//i.test(src));
  check(remote.join() === BLOCKLY, `remote scripts: ${remote}`);
  check(!page.scripts.includes(BLOCKLY), "the harness, like a browser offline, never ran it");
  const html = fs.readFileSync(path.join(PANEL_ROOT, "joystick.html"), "utf8");
  const tag = html.match(/<script src="https:\/\/cdn\.jsdelivr\.net[^>]*>/);
  check(tag && /integrity="sha384-4Kv1r1k2t1Nx4aCrz2guWZY\/uABIpOYzbdP6jumYusRZ0friDYW9iV1A06ULXjQm"/.test(tag[0]), `pinned by its hash: ${tag}`);
  check(tag && /crossorigin="anonymous"/.test(tag[0]) && /\bdefer\b/.test(tag[0]), `cross-origin, and deferred so driving never waits for it: ${tag}`);
  check(page.errors.length === 0, `errors ${page.errors}`);
});

test("program: without Blockly the tab says so, Run stays off, and driving works", () => {
  const page = loadPage({ stored: { "rover.tab": "tabProgram" } });
  check(page.errors.length === 0, `errors ${page.errors}`);
  check(!page.$("programTab").hidden, "the Program tab came back");
  const offline = page.$("programOffline");
  const words = all(offline).map((n) => n.textContent).join(" ");
  check(!offline.hidden, "the offline message shows");
  check(/could not load/.test(words) && /cdn\.jsdelivr\.net/.test(words) && /internet the first time/.test(words) && /Driving works without it/.test(words), `it says why: ${words}`);
  check(/could not load/.test(page.$("programState").textContent), `state: ${page.$("programState").textContent}`);
  const off = () => [page.$("programRun"), page.$("programStop"), ...fileMenu(page)].filter((b) => b.disabled !== true).map((b) => b.id || b.textContent);
  check(off().length === 0, `enabled without an editor: ${off()}`);

  // A live link changes nothing here...
  const ws = connectOpen(page);
  ws.serverMsg(telemetry({ mode: "MANUAL" }));
  check(off().length === 0, `enabled with a link but no editor: ${off()}`);
  // ...and pressing Run anyway runs nothing.
  page.fire(page.$("programRun"), "click");
  page.clock.advance(1000);
  check(count(ws) === 0, `Run without an editor sent ${names(ws)}`);
  check(page.evalIn("runner.state") === "idle", "nothing running");

  // Driving, on either tab's Stop and on the Drive tab, is untouched.
  page.fire(page.$("tabDrive"), "click");
  press(page, page.$("cw"), 1);
  page.clock.advance(450);
  lift(page, page.$("cw"), 1);
  check(names(ws).join() === "ROTATE_CLOCKWISE,ROTATE_CLOCKWISE,ROTATE_CLOCKWISE,STOP", `drove ${names(ws)}`);
  const s = stickTouch(page, 0);
  s.start(); s.move(0, -50); s.end();
  check(names(ws).slice(-2).join() === "MOVE_FORWARD,STOP", `stick ${names(ws)}`);
  check(page.errors.length === 0, `errors ${page.errors}`);

  // The switch offers what the registry holds: the rover, and the simulator
  // when its scripts registered one; the simulator's view is drawn only
  // then, in its one slot in the view pane, beside both tabs. The view pane
  // is there either way (the rover's scan), and the View toggle shows and
  // hides it.
  for (const without of [false, true]) {
    const p = without ? loadPage({ leaveOut: ["js/sim.js", "js/simview.js"], stored: { "rover.tab": "tabProgram" } }) : page;
    const sim = p.evalIn("'simulator' in targets");
    check(sim === !without, `the simulator registered: ${sim}`);
    check(segments(p).length === (sim ? 2 : 1), `segments ${segments(p).map((b) => b.textContent)}`);
    check(p.$("target").hidden === !sim, `the switch follows the registry, ${without ? "without" : "with"} the simulator`);
    const slot = p.$("simSlot");
    check(slot.parentNode === p.$("view") && p.$("view").parentNode === p.$("programTab").parentNode, "#simSlot is in the view pane, a sibling of the tabs");
    check((slot.children.length > 0) === sim, `the simulator's view drawn in it only with a simulator: ${slot.children.length}`);
    p.fire(p.$("viewToggle"), "click");
    p.fire(p.$("viewToggle"), "click");
    check(p.errors.length === 0, `errors ${p.errors}`);
  }
});

test("program: the editor refits as its box changes size, not only as the tab is shown", () => {
  // Blockly refits itself only to a window's resize. On a wide screen the
  // editor's box also changes as the view folds, or as the console under it
  // grows, and Blockly drew past its edges until the next tab switch.
  const page = loadPage({ frames: true, stored: { "rover.tab": "tabProgram" } });
  check(page.$("programWorkspace").resizeObserved === true, "the editor's box is watched");
  page.resized();
  standInEditor(page);
  const before = page.evalIn("__editor.resized");
  page.resized();
  check(page.evalIn("__editor.resized") === before + 1, "a change of its size refits it");
  check(page.errors.length === 0, `errors ${page.errors}`);
});

test("program: with an editor, Run follows the link, and a run highlights, locks the editor and ends with STOP", async () => {
  const page = loadPage();
  standInEditor(page);
  check(page.$("programOffline").hidden, "no offline message");
  check(page.$("programRun").disabled === true, "Run off without a link");
  // Why, in full on Run and on the line's hover, and in a few words on the
  // line, which is one line: a phone cut the whole reason to "Connect t..."
  // (the review's phones 0).
  check(/Connect to the rover/.test(page.$("programRun").title) && page.$("programState").textContent === "Not connected." && /Connect to the rover/.test(page.$("programState").title), `says why: ${page.$("programRun").title} / ${page.$("programState").textContent} / ${page.$("programState").title}`);
  check(page.$("programRunLabel").textContent === "Run on rover", `label ${page.$("programRunLabel").textContent}`);
  check(exampleItems(page).length === 4 && fileMenu(page).every((b) => b.disabled === false), "the File menu works offline");

  // Not connected: pressing Run anyway is refused, and nothing is sent.
  page.fire(page.$("programRun"), "click");
  await flush();
  check(page.evalIn("runner.state") === "idle", "refused");

  const ws = connectOpen(page);
  ws.serverMsg(telemetry({ mode: "MANUAL" }));
  check(page.$("programRun").disabled === false, "Run on with a live link");
  check(page.$("programState").textContent === "Ready to run on the rover.", `state ${page.$("programState").textContent}`);

  page.fire(page.$("programRun"), "click");
  await flush();
  check(page.evalIn("runner.state") === "running", "running");
  check(page.$("programRun").disabled === true && page.$("programStop").disabled === false, "Run off, Stop on");
  check([...exampleItems(page), page.$("programImport"), page.$("programClear")].every((b) => b.disabled), "no editing tools mid-run");
  check(!page.$("programMenu").disabled && !page.$("programExport").disabled, "Export works mid-run");
  check(page.$("programState").dataset.tone === "running" && /Running on the rover/.test(page.$("programState").textContent), "says so");

  // Switching tabs stops nothing.
  page.fire(page.$("tabProgram"), "click");
  page.fire(page.$("tabDrive"), "click");
  page.fire(page.$("tabProgram"), "click");
  await liveForAsync(page, ws, 700);
  check(names(ws).join() === "MOVE_FORWARD,MOVE_FORWARD,MOVE_FORWARD,STOP", `sent ${names(ws)}`);
  check(ws.moves().slice(0, 3).every((m) => m.speed === 128 && m.duration === 400), "50 % is 128, each frame asking 400 ms");
  check(ws.sentAt.slice(0, 4).map((t) => t - ws.sentAt[0]).join() === "0,200,400,500", `the repeat, then STOP at 0.5 s: ${ws.sentAt}`);
  check(page.evalIn("__editor.highlighted.join()") === "b1,", `highlighted ${page.evalIn("__editor.highlighted")}`);
  check(page.evalIn("__editor.readOnly.join()") === "true,false", `locked while running ${page.evalIn("__editor.readOnly")}`);
  check(page.evalIn("__editor.resized") === 2, "fitted each time the tab was shown");
  check(page.$("programState").textContent === "Done on the rover." && page.$("programState").dataset.tone === "done", `state ${page.$("programState").textContent}`);
  check(logLines(page).join("|") === "Not run: Connect to the rover to run a program on it.|Started on the rover.|hi|Done.", `log ${logLines(page)}`);
  check(page.$("programRun").disabled === false && page.$("programStop").disabled === true, "ready again");

  // A program its compiler refuses never runs, and the reason is shown.
  page.evalIn(`__editor.compile = () => { throw Object.assign(new Error("A drive until block has nothing to wait for."), { blockId: "b9" }); };
    __editor.select = (id) => { __editor.selected = id; };`);
  const mark = count(ws);
  page.fire(page.$("programRun"), "click");
  await liveForAsync(page, ws, 500);
  check(count(ws) === mark && page.evalIn("runner.state") === "idle", "nothing ran");
  check(/^Cannot run: A drive until/.test(page.$("programState").textContent) && page.evalIn("__editor.selected") === "b9", `shown, and its block selected: ${page.$("programState").textContent}`);
  check(page.errors.length === 0, `errors ${page.errors}`);
});

test("program: a manual press, blur, a hidden page, Stop, Autonomous either way, the tab's Stop, link loss and a stale link each stop it", async () => {
  const cases = [
    // [what, act, the reason, what goes out after it]
    ["a rotate press", (page) => press(page, page.$("ccw"), 3), /^the rover was driven by hand\.$/, "ROTATE_COUNTERCLOCKWISE"],
    ["a stick press", (page) => stickTouch(page, 0).start(), /^the rover was driven by hand\.$/, "STOP"],
    ["blur", (page) => page.fire(page.win, "blur", { bubbles: false }), /lost focus/, "STOP"],
    ["a hidden page", (page) => { page.doc.hidden = true; page.fire(page.doc, "visibilitychange", { bubbles: false }); }, /hidden/, "STOP"],
    ["Stop", (page) => page.fire(page.$("stop"), "click"), /^Stop was pressed\.$/, "STOP"],
    ["Autonomous", (page) => page.fire(page.$("auto"), "click"), /^Autonomous was pressed\.$/, "RESUME_AUTONOMOUS"],
    // Turned off, lit by a rover reported exploring: STOP, and the console
    // names the toggle, not Stop.
    ["Autonomous, lit", (page, ws) => { ws.serverMsg(telemetry({ mode: "AUTONOMOUS" })); page.fire(page.$("auto"), "click"); }, /^Autonomous was pressed\.$/, "STOP"],
    ["the tab's Stop", (page) => page.fire(page.$("programStop"), "click"), /Program tab/, "STOP"],
    ["link loss", (page, ws) => ws.serverDrop(), /link to the rover was lost/, ""],
    ["Disconnect", (page) => page.fire(page.$("connect"), "click"), /disconnected/, "STOP"],
  ];
  for (const [what, act, reason, after] of cases) {
    const { page, ws } = connected(telemetry({ mode: "MANUAL" }));
    startProgram(page);
    await liveForAsync(page, ws, 300);
    check(names(ws).join() === "MOVE_FORWARD,MOVE_FORWARD", `${what}: driving ${names(ws)}`);
    const mark = count(ws);
    act(page, ws);
    await flush();
    const end = ended(page);
    check(end && end.outcome === "stopped" && reason.test(end.reason), `${what}: ended ${JSON.stringify(end)}`);
    check(page.evalIn("runner.state") === "idle", `${what}: idle`);
    check(names(ws, mark).join() === after, `${what}: sent ${names(ws, mark)}, wanted ${after}`);
    // Every stop the panel imposed says why, in amber; the operator's own
    // Stop program, what they asked for, a plain "Stopped." (the review's
    // phones 25: their own stop read as a warning).
    if (what === "the tab's Stop") {
      check(page.$("programState").textContent === "Stopped." && page.$("programState").dataset.tone === "ended" && end.own === true, `${what}: state ${page.$("programState").textContent} ${page.$("programState").dataset.tone}`);
      const last = page.$("programLog").children.at(-1);
      check(last.textContent === "Stopped." && last.dataset.tone === "info", `${what}: logged ${last.dataset.tone}: ${last.textContent}`);
    } else {
      check(/^Stopped: /.test(page.$("programState").textContent) && page.$("programState").dataset.tone === "stopped" && !("own" in end), `${what}: state ${page.$("programState").textContent}`);
      const last = page.$("programLog").children.at(-1);
      check(/^Stopped: /.test(last.textContent) && last.dataset.tone === "stopped", `${what}: logged ${last.dataset.tone}: ${last.textContent}`);
    }
    check(!logLines(page).includes("after"), `${what}: nothing after the drive ran`);
    // The program never takes the rover back: only what the operator holds
    // drives on.
    const held = names(ws).length;
    page.doc.hidden = false;
    await liveForAsync(page, ws, 1000, { frames: ws.readyState === 1 });
    check(!names(ws).slice(held).includes("MOVE_FORWARD"), `${what}: the program drove again: ${names(ws, held)}`);
    check(page.errors.length === 0, `${what}: errors ${page.errors}`);
  }

  // Telemetry that stops while the socket stays open: the link goes stale.
  const { page, ws } = connected(telemetry({ mode: "MANUAL" }));
  startProgram(page);
  await liveForAsync(page, ws, 1900, { frames: false });
  check(page.doc.body.dataset.link === "stale", "stale");
  const end = ended(page);
  check(end && end.outcome === "stopped" && /telemetry stopped arriving/.test(end.reason), `stale: ended ${JSON.stringify(end)}`);
  check(names(ws).slice(-1).join() === "STOP", `stale: ${names(ws)}`);
});

test("program: a run stopped mid-wait leaves no timer behind", async () => {
  const { page, ws } = connected(telemetry({ mode: "MANUAL" }));
  startProgram(page, "await api.wait(60);");
  await liveForAsync(page, ws, 300);
  page.fire(page.$("connect"), "click"); // Disconnect: the run stops, and the link's own timers go
  await flush();
  page.clock.advance(100); // the socket's close
  check(ended(page) && ended(page).outcome === "stopped", `ended ${JSON.stringify(ended(page))}`);
  check(page.clock.pending() === 0, `timers pending ${page.clock.pending()}`);
});

test("program: start exploring hands over, its own stop is obeyed, and neither stops the program", async () => {
  const { page, ws } = connected(telemetry({ mode: "MANUAL" }));
  startProgram(page, "await api.explore(); await api.wait(1); await api.stop(); await api.wait(1); await api.log('after');");
  await liveForAsync(page, ws, 500);
  check(names(ws).join() === "RESUME_AUTONOMOUS", `explore ${names(ws)}`);
  check(page.evalIn("runner.state") === "running", "explore did not stop the program");
  await liveForAsync(page, ws, 700);
  check(names(ws).join() === "RESUME_AUTONOMOUS,STOP", `stop ${names(ws)}`);
  check(page.evalIn("runner.state") === "running", "nor did its own stop");
  await liveForAsync(page, ws, 1000);
  check(ended(page) && ended(page).outcome === "done" && logLines(page).includes("after"), `ended ${JSON.stringify(ended(page))}`);
  check(names(ws).join() === "RESUME_AUTONOMOUS,STOP", `nothing more ${names(ws)}`);

  // Stopped while the rover explores for it: nothing is sent, so it explores on.
  startProgram(page, "await api.explore(); await api.wait(10);");
  await liveForAsync(page, ws, 300);
  const mark = count(ws);
  page.fire(page.$("programStop"), "click");
  await liveForAsync(page, ws, 1000);
  check(ended(page).outcome === "stopped" && count(ws) === mark, `stopping it sent ${names(ws, mark)}`);
});

test("program: switching the target mid-run stops the program, and the choice is remembered", async () => {
  const { page, ws } = connected(telemetry({ mode: "MANUAL" }));
  standInEditor(page);
  // Each segment's word (a narrow cell shows Sim in Simulator's place).
  const words = (b) => all(b).filter((n) => n.getAttribute && n.getAttribute("class") === "segWord").map((n) => n.textContent).join("");
  check(segments(page).map(words).join() === "Rover,Simulator", `segments ${segments(page).map(words)}`);
  check(!page.$("target").hidden && page.$("simSlot").children.length > 0, "both offered, and the simulator's view drawn");
  check(segments(page)[0].getAttribute("aria-pressed") === "true", "the rover chosen");

  startProgram(page);
  await liveForAsync(page, ws, 300);
  page.fire(segments(page)[0], "click");
  await flush();
  check(page.evalIn("runner.state") === "running", "choosing the target already chosen is no switch");
  const mark = count(ws);
  page.fire(segments(page)[1], "click");
  await flush();
  const end = ended(page);
  check(end && end.outcome === "stopped" && /switched to the simulator/.test(end.reason), `ended ${JSON.stringify(end)}`);
  check(names(ws, mark).join() === "STOP", `sent ${names(ws, mark)}`);
  check(page.evalIn("targetSwitch.kind") === "simulator" && page.store["rover.target"] === "simulator", "chosen and remembered");
  check(page.$("programRunLabel").textContent === "Preview" && page.$("programRun").disabled === false, "Preview, ready whatever the link");
  check(segments(page)[1].getAttribute("aria-pressed") === "true", "pressed");

  // A preview is stopped by switching back, and by the panel's Stop.
  page.fire(page.$("programRun"), "click");
  await flush();
  check(page.evalIn("runner.target && runner.target.kind") === "simulator", "previewing");
  page.fire(segments(page)[0], "click");
  await flush();
  check(page.evalIn("runner.state") === "idle" && /Stopped: the target was switched to the rover/.test(page.$("programState").textContent), `state ${page.$("programState").textContent}`);
  page.fire(segments(page)[1], "click");
  page.fire(page.$("programRun"), "click");
  await flush();
  const before = count(ws);
  page.fire(page.$("stop"), "click");
  await flush();
  check(page.evalIn("runner.state") === "idle" && /Stop was pressed/.test(page.$("programState").textContent), `the panel's Stop: ${page.$("programState").textContent}`);
  check(names(ws, before).join() === "STOP", "and the panel's Stop still stops the rover");
  // So does the panel's Autonomous. On the simulator it hands the
  // simulated rover to its exploring, and leaves the rover alone.
  page.fire(page.$("programRun"), "click");
  await flush();
  check(page.evalIn("runner.target && runner.target.kind") === "simulator", "previewing again");
  const handed = count(ws);
  page.fire(page.$("auto"), "click");
  await flush();
  check(page.evalIn("runner.state") === "idle" && /Stopped: Autonomous was pressed/.test(page.$("programState").textContent), `the panel's Autonomous: ${page.$("programState").textContent}`);
  check(count(ws) === handed, `the rover was left alone: ${names(ws, handed)}`);
  check(page.evalIn("targets.simulator.state.mode") === "AUTONOMOUS", "the simulated rover took the mode");
  // How the last run ended belongs to its target: a switch clears it.
  page.fire(segments(page)[0], "click");
  check(page.$("programState").textContent === "Ready to run on the rover.", `after a switch: ${page.$("programState").textContent}`);

  // The view pane beside the editor: hidden at first on a phone, on
  // either target, giving the editor the room; a switch to the simulator
  // leaves it folded there (shown, it squeezed the editor to a strip on an
  // upright phone: the critic's round 1). The View toggle shows and hides
  // it either way, and says so (aria-pressed, its title).
  const folded = loadPage();
  const view = () => `${folded.$("programTab").dataset.view} ${folded.$("viewToggle").getAttribute("aria-pressed")}`;
  check(view() === "hidden false", `hidden under the rover, with no room for both: ${view()}`);
  check(/show/i.test(folded.$("viewToggle").title), `its title says what a press does: ${folded.$("viewToggle").title}`);
  folded.fire(segments(folded)[1], "click");
  check(view() === "hidden false", `still folded on the simulator, on a phone: ${view()}`);
  const onSim = loadPage({ stored: { "rover.target": "simulator" } });
  check(onSim.$("programTab").dataset.view === "hidden", `folded at first on a phone with the simulator the target: ${onSim.$("programTab").dataset.view}`);
  folded.fire(folded.$("viewToggle"), "click");
  check(view() === "shown true", `the toggle shows it: ${view()}`);
  folded.fire(folded.$("viewToggle"), "click");
  check(view() === "hidden false" && /show/i.test(folded.$("viewToggle").title), `the toggle hides it: ${view()}`);
  folded.fire(segments(folded)[0], "click");
  check(view() === "hidden false", `back on the rover, as it was: ${view()}`);
  folded.fire(folded.$("viewToggle"), "click");
  check(view() === "shown true" && /hide/i.test(folded.$("viewToggle").title), `shown again: ${view()} ${folded.$("viewToggle").title}`);
  // Where the screen has room for both side by side, it starts shown.
  const roomy = loadPage();
  roomy.evalIn(`globalThis.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} });`);
  check(roomy.evalIn(`new ProgramTab({ runner, targetSwitch, examples: [], ask, showView: true, ui: {
    ...Object.fromEntries(["run", "runLabel", "stop", "menu", "menuList", "examples", "exportButton", "importButton", "importFile", "clear", "workspace", "hint", "offline", "state", "log"].map((k) => [k, document.createElement(k === "importFile" ? "input" : "div")])),
    tab: document.createElement("section"), viewToggle: document.createElement("button") } }) && true`), "a tab told there is room");
  // Told there is room, it starts shown, and a switch to the simulator
  // shows it again after the toggle folded it.
  roomy.evalIn(`globalThis.__ui = { ...Object.fromEntries(["run", "runLabel", "stop", "menu", "menuList", "examples", "exportButton", "importButton", "importFile", "clear", "workspace", "hint", "offline", "state", "log"].map((k) => [k, document.createElement(k === "importFile" ? "input" : "div")])),
    tab: document.createElement("section"), viewToggle: document.createElement("button") };
    new ProgramTab({ runner, targetSwitch, examples: [], ask, showView: true, ui: __ui });`);
  const roomyView = [roomy.evalIn("__ui.tab.dataset.view")];
  roomy.fire(roomy.evalIn("__ui.viewToggle"), "click");
  roomyView.push(roomy.evalIn("__ui.tab.dataset.view"));
  roomy.fire(segments(roomy)[1], "click");
  roomyView.push(roomy.evalIn("__ui.tab.dataset.view"));
  check(roomyView.join() === "shown,hidden,shown", `with room: shown at first, and again on a switch to the simulator: ${roomyView}`);
  const app = fs.readFileSync(path.join(PANEL_ROOT, "js", "app.js"), "utf8");
  check(/showView:\s*roomForView/.test(app) && /matchMedia\("\(min-width: 960px\) and \(min-height: 521px\), \(min-width: 720px\) and \(min-height: 900px\)"\)/.test(app), "shown at first where the layout is side by side, or a tablet upright has room for its band");
  // Hidden is no layout's alone: the pane is gone on every layout, with no
  // strip left, and the editor takes its room.
  const panel = panelCss();
  const gone = '.shell:has(> #programTab[data-view="hidden"]:not([hidden])) > .view';
  for (const opening of ["@media (max-width: 959.98px), (max-height: 520.98px) {", "@media (min-width: 960px) and (min-height: 521px) {"]) {
    check((blockRules(panel, opening) || []).some((r) => r.selector === gone && /display:\s*none/.test(r.body)), `${opening}: hidden, the pane is gone`);
  }
  const wideRules = blockRules(panel, "@media (min-width: 960px) and (min-height: 521px) {") || [];
  const hiddenWide = wideRules.find((r) => r.selector === '.shell:has(> #programTab[data-view="hidden"]:not([hidden]))');
  check(hiddenWide && /grid-template-columns:\s*minmax\(0, 1fr\);/.test(hiddenWide.body) && /"head"\s*"main"/.test(hiddenWide.body), `wide, hidden: the editor the width: ${hiddenWide && hiddenWide.body}`);
  const shownWide = wideRules.find((r) => r.selector === ".shell:has(> #programTab:not([hidden]))");
  const wideBody = shownWide ? shownWide.body : "";
  check(/--view-w:\s*clamp\(360px, 0\.5 \* \(min\(100vw, var\(--shell-max\)\) - 2 \* var\(--gutter\) - var\(--s-4\)\), 640px\);/.test(wideBody) && /grid-template-columns:\s*var\(--view-w\) minmax\(0, 1fr\);/.test(wideBody), `wide, shown: the view's column about half, the editor the rest: ${wideBody}`);
  // The view's card at the top of its column, as tall as its drawing at
  // the column's width (--va) and its bars, and the console under it the
  // rest of the column; the editor's card beside both, full height, its
  // toolbar its head. Given the whole column, the fan or the room floated
  // in it with bare ground over and under, 50 to 67% of it empty (the
  // review's laptops 0, tablets 6). The view's row gives way to a short
  // screen, never the console's last line.
  check(/--view-h:\s*calc\(\(var\(--view-w\) - var\(--vcw\)\) \/ var\(--va\) \+ var\(--vch\)\);/.test(wideBody), `wide, shown: the view as tall as its drawing at the column's width: ${wideBody}`);
  check(/grid-template-rows:\s*auto var\(--bar-h\) minmax\(0, calc\(var\(--view-h\) - var\(--bar-h\)\)\) minmax\(var\(--console-min\), 1fr\);/.test(wideBody) && /"head head"\s*"view pbar"\s*"view edit"\s*"cons edit"/.test(wideBody) && !/(^|[\s;])(row-)?gap:/.test(wideBody), `wide, shown: the view over the console, the editor's card beside both: ${wideBody}`);
  const wideTab = (selector) => wideRules.filter((r) => r.selector.replace(/,\n\s*/g, ",") === selector).map((r) => r.body).join("");
  // The tab and its stage step aside, with the view shown alone, so the
  // toolbar, the editor and the console take the shell's areas; hidden,
  // the tab is one box, its console under the editor.
  check(/display:\s*contents/.test(wideTab('#programTab:not([hidden], [data-view="hidden"]),#programTab:not([hidden], [data-view="hidden"]) > .programStage')), "wide, shown: the tab's toolbar, editor and console on the shell's grid");
  check(/grid-area:\s*pbar/.test(wideTab('#programTab:not([data-view="hidden"]) .programBar')) && /grid-area:\s*edit/.test(wideTab('#programTab:not([data-view="hidden"]) .programEditor')), "the toolbar the editor's head, the editor under it");
  const consoleWide = wideTab('#programTab:not([data-view="hidden"]) .programConsole');
  const logWide = wideTab('#programTab:not([data-view="hidden"]) .programLog');
  check(/grid-area:\s*cons/.test(consoleWide) && /margin-top:\s*var\(--s-4\)/.test(consoleWide) && /flex:\s*1 1 auto/.test(logWide) && /max-height:\s*none/.test(logWide), `the console under the view, its log the rest of it, scrolling: ${consoleWide} | ${logWide}`);
  check(!/padding-top|margin-top/.test(wideTab("#programTab")), "wide: the toolbar at the pane's top, against the editor");
  const stageSplit = (rules) => rules.filter((r) => /#programTab|programStage|programConsole|programBar|programEditor|programLog/.test(r.selector) && /subgrid|display:\s*contents|grid-(area|row|column)|max-height:\s*none/.test(r.body));
  // A tablet upright: the view a band over the editor's card, the
  // screen's width, one height whatever the target; the console under the
  // editor there too. Beside the band it was a box as tall as the band
  // holding one line, and the fan a thumbnail (the review's tablets 1).
  const tabletRules = blockRules(panel, "@media (min-width: 600px) and (max-width: 959.98px) and (min-height: 521px) {") || [];
  const band = tabletRules.filter((r) => r.selector === ".shell:has(> #programTab:not([hidden])) > .view").map((r) => r.body).join("");
  check(/height:\s*clamp\(120px, min\(38 \* var\(--svh\), 100 \* var\(--svh\) - 400px\), 460px\);/.test(band), `a tablet: the view a band one height: ${band}`);
  check(stageSplit(tabletRules).length === 0 && !tabletRules.some((r) => /programTab/.test(r.selector) && /grid-template-(columns|areas)/.test(r.body)) && !tabletRules.some((r) => /^\.shell/.test(r.selector) && /grid-template-columns/.test(r.body)),
    `a tablet: the band the width, the console under the editor: ${stageSplit(tabletRules).map((r) => r.selector)}`);
  // The console after the editor in the stage, so a column puts it under.
  const stageKids = [...folded.$("programStage").children].map((n) => n.getAttribute("class"));
  check(stageKids.indexOf("programEditor") >= 0 && stageKids.indexOf("programEditor") < stageKids.indexOf("programConsole"), `the console after the editor: ${stageKids}`);
  const aspect = cssRules(outside(panel, "@media"));
  const shellVars = aspect.filter((r) => r.selector === ".shell" && /--va:/.test(r.body)).map((r) => r.body).join("");
  const simVars = aspect.filter((r) => r.selector === 'body[data-target="simulator"] .shell').map((r) => r.body).join("");
  check(/--va:\s*2\.1;/.test(shellVars) && /--va:\s*var\(--room-aspect, 1\.3333\);/.test(simVars), `the fan's aspect, or the room's: ${shellVars} | ${simVars}`);
  // A tablet upright: the band over the editor one height whatever the
  // target, from the screen alone, never from what it shows (--va, --vcw,
  // --vch), so a switch of target never moves the editor's top (105 px at
  // 768 x 1024 when the fan's band was only as tall as its wide shape: the
  // review's tablets 11). The band is the screen's width (the review's
  // tablets 1, above), and the fan or the room fits inside it.
  check(band !== "" && !/--v(a|cw|ch)\b/.test(band), `tablet: the band's height the screen's, not what it shows: ${band}`);
  check(!tabletRules.some((r) => /data-target/.test(r.selector)), "tablet: nothing in the band's layout by target");
  // The editor and the console are the stage's; nothing of the simulator's.
  const consoleBox = folded.$("programState").parentNode.parentNode;
  check(consoleBox.getAttribute("class") === "programConsole" && consoleBox.parentNode === folded.$("programStage"), "the console is in the stage");
  // The state one line, on every layout: two or three lines of it took
  // the editor's height a run at a time on a phone (the review's phones
  // 7). Whole on hover, and on Run's title while Run is off; the line says
  // a reason briefly ("Not connected.", tested above).
  const stateRule = cssRules(outside(stylesheet("program.css"), "@")).filter((r) => r.selector === ".programState").map((r) => r.body).join("");
  check(/white-space:\s*nowrap;/.test(stateRule) && /text-overflow:\s*ellipsis;/.test(stateRule) && /overflow:\s*hidden;/.test(stateRule), `the state one line: ${stateRule}`);
  check(folded.$("programState").title !== "" && (folded.$("programState").title === folded.$("programState").textContent || folded.$("programState").title === folded.evalIn("targetSwitch.target.ready().why")), `the state whole on hover, where one line cuts it: '${folded.$("programState").title}'`);
  check(!all(folded.$("programTab")).includes(folded.$("simSlot")), "no view of its own in the Program tab");
  // The toolbar is the head of the editor's card on every layout: one slim
  // row a cell's height, on the card's ground, with no gap between it and
  // the editor, whose top corners give way to it. In the bands beside the
  // top of a phone on its side, it was two rows, and four slabs before that
  // (the critic's round 2: the on-its-side test holds that layout to this).
  const programCss = stylesheet("program.css");
  const programBase = cssRules(outside(programCss, "@"));
  const baseOf = (selector) => programBase.filter((r) => r.selector === selector).map((r) => r.body).join("");
  check(/--bar-h:\s*calc\(var\(--ctl\) \+ 7px\);/.test(baseOf(":root")) && /height:\s*var\(--bar-h\);/.test(baseOf(".programBar")) && /display:\s*flex;/.test(baseOf(".programBar")) && /border-bottom:\s*none;/.test(baseOf(".programBar")) && /border-radius:\s*var\(--r-lg\) var\(--r-lg\) 0 0;/.test(baseOf(".programBar")),
    `the toolbar a row, the card's head: ${baseOf(".programBar")}`);
  check(/border-radius:\s*0 0 var\(--r-lg\) var\(--r-lg\);/.test(baseOf(".programEditor")) && /gap:\s*0;/.test(baseOf("#programTab")), `the editor the card's body, straight under it: ${baseOf(".programEditor")} | ${baseOf("#programTab")}`);
  // Blockly's toolbox along the top of an upright phone's editor, every
  // category in sight there: wrapping to a second row, never a row that
  // scrolls and cuts one mid-word ("Lo" at 375 px: the critic's round 2).
  // On its side, down the left, so they never wrap: along the top they
  // took 30 to 60 px of an editor 170 px tall (the review's phones 0).
  // Down the left of a short editor the seven ran past its foot (round
  // 2), so a short editor's pills are closer, all seven in its height.
  const blocksJs = fs.readFileSync(path.join(PANEL_ROOT, "js", "blocks.js"), "utf8");
  check(/static NARROW = "\(max-width: 600px\) and \(orientation: portrait\)";/.test(blocksJs), "the toolbox along the top of an upright phone alone");
  const pills = baseOf('.blocklyToolbox[layout="h"] .blocklyToolboxCategoryGroup');
  check(/flex-wrap:\s*wrap;/.test(pills) && !/overflow|mask/.test(pills), `every category in sight, wrapping: ${pills}`);
  // Every block a query opens, wherever it is in the sheet.
  const everyBlock = (css, opening) => {
    const rules = [];
    for (let rest = css.replace(/\/\*[\s\S]*?\*\//g, ""), at = rest.indexOf(opening); at >= 0; rest = rest.slice(at + opening.length), at = rest.indexOf(opening)) rules.push(...blockRules(rest.slice(at), opening));
    return rules;
  };
  const shortPills = everyBlock(programCss, "@container editor (max-height: 299.98px) {").filter((r) => /blocklyToolbox:not\(\[layout="h"\]\)/.test(r.selector));
  const pillPad = shortPills.filter((r) => /\.roverCategory/.test(r.selector)).map((r) => r.body).join("");
  const pillLine = shortPills.filter((r) => /blocklyToolboxCategoryLabel/.test(r.selector)).map((r) => r.body).join("");
  const pad = Number((pillPad.match(/padding:\s*(\d+)px/) || [])[1]);
  const gap = Number((pillPad.match(/margin:\s*0 0 (\d+)px/) || [])[1]);
  const line = Number((pillLine.match(/line-height:\s*(\d+)px/) || [])[1]);
  // Seven pills and the toolbox's 4 px either end in 170 px, the editor's
  // height at 568 x 320.
  check(pad > 0 && line > 0 && 7 * (line + 2 * pad + gap) + 8 <= 170, `a short editor: the seven down the left in 170 px: ${7 * (line + 2 * pad + gap) + 8} (${pillPad} | ${pillLine})`);
  check((blockRules(programCss, "@media (max-width: 600px) and (orientation: portrait) {") || []).some((r) => r.selector === ".programHint") && (blockRules(programCss, "@media not all and (max-width: 600px) and (orientation: portrait) {") || []).some((r) => r.selector === ".programHint"),
    "the hint clear of the toolbox wherever blocks.js puts it");
  // Shorter still (130 px at 480 x 320), closer again: at 23 px a pill,
  // Variables was cut in half and Output out of sight (the review's
  // phones 4; measured in a browser: all seven in 130 px).
  const shorter = everyBlock(programCss, "@container editor (max-height: 169.98px) {");
  const tight = (re) => shorter.filter((r) => re.test(r.selector)).map((r) => r.body).join("");
  const tPad = Number((tight(/\.roverCategory$/).match(/padding:\s*(\d+)px/) || [])[1]);
  const tLine = Number((tight(/blocklyToolboxCategoryLabel/).match(/line-height:\s*(\d+)px/) || [])[1]);
  const tEnds = Number((tight(/^\.blocklyToolbox:not\(\[layout="h"\]\)$/).match(/padding:\s*(\d+)px/) || [])[1]);
  check(tLine > 0 && 7 * (tLine + 2 * tPad) + 2 * tEnds <= 130 && /margin:\s*0;/.test(tight(/\.roverCategory$/)), `shorter still: the seven in 130 px: ${7 * (tLine + 2 * tPad) + 2 * tEnds}`);
  // A short editor drops the zoom buttons, which ran up under the toolbox;
  // a narrow one (a phone's) or a shorter one the trash can too, which on
  // a phone lay over an example's inputs (the review's phones 3); and a
  // short one puts the hint at its foot, or, too narrow for it beside the
  // toolbox, nowhere: it ran five lines tall, its top cut off.
  check(/container:\s*editor \/ size;/.test(baseOf(".programEditor")), "the editor a container for its height");
  check(everyBlock(programCss, "@container editor (max-height: 299.98px) {").some((r) => r.selector === ".blocklyZoom" && /display:\s*none/.test(r.body)), "a short editor: no zoom buttons");
  const small = everyBlock(programCss, "@container editor (max-width: 359.98px) or (max-height: 259.98px) {");
  check(small.some((r) => r.selector.replace(/\s+/g, " ") === ".blocklyZoom, .blocklyTrash" && /display:\s*none/.test(r.body)), "under 360 px wide or 260 tall: no trash can, no zoom buttons");
  const shortest = blockRules(programCss, "@container editor (max-height: 199.98px) {") || [];
  check(shortest.some((r) => r.selector === ".programHint" && /bottom:/.test(r.body)), "shorter still: the hint at the foot");
  const cramped = everyBlock(programCss, "@container editor (max-height: 199.98px) and (max-width: 399.98px) {");
  check(cramped.some((r) => r.selector === ".programHint" && /display:\s*none/.test(r.body)), "and too narrow beside the toolbox, no hint");
  // A program loaded (an example, a file) fitted to the editor's width,
  // from its top-left, never zoomed in past the start scale (the review's
  // phones 3: examples ran past a phone's editor); measured in a browser.
  check(/load\(state\) \{[\s\S]*?this\.#showTopLeft\(true\);/.test(blocksJs) && /Math\.min\(this\.#startScale, \(view\.width - 2 \* margin\) \/ width\)/.test(blocksJs) && /workspace\.scroll\(margin - box\.left \* scale, margin - box\.top \* scale\)/.test(blocksJs), "a loaded program fitted to the width, from its top-left");
  // The toolbar keeps to one row in a phone's tab: its icons go first.
  const narrowPane = blockRules(programCss, "@container program (max-width: 459.98px) {") || [];
  check(narrowPane.some((r) => /\.viewWord/.test(r.selector) && /display:\s*none/.test(r.body)), "a narrow tab's View toggle its icon alone");
  // Narrower still (a 320 px phone), Run gives way, never Stop program:
  // cut to "Stop", it was the one button on screen named Stop and not the
  // one that stops an exploring rover (the review's phones 6). Run says
  // "Run" on the rover ("Preview" on the simulator), titled in full, and
  // no rule there hides a word of Stop program.
  const narrowest = blockRules(programCss, "@container program (max-width: 339.98px) {") || [];
  const haltWords = all(folded.$("programStop")).map((n) => (n.textContent || "").trim()).filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
  check(narrowest.some((r) => r.selector === ".programBar .runWord" && /display:\s*none/.test(r.body)) && narrowest.some((r) => r.selector === ".programBar .runShort" && /display:\s*inline/.test(r.body)) && /\.runShort\s*\{\s*display:\s*none;/.test(programCss.replace(/\/\*[\s\S]*?\*\//g, "")),
    "the narrowest tab: Run's short word in place of its long one, and only there");
  check(!narrowest.some((r) => /halt|#programStop/.test(r.selector) && /display:\s*none/.test(r.body)) && haltWords === "Stop program" && folded.$("programStop").getAttribute("aria-label") === "Stop program", `the narrowest tab's Stop program says both words: ${haltWords}`);
  const shortRun = () => `${folded.$("programRunShort").textContent} / ${folded.$("programRunLabel").textContent}`;
  check(shortRun() === "Run / Run on rover", `Run's words on the rover: ${shortRun()}`);
  folded.fire(segments(folded)[1], "click");
  check(shortRun() === "Preview / Preview", `on the simulator: ${shortRun()}`);
  folded.fire(segments(folded)[0], "click");

  const again = loadPage({ stored: { "rover.target": "simulator" } });
  check(again.evalIn("targetSwitch.kind") === "simulator" && again.$("programRunLabel").textContent === "Preview", "remembered");
  check(loadPage({ stored: { "rover.target": "moon" } }).evalIn("targetSwitch.kind") === "rover", "a kind it does not offer is the rover");
  // The switch was the Program tab's, under a key of its own: a choice
  // made there is read once, and the new key wins once it holds one.
  check(loadPage({ stored: { "rover.programTarget": "simulator" } }).evalIn("targetSwitch.kind") === "simulator", "the Program tab's choice carried over");
  check(loadPage({ stored: { "rover.programTarget": "simulator", "rover.target": "rover" } }).evalIn("targetSwitch.kind") === "rover",
    "the page's own key wins over the old one");
  // With only the rover there is nothing to switch.
  const roverOnly = again.evalIn(`(() => {
    const group = document.createElement("div");
    const only = new TargetSwitch({ group, targets: { rover: targets.rover }, storageKey: "rover.target" });
    return { hidden: group.hidden, kind: only.kind, kinds: only.kinds.join() };
  })()`);
  check(roverOnly.hidden && roverOnly.kind === "rover" && roverOnly.kinds === "rover", `the rover alone: ${JSON.stringify(roverOnly)}`);
  check(page.errors.length === 0, `errors ${page.errors}`);
});

test("program: a loop of stops, of stops and explores, or of very short drives cannot flood the rover", async () => {
  // Each STOP costs the rover a change of mode and a write of all four motors
  // over I2C, and nothing in the firmware slows a client down. Unpaced, the
  // first of these sent about 200 a second.
  for (const [what, body, most] of [
    ["stops", "await api.stop();", 6], // 0, 200 ... 1000 ms: the same again after REPEAT_MS
    ["stops and explores", "await api.stop(); await api.explore();", 11], // one each STICK_SEND_MS
    ["0.01 s drives", "await api.drive(MOVE_FORWARD, 50, 0.01);", 22], // a move each STICK_SEND_MS, and its STOP
  ]) {
    const { page, ws } = connected(telemetry({ mode: "MANUAL" }));
    startProgram(page, `for (let i = 0; i < 100000; i++) { await api.tick(); ${body} }`);
    await liveForAsync(page, ws, 1000, { step: 5 });
    check(page.evalIn("runner.state") === "running", `${what}: still running`);
    check(count(ws) > 2 && count(ws) <= most, `${what}: ${count(ws)} frames in 1 s, at most ${most}: ${names(ws)}`);
    const mark = count(ws);
    page.fire(page.$("programStop"), "click");
    await liveForAsync(page, ws, 500, { step: 5 });
    check(page.evalIn("runner.state") === "idle", `${what}: stopped`);
    check(names(ws, mark).every((n) => n === "STOP"), `${what}: after Stop, only a STOP: ${names(ws, mark)}`);
    check(page.errors.length === 0, `${what}: errors ${page.errors}`);
  }
});

// With no link on the rover target the console's line says why Run is off,
// and beside it Connect does the next thing while the view, with its
// connect card, is folded: on a phone it starts folded on this tab, and the
// chip was the only way to connect (the critic's round 2). Not while the
// card is on screen too: two Connect buttons asked which to press (round
// 1). Hidden by its attribute otherwise, so no style follows the link or
// the target.
test("program: the console offers Connect beside the line while the rover target has no link and the view is folded, and only then", () => {
  const page = loadPage();
  standInEditor(page);
  const go = page.$("programConnect");
  check(go.parentNode === page.$("programState").parentNode && /Connect to the rover/.test(go.getAttribute("title") || ""), "beside the state line, titled");
  check(go.hidden, "the Drive tab: the scan's card offers it");
  page.fire(page.$("tabProgram"), "click");
  check(page.$("programTab").dataset.view === "hidden" && !go.hidden && page.$("programState").textContent === "Not connected." && /Connect to the rover/.test(page.$("programState").title), `no link, the view folded: offered, the line says why: ${page.$("programState").textContent}`);
  page.fire(page.$("viewToggle"), "click");
  check(go.hidden, "the view shown: its connect card offers it, not two at once");
  page.fire(page.$("viewToggle"), "click");
  check(!go.hidden, "folded again: back");
  page.fire(go, "click");
  check(page.sockets.length === 1 && page.doc.body.dataset.link === "connecting" && go.hidden, "a press is Connect's, and connecting it goes");
  const ws = page.sockets[0];
  ws.serverOpen();
  check(go.hidden, "up: gone");
  ws.serverDrop();
  check(!go.hidden, "lost: back");
  page.fire(page.$("target").children[1], "click");
  check(go.hidden, "the simulator target needs no link: gone");
  page.fire(page.$("target").children[0], "click");
  check(!go.hidden, "the rover again, still no link: back");
  const shown = cssRules(stylesheet("program.css")).filter((r) => /\.consoleConnect/.test(r.selector) && /display:/.test(r.body));
  check(shown.every((r) => !/data-(link|target)/.test(r.selector)) && shown.some((r) => r.selector === ".consoleConnect[hidden]" && /display:\s*none/.test(r.body)), `by its attribute alone: ${shown.map((r) => r.selector)}`);
  check(page.errors.length === 0, `errors ${page.errors}`);
});

test("program: Run is off with nothing to run, and asks before running several stacks on the rover", async () => {
  const { page, ws } = connected(telemetry({ mode: "MANUAL" }));
  standInEditor(page);
  page.evalIn("__editor.empty = true; __editor.stacks = 0; programTab.refresh();");
  check(page.$("programRun").disabled === true, "Run off on an empty editor");
  check(/^Nothing to run yet/.test(page.$("programRun").title) && page.$("programState").textContent === "No blocks yet.", `says why: ${page.$("programRun").title} / ${page.$("programState").textContent}`);
  // The examples are out of sight in the File menu: Run's title and the
  // hint over the empty editor say so. The advice once on screen, not three
  // times over (the critic's round 2): the state says only that there are
  // no blocks, and the log stays empty, out of sight.
  check(/an example from the File menu\.$/.test(page.$("programRun").title) && /an example in the File menu\.$/.test(page.$("programHint").textContent) && page.$("programHint").hidden === false,
    `says where the examples are: ${page.$("programRun").title} / ${page.$("programHint").textContent}`);
  check(!/File menu/.test(page.$("programState").textContent) && page.$("programLog").children.length === 0, `said once: ${page.$("programState").textContent}`);
  const emptyLog = cssRules(stylesheet("program.css")).find((r) => r.selector === ".programLog:empty");
  check(emptyLog && /display:\s*none/.test(emptyLog.body), "an empty log takes no room");
  page.fire(page.$("programRun"), "click");
  await flush();
  check(page.evalIn("runner.state") === "idle" && count(ws) === 0, "and pressing it anyway runs nothing");

  // Run runs every stack on the canvas, so on the rover it asks first.
  page.evalIn("__editor.empty = false; __editor.stacks = 3; programTab.refresh();");
  const asked = questionsAsked(page);
  check(page.$("programRun").disabled === false, "Run on again");
  page.fire(page.$("programRun"), "click");
  await flush();
  check(asked.length === 1 && openQuestion(page) === asked[0], `asked ${asked}`);
  check(/holds 3 separate stacks/.test(asked[0]) && /loose drives the rover/.test(asked[0]), `asked ${asked[0]}`);
  check(page.evalIn("runner.state") === "idle" && count(ws) === 0, "nothing runs while it asks");
  await answer(page, "cancel");
  check(openQuestion(page) === null && page.evalIn("runner.state") === "idle" && count(ws) === 0, "declined: nothing ran, nothing sent");
  page.fire(page.$("programRun"), "click");
  await flush();
  await answer(page, "yes");
  check(asked.length === 2 && page.evalIn("runner.state") === "running", "confirmed: it runs");
  await liveForAsync(page, ws, 700);
  check(names(ws).join() === "MOVE_FORWARD,MOVE_FORWARD,MOVE_FORWARD,STOP", `sent ${names(ws)}`);

  // One stack is not asked about, and nor is a preview: it only shows.
  page.evalIn("__editor.stacks = 1;");
  page.fire(page.$("programRun"), "click");
  await liveForAsync(page, ws, 700);
  check(asked.length === 2, "one stack: not asked");
  check(page.evalIn("runner.state") === "idle" && /Done on the rover/.test(page.$("programState").textContent), `state ${page.$("programState").textContent}`);
  if (page.evalIn("'simulator' in targets")) {
    page.evalIn("__editor.stacks = 3;");
    page.fire(segments(page)[1], "click");
    page.fire(page.$("programRun"), "click");
    await flush();
    check(asked.length === 2 && page.evalIn("runner.target && runner.target.kind") === "simulator", "a preview of three stacks: not asked");
    page.fire(page.$("programStop"), "click");
    await flush();
  }
  check(page.errors.length === 0, `errors ${page.errors}`);
});

test("program: Run on the rover asks before it drives a pivot unless the rover reports ADVANCED; a preview never asks", async () => {
  const page = loadPage();
  const ws = connectOpen(page);
  standInEditor(page, "await api.drive(PIVOT_RIGHT_FORWARD, 50, 0.5);");
  page.evalIn(`__editor.pivots = ["Pivot right, forward"];`);
  const questions = questionsAsked(page);
  const asked = () => questions.length;
  const question = () => questions[questions.length - 1];
  const run = async (how) => {
    page.fire(page.$("programRun"), "click");
    await flush();
    if (openQuestion(page) !== null) await answer(page, how);
  };

  // NORMAL: asked, naming the pivot and the scheme; declined, nothing runs.
  ws.serverMsg(telemetry({ mode: "MANUAL", scheme: "NORMAL" }));
  await run("cancel");
  check(asked() === 1, `asked ${asked()} times`);
  check(/drives a pivot \(Pivot right, forward\)/.test(question()) && /on the bench/.test(question()) && /NORMAL scheme/.test(question()), `asked ${question()}`);
  check(page.evalIn("runner.state") === "idle" && count(ws) === 0, `declined: nothing ran, sent ${names(ws)}`);

  // Accepted: it drives the pivot, re-sent like any held move.
  await run("yes");
  await liveForAsync(page, ws, 700, { fields: { mode: "MANUAL", scheme: "NORMAL" } });
  check(asked() === 2 && names(ws).join() === "PIVOT_RIGHT_FORWARD,PIVOT_RIGHT_FORWARD,PIVOT_RIGHT_FORWARD,STOP", `sent ${names(ws)}`);

  // A scheme the rover has not reported: asked too, and it says so.
  ws.serverMsg(telemetry({ mode: "MANUAL", scheme: undefined }));
  await run("cancel");
  check(asked() === 3 && /has not said which control scheme/.test(question()), `unknown: ${question()}`);
  check(page.evalIn("runner.state") === "idle", "declined");

  // ADVANCED: the operator has chosen the pivots already.
  ws.serverMsg(telemetry({ mode: "MANUAL", scheme: "ADVANCED" }));
  let mark = count(ws);
  await run();
  check(asked() === 3 && page.evalIn("runner.state") === "running", "ADVANCED: not asked, and it runs");
  await liveForAsync(page, ws, 700, { fields: { mode: "MANUAL", scheme: "ADVANCED" } });
  check(names(ws, mark).join() === "PIVOT_RIGHT_FORWARD,PIVOT_RIGHT_FORWARD,PIVOT_RIGHT_FORWARD,STOP", `sent ${names(ws, mark)}`);

  // NORMAL, but no pivot in the program: nothing to ask.
  ws.serverMsg(telemetry({ mode: "MANUAL", scheme: "NORMAL" }));
  page.evalIn("__editor.pivots = []; __editor.compile = () => async (api) => { await api.drive(MOVE_FORWARD, 50, 0.5); };");
  await run();
  check(asked() === 3 && page.evalIn("runner.state") === "running", "no pivot: not asked");
  await liveForAsync(page, ws, 700, { fields: { mode: "MANUAL", scheme: "NORMAL" } });

  // A preview sends nothing, so it never asks.
  if (page.evalIn("'simulator' in targets")) {
    page.evalIn("__editor.pivots = ['Pivot right, forward'];");
    page.fire(segments(page)[1], "click");
    mark = count(ws);
    await run();
    check(asked() === 3 && page.evalIn("runner.target && runner.target.kind") === "simulator", "a preview: not asked");
    page.fire(page.$("programStop"), "click");
    await flush();
    check(count(ws) === mark, `the preview sent ${names(ws, mark)}`);
  }
  check(page.errors.length === 0, `errors ${page.errors}`);
});

test("program: Run asks in the page, so a run the operator confirmed drives on", async () => {
  // Desktop Chrome gives window.confirm() the focus and sends the window a
  // blur once it has closed, after the run has started: the blur stood the
  // run down at once, a twitch of the wheels and "lost focus". The stand-in
  // behaves so, and must never be asked.
  const { page, ws } = connected(telemetry({ mode: "MANUAL", scheme: "NORMAL" }));
  standInEditor(page, "await api.drive(PIVOT_RIGHT_FORWARD, 50, 0.5);");
  page.evalIn(`
    __editor.stacks = 2; __editor.pivots = ["Pivot right, forward"];
    globalThis.__confirmed = 0;
    globalThis.confirm = () => {
      __confirmed++;
      Promise.resolve().then(() => window.dispatchEvent({ type: "blur", bubbles: false }));
      return true;
    };
  `);
  const asked = questionsAsked(page);
  // The dialog is shared, and the last question relabelled it: Run's must
  // name its own action, the one that drives the real rover.
  page.fire(exampleItems(page)[0], "click");
  await flush();
  await answer(page, "cancel");
  page.fire(page.$("programRun"), "click");
  await flush();
  check(page.$("askYes").textContent === "Run on rover" && page.$("ask").getAttribute("aria-label") === "Run on the rover?",
    `Run asks under ${page.$("ask").getAttribute("aria-label")}, with ${page.$("askYes").textContent}`);
  await answer(page, "yes"); // the stacks
  await answer(page, "yes"); // the pivot
  check(asked.length === 3 && page.evalIn("__confirmed") === 0, `asked ${asked.length} in the page, ${page.evalIn("__confirmed")} with confirm()`);
  check(page.evalIn("runner.state") === "running", `running: ${page.$("programState").textContent}`);
  await liveForAsync(page, ws, 700, { fields: { mode: "MANUAL", scheme: "NORMAL" } });
  check(names(ws).join() === "PIVOT_RIGHT_FORWARD,PIVOT_RIGHT_FORWARD,PIVOT_RIGHT_FORWARD,STOP", `sent ${names(ws)}`);
  check(page.$("programState").textContent === "Done on the rover.", `state ${page.$("programState").textContent}`);
  check(page.errors.length === 0, `errors ${page.errors}`);
});

test("program: Escape is no answer, one question at a time, and a link gone meanwhile runs nothing", async () => {
  const { page, ws } = connected(telemetry({ mode: "MANUAL" }));
  standInEditor(page);
  page.evalIn("__editor.stacks = 2;");
  const asked = questionsAsked(page);
  const runIt = async () => {
    page.fire(page.$("programRun"), "click");
    await flush();
  };

  // A yes, then Escape: the dialog keeps the last answer it was closed
  // with, and Escape closes it with none, so the yes must not carry over.
  await runIt();
  await answer(page, "yes");
  await liveForAsync(page, ws, 700);
  check(page.$("programState").textContent === "Done on the rover.", `the yes ran: ${page.$("programState").textContent}`);
  const mark = count(ws);
  await runIt();
  await answer(page, "escape");
  await liveForAsync(page, ws, 500);
  check(asked.length === 2 && page.evalIn("runner.state") === "idle" && count(ws) === mark, `Escape ran it: sent ${names(ws, mark)}`);

  // While a question waits, Run asks nothing more and runs nothing.
  await runIt();
  await runIt();
  check(asked.length === 3 && page.evalIn("runner.state") === "idle", `asked ${asked.length} times`);

  // The link goes while it asks: a yes then runs nothing, and says why.
  ws.serverDrop();
  await answer(page, "yes");
  check(page.evalIn("runner.state") === "idle" && count(ws) === mark, `ran on a link that went: ${names(ws, mark)}`);
  check(logLines(page).at(-1) === "Not run: Connect to the rover to run a program on it.", `log ${logLines(page).at(-1)}`);
  check(page.errors.length === 0, `errors ${page.errors}`);
});

test("program: the File menu holds the examples, Import, Export and Clear, and opens and closes as a menu does", () => {
  // On its tab: hidden, nothing can take the focus or scroll.
  const page = loadPage({ stored: { "rover.tab": "tabProgram" } });
  const button = page.$("programMenu");
  const menu = page.$("programMenuList");
  check(button.getAttribute("aria-haspopup") === "menu" && button.getAttribute("aria-controls") === "programMenuList", "a menu button for its menu");
  check(menu.getAttribute("role") === "menu" && menu.hidden && button.getAttribute("aria-expanded") === "false", "closed at first");
  check(button.disabled === true && /could not load/.test(button.title), `off without an editor, saying why: ${button.title}`);
  const items = () => menu.querySelectorAll('[role="menuitem"]');
  const words = (b) => all(b).map((n) => n.textContent).join(" ").trim();
  check(items().map(words).join() === "Square,Strafe box,Patrol,Mecanum tour,Import…,Export,Clear", `items ${items().map(words)}`);
  check(menu.querySelectorAll('[role="separator"]').length === 2, "the examples, then the file, then Clear apart");

  standInEditor(page);
  const focused = () => words(page.doc.activeElement) || page.doc.activeElement.id;
  const key = (target, k) => page.fire(target, "keydown", { key: k });
  check(button.disabled === false, "on with an editor");
  page.fire(button, "click");
  check(!menu.hidden && button.getAttribute("aria-expanded") === "true" && focused() === "Square", `opened on the first item: ${focused()}`);
  check(menu.scrolledIntoView === 1 && menu.scrollOptions && menu.scrollOptions.block === "nearest",
    "scrolled into view as it opened, clear of the top stuck over a phone's page, and no further: the button stays in sight");
  check(key(page.doc.activeElement, "ArrowDown").defaultPrevented, "Down moves in the menu, not the page");
  check(focused() === "Strafe box", `Down: ${focused()}`);
  key(page.doc.activeElement, "End");
  check(focused() === "Clear", `End: ${focused()}`);
  key(page.doc.activeElement, "ArrowDown");
  check(focused() === "Square", `Down wraps: ${focused()}`);
  key(page.doc.activeElement, "ArrowUp");
  check(focused() === "Clear", `Up wraps: ${focused()}`);
  key(page.doc.activeElement, "Home");
  check(focused() === "Square", `Home: ${focused()}`);
  key(page.doc.activeElement, "Escape");
  check(menu.hidden && button.getAttribute("aria-expanded") === "false" && page.doc.activeElement === button, "Escape closes it, back on the button");

  // An item that cannot act stays, disabled, and the keys pass it by: an
  // empty editor has nothing to clear and nothing to export (Export was
  // on there while Clear was off: the review's tablets 17).
  page.evalIn("__editor.empty = true; programTab.refresh();");
  check(page.$("programClear").disabled && !page.$("programClear").hidden, "nothing to clear: Clear disabled, still there");
  check(page.$("programExport").disabled && !page.$("programExport").hidden, "nothing to export: Export disabled, still there");
  check(key(button, "ArrowUp").defaultPrevented, "Up on the button opens the menu, and scrolls nothing");
  check(!menu.hidden && focused() === "Import…", `Up on the button opens on the last that can act: ${focused()}`);
  key(page.doc.activeElement, "Tab");
  check(menu.hidden && button.getAttribute("aria-expanded") === "false", "Tab closes it");
  page.evalIn("__editor.empty = false; programTab.refresh();");

  // A press inside leaves it open; outside, it closes, and the focus goes
  // where the press put it.
  key(button, "ArrowDown");
  page.fire(menu, "pointerdown");
  check(!menu.hidden, "a press inside: still open");
  page.fire(page.$("programRun"), "pointerdown");
  check(menu.hidden && page.doc.activeElement !== button, "a press outside closes it");
  // So does a press on the editor, which Blockly keeps from going any
  // further: the editor is most of the tab.
  key(button, "ArrowDown");
  page.$("programWorkspace").addEventListener("pointerdown", (event) => event.stopPropagation());
  page.fire(page.$("programWorkspace"), "pointerdown");
  check(menu.hidden, "a press Blockly stops still closes it");
  // A press on its button sends pointerdown before click, as a browser
  // does: the button, not the press, closes it.
  const press = (target) => {
    page.fire(target, "pointerdown");
    page.fire(target, "click");
  };
  press(button);
  check(!menu.hidden, "its button opens it");
  press(button);
  check(menu.hidden, "its button closes it again");

  // An item does its action, and closes the menu.
  page.fire(button, "click");
  page.fire(page.$("programExport"), "pointerdown");
  check(!menu.hidden, "a press on an item is inside");
  page.evalIn(`globalThis.__exported = [];
    globalThis.Blob = class { constructor(parts) { __exported.push(parts.join("")); } };
    globalThis.URL = { createObjectURL: () => "blob:program", revokeObjectURL() {} };`);
  // A mouse lands on the item's word, not the item.
  page.fire(page.$("programExport").children.find((c) => c.tagName === "SPAN"), "click");
  check(page.evalIn("__exported.join()") === "{}", `Export saved the program: ${page.evalIn("__exported.join()")}`);
  check(menu.hidden && page.doc.activeElement === button, "and the menu closed, back on its button");

  // One popup at a time, however it was opened: the simulator's settings
  // close as the menu opens, and the menu as they open.
  const [more] = page.$("simSlot").querySelectorAll('[aria-controls="simMore"]');
  page.fire(more, "click");
  check(!page.$("simMore").hidden, "the simulator's settings open");
  key(button, "ArrowDown");
  check(!menu.hidden && page.$("simMore").hidden && more.getAttribute("aria-expanded") === "false", "the menu opened, and closed them");
  page.fire(more, "click");
  check(menu.hidden && button.getAttribute("aria-expanded") === "false" && !page.$("simMore").hidden, "they opened, and closed the menu");
  check(page.errors.length === 0, `errors ${page.errors}`);
});

test("program: an item that asks leaves the focus on the File button once answered, and a disabled item says why", async () => {
  // The question's <dialog> gives the focus back to whatever had it when it
  // opened. The menu must be closed by then, the focus on its button: an
  // item hidden meanwhile cannot take it, and it fell to the page.
  const { page, ws } = connected(telemetry({ mode: "MANUAL" }), { stored: { "rover.tab": "tabProgram" } });
  standInEditor(page);
  const button = page.$("programMenu");
  // Enter on an item clicks the item; a mouse clicks the word on it.
  const word = (item) => item.children.find((c) => c.tagName === "SPAN");
  for (const [name, item, how, at] of [
    ["an example", () => exampleItems(page)[1], "escape", (b) => b],
    ["Clear", () => page.$("programClear"), "cancel", word],
    ["Clear", () => page.$("programClear"), "yes", (b) => b],
  ]) {
    page.fire(button, "keydown", { key: "ArrowDown" });
    item().focus();
    page.fire(at(item()), "click");
    await flush();
    check(page.$("ask").open && page.doc.activeElement === page.$("askNo"), `${name}: asked, Cancel focused`);
    await answer(page, how);
    check(page.$("programMenuList").hidden && page.doc.activeElement === button, `${name}, ${how}: the focus on ${page.doc.activeElement.id || page.doc.activeElement.tagName}`);
  }

  // Mid-run, the items that would change the editor say so; an empty
  // editor has nothing to clear.
  const titles = () => [...exampleItems(page), page.$("programImport"), page.$("programClear")].map((b) => `${b.disabled ? "off" : "on"}:${b.title}`);
  check(titles().join("|") === "on:Load this example into the editor|".repeat(4) + "on:Open a program saved with Export|on:Remove every block", `idle: ${titles()}`);
  startProgram(page, "await api.wait(5);");
  await flush();
  check(titles().every((t) => t === "off:Stop the program first"), `mid-run: ${titles()}`);
  check(page.$("programExport").disabled === false && page.$("programExport").title === "Save the program as rover-program.json", `Export still works: ${page.$("programExport").title}`);
  page.evalIn("runner.abort('done')");
  await liveForAsync(page, ws, 200);
  page.evalIn("__editor.empty = true; programTab.refresh();");
  check(titles().at(-1) === "off:Nothing to clear", `empty: ${titles().at(-1)}`);
  check(page.$("programExport").disabled === true && /^Nothing to export/.test(page.$("programExport").title), `empty, Export off and says why: ${page.$("programExport").title}`);
  page.evalIn("__editor.empty = false; programTab.refresh();");
  check(page.$("programExport").disabled === false && /^Save the program/.test(page.$("programExport").title), `blocks again: Export on: ${page.$("programExport").title}`);
  check(page.errors.length === 0, `errors ${page.errors}`);
});

test("program: Blockly's own questions are asked in the page's dialog, Cancel focused", async () => {
  // Blockly asks before deleting every block, or a variable still in use,
  // in a dialog of its own with OK focused: a reflexive Enter deleted the
  // program. This page has no Blockly, so a stand-in takes its place, with
  // the one call app.js makes of it and an editor that starts.
  const page = loadPage();
  const asked = questionsAsked(page);
  page.evalIn(`
    globalThis.__confirm = null;
    globalThis.Blockly = { dialog: { setConfirm(fn) { __confirm = fn; } } };
    globalThis.javascript = { javascriptGenerator: {} };
    BlockEditor = function () {
      return { empty: true, stacks: 0, pivots: [], onChange() { return () => {}; }, setReadOnly() {}, setScheme() {}, resize() {} };
    };
    startBlockEditor();
    globalThis.__answers = [];
    __confirm("Delete all 8 blocks?", (yes) => __answers.push(yes));
  `);
  await flush();
  check(asked.join() === "Delete all 8 blocks?" && page.doc.activeElement === page.$("askNo"), `asked ${asked}, focus ${page.doc.activeElement.id}`);
  check(page.$("askYes").textContent === "Delete" && page.$("ask").getAttribute("aria-label") === "Delete blocks?", "named for what it does");
  await answer(page, "escape");
  page.evalIn(`__confirm("Delete 2 uses of the 'x' variable?", (yes) => __answers.push(yes));`);
  await flush();
  await answer(page, "yes");
  check(page.evalIn("__answers.join()") === "false,true", `answers ${page.evalIn("__answers.join()")}`);
  check(page.errors.length === 0, `errors ${page.errors}`);
});

// The top is two cells on every layout and beside both tabs (F8, the
// owner's ask: "squeeze all this in 2 cells at the top"): what the controls
// drive and its state (the target first, Autonomous, then the link chip
// with the rover's alerts), then how they drive it (the tabs, the scheme,
// and Stop beside the gear at its far end). One row where the top is 900
// px wide, the first cell as wide as it needs and the second the rest, a
// cell a row below. Autonomous and Stop are in different cells, so a hand
// reaching for Stop cannot start the rover exploring, and nothing of the
// link sits beside Stop: Disconnect there left an exploring rover
// exploring, and the panel no link to stop it. Beside the Program tab the rail is a column,
// the scan and the readouts, one width from the viewport alone; the Drive
// tab is split for the simulator's view (F3i, the next test). Layout itself
// is measured in a browser; this holds the shape.
test("the top: two cells, one row from 900 px, Stop beside the gear and Autonomous in the other cell, beside both tabs", () => {
  const css = panelCss();
  const rules = cssRules(css);
  const root = rules.filter((r) => r.selector === ":root").map((r) => r.body).join("");
  // The panes: the view and the hands. On a wide screen the Drive tab's
  // column is as wide as its two sticks need, from the viewport alone (the
  // sticks' budget), and nothing narrows it per tab or per state.
  const wide = mediaRules(WIDE) || [];
  const wideRoot = wide.filter((r) => r.selector === ":root").map((r) => r.body).join("");
  check(/--drive:\s*calc\(2 \* var\(--stick\) \+ 56px\);/.test(wideRoot), `the Drive tab's column from the sticks alone: ${wideRoot}`);
  const setsDrive = rules.filter((r) => r.selector !== ":root" && /--drive\s*:/.test(r.body));
  check(setsDrive.length === 0, `nothing narrows it per tab: ${setsDrive.map((r) => r.selector)}`);
  check(!rules.some((r) => /--rail\s*:/.test(r.body)) && !/var\(--rail\)/.test(css), "no rail left");
  // A grid set on the shell itself, per tab: the Program tab's alone (the
  // view shown, and hidden), the Drive tab's the shell's own.
  const perTab = wide.filter((r) => /^\.shell:has\(> #(programTab|driveTab)[^ ]*\)$/.test(r.selector) && /grid-template/.test(r.body));
  check(perTab.length === 2 && perTab.every((r) => /^\.shell:has\(> #programTab/.test(r.selector)), `a grid of its own beside the Program tab alone: ${perTab.map((r) => r.selector)}`);
  const body = (selector, from = wide) => (from.find((r) => r.selector === selector) || {}).body || "";
  const areas = (text) => ((text.match(/grid-template-areas:([^;]*);/) || ["", ""])[1].match(/"[^"]*"/g) || []).map((a) => a.replace(/\s+/g, " "));
  check(/grid-template-columns:\s*minmax\(0, 1fr\) var\(--drive\);/.test(body(".shell")), `the view, then the hands: ${body(".shell")}`);
  check(areas(body(".shell")).join(" ") === '"head head" "view main"', `the top across both, and no bar across the foot: ${areas(body(".shell"))}`);
  // The top spans the page beside either tab, so a tab switch moves none of
  // its cells: the Program tab changes only where the panes meet.
  const programShown = body(".shell:has(> #programTab:not([hidden]))");
  check(/grid-template-columns:\s*var\(--view-w\) minmax\(0, 1fr\);/.test(programShown) && /--view-w:\s*clamp\(360px, 0\.5 \* /.test(programShown) && areas(programShown)[0] === '"head head"', `beside the Program tab, the view's column about half, the top across both: ${programShown}`);
  const programHidden = body('.shell:has(> #programTab[data-view="hidden"]:not([hidden]))');
  check(areas(programHidden).join(" ") === '"head" "main"' && /grid-template-columns:\s*minmax\(0, 1fr\);/.test(programHidden), `the view hidden, the editor the page's width: ${programHidden}`);
  const base = cssRules(outside(css, "@media"));
  const baseBody = (selector) => base.filter((r) => r.selector === selector).map((r) => r.body).join("");
  check(areas(baseBody(".shell")).join(" ") === '"head" "view" "main"', `a phone: the top, the view, then the hands, and no foot bar: ${areas(baseBody(".shell"))}`);

  // The top: stuck to the screen's top when the page scrolls, over
  // Blockly's widgets, and the container its cells are laid out by.
  const bar = baseBody(".bar");
  check(/grid-area:\s*head;/.test(bar) && /position:\s*sticky;/.test(bar) && /top:\s*0;/.test(bar) && /container:\s*bar \/ inline-size;/.test(bar), `the top stuck, and a container: ${bar}`);
  check(Number((bar.match(/z-index:\s*(\d+);/) || [])[1]) > 100000, `over Blockly's widgets (100000): ${bar}`);
  check(/grid-template-columns:\s*minmax\(0, 1fr\);/.test(baseBody(".cells")), `a cell a row below 900 px: ${baseBody(".cells")}`);
  // One row from 900 px: the first cell as wide as what it holds, never
  // squeezed below it, and the second the rest, Stop's at its far end, no
  // page ground between them. Halves left dead ground inside both cells
  // (the critic's round 2: 140 px in the first at 1280, 240 in the second);
  // each cell as wide as it held left up to 580 px of bare ground between
  // them (round 3). Nothing before the chip changes width with the state,
  // so Autonomous never moves: a badge coming, or a switch to the
  // simulator, moved it 58 px (the critic's round 2), when it came after
  // the chip.
  const oneRow = blockRules(outside(css, "@media"), "@container bar (min-width: 900px) {") || [];
  const cellsRow = oneRow.find((r) => r.selector === ".cells");
  check(cellsRow && /display:\s*flex;/.test(cellsRow.body) && !/justify-content/.test(cellsRow.body) && /column-gap:\s*var\(--s-2\);/.test(cellsRow.body), `one row from 900 px, the cells 8 px apart: ${cellsRow && cellsRow.body}`);
  check(oneRow.some((r) => r.selector === ".hcell.drives" && /flex:\s*none;/.test(r.body)), "the first cell as wide as what it holds, never squeezed");
  check(oneRow.some((r) => r.selector === ".hcell.hands" && /flex:\s*1 1 0;/.test(r.body)), "the second cell the rest of the row");
  check(!oneRow.some((r) => r.selector === ".hcell"), "no rule for both cells alike");
  // Where the two would meet, the first clips what it cannot hold rather
  // than spill over Stop's; the words step down first (below), so it never
  // has to. Not the cells themselves: the gear's popover hangs from the
  // second.
  check(baseBody(".drives").includes("overflow-x: clip;") && !/overflow/.test(baseBody(".hcell")), "the first cell clips what it cannot hold, rather than spill over Stop's");
  // The chip's word slot is as wide whatever it says: the word and a sizer
  // for each word it can say (Link adds them) in one grid cell, the sizers
  // out of sight.
  const chipWord = baseBody(".chipWord");
  check(/display:\s*inline-grid;/.test(chipWord) && /grid-area:\s*1 \/ 1;/.test(baseBody(".chipWord > *")) && /visibility:\s*hidden;/.test(baseBody(".chipSizer")), `the chip's words in one cell, sized by the longest: ${chipWord}`);
  // Words only where all of them fit, measured (fitSteps, app.js): each
  // cell tries its steps from the most it says and keeps the first whose
  // content fits, so the words follow the fonts the device has and the
  // cell's width, and nothing else. The first cell: the address on the chip
  // (a screen 1280 px wide), every word, the alerts' glyphs for their
  // words, Sim and Auto and the rover's glyph for its name, every control
  // closer, 12 px words, the chip's lamp. The second: every word, the
  // segments closer, and closer still, both at 13 px (a 375 px phone),
  // 12 px words, and Adv only where nothing else fits. What comes and goes
  // in the chip (the rover's name, both alerts) is measured shown
  // (data-fitting), so the step never depends on the state; where the
  // cells share a row, either cell running over counts, and the row.
  const appJs = fs.readFileSync(path.join(PANEL_ROOT, "js", "app.js"), "utf8");
  check(/fitSteps\(secondCell, \["words", "tight", "snug", "small", "short"\], runsOver\)/.test(appJs) && /fitSteps\(firstCell, \[\.\.\.\(wideTop && wideTop\.matches \? \["host"\] : \[\]\), "words", "glyphs", "short", "snug", "small", "lamp"\], runsOver\)/.test(appJs), "each cell's steps, from the most it says");
  check(/matchMedia\("\(min-width: 1280px\)"\)/.test(appJs) && /\[firstCell, secondCell, cellsRow\]\.some\(\(box\) => box\.scrollWidth > box\.clientWidth\)/.test(appJs), "the address from 1280 px, and either cell's overflow or the row's counts");
  check(/cellsRow\.dataset\.fitting = "yes";[\s\S]*fitSteps\(firstCell[\s\S]*delete cellsRow\.dataset\.fitting;/.test(appJs), "measured with the chip's coming and going parts shown");
  const fitting = rules.find((r) => r.selector === ".cells[data-fitting] :is(.chipFor, .chipAlert)[hidden]");
  check(fitting && /display:\s*inline-flex;/.test(fitting.body) && /visibility:\s*hidden;/.test(fitting.body), `shown, out of sight, while measured: ${fitting && fitting.body}`);
  // The address is the chip's data-host (Link), which only connecting
  // somewhere else changes; the state never refits the cells.
  check(/new ResizeObserver\(fitTheTop\)/.test(appJs) && /new MutationObserver\(fitTheTop\)\.observe\(byId\("linkChip"\), \{ attributes: true, attributeFilter: \["data-host"\] \}\)/.test(appJs), "measured again as the cells' width or the address changes, never the state");
  const page0 = loadPage();
  check(page0.doc.documentElement.querySelector(".hcell.drives").dataset.fit === "words" && page0.doc.documentElement.querySelector(".hcell.hands").dataset.fit === "words", "a page that cannot measure keeps every word");
  // A box that fits at some steps and not others, and one that fits at none.
  const box = (fits) => ({ dataset: {}, clientWidth: 100, get scrollWidth() { return fits.includes(this.dataset.fit) ? 100 : 101; } });
  const some = box(["short", "glyphs"]);
  const none = box([]);
  const fit = { first: fitSteps(some, ["host", "words", "short", "glyphs", "lamp"]), none: fitSteps(none, ["host", "words", "lamp"]) };
  check(fit.first === "short" && some.dataset.fit === "short" && fit.none === "lamp" && none.dataset.fit === "lamp", `the first step that fits, or the last: ${JSON.stringify(fit)}`);
  // A row whose parts shrink to fit says it does not fit by its parts.
  const parts = { dataset: {}, clientWidth: 100, scrollWidth: 100 };
  check(fitSteps(parts, ["words", "bare"], (b) => b.dataset.fit === "words") === "bare", "its own test of fitting");
  const wordRules = cssRules(css.replace(/@(media|container)[^{]*\{/g, "")).filter((r) => /\.(chipWord|chipForWord|chipSay|alertWord|segShort|segWord|autoShort|autoWord|roverGlyph)\b/.test(r.selector) && /display\s*:/.test(r.body));
  const byFit = (pattern) => wordRules.filter((r) => pattern.test(r.selector) && /data-fit/.test(r.selector));
  // The address (the chip's --host) drawn after the link's word, and in
  // each sizer, so the word's slot is as wide with it whatever it says and
  // the address 8 px after the word: only at the first cell's first step.
  const hosts = cssRules(css.replace(/@(media|container)[^{]*\{/g, "")).filter((r) => /content:\s*var\(--host/.test(r.body));
  check(hosts.length === 1 && hosts[0].selector === '.drives[data-fit="host"] :is(.chipSay, .chipSizer)::after' && /margin-left:\s*var\(--s-2\);/.test(hosts[0].body) && /color:\s*var\(--dim\);/.test(hosts[0].body),
    `the address only at the first cell's first step, after the word and in the sizers: ${hosts.map((r) => r.selector)}`);
  // No slot of its own for it: one left a gap after a short word
  // ("Connected", then the room "Not connected" needs: the critic's round 1).
  check(page0.doc.getElementById("linkHost") === null && !cssRules(css).some((r) => /\.chipHost\b/.test(r.selector)), "no slot of its own for the address");
  // The link's words are one set at every width, never short ones of their
  // own: "Connect" and "Linking…" on a phone said other things than the
  // words elsewhere (the critics' round 3).
  check(!rules.some((r) => /\.chip(Short|Long)\b/.test(r.selector)) && page0.evalIn("Link.SHORT") === undefined && page0.doc.getElementById("linkShort") === null, "no short words of the link's own");
  check(byFit(/\.alertWord/).some((r) => /\[data-fit="glyphs"\]/.test(r.selector) && /\[data-fit="lamp"\]/.test(r.selector) && !/\[data-fit="words"\]/.test(r.selector) && /display:\s*none/.test(r.body)), "the alerts' words go from the glyphs step, their glyphs stay");
  check(byFit(/\.autoShort/).some((r) => /\[data-fit="short"\]/.test(r.selector) && /\.target \.segShort/.test(r.selector) && /display:\s*inline/.test(r.body)), "Sim and Auto from the short step");
  check(byFit(/\.chipForWord/).some((r) => /\[data-fit="short"\]/.test(r.selector) && /display:\s*none/.test(r.body)) && byFit(/\.roverGlyph/).some((r) => /\[data-fit="short"\]/.test(r.selector) && /display:\s*block/.test(r.body)), "Rover: gives way to the rover's glyph at the short step");
  check(byFit(/\.chipWord/).length === 1 && /^\.drives\[data-fit="lamp"\] \.chipWord$/.test(byFit(/\.chipWord/)[0].selector), "the chip's lamp and caret alone only at the last step");
  const byElse = wordRules.filter((r) => !/data-fit/.test(r.selector) && !/display:\s*none/.test(r.body) && !/^\.chipWord$/.test(r.selector));
  check(byElse.length === 0, `no viewport or container rule shows a word the cell may not hold: ${byElse.map((r) => r.selector)}`);
  // A cell is one line of controls, 40 px tall whatever they say: nothing
  // in it wraps, and no layout changes its height.
  check(/--cell-h:\s*40px;/.test(root) && /--ctl:\s*32px;/.test(root) && /--seg:\s*28px;/.test(root) && /--t-ctl:\s*13px;/.test(root), "40 px cells, 32 px controls, 28 px segments, 13 px words");
  const cell = baseBody(".hcell");
  check(/height:\s*var\(--cell-h\);/.test(cell) && /white-space:\s*nowrap;/.test(cell) && /display:\s*flex;/.test(cell) && !/flex-wrap:\s*wrap/.test(cell), `one line, 40 px: ${cell}`);
  const cellItself = (selector) => selector.split(",").some((part) => /^\.(hcell|cells)(\.[\w-]+)*$/.test(part.trim()));
  const sized = rules.filter((r) => cellItself(r.selector) && /(^|[\s;{])(min-|max-)?height\s*:/.test(r.body));
  check(sized.length === 1 && sized[0].selector === ".hcell", `nothing but the base rule sets a cell's height: ${sized.map((r) => r.selector)}`);
  check(/height:\s*var\(--ctl\);/.test(baseBody(".hcell button")), `its controls 32 px: ${baseBody(".hcell button")}`);

  // The page: two cells, in order, and none of what they replaced.
  const page = loadPage();
  const html = page.doc.documentElement;
  const cells = html.querySelector(".cells");
  const kids = (el) => el.children.filter((n) => !(n.tagName === "OUTPUT" && n.hidden)).map((n) => n.id || (n.getAttribute("class") || "").split(" ")[0]);
  check(cells && cells.children.length === 2, `two cells: ${cells && cells.children.length}`);
  const [drives, hands] = cells ? cells.children : [];
  check(drives && kids(drives).join() === "target,auto,linkChip,linkPanel", `the first cell: the target first, Autonomous, then the link chip and its popover: ${drives && kids(drives)}`);
  check(hands && kids(hands).join() === "tabs,scheme,stop,menuHolder", `the second: the tabs, the scheme, Stop and the gear: ${hands && kids(hands)}`);
  for (const gone of [".wordmark", ".masthead", ".status", ".pill", ".link", ".actions", ".switches", ".segIcon", ".actionWord"]) {
    check(html.querySelectorAll(gone).length === 0, `no ${gone} left`);
  }
  check(!rules.some((r) => /\.(wordmark|masthead|pill|actions|switches|segIcon|actionWord)\b/.test(r.selector)), "and no rule for any of them");

  // Stop: red, its square alone, named and titled with its key, as wide as
  // a key and the cell's height; nothing of the link beside it.
  const stop = page.$("stop");
  check(stop.getAttribute("aria-label") === "Stop" && /\(Space\)/.test(stop.getAttribute("title") || "") && stop.children.length === 1 && stop.children[0].tagName === "SVG", "Stop: an icon, named Stop, titled with its key");
  const stopCss = baseBody("#stop");
  check(/width:\s*40px;/.test(stopCss) && /background:\s*var\(--stop\);/.test(stopCss) && /(^|[^-])color:\s*var\(--on-stop\);/.test(stopCss), `Stop 40 x 32, red: ${stopCss}`);
  check(!all(hands).some((n) => ["connect", "host", "linkChip", "auto"].includes(n.id)), "neither the link nor Autonomous in Stop's cell");
  check(/\(T\)/.test(page.$("auto").getAttribute("title") || "") && page.$("auto").getAttribute("aria-label") === "Autonomous", "Autonomous named, and titled with its key");

  // Sleek segments, words only: a pill track 2 px inset, segments 28 px
  // tall in 13 px words, the chosen one inverted; the tabs words over an
  // underline. Each titled with what it does.
  const track = baseBody(".segmented");
  check(/padding:\s*2px;/.test(track) && /border-radius:\s*var\(--r-full\);/.test(track) && /background:\s*var\(--raised\);/.test(track), `the track: ${track}`);
  const seg = base.find((r) => r.selector.split(",").map((x) => x.trim()).includes(".segmented button"));
  check(seg && /height:\s*var\(--seg\);/.test(seg.body) && /font-size:\s*var\(--t-ctl\);/.test(seg.body) && /border-radius:\s*var\(--r-full\);/.test(seg.body), `a segment: ${seg && seg.body}`);
  const segs = [page.$("tabDrive"), page.$("tabProgram"), ...page.$("schemeChoice").children, ...page.$("target").children];
  check(segs.length === 6, `six segments: ${segs.length}`);
  for (const one of segs) {
    const words = all(one).filter((n) => n !== one && n.tagName !== "#TEXT");
    check(!words.some((n) => n.tagName === "SVG") && (one.getAttribute("title") || one.title || "").length > 0, `${one.id || one.dataset.scheme || one.dataset.target}: words alone, and a hint`);
  }
  check(segs.slice(2).every((one) => all(one).some((n) => n.getAttribute && n.getAttribute("class") === "segWord")), "each switch's segment its word");

  // The link's address, Connect and note in the chip's popover; the whole
  // note on hover too.
  const panel = page.$("linkPanel");
  check(["host", "connect", "note"].every((id) => all(panel).includes(page.$(id))), "the address, Connect and the note in the chip's popover");
  check(page.$("linkChip").getAttribute("aria-controls") === "linkPanel", "the chip opens it");
  // Open, its Connect is the one: the card's over the scan gives way,
  // keeping its place.
  // The Program tab console's Connect too (the critic's round 2).
  const cardAway = rules.find((r) => r.selector === ".shell:has(#linkPanel:not([hidden])) :is(.connectCard, .consoleConnect)");
  check(cardAway && /visibility:\s*hidden;/.test(cardAway.body) && !/display/.test(cardAway.body), `the connect card and the console's Connect give way to the popover: ${cardAway && cardAway.body}`);
  check((page.$("programConnect").getAttribute("class") || "").split(/\s+/).includes("consoleConnect"), "the console's Connect is the one that gives way");
  page.$("host").value = "";
  page.fire(page.$("connect"), "click");
  check(page.$("note").title === page.$("note").textContent && page.$("note").textContent !== "", `the whole note on hover: ${page.$("note").title}`);

  // Nothing makes the cells taller or shorter on a short screen.
  check(mediaRules(WIDE_SHORT) === null, "no short layout of its own: the sticks' budget takes the height");
  const baseKeys = new Set(cssRules(outside(css, "@media")).map((r) => `${r.selector}{${r.body}`));
  const inMedia = rules.filter((r) => !baseKeys.has(`${r.selector}{${r.body}`));
  check(!inMedia.some((r) => /\.hcell|\.cells|#stop|#auto/.test(r.selector) && /(grid-template-rows|min-height|(^|[\s;{])height)\s*:/.test(r.body)), "no layout makes the cells taller or shorter");
  check(mediaRules(WIDE_LAMPS) === null, "no layout of its own for the pills' lamps");
  // The scan fills its place beside both tabs: no card sized to its drawing.
  check(!rules.some((r) => /\.scan\b/.test(r.selector) && /aspect-ratio/.test(r.body)), "the scan's card is the column's");
  check(page.errors.length === 0, `errors ${page.errors}`);
});

// Where the cells stack (under 900 px, and the middle column of a phone on
// its side), the first cell is over the second: Autonomous must never sit
// over Stop, or a press that misses Stop starts the rover exploring (the
// critics' round 3, a blocker: Autonomous at the first cell's far end, right
// over Stop at the second's). So the first cell runs from its start, the
// target, Autonomous, then the link chip, and nothing pushes Autonomous to
// the far end: no order, no auto margin, no justification, no reversal.
// Stop and the gear keep the second cell's far end. The fit's last steps
// keep 48 px or more between them, measured in a browser at every size the
// panel is checked at; this pins the rules that measurement rests on.
test("safety: where the cells stack, Autonomous sits at the first cell's start, never over Stop", () => {
  const css = panelCss();
  const rules = cssRules(css);
  const page = loadPage();
  const [drives, hands] = page.doc.documentElement.querySelector(".cells").children;
  const ids = (cell) => cell.children.filter((n) => !n.hidden).map((n) => n.id || (n.getAttribute("class") || "").split(" ")[0]);
  check(ids(drives).indexOf("auto") === 1 && ids(drives)[0] === "target", `Autonomous second, after the target: ${ids(drives)}`);
  check(ids(hands).slice(-2).join() === "stop,menuHolder", `Stop and the gear last in the second cell: ${ids(hands)}`);
  // What each selector in a rule's list picks: its last compound.
  const picks = (r) => selectorsOf(r.selector).map((each) => each.split(/\s*[\s>+~]\s*/).pop());
  const child = /^(\.target|#target|\.autoSwitch|#auto|\.linkChip|#linkChip|\.tabs|#tabs|\.scheme|#scheme|#stop|\.menuHolder)([:[.]|$)/;
  const reorders = rules.filter((r) => picks(r).some((each) => child.test(each)) && /(^|[\s;])order\s*:/.test(r.body));
  check(reorders.length === 0, `nothing in the cells reordered: ${reorders.map((r) => r.selector)}`);
  const firsts = /^(\.target|#target|\.autoSwitch|#auto|\.linkChip|#linkChip)([:[.]|$)/;
  const pushed = rules.filter((r) => picks(r).some((each) => firsts.test(each)) && /margin(-left|-inline-start|-inline)?\s*:[^;]*\bauto\b/.test(r.body));
  check(pushed.length === 0, `nothing in the first cell pushed along it: ${pushed.map((r) => r.selector)}`);
  const cellRule = (r) => picks(r).some((each) => /^(\.hcell|\.drives|\.hcell\.drives)(\[[^\]]*\]|:is\(.*\))*$/.test(each));
  const turned = rules.filter((r) => cellRule(r) && (/justify-content\s*:\s*(?!normal|flex-start|start)/.test(r.body) || /flex-direction\s*:\s*row-reverse|(^|[\s;])direction\s*:\s*rtl/.test(r.body)));
  check(turned.length === 0, `the first cell neither justified to its end nor reversed: ${turned.map((r) => r.selector)}`);
  check(/margin-right:\s*auto;/.test((rules.find((r) => r.selector === ".hands > .scheme") || {}).body || ""), "the scheme's auto margin puts Stop and the gear at the far end");
  // The cells stack, a row each, until the top is 900 px wide: a single
  // column outside the container query, and a row only inside it.
  const base = outside(css, "@container");
  check(/grid-template-columns:\s*minmax\(0, 1fr\);/.test((cssRules(base).find((r) => r.selector === ".cells") || {}).body || ""), "stacked, a cell a row, below 900 px");
  const row = blockRules(css, "@container bar (min-width: 900px) {");
  check(row && /display:\s*flex;/.test((row.find((r) => r.selector === ".cells") || {}).body || ""), "one row only from 900 px");
  // The fit's last step closes the target up, so the first cell ends short
  // of Stop on a 320 px phone and in a phone's middle column on its side.
  check(/--seg-x:\s*4px;/.test((rules.find((r) => r.selector === '.drives[data-fit="lamp"]') || {}).body || ""), "the last step's segments closer");
  // AutoToggle's contract says so too.
  const autoJs = fs.readFileSync(path.join(PANEL_ROOT, "js", "autotoggle.js"), "utf8");
  check(/never (over|in) Stop/i.test(autoJs), "autotoggle.js's header says where it sits, and why");
});

// Every button says on hover what it does, the owner's ask with Stop's
// icon ("all buttons should have that"): Stop and the link chip above all,
// whose words a narrow cell drops or never shows, and every other button
// on the page, in each state of the link (connecting and stale too), of
// the editor and of a program, on either target, and the question
// dialog's answers, which were the two left untitled (the reviewer's
// round 1).
test("every button titled with what it does, in every state of the link and of a program", async () => {
  const page = loadPage();
  const untitled = () => all(page.doc.documentElement)
    .filter((n) => n.tagName === "BUTTON")
    .filter((n) => !(n.getAttribute("title") || n.title))
    .map((n) => n.id || n.dataset.family || n.dataset.target || n.dataset.scheme || n.textContent);
  check(untitled().length === 0, `untitled with no link: ${untitled()}`);
  const tabTitle = page.$("tabProgram").getAttribute("title");
  check(/^Program/.test(tabTitle), `the Program tab: ${tabTitle}`);
  page.$("host").value = "10.0.0.7";
  page.fire(page.$("connect"), "click");
  check(page.doc.body.dataset.link === "connecting" && untitled().length === 0 && /^Cancel/.test(page.$("connect").title), `untitled while connecting: ${untitled()}, connect '${page.$("connect").title}'`);
  const ws = page.sockets.at(-1);
  ws.serverOpen();
  check(untitled().length === 0 && /^Disconnect/.test(page.$("connect").title), `untitled with a link: ${untitled()}, connect '${page.$("connect").title}'`);
  ws.serverMsg(telemetry({ mode: "MANUAL", scheme: "NORMAL" }));
  check(untitled().length === 0, `untitled with telemetry: ${untitled()}`);
  page.clock.advance(page.evalIn("Link.STALE_MS"));
  check(page.doc.body.dataset.link === "stale" && untitled().length === 0 && /^Disconnect/.test(page.$("connect").title), `untitled while stale: ${untitled()}, connect '${page.$("connect").title}'`);
  ws.serverMsg(telemetry({ mode: "MANUAL", scheme: "NORMAL" }));
  // Off under NORMAL, the family's segments say why too.
  const familySegs = all(page.$("familyChoice")).filter((n) => n.dataset.family);
  const offTitle = page.evalIn("FamilySelector.OFF_TITLE");
  check(/Advanced/.test(offTitle) && familySegs.length === 2 && familySegs.every((b) => b.disabled && b.title.endsWith(offTitle)), `the family off, saying what it needs: ${familySegs.map((b) => b.title)}`);
  ws.serverMsg(telemetry({ mode: "MANUAL", scheme: "ADVANCED" }));
  check(familySegs.every((b) => !b.disabled && !b.title.includes(offTitle) && b.title !== ""), `the family on: ${familySegs.map((b) => b.title)}`);

  // The editor up, then a program run on the rover, and after it.
  standInEditor(page);
  check(untitled().length === 0 && page.$("programRun").title === "Run the program on the rover" && /Import/.test(page.$("programMenu").title), `with the editor: ${untitled()}, Run '${page.$("programRun").title}', File '${page.$("programMenu").title}'`);
  page.fire(page.$("programRun"), "click");
  await flush();
  check(page.evalIn("runner.state") === "running" && untitled().length === 0, `running: ${untitled()}`);
  check(/^A program is running/.test(page.$("programRun").title) && /driving the rover/.test(page.$("tabProgram").getAttribute("title")), `running: Run '${page.$("programRun").title}', tab '${page.$("tabProgram").getAttribute("title")}'`);
  await liveForAsync(page, ws, 2000);
  check(page.evalIn("runner.state") === "idle" && untitled().length === 0 && page.$("tabProgram").getAttribute("title") === tabTitle, `after the run: ${untitled()}, tab '${page.$("tabProgram").getAttribute("title")}'`);
  // A question: Yes says what it answers, Cancel that it answers no.
  check(page.$("askNo").title === page.evalIn("AskDialog.NO_TITLE") && /^Cancel \(Escape\): answer no/.test(page.$("askNo").title), `Cancel before any question: '${page.$("askNo").title}'`);
  page.fire(page.$("programClear"), "click");
  await flush();
  check(page.$("ask").open && untitled().length === 0, `asked: ${page.$("ask").open}, untitled ${untitled()}`);
  check(page.$("askYes").title === "Clear: answer yes to “Clear the program?”", `Yes, titled with its question: '${page.$("askYes").title}'`);
  check(page.$("askNo").title === page.evalIn("AskDialog.NO_TITLE"), `Cancel: '${page.$("askNo").title}'`);
  await answer(page, "cancel");
  check(!page.$("ask").open && page.evalIn("__editor.cleared") === 0, "answered no: nothing cleared");

  // The view's toggle, both ways, titled with what a press does.
  // The fake page has no matchMedia, so it starts as a phone does: hidden.
  const view = page.$("viewToggle");
  check(view.getAttribute("aria-pressed") === "false" && /^View: show/.test(view.title), `the view hidden: '${view.title}'`);
  page.fire(view, "click");
  check(view.getAttribute("aria-pressed") === "true" && /^View: hide/.test(view.title) && untitled().length === 0, `the view shown: '${view.title}' ${untitled()}`);
  page.fire(view, "click");
  check(view.getAttribute("aria-pressed") === "false" && /^View: show/.test(view.title) && untitled().length === 0, `hidden again: '${view.title}' ${untitled()}`);
  // The simulator target: its view still folded on a phone, a preview,
  // and after it.
  page.fire(segments(page)[1], "click");
  check(view.getAttribute("aria-pressed") === "false" && /^View: show/.test(view.title), `the view folded with the simulator, on a phone: ${view.title}`);
  check(untitled().length === 0 && page.$("programRun").title === "Preview the program on the simulator", `the simulator: ${untitled()}, Run '${page.$("programRun").title}'`);
  page.fire(page.$("programRun"), "click");
  await flush();
  check(page.evalIn("runner.state") === "running" && untitled().length === 0, `previewing: ${untitled()}`);
  page.fire(page.$("programStop"), "click");
  await flush();
  check(page.evalIn("runner.state") === "idle" && untitled().length === 0 && page.$("tabProgram").getAttribute("title") === tabTitle, `after the preview: ${page.evalIn("runner.state")} ${untitled()}`);
  check(page.errors.length === 0, `errors ${page.errors}`);
});

// On the simulator target the Autonomous switch shows the simulated rover's
// mode, so the link chip says, after its word, that a rover sent exploring
// before the switch is still moving by itself: nothing else on screen would.
// A motor shield that did not answer is said by the fault line in the
// scan's card while the view shows the scan, and by the chip while it does
// not (the simulator target, or the view folded on the Program tab): one
// place at a time, never both (the critic's round 2: a badge beside a fault
// bar said it twice). Each in a slot of its own, both at once where both
// are so, the link's word always readable beside them (the critics' round
// 3: one alert in the word's place hid the other, and hid "No data"),
// amber, titled in full, and said in words at the top of the chip's
// popover, which a touch screen opens with a press where it cannot hover.
// A rover last seen exploring stays said, dashed, as the Autonomous
// switch's track is, after its link goes quiet or is lost: until a frame
// says MANUAL, or a Stop goes out over the link (one with no link reaches
// nothing, and the rover may be exploring still).
test("alerts: the chip keeps the link's word, and says No motors and a rover exploring each in its own slot, the rover last seen exploring until it says otherwise", () => {
  const { page, ws } = connected(telemetry({ mode: "AUTONOMOUS" }));
  const chip = page.$("linkChip");
  const alerts = () => chip.dataset.alert;
  const shown = (id) => !page.$(id).hidden;
  const word = () => page.$("linkState").textContent;
  const known = () => page.$("alertExploring").dataset.known;
  const titleOf = (el) => el.getAttribute("title") || el.title || "";
  const toSim = () => page.fire(page.$("target").children[1], "click");
  const toRover = () => page.fire(page.$("target").children[0], "click");
  check(alerts() === "" && page.$("linkAlert").hidden && !shown("alertExploring"), "on the rover target the switch says it itself: no alert");
  check(page.$("auto").getAttribute("aria-pressed") === "true", "the switch on, the rover's");
  // Whose link: named only on the simulator target, where the word could
  // read as the simulator's; on the rover target the target says it.
  check(page.$("chipFor").hidden, "on the rover target the chip names nobody");
  toSim();
  const forWord = all(page.$("chipFor")).find((n) => n.getAttribute && n.getAttribute("class") === "chipForWord");
  check(!page.$("chipFor").hidden && forWord && forWord.textContent === "Rover:", "on the simulator target: Rover:");
  check(alerts() === "exploring" && shown("alertExploring") && !shown("alertMotors") && known() === "now", `on the simulator: the chip says the rover explores: ${alerts()} ${known()}`);
  check(word() === "Connected" && chip.dataset.say === "up", `the link's word kept beside it: ${word()}`);
  check(page.$("auto").getAttribute("aria-pressed") === "false", "the switch the simulator's, off");
  check(/^Rover exploring: /.test(titleOf(chip)) && /Connected to the rover/.test(titleOf(chip)) && /^Rover exploring: /.test(titleOf(page.$("alertExploring"))), `titled in full, the link's own title after it: ${titleOf(chip)}`);
  check(!page.$("linkAlert").hidden && /^Rover exploring: /.test(page.$("linkAlert").textContent), `said in the popover too: ${page.$("linkAlert").textContent}`);
  ws.serverMsg(telemetry({ mode: "MANUAL" }));
  check(alerts() === "" && !shown("alertExploring") && page.$("linkAlert").hidden && /^Connected to the rover/.test(titleOf(chip)), `gone once the rover reports manual, the title the link's again: ${titleOf(chip)}`);
  ws.serverMsg(telemetry({ mode: "AUTONOMOUS" }));
  check(alerts() === "exploring" && known() === "now", "back as it explores again");
  page.clock.advance(page.evalIn("Link.STALE_MS"));
  check(page.doc.body.dataset.link === "stale" && alerts() === "exploring" && word() === "No data", `stale: the word says so, the rover last seen exploring beside it: ${word()} ${alerts()}`);
  check(known() === "last" && /as last reported/.test(titleOf(page.$("alertExploring"))), `dashed, as last reported: ${known()}`);
  ws.serverDrop();
  check(alerts() === "exploring" && known() === "last" && word() === "Link lost", `lost: still said, as last reported: ${alerts()} ${word()}`);
  // A Stop with no link reaches nothing: the rover may be exploring still.
  page.fire(page.$("stop"), "click");
  check(alerts() === "exploring", "a Stop with no link leaves it said");
  // A new link, before its first frame, knows nothing new.
  const again = connectOpen(page);
  check(alerts() === "exploring" && known() === "last", `a new link, before its first frame: ${known()}`);
  again.serverMsg(telemetry({ mode: "AUTONOMOUS" }));
  check(alerts() === "exploring" && known() === "now", "its first frame: exploring now");
  // A Stop that goes out over the link: said no more, until a frame says
  // the rover explores still.
  page.fire(page.$("stop"), "click");
  check(alerts() === "" && !shown("alertExploring"), "a Stop over the link ends it");
  again.serverMsg(telemetry({ mode: "AUTONOMOUS" }));
  check(alerts() === "exploring", "until the rover says it explores still");
  again.serverMsg(telemetry({ mode: "MANUAL" }));
  check(alerts() === "", "and gone with MANUAL");
  again.serverMsg(telemetry({ mode: "AUTONOMOUS" }));
  toRover();
  check(alerts() === "" && page.$("chipFor").hidden, "gone on the rover target, with the rover's name");

  // No motors: the fault line in the scan's card on the rover target, the
  // chip on the simulator's, whose view shows no scan.
  again.serverMsg(telemetry({ motorsReady: false, mode: "MANUAL" }));
  check(!page.$("motorsFault").hidden && alerts() === "", "the rover target: the fault in the scan's card, not the chip as well");
  toSim();
  check(alerts() === "motors" && shown("alertMotors") && /motor shield/i.test(titleOf(chip)) && /motor shield/.test(titleOf(page.$("alertMotors"))) && /motor shield/.test(page.$("linkAlert").textContent), `the simulator target: the chip says it: ${alerts()} ${titleOf(chip)}`);
  // Both at once, each in its slot, and the link's word with them.
  again.serverMsg(telemetry({ motorsReady: false, mode: "AUTONOMOUS" }));
  check(alerts() === "motors exploring" && shown("alertMotors") && shown("alertExploring") && word() === "Connected", `both, and the word: ${alerts()} ${word()}`);
  check(/^No motors: [\s\S]* Rover exploring: [\s\S]* Connected to the rover/.test(titleOf(chip)) && /No motors[\s\S]*Rover exploring/.test(page.$("linkAlert").textContent), `both in the title and the popover: ${titleOf(chip)}`);
  again.serverMsg(telemetry({ motorsReady: true, mode: "MANUAL" }));
  check(alerts() === "" && !shown("alertMotors") && !shown("alertExploring"), "gone when the shield answers and the rover stops");
  toRover();
  // The Program tab with the view folded shows no scan: the chip says it,
  // and the view shown again takes it back.
  again.serverMsg(telemetry({ motorsReady: false }));
  page.fire(page.$("tabProgram"), "click");
  check(page.$("programTab").dataset.view === "hidden" && alerts() === "motors", `the view folded: the chip: ${page.$("programTab").dataset.view} ${alerts()}`);
  page.fire(page.$("viewToggle"), "click");
  check(page.$("programTab").dataset.view === "shown" && alerts() === "", `the view shown: the fault line again: ${alerts()}`);
  page.fire(page.$("viewToggle"), "click");
  check(alerts() === "motors", "folded again: the chip");
  page.fire(page.$("tabDrive"), "click");
  check(alerts() === "", "the Drive tab: the scan, and its fault line");

  // Width, never height: the chip is a cell's button, 32 px. Its word's
  // slot is as wide as the longest word it says: the word and a sizer for
  // each of Link's words share one grid cell. What comes and goes in it
  // (the rover's name, the alerts) takes room the fit keeps for it (the
  // top's test), never a state's size.
  const css = panelCss();
  const cellButton = cssRules(outside(css, "@media")).find((r) => r.selector === ".hcell button");
  check(cellButton && /height:\s*var\(--ctl\);/.test(cellButton.body) && /flex:\s*none;/.test(cellButton.body), `a cell's button 32 px, never squeezed: ${cellButton && cellButton.body}`);
  const sizers = all(chip).filter((n) => /(^|\s)chipSizer(\s|$)/.test((n.getAttribute && n.getAttribute("class")) || ""));
  const labels = [...new Set(Object.values(page.evalIn("Link.LABEL")))];
  check(sizers.length === labels.length && sizers.every((n) => n.getAttribute("aria-hidden") === "true" && n.parentNode === page.$("linkState").parentNode) && labels.every((w) => sizers.some((n) => n.textContent === w)),
    `a sizer for each word, beside the word, out of the reading order: ${sizers.map((n) => n.textContent)}`);
  const sizesChip = cssRules(css).filter((r) => /\.linkChip/.test(r.selector) && /\[data-(say|alert)/.test(r.selector) && /(^|[\s;{])(min-|max-)?(height|width)\s*:|padding|font-size|gap/.test(r.body));
  check(sizesChip.length === 0, `no state of the chip's sizes it: ${sizesChip.map((r) => r.selector)}`);
  // Amber, the words saying which, never hue alone: tinted while the link
  // went, went quiet or never came, or while the rover needs the operator.
  const amber = cssRules(css).find((r) => r.selector === '.linkChip:is([data-say="lost"], [data-say="stale"], [data-say="unreachable"], :not([data-alert=""]))');
  check(amber && /background:\s*var\(--warn-soft\);/.test(amber.body), `an alert or a link gone tints the chip: ${amber && amber.body}`);
  const alertCss = cssRules(outside(css, "@media")).find((r) => r.selector === ".chipAlert");
  check(alertCss && /(^|[^-])color:\s*var\(--warn\);/.test(alertCss.body), `each alert amber: ${alertCss && alertCss.body}`);
  const dashed = cssRules(css).find((r) => r.selector === '.chipAlert[data-known="last"]');
  check(dashed && /outline:\s*1px dashed var\(--warn\);/.test(dashed.body), `as last reported: dashed: ${dashed && dashed.body}`);
  // A press opens the popover, its first line the alerts.
  toSim();
  page.fire(chip, "click");
  check(!page.$("linkPanel").hidden && page.$("linkPanel").children[0] === page.$("linkAlert") && !page.$("linkAlert").hidden, "a press opens the popover, the alert its first line");
  for (const gone of ["motorsBadge", "exploringBadge", "motorsNote", "exploringNote", "chipAlert"]) check(page.doc.getElementById(gone) === null, `no #${gone} left`);
  check(!cssRules(css).some((r) => /\.badge\b/.test(r.selector)), "and no rule for a badge");
  check(page.errors.length === 0, `errors ${page.errors}`);
});

// The view (F8): one pane, a sibling of both tabs, showing what the
// controls drive: the scan, with its fault card and its readouts line, on
// the rover target, and the simulated room on the simulator target, on
// either tab. Never around a stick: joy.js places a touch by its canvas's
// offsetParent, and the view is positioned. Its size is the shell grid's
// alone, so nothing it holds, and no switch of target, moves the dock under
// a held stick. Layout itself is measured in a browser.
test("the view: one pane beside both tabs, its content picked by the target, never around a stick", () => {
  const page = loadPage();
  const view = page.$("view");
  const shell = page.$("driveTab").parentNode;
  check(view.parentNode === shell && page.$("programTab").parentNode === shell, "a sibling of both tabs, a cell of the shell's grid");
  const kids = view.children.filter((n) => n.tagName && n.tagName !== "#TEXT").map((n) => n.id || (n.getAttribute("class") || "").split(" ")[0]);
  check(kids.join() === "scan,simSlot,readouts", `the scan, the simulator's slot and the readouts: ${kids}`);
  check(page.$("motorsFault").parentNode === page.$("scan").parentNode, "the fault in the scan's card");
  for (const canvas of [page.canvas, page.pivotCanvas]) {
    for (let n = canvas.parentNode; n; n = n.parentNode) check(n !== view, "not an ancestor of a stick");
  }
  // One view of the simulator, in one slot: none of the slots and folds it
  // used to move between.
  for (const gone of ["driveView", "driveSimSlot", "programSim", "simToggle", "scanEmpty"]) {
    check(page.doc.getElementById(gone) === null, `no #${gone} left`);
  }
  const slots = all(page.doc.documentElement).filter((n) => n.getAttribute && /(^|\s)(simSlot|driveView|programSim)(\s|$)/.test(n.getAttribute("class") || ""));
  check(slots.length === 1 && slots[0] === page.$("simSlot"), `one slot: ${slots.length}`);
  check(!/moveTo/.test(page.evalIn("String(SimView.prototype.constructor)")), "SimView never moves");
  // The readouts are the view's, not a card of their own beside the dock.
  check(page.doc.documentElement.querySelectorAll(".readouts").length === 1 && page.$("move").parentNode.parentNode.parentNode === view, "the readouts at the view's foot");

  const css = panelCss();
  const base = cssRules(outside(css, "@media"));
  const rule = (rules, selector) => rules.filter((r) => r.selector === selector).map((r) => r.body).join("");
  // Its size the grid's alone: size containment, and every part of it
  // giving way inside it but the readouts' one line.
  const v = rule(base, ".view");
  check(/grid-area:\s*view;/.test(v) && /min-height:\s*0;/.test(v) && /contain:\s*size;/.test(v) && /display:\s*flex;/.test(v), `the grid's size, never its content's: ${v}`);
  for (const part of [".scan", ".simSlot"]) {
    const body = rule(base, part);
    check(/flex:\s*1 1 0;/.test(body) && /min-height:\s*0;/.test(body), `${part} takes what is left, down to nothing: ${body}`);
  }
  const fault = rule(base, ".fault");
  check(/min-height:\s*0;/.test(fault) && /max-height:\s*50cqh;/.test(fault) && /overflow-y:\s*auto;/.test(fault), `the fault takes height from the fan, at most half the card: ${fault}`);
  // The connect card shares the fan's cell, over it, under the legend's
  // row, where the fault takes the legend's place, and the scan is
  // size-contained: the card or the fault coming and going moves nothing
  // outside it.
  check(/container:\s*scan \/ size;/.test(rule(base, ".scan")) && /grid-area:\s*2 \/ 1;/.test(rule(base, ".scan > *")) && /grid-area:\s*1 \/ 1;/.test(rule(base, ".scan > :is(.fault, .scanLegend)")), "the connect card over the fan, in its one cell, the legend's row over both, the fault in its place");
  // The fan centred in its card, as large as it fits: pinned to the foot,
  // it left the card's top half empty (the critic's round 2).
  check(/preserveAspectRatio", "xMidYMid meet"/.test(fs.readFileSync(path.join(PANEL_ROOT, "js", "scan.js"), "utf8")), "the fan centred in its card");

  // The target picks only what fills the view and its shape: one rule,
  // outside every @media, hiding the rover's parts on the simulator, and
  // the simulator's slot hidden on the rover (app.js), so its view knows it
  // is out of sight; and one giving the shell the room's aspect in the
  // fan's place (--va, what the card adds: --vcw, --vch), which only the
  // Program tab's layouts read, so the view there is as tall as the room
  // needs. Never the view itself, the dock or the top's cells, so a switch
  // moves no stick; anything else that follows the target is a colour.
  // (What the chip says for the rover on the simulator target, app.js
  // says in a chip as wide whatever it says.)
  const paintOnly = (body) => body.split(";").map((d) => d.trim()).filter(Boolean).every((d) => /^(color|background|border-style)\s*:/.test(d));
  const onTarget = cssRules(css).filter((r) => /data-target/.test(r.selector) && !paintOnly(r.body));
  const picks = 'body[data-target="simulator"] .view > :is(.scan, .readouts)';
  const shape = 'body[data-target="simulator"] .shell';
  const shapeOnly = (body) => body.split(";").map((d) => d.trim()).filter(Boolean).every((d) => /^--(va|vcw|vch)\s*:/.test(d));
  check(onTarget.length >= 2 && onTarget.some((r) => r.selector.replace(/\s+/g, " ") === picks && /^\s*display:\s*none;\s*$/.test(r.body)) && onTarget.every((r) => r.selector.replace(/\s+/g, " ") === picks || (r.selector === shape && shapeOnly(r.body))),
    `the target picks what fills the view and its shape, and nothing else: ${onTarget.map((r) => r.selector)}`);
  check(base.some((r) => r.selector.replace(/\s+/g, " ") === picks) && base.some((r) => r.selector === shape), "outside every @media: the same on every layout");
  const readsShape = cssRules(css).filter((r) => /var\(--(va|vcw|vch)\)/.test(r.body));
  check(readsShape.length > 0 && readsShape.every((r) => /#programTab/.test(r.selector)), `only the Program tab's layouts read the shape, where no stick is: ${readsShape.map((r) => r.selector)}`);
  check(/display:\s*none;/.test(rule(base, ".simSlot[hidden]")), "the slot's hidden attribute outranks its display");
  check(page.$("simSlot").hidden && page.doc.body.dataset.target === "rover", "the rover target: the slot hidden");
  page.fire(page.$("target").children[1], "click");
  check(!page.$("simSlot").hidden && page.doc.body.dataset.target === "simulator", "the simulator target: shown");
  page.fire(page.$("target").children[0], "click");
  check(page.$("simSlot").hidden, "and hidden again on the rover");
  for (const file of ["program.css", "sim.css"]) {
    check(!/data-target/.test(stylesheet(file)), `${file}: nothing follows the target`);
  }

  // The readouts keep one height while a stick is held: one line, a value
  // too long cut short, never wrapped, the phase coming and going at its end.
  const line = rule(base, ".readouts");
  check(/height:\s*var\(--readouts-h\);/.test(line) && /white-space:\s*nowrap;/.test(line) && /overflow:\s*hidden;/.test(line) && /flex:\s*none;/.test(line) && !/flex-wrap:\s*wrap/.test(line), `one line: ${line}`);
  const value = rule(base, ".cell output");
  check(/overflow:\s*hidden;/.test(value) && /text-overflow:\s*ellipsis;/.test(value), `a value cut short: ${value}`);
  const cells = page.$("move").parentNode.parentNode.children.filter((n) => n.tagName && n.tagName !== "#TEXT");
  check(cells[cells.length - 1] === page.$("phaseCell"), "the phase last");
  check(!cssRules(css).some((r) => /#phaseCell\[hidden\]/.test(r.selector)) && /display:\s*none;/.test(rule(base, ".cell[hidden]")), "a hidden phase takes no room on the line");
  const baseKeys = new Set(base.map((r) => `${r.selector}{${r.body}`));
  const inMedia = cssRules(css).filter((r) => !baseKeys.has(`${r.selector}{${r.body}`));
  check(!inMedia.some((r) => /\.readouts|\.cell\b/.test(r.selector) && /(^|[\s;{])(min-|max-)?height\s*:/.test(r.body)), "no layout changes the line's height");

  // Wide: the sticks' budget from the viewport alone, the Drive tab's
  // column as wide as they need, and no layout of its own for a short,
  // tall or narrower wide screen.
  const wideRoot = rule(mediaRules(WIDE) || [], ":root");
  check(/--stick:\s*clamp\(120px, min\(100 \* var\(--svh\) - 228px, \(45vw - 56px\) \/ 2\), 240px\);/.test(wideRoot), `wide: the sticks: ${wideRoot}`);
  check(/--drive:\s*calc\(2 \* var\(--stick\) \+ 56px\);/.test(wideRoot), `wide: the column: ${wideRoot}`);
  check(mediaRules(WIDE_SHORT) === null && !css.includes("@media (min-width: 1180px)") && !/@media \(min-width: 960px\)[^{]*(min-height: 761px|max-height: 738\.98px)/.test(css), "no layout of its own for a short, a tall or a wider wide screen");
  // A tablet upright fills its screen's width, and its dock is a card as
  // wide as the cells and the view, as far off the foot as off the sides
  // (16 px off it, 24 off them, the critic's round 1).
  const tablet = mediaRules("@media (min-width: 720px) and (max-width: 959.98px) and (min-height: 761px) {") || [];
  check(/--shell-max:\s*960px;/.test(rule(tablet, ":root")) && /margin:\s*0 0 calc\(var\(--gutter\) \+ env\(safe-area-inset-bottom, 0px\)\);/.test(rule(tablet, ".dock")) && /border-radius:\s*var\(--r-xl\);/.test(rule(tablet, ".dock")),
    `a tablet upright: the screen's width, the dock a card: ${rule(tablet, ":root")} ${rule(tablet, ".dock")}`);
  check(!css.includes("@media (min-width: 960px) and (max-width: 999.98px)"), "no narrower switches from 960 to 999 px");

  // A phone: the view between the top and the dock on the Drive tab; on
  // the Program tab a band over the editor, or gone with its toggle off.
  const phone = mediaRules("@media (max-width: 959.98px), (max-height: 520.98px) {") || [];
  // No taller than what it shows needs at the screen's width (--va), so
  // the room is not letterboxed in a band taller than itself (the critic's
  // round 2).
  check(/height:\s*clamp\(120px, min\(33 \* var\(--svh\), 100 \* var\(--svh\) - 400px, \(100vw - 2 \* var\(--gutter\) - var\(--vcw\)\) \/ var\(--va\) \+ var\(--vch\)\), 480px\);/.test(rule(phone, ".shell:has(> #programTab:not([hidden])) > .view")), "phone: the Program tab's view a band a third of the screen at most, giving way to the editor on a short one");
  // The page the screen's height beside the Program tab, so the editor and
  // its console are on it whole (at 375 x 667 they ran 143 px past it).
  const programShell = rule(phone, ".shell:has(> #programTab:not([hidden]))");
  check(/height:\s*100dvh;/.test(programShell) && /grid-template-rows:\s*auto auto minmax\(0, 1fr\);/.test(programShell), `phone: the Program tab the screen's height: ${programShell}`);
  const programPhone = blockRules(stylesheet("program.css"), "@media (max-width: 959.98px), (max-height: 520.98px) {") || [];
  const floor = Number((rule(programPhone, ".programEditor").match(/min-height:\s*(\d+)px;/) || [])[1]);
  check(floor > 0 && floor <= 160, `phone: the editor's floor low enough to stay on the screen: ${floor}`);
  check(/display:\s*none;/.test(rule(phone, '.shell:has(> #programTab[data-view="hidden"]:not([hidden])) > .view')), "phone: gone with its toggle off, no strip");
  check(!phone.some((r) => /#driveTab/.test(r.selector) && /\.view\b/.test(r.selector)), "phone: the Drive tab's view never hidden or sized by the tab");
  // The target is the first cell's first control on every phone, on both
  // tabs: the cell is there anyway, one height whatever it holds, so no
  // layout leaves the target out. (A row of its own, before, left the scan
  // nothing to give on a short phone and moved a stick at 375 x 548.)
  const hidesTarget = cssRules(css).filter((r) => r.selector.split(",").some((part) => /(\.target|#target)$/.test(part.trim())) && /display:\s*none/.test(r.body));
  check(hidesTarget.length === 0, `the target never hidden: ${hidesTarget.map((r) => r.selector)}`);
  // Under 600 px tall the scan gives way to nothing: with its padding it
  // could not, and the family's slot opening moved the stick.
  const short600 = mediaRules("@media (max-width: 959.98px) and (max-height: 600px) {") || [];
  check(/padding-block:\s*var\(--s-1\) 0;/.test(rule(short600, ".scan")), `short phone: the scan's padding cut: ${rule(short600, ".scan")}`);
  // A lost link must not move the simulator's sticks: the address, Connect
  // and the note hang in the chip's popover, over the page and in no row,
  // and the chip's word keeps the width of the longest it says: a sizer for
  // each of its words in its slot.
  check((page.$("linkPanel").getAttribute("class") || "").split(/\s+/).includes("menu"), "the link's popover a .menu");
  check(/position:\s*absolute;/.test(rule(base, ".menu")), `a .menu over the page, in no row: ${rule(base, ".menu")}`);
  const sizers = all(page.$("linkChip")).filter((n) => n.getAttribute && n.getAttribute("class") === "chipSizer").map((n) => n.textContent);
  const labels = Object.values(page.evalIn("Link.LABEL"));
  check(labels.every((label) => sizers.includes(label)), `the chip's word as wide as its longest: ${sizers} of ${labels}`);
  const hidesLink = cssRules(css).filter((r) => /data-(link|target)/.test(r.selector) && /\.(linkChip|linkPanel|hcell|cells|view|dock)\b|#(host|connect|note|view|driveTab)\b/.test(r.selector) && /display:/.test(r.body) && !/\.view > /.test(r.selector));
  check(hidesLink.length === 0, `nothing of the link, the view or the dock shown or hidden by the link's state or the target: ${hidesLink.map((r) => r.selector)}`);

  // The room too short for itself: height queries on the simulator's view,
  // outside every @media, so they apply wherever the pane is short.
  const sim = stylesheet("sim.css");
  check(!/@media \(min-width: 960px\)/.test(sim), "sim.css: no layout of its own, the pane's size alone");
  const simBase = cssRules(outside(sim, "@media"));
  check(/container:\s*sim \/ size;/.test(rule(simBase, ".sim")) && /height:\s*100%;/.test(rule(simBase, ".sim")), `the view fills its slot, a size container: ${rule(simBase, ".sim")}`);
  check(/min-height:\s*0;/.test(rule(base, ".simSlot .sim")), `the pane's height, not the view's floor: ${rule(base, ".simSlot .sim")}`);
  // Too short for the room, the room goes and the bar stays, with the
  // wheels and the motion in it. Never a row of words under the room:
  // they are in the bar's one row (sim.test.js).
  const short = blockRules(outside(sim, "@media"), "@container sim (max-height: 99.98px) {") || [];
  const hidden = short.find((r) => /display:\s*none;/.test(r.body));
  check(hidden && hidden.selector.trim() === ".sim-stage", `short: the room goes: ${hidden && hidden.selector}`);
  const heights = [...outside(sim, "@media").matchAll(/@container sim \(max-height: [\d.]+px\) \{/g)].flatMap((m) => blockRules(outside(sim, "@media"), m[0]) || []);
  check(!heights.some((r) => /\.sim-(bar|status|inset|move)\b/.test(r.selector) && /display:\s*none/.test(r.body)), "however short, the bar, the wheels and the motion stay");
  check(page.errors.length === 0, `errors ${page.errors}`);
});

test("program: the File menu opens over the page but under the top, and on a phone scrolls clear of it", () => {
  // Nothing may cover Stop, in the top's second cell. The menu hangs over
  // the editor and the simulator, and opened under the top stuck over a
  // scrolled phone it scrolls down clear of the top rather than hide under
  // it. Nothing sticks to the foot now, so nothing needs clearing there.
  const zIndex = (selector) => {
    const rule = cssRules(panelCss()).find((r) => r.selector === selector && /z-index/.test(r.body));
    return rule && Number(/z-index:\s*(\d+)/.exec(rule.body)[1]);
  };
  check(zIndex(".menu") >= 1 && zIndex(".menu") < zIndex(".bar"), `the menu at ${zIndex(".menu")}, the top at ${zIndex(".bar")}`);
  const margin = (mediaRules("@media (max-width: 959.98px), (max-height: 520.98px) {") || [])
    .find((r) => /scroll-margin-top:[^;]*2 \* var\(--cell-h\)/.test(r.body));
  const popups = margin ? margin.selector.split(",").map((part) => part.trim()) : [];
  check(popups.includes(".menu") && popups.includes(".sim-more"), `a scroll margin as tall as the top's two rows of cells, wherever the top sticks over the page: ${popups}`);
  const bottom = cssRules(panelCss()).filter((r) => /scroll-margin-bottom/.test(r.body));
  check(bottom.length === 0, `no foot bar to clear: ${bottom.map((r) => r.selector)}`);
  // The simulator's box clips its room without being a scroll container,
  // which would swallow the settings' margin before the window scrolled.
  const slot = cssRules(outside(panelCss(), "@media")).filter((r) => r.selector === ".simSlot").map((r) => r.body).join("");
  check(/overflow:\s*clip\s*;/.test(slot), `.simSlot clips, not scrolls: ${slot}`);
  const view = cssRules(panelCss()).filter((r) => /(^|[\s,])\.view$/.test(r.selector)).map((r) => r.body).join("");
  check(!/overflow(-[xy])?:\s*(auto|scroll|hidden)/.test(view), `nor is the view a scroll container: ${view}`);
});

test("program: an example, Import and Clear ask in the page before they replace a program, never with confirm()", async () => {
  // Desktop Chrome blurs the window after its own dialog, and the desktop
  // app's browser pane dismisses native dialogs unseen: none of these may
  // use one.
  const page = loadPage();
  standInEditor(page);
  page.evalIn("globalThis.__confirmed = 0; globalThis.confirm = () => { __confirmed++; return true; };");
  const asked = questionsAsked(page);
  const editor = () => page.evalIn("({ loaded: __editor.loaded.length, cleared: __editor.cleared })");
  const pick = (name) => page.fire(exampleItems(page).find((b) => b.textContent === name), "click");

  // An example over a program: asked, and no keeps the program.
  pick("Patrol");
  await flush();
  check(asked.length === 1 && /Replace the program in the editor with the "Patrol" example\?/.test(asked[0]), `asked ${asked}`);
  check(page.$("askYes").textContent === "Replace" && page.$("ask").getAttribute("aria-label") === "Replace the program?", "the yes names the action");
  await answer(page, "cancel");
  check(editor().loaded === 0, "declined: kept");
  pick("Patrol");
  await flush();
  await answer(page, "yes");
  check(editor().loaded === 1 && logLines(page).at(-1) === 'Loaded the "Patrol" example.', `loaded: ${logLines(page).at(-1)}`);

  // An empty editor has nothing to lose: not asked.
  page.evalIn("__editor.empty = true; programTab.refresh();");
  pick("Square");
  await flush();
  check(asked.length === 2 && editor().loaded === 2, "an empty editor: loaded without a question");
  page.evalIn("__editor.empty = false; programTab.refresh();");

  // Import opens the picker from the press itself, then reads the file; a
  // program over a program is asked about.
  const fileInput = page.$("programFile");
  page.fire(page.$("programImport"), "click");
  check(fileInput.pickerOpened === 1, "the press opened the file picker");
  const choose = async (name, text) => {
    fileInput.files = [{ name, size: text.length, text: async () => text }];
    page.fire(fileInput, "change");
    await flush();
  };
  await choose("mine.json", '{"blocks":{}}');
  check(asked.length === 3 && /Replace the program in the editor with mine\.json\?/.test(asked[2]), `asked ${asked[2]}`);
  await answer(page, "escape");
  check(editor().loaded === 2, "Escape: kept");
  await choose("mine.json", '{"blocks":{}}');
  await answer(page, "yes");
  check(editor().loaded === 3 && logLines(page).at(-1) === "Imported mine.json.", `imported: ${logLines(page).at(-1)}`);
  await choose("notes.txt", "not a program");
  check(asked.length === 4 && editor().loaded === 3 && /Kept the program you had\. This file is not JSON/.test(logLines(page).at(-1)), `not JSON: ${logLines(page).at(-1)}`);

  // Clear: asked, with Undo named; Escape keeps every block.
  page.fire(page.$("programClear"), "click");
  await flush();
  // Undo is Blockly's, on its own keys: Cmd+Z on a Mac, and only in the
  // editor.
  check(asked.length === 5 && asked[4] === "Remove every block? Ctrl+Z (Cmd+Z on a Mac) in the editor brings them back.", `asked ${asked[4]}`);
  check(page.$("askYes").textContent === "Clear" && page.$("ask").getAttribute("aria-label") === "Clear the program?", "the yes says Clear, under its own name");
  await answer(page, "escape");
  check(editor().cleared === 0, "Escape: nothing cleared");
  page.fire(page.$("programClear"), "click");
  await flush();
  await answer(page, "yes");
  check(editor().cleared === 1, "cleared");

  check(page.evalIn("__confirmed") === 0, `confirm() was called ${page.evalIn("__confirmed")} times`);
  check(page.errors.length === 0, `errors ${page.errors}`);
});

test("program: a question that waits keeps the editor's tools from acting under a program that started meanwhile", async () => {
  const { page, ws } = connected(telemetry({ mode: "MANUAL" }));
  standInEditor(page);
  const asked = questionsAsked(page);
  const fileInput = page.$("programFile");
  const tools = {
    example: () => page.fire(exampleItems(page)[0], "click"),
    import: () => {
      fileInput.files = [{ name: "mine.json", size: 2, text: async () => "{}" }];
      page.fire(fileInput, "change");
    },
    clear: () => page.fire(page.$("programClear"), "click"),
  };
  for (const [name, use] of Object.entries(tools)) {
    use();
    await flush();
    check(openQuestion(page) !== null, `${name}: asked`);
    // Nothing runs while it asks, not even a program Run would not ask about.
    page.fire(page.$("programRun"), "click");
    await flush();
    check(page.evalIn("runner.state") === "idle" && openQuestion(page) === asked.at(-1), `${name}: Run ran under the question`);
    // A program starts while it asks (here, behind the dialog's back): a
    // yes then changes nothing in the locked editor.
    startProgram(page, "await api.wait(5);");
    await flush();
    await answer(page, "yes");
    check(page.evalIn("__editor.loaded.length") === 0 && page.evalIn("__editor.cleared") === 0, `${name}: changed the editor under a running program`);
    page.evalIn("runner.abort('done')");
    await liveForAsync(page, ws, 200);
  }
  check(asked.length === 3, `asked ${asked.length}`);

  // One question at a time: another is no at once, and the first still waits.
  tools.example();
  await flush();
  const second = page.evalIn("globalThis.__second = null; ask.ask({ title: 'x', text: 'y', yes: 'z' }).then((v) => { __second = v; }); 0");
  await flush();
  check(second === 0 && page.evalIn("__second") === false && openQuestion(page) === asked[3], "a second question is no, and the first stays");
  await answer(page, "cancel");
  check(page.errors.length === 0, `errors ${page.errors}`);
});

test("program: its own stop and start exploring are no press: a stick let go of still asks for one", async () => {
  const page = loadPage();
  const ws = connectOpen(page);
  const note = page.$("pivotNote");
  const asking = () => note.textContent === page.evalIn("FamilySelector.PRESS_AGAIN") && note.dataset.tone === "warn";
  ws.serverMsg(telemetry({ mode: "MANUAL", scheme: "ADVANCED" }));
  const s = pivotTouch(page, 0);
  s.start(); pushTo(page, s, 0, 70);
  ws.serverMsg(telemetry({ mode: "MANUAL", scheme: "NORMAL" }));
  ws.serverMsg(telemetry({ mode: "MANUAL", scheme: "ADVANCED" }));
  s.end();
  check(asking(), `asked for a fresh press: '${note.textContent}'`);
  await flush(); // the touch's own events have all landed, as in a browser before any click

  const heard = listen(page);
  const mark = count(ws);
  startProgram(page, "await api.stop(); await api.explore(); await api.log('after');");
  await liveForAsync(page, ws, 1000, { fields: { mode: "MANUAL", scheme: "ADVANCED" } });
  check(ended(page) && ended(page).outcome === "done", `ended ${JSON.stringify(ended(page))}`);
  check(names(ws, mark).join() === "STOP,RESUME_AUTONOMOUS", `sent ${names(ws, mark)}`);
  check(heard.presses() === 0 && heard.downs() === "", `the Driver raised ${heard.presses()} presses, stand-downs '${heard.downs()}'`);
  check(asking(), `still asking: '${note.textContent}' ${note.dataset.tone}`);
  check(page.errors.length === 0, `errors ${page.errors}`);
});

test("program: the Program tab is marked while a program drives the rover, and otherwise while it previews", async () => {
  const { page, ws } = connected(telemetry({ mode: "MANUAL" }));
  const tab = page.$("tabProgram");
  const marked = () => tab.dataset.running === "yes" && /driving the rover/.test(tab.getAttribute("title") || "");
  check(!marked(), "not marked at first");
  startProgram(page);
  await flush();
  check(marked(), "marked while the program drives the rover");
  page.fire(page.$("tabDrive"), "click");
  check(marked(), "and while the Drive tab shows");
  press(page, page.$("cw"), 1); // any press takes over
  await flush();
  check(page.evalIn("runner.state") === "idle" && !marked() && /^Program: /.test(tab.getAttribute("title")), `unmarked once it stopped, its own title back: ${tab.getAttribute("title")}`);
  lift(page, page.$("cw"), 1);
  if (page.evalIn("'simulator' in targets")) {
    page.evalIn("runner.run(async (api) => { await api.wait(5); }, targets.simulator);");
    await flush();
    // A preview marks the tab too, another way: the simulated rover drove
    // itself under the Drive tab with nothing to say why (the review's
    // laptops 6).
    const previewing = () => tab.dataset.running === "preview" && /preview is running on the simulator/.test(tab.getAttribute("title") || "");
    check(page.evalIn("runner.target && runner.target.kind") === "simulator" && !marked() && previewing(), `a preview drives no rover: marked as a preview: ${tab.dataset.running} ${tab.getAttribute("title")}`);
    page.evalIn("runner.abort('done')");
    await flush();
    check(!previewing() && !tab.dataset.running && /^Program: /.test(tab.getAttribute("title")), "unmarked once it ends");
    const ring = cssRules(stylesheet("program.css")).find((r) => r.selector === '.tabs [role="tab"][data-running="preview"]::after');
    check(ring && /position:\s*absolute/.test(ring.body) && /border:\s*1\.5px solid var\(--ok\)/.test(ring.body) && !/animation/.test(ring.body), `a still ring in the dot's corner: ${ring && ring.body}`);
  }
  check(page.errors.length === 0, `errors ${page.errors}`);
});

test("program: the simulator's word reaches the console while a preview runs, and says where it starts", async () => {
  const page = loadPage();
  if (!page.evalIn("'simulator' in targets")) return;
  const sim = page.evalIn("targets.simulator");
  // Straight back into the wall behind the start.
  page.evalIn("globalThis.__end = null; runner.run(async (api) => { await api.drive(MOVE_BACKWARD, 100, 2); await api.explore(); }, targets.simulator).then((end) => { __end = end; });");
  await pageFrames(page, 3000, sim);
  check(ended(page) && ended(page).outcome === "done", `ended ${JSON.stringify(ended(page))}`);
  const lines = () => page.$("programLog").children.map((li) => `${li.dataset.tone}: ${li.textContent}`);
  check(lines().includes("bump: Simulator: bumped into the wall"), `the bump: ${lines()}`);
  check(lines().some((l) => /^info: Simulator: exploring is not simulated/.test(l)), `exploring: ${lines()}`);
  check(!lines().some((l) => /goes on from where/.test(l)), "the first preview started at the start: nothing to say");

  // The next preview starts where this one left the rover, and says so; the
  // simulator's word stops reaching the console once it has ended.
  page.evalIn("runner.run(async (api) => { await api.wait(0.1); }, targets.simulator);");
  await pageFrames(page, 300, sim);
  const said = lines();
  check(said.filter((l) => /^info: The preview goes on from where the last one left the simulated rover/.test(l)).length === 1, `said where: ${said}`);
  check(said.indexOf(said.find((l) => /goes on from where/.test(l))) < said.lastIndexOf("info: Started on the simulator."), "before it starts");
  sim.hold(CODES.MOVE_FORWARD, 255);
  sim.explore();
  await pageFrames(page, 100, sim);
  check(lines().length === said.length, `nothing after the preview ended: ${lines().slice(said.length)}`);
  check(page.errors.length === 0, `errors ${page.errors}`);
});

test("program: the two Stops are named apart", () => {
  const page = loadPage();
  const words = all(page.$("programStop")).map((n) => n.textContent).join(" ");
  check(/Stop program/.test(words), `the Program tab's: ${words}`);
  check(/End the program/.test(page.$("programStop").getAttribute("title") || ""), "its title says what it does");
  // The top's is its square alone, named Stop, and its title says it
  // always stops the rover.
  check(page.$("stop").getAttribute("aria-label") === "Stop" && /whatever is driving it/.test(page.$("stop").getAttribute("title") || ""), "the top's always stops the rover, and says so");
  check(page.$("programStop").getAttribute("aria-label") !== "Stop", "the Program tab's is not named Stop alone");
  check(page.errors.length === 0, `errors ${page.errors}`);
});

// A preview drives what the operator watches: pressed with the view
// folded (a phone, where it starts folded), it shows the view for the run,
// and leaves it shown after, the toggle saying so. Folded, Preview ran a
// room nobody could see (the review's phones 1). A run on the rover leaves
// the fold as it is, and a preview that cannot start shows nothing.
test("program: Preview with the view folded shows it; a run on the rover leaves it folded", async () => {
  const page = loadPage();
  if (!page.evalIn("'simulator' in targets")) return;
  standInEditor(page, "await api.wait(0.2);");
  page.fire(page.$("tabProgram"), "click");
  const view = () => `${page.$("programTab").dataset.view} ${page.$("viewToggle").getAttribute("aria-pressed")}`;
  const ws = connectOpen(page);
  ws.serverMsg(telemetry({ mode: "MANUAL" }));
  check(view() === "hidden false", `folded on a phone: ${view()}`);
  page.fire(page.$("programRun"), "click");
  await flush();
  check(page.evalIn("runner.state") === "running" && view() === "hidden false", `a run on the rover leaves it folded: ${page.evalIn("runner.state")} ${view()}`);
  page.fire(page.$("programStop"), "click");
  await flush();
  toSimulator(page);
  check(view() === "hidden false" && page.$("programRunLabel").textContent === "Preview", `folded on the simulator: ${view()}`);
  page.evalIn(`__editor.compile = () => { throw new Error("A drive until block has nothing to wait for."); };`);
  page.fire(page.$("programRun"), "click");
  await flush();
  check(page.evalIn("runner.state") === "idle" && view() === "hidden false", `a preview that cannot start shows nothing: ${view()}`);
  page.evalIn(`__editor.compile = () => async (api) => { await api.wait(0.2); };`);
  page.fire(page.$("programRun"), "click");
  await flush();
  check(page.evalIn("runner.target && runner.target.kind") === "simulator" && view() === "shown true" && /hide/i.test(page.$("viewToggle").title), `Preview shows the view: ${view()} ${page.$("viewToggle").title}`);
  await pageFrames(page, 600, page.evalIn("targets.simulator"));
  check(page.evalIn("runner.state") === "idle" && view() === "shown true", `shown after the preview, until View folds it: ${page.evalIn("runner.state")} ${view()}`);
  page.fire(page.$("viewToggle"), "click");
  check(view() === "hidden false", `View folds it: ${view()}`);
  check(page.errors.length === 0, `errors ${page.errors}`);
});

// A phone's console is one line, and its log a press of Log away: Log
// shows with the first line and counts them, and opens and closes the
// log, saying which a press does. The log opens over the editor's foot,
// out of the flow, so the editor's height never follows what was said:
// after one run the console grew to 155 px and the editor shrank from
// 470 px to 300 at 375 x 667 (the review's phones 7). Wider, the log is
// under the state, only as tall as it needs, up to five lines, on the
// console's own ground: a box the column's height under the view, it held
// one line (laptops 0), and pure black, it read as a hole (laptops 14).
test("program: a phone's Log shows with the first line, counts them, and opens over the editor", async () => {
  const page = loadPage();
  standInEditor(page);
  const toggle = page.$("programLogToggle");
  const log = page.$("programLog");
  const shut = () => `${toggle.getAttribute("aria-expanded")} ${log.dataset.open}`;
  check(toggle.hidden && log.children.length === 0, "no log, no Log");
  check(toggle.getAttribute("aria-controls") === "programLog" && toggle.parentNode === page.$("programState").parentNode, "beside the state, naming the log");
  check(shut() === "false no" && /^Show/.test(toggle.title), `shut at first: ${shut()} ${toggle.title}`);
  page.fire(page.$("programRun"), "click");
  await flush();
  check(!toggle.hidden && page.$("programLogCount").textContent === "1", `the first line: Log, counting it: ${page.$("programLogCount").textContent}`);
  page.fire(toggle, "click");
  check(shut() === "true yes" && /^Hide/.test(toggle.title), `open: ${shut()} ${toggle.title}`);
  page.fire(page.$("programRun"), "click");
  await flush();
  check(page.$("programLogCount").textContent === "2" && shut() === "true yes", `counts as lines come, open as it was: ${page.$("programLogCount").textContent}`);
  page.fire(toggle, "click");
  check(shut() === "false no" && /^Show/.test(toggle.title), `shut again: ${shut()}`);
  const programCss = stylesheet("program.css");
  const base = cssRules(outside(programCss, "@"));
  const baseOf = (selector) => base.filter((r) => r.selector === selector).map((r) => r.body).join("");
  check(/display:\s*none;/.test(baseOf(".logToggle")), "Log a phone's alone");
  const logRule = baseOf(".programLog");
  check(/flex:\s*none;/.test(logRule) && /max-height:\s*calc\(5 \* var\(--t-sm\) \* 1\.6 \+ var\(--s-1\) \+ var\(--s-2\)\);/.test(logRule) && /overflow-y:\s*auto;/.test(logRule) && /background:\s*var\(--panel\);/.test(logRule),
    `wider, the log as tall as it needs up to five lines, on the console's ground: ${logRule}`);
  const phone = blockRules(programCss, "@media (max-width: 599.98px), (max-height: 520.98px) {") || [];
  const phoneOf = (selector) => phone.filter((r) => r.selector === selector).map((r) => r.body).join("");
  check(/display:\s*inline-flex;/.test(phoneOf(".logToggle:not([hidden])")), "a phone's Log, once there is a log");
  check(/display:\s*none;/.test(phoneOf('.programLog:not([data-open="yes"])')), "shut, the log takes no room");
  const open = phoneOf('.programLog[data-open="yes"]');
  check(/position:\s*absolute;/.test(open) && /bottom:\s*calc\(100% \+ 6px\);/.test(open) && /position:\s*relative;/.test(phoneOf(".programConsole")), `open, over the editor's foot, out of the flow: ${open}`);
  check(page.errors.length === 0, `errors ${page.errors}`);
});

// The View toggle is quiet: shown, the raised ground and the ink, never
// the chosen segment's inversion, which made it the loudest thing in the
// toolbar, louder than Run and the only bright thing while Run was off
// (the review's tablets 10, laptops 14). Run is the one loud control.
test("program: the View toggle is quiet, shown or folded", () => {
  const rules = cssRules(outside(stylesheet("program.css"), "@media"));
  const of = (selector) => rules.filter((r) => r.selector === selector).map((r) => r.body).join("");
  check(/color:\s*var\(--readout\);/.test(of('.viewToggle[aria-pressed="true"]')) && /background:\s*var\(--raised\);/.test(of('.viewToggle[aria-pressed="true"]')), `shown: ${of('.viewToggle[aria-pressed="true"]')}`);
  check(/color:\s*var\(--dim\);/.test(of('.viewToggle[aria-pressed="false"]')), `folded: ${of('.viewToggle[aria-pressed="false"]')}`);
  const loud = cssRules(stylesheet("program.css")).filter((r) => /viewToggle/.test(r.selector) && /--chosen|--on-chosen|--live/.test(r.body));
  check(loud.length === 0, `nothing paints it as a choice or a live control: ${loud.map((r) => r.selector)}`);
});

// In a short view (a phone's band over the editor, the middle of a phone
// on its side), the connect card is one compact row under the fan, its
// button and Change address: sized for a tall pane, it covered most of a
// short fan (the review's tablets 2).
test("program: the connect card is a compact row under the fan in a short view", () => {
  const short = blockRules(panelCss(), "@container scan (max-height: 259.98px) {") || [];
  const card = short.filter((r) => r.selector === ".scan > .connectCard").map((r) => r.body).join("");
  check(/grid-auto-flow:\s*column;/.test(card) && /place-self:\s*end center;/.test(card) && /background:\s*none;/.test(card) && /box-shadow:\s*none;/.test(card), `one row, at the foot, with no card around it: ${card}`);
  check(short.some((r) => r.selector.split(/,\s*/).includes(".connectTitle") && /display:\s*none;/.test(r.body)), "its title in the top's chip, not over the fan");
  check(!short.some((r) => /connectGo|connectAddress/.test(r.selector) && /display:\s*none/.test(r.body)), "Connect and Change address both there");
  // Narrow too (a phone on its side at 480 px), Connect alone, whole: beside
  // it, Change address wrapped and cut the button to "ct to 192.16". The
  // top's link chip changes the address there.
  const narrow = blockRules(panelCss(), "@container scan (max-height: 259.98px) and (max-width: 329.98px) {") || [];
  check(narrow.some((r) => r.selector.split(/,\s*/).includes(".connectAddress") && /display:\s*none;/.test(r.body)) && !narrow.some((r) => /connectGo/.test(r.selector)), "a short, narrow view: Connect alone");
  check(/grid-auto-columns:\s*minmax\(0, max-content\);/.test(card) && short.some((r) => r.selector === ".connectAddress" && /white-space:\s*nowrap;/.test(r.body)), "each on one line, the button giving way first");
});

/* --- the target: the Drive tab on the simulator ---------------------------- */

// Every command the page's simulator takes from the Driver, as move names,
// with the speed and duration of the last.
function simCommands(page) {
  page.evalIn(`
    globalThis.__simTook = [];
    const simulator = targets.simulator;
    const take = simulator.command.bind(simulator);
    simulator.command = (move, speed, duration) => {
      __simTook.push({ move, speed, duration });
      take(move, speed, duration);
    };
  `);
  return Object.assign((from = 0) => page.evalIn("__simTook").slice(from).map((c) => NAMES[c.move]), {
    count: () => page.evalIn("__simTook.length"),
    last: () => page.evalIn("__simTook[__simTook.length - 1]"),
  });
}
const toSimulator = (page) => page.fire(segments(page)[1], "click");
const toRover = (page) => page.fire(segments(page)[0], "click");

// The owner's ask (F8): "Rover or simulator should be the first option".
test("target: one switch, the first thing in the top's first cell, for both tabs", () => {
  const page = loadPage();
  const first = page.doc.documentElement.querySelector(".cells").children[0];
  check(first.children[0] === page.$("target"), `the first cell starts with the target: ${first.children.map((n) => n.id)}`);
  const word = (b) => all(b).filter((n) => n.getAttribute && n.getAttribute("class") === "segWord").map((n) => n.textContent).join("");
  check(page.$("target").children.map(word).join(" | ") === "Rover | Simulator", `Rover | Simulator, the rover first: ${page.$("target").children.map(word)}`);
  check(page.$("target").getAttribute("role") === "group" && /Drive and run programs on/.test(page.$("target").getAttribute("aria-label")),
    "named for what it picks");
  check(!all(page.$("programTab")).some((n) => n.getAttribute("class") === "segmented" && n.parentNode.getAttribute("role") === "toolbar"),
    "the Program toolbar has no switch of its own");
  check(page.$("programTarget") === null, "the old switch is gone");
  check(page.doc.body.dataset.target === "rover", "the rover at first");
  toSimulator(page);
  check(page.doc.body.dataset.target === "simulator", "the page knows the target, for its layout");
  check(page.errors.length === 0, `errors ${page.errors}`);
});

test("target: on the simulator the Drive tab drives it, and nothing but Stop reaches the open Link", () => {
  const { page, ws } = connected(telemetry({ mode: "MANUAL" }));
  const sim = simCommands(page);
  const state = () => page.evalIn("targets.simulator.state");
  toSimulator(page);
  check(count(ws) === 0 && sim.count() === 0, `the switch with nothing held sent ${names(ws)} and ${sim()}`);

  press(page, page.$("cw"), 1);
  page.clock.advance(450);
  check(state().move === CODES.ROTATE_CLOCKWISE && state().moving, `rotating: ${JSON.stringify(state().move)}`);
  lift(page, page.$("cw"), 1);
  check(sim().join() === "ROTATE_CLOCKWISE,ROTATE_CLOCKWISE,ROTATE_CLOCKWISE,STOP", `rotate: ${sim()}`);
  check(!state().moving, "let go: stopped");

  const s = stickTouch(page, 0);
  s.start(); s.move(0, -100);
  check(sim().slice(-1)[0] === "MOVE_FORWARD" && state().moving, `the stick: ${sim()}`);
  check(sim.last().speed === Number(page.$("speed").value) && sim.last().duration === page.evalIn("MOVE_DURATION_MS"),
    `at the slider's speed, for one command's time: ${JSON.stringify(sim.last())}`);
  page.$("speed").value = "128";
  page.fire(page.$("speed"), "input");
  page.clock.advance(250);
  check(sim.last().speed === 128, `the speed follows the slider: ${JSON.stringify(sim.last())}`);
  s.end();
  check(sim().slice(-1)[0] === "STOP" && !state().moving, `let go: ${sim()}`);

  // The pivot stick, under the simulator's own ADVANCED, as on the rover.
  page.fire(schemeButton(page, "ADVANCED"), "click");
  const p = pivotTouch(page, 1);
  p.start(); p.move(60, -60);
  check(sim().slice(-1)[0] === "PIVOT_RIGHT_FORWARD", `a pivot: ${sim()}`);
  p.end();

  check(count(ws) === 0, `the rover got ${names(ws)}`);
  // Autonomous: the simulator alone, which says exploring is not simulated.
  // The toggle shows the simulated rover's mode, at once, never the rover's.
  const lit = () => page.$("auto").getAttribute("aria-pressed");
  page.fire(page.$("auto"), "click");
  check(count(ws) === 0 && state().mode === "AUTONOMOUS", `Autonomous: ${names(ws)}, ${state().mode}`);
  check(lit() === "true", "on: the simulated rover explores");
  check(/exploring is not simulated/.test(page.$("auto").getAttribute("title")), `its title says so: ${page.$("auto").getAttribute("title")}`);
  page.fire(page.$("auto"), "click");
  check(count(ws) === 0 && sim().slice(-1)[0] === "STOP" && state().mode === "MANUAL" && lit() === "false",
    `off again, the rover left alone: ${names(ws)}, ${sim()}, ${state().mode}, ${lit()}`);
  ws.serverMsg(telemetry({ mode: "AUTONOMOUS" }));
  check(lit() === "false", "the rover exploring does not light it on the simulator");
  page.fire(page.$("auto"), "click");
  check(count(ws) === 0 && lit() === "true", "on again");
  // Stop: everything, the rover included.
  page.fire(page.$("stop"), "click");
  check(names(ws).join() === "STOP", `Stop reached the rover: ${names(ws)}`);
  check(sim().slice(-1)[0] === "STOP" && state().mode === "MANUAL", `and the simulator: ${sim()}`);
  // With no link, Stop still stops the simulator, and nothing fails.
  ws.serverDrop();
  page.fire(page.$("stop"), "click");
  check(sim().slice(-1)[0] === "STOP", "Stop with the link down");
  check(lit() === "false", "Stop turned the simulated rover's off");
  toRover(page);
  check(/^Autonomous \(T\): on, the rover explores by itself/.test(page.$("auto").getAttribute("title")), "back on the rover, Autonomous's own title");
  check(lit() === "true", "and the mode the rover last reported, kept meanwhile");
  check(page.errors.length === 0, `errors ${page.errors}`);
});

test("target: on the simulator Stop reaches the rover first, whatever the simulator does", () => {
  const { page, ws } = connected(telemetry());
  toSimulator(page);
  page.evalIn("targets.simulator.command = () => { throw new Error('a fault in the simulator'); };");
  page.fire(page.$("stop"), "click");
  check(names(ws).join() === "STOP", `the exploring rover was sent ${names(ws)}`);
});

test("target: a switch under a held control sends one STOP to the target left behind, then nothing until a fresh press", () => {
  const { page, ws } = connected(telemetry({ mode: "MANUAL" }));
  const sim = simCommands(page);

  // From the rover, a rotate button held.
  press(page, page.$("cw"), 1);
  page.clock.advance(250);
  check(names(ws).join() === "ROTATE_CLOCKWISE,ROTATE_CLOCKWISE", `rotating: ${names(ws)}`);
  toSimulator(page);
  check(names(ws).join() === "ROTATE_CLOCKWISE,ROTATE_CLOCKWISE,STOP", `one STOP to the rover: ${names(ws)}`);
  page.clock.advance(1000);
  lift(page, page.$("cw"), 1);
  check(count(ws) === 3 && sim.count() === 0, `then nothing anywhere: ${names(ws, 3)}, ${sim()}`);
  check(page.$("cw").dataset.held === undefined, "the button no longer shows held");

  // From the simulator, the stick held.
  const s = stickTouch(page, 0);
  s.start(); s.move(0, -100);
  check(sim().join() === "MOVE_FORWARD", `driving the simulator: ${sim()}`);
  toRover(page);
  check(sim().join() === "MOVE_FORWARD,STOP" && count(ws) === 3, `one STOP to the simulator, nothing to the rover: ${sim()}, ${names(ws, 3)}`);
  s.move(0, -90);
  page.clock.advance(1000);
  s.end();
  check(count(ws) === 3 && sim.count() === 2, `then nothing until a fresh press: ${names(ws, 3)}, ${sim(2)}`);
  s.start(); s.move(0, -100);
  check(names(ws, 3).join() === "MOVE_FORWARD", `a fresh press drives the rover: ${names(ws, 3)}`);
  s.end();

  // Nothing held: a switch sends nothing either way.
  const mark = count(ws);
  toSimulator(page);
  toRover(page);
  check(count(ws) === mark && sim.count() === 2, `nothing held: ${names(ws, mark)}, ${sim(2)}`);
  check(page.errors.length === 0, `errors ${page.errors}`);
});

test("target: a lost or stale link lets go of nothing driving the simulator", () => {
  const { page, ws } = connected(telemetry({ mode: "MANUAL" }));
  const sim = simCommands(page);
  toSimulator(page);
  press(page, page.$("ccw"), 1);
  page.clock.advance(3000); // no telemetry meanwhile: the link goes stale
  ws.serverDrop();
  page.clock.advance(400);
  check(sim().every((m) => m === "ROTATE_COUNTERCLOCKWISE") && sim.count() >= 15, `driving on: ${sim.count()} ${sim().slice(-2)}`);
  lift(page, page.$("ccw"), 1);
  check(sim().slice(-1)[0] === "STOP", "let go: STOP");

  // Nor a held stick: the scheme it drives with is the simulator's, which
  // the rover's link does not carry (F3g). Before, the rover's scheme went
  // with the link and the stick was let go.
  const ws2 = connectOpen(page);
  ws2.serverMsg(telemetry({ mode: "MANUAL", scheme: "ADVANCED" }));
  const s = stickTouch(page, 0);
  s.start(); s.move(0, -100);
  const mark = sim.count();
  ws2.serverDrop();
  page.clock.advance(1000);
  check(sim(mark).length >= 4 && sim(mark).every((m) => m === "MOVE_FORWARD"), `driving on: ${sim(mark)}`);
  s.end();
  check(sim().slice(-1)[0] === "STOP", "let go: STOP");
  check(page.errors.length === 0, `errors ${page.errors}`);
});

// The scheme toggle shows and sets the target's scheme (F3g): on the
// simulator its own, so Normal | Advanced work with no rover, and nothing of
// it reaches the Link.
test("target: on the simulator the scheme toggle sets the simulator's scheme, with no rover, and sends nothing", () => {
  const page = loadPage();
  // With no socket a send goes nowhere, so the Link is watched instead.
  page.evalIn("globalThis.__linkSent = []; const send = link.send.bind(link); link.send = (frame) => (__linkSent.push(frame), send(frame));");
  const scheme = () => page.evalIn("targets.simulator.scheme");
  check(shownScheme(page) === "unknown" && SCHEMES.every((x) => !schemeButton(page, x).disabled), "the rover's, unknown, at first, taking a wish");
  page.fire(schemeButton(page, "ADVANCED"), "click"); // a wish for the rover, kept unseen on the simulator
  check(pendingScheme(page) === "ADVANCED", `the wish marked: ${pendingScheme(page)}`);
  toSimulator(page);
  check(pendingScheme(page) === null && page.evalIn("schemeToggle.wanted") === "ADVANCED", `the rover's wish unseen on the simulator, and kept: ${pendingScheme(page)}`);
  check(shownScheme(page) === "NORMAL" && page.$("scheme").dataset.state === "known", `the simulator's: ${shownScheme(page)} ${page.$("scheme").dataset.state}`);
  check(SCHEMES.every((x) => !schemeButton(page, x).disabled), "offered");
  check(/simulator/i.test(page.$("scheme").title), `its title says whose: ${page.$("scheme").title}`);
  page.fire(schemeButton(page, "ADVANCED"), "click");
  check(scheme() === "ADVANCED" && shownScheme(page) === "ADVANCED" && pendingScheme(page) === null, `set at once: ${scheme()} ${shownScheme(page)} pending ${pendingScheme(page)}`);
  check(page.$("scheme").getAttribute("aria-busy") === "false", "never busy");
  check(pivotsState(page) === "on", `the Drive tab's pivot stick follows it: ${pivotsState(page)}`);
  page.fire(familyButton(page, "PIVOT_SIDEWAYS"), "click");
  const sim = simCommands(page);
  const s = pivotTouch(page, 0);
  s.start(); s.move(60, -60);
  check(sim().slice(-1)[0] === "PIVOT_SIDEWAYS_FORWARD_RIGHT", `a pivot on the simulated rover: ${sim()}`);
  // Back to NORMAL: the pivot stick lets go and goes off, as under the
  // rover's.
  page.fire(schemeButton(page, "NORMAL"), "click");
  check(scheme() === "NORMAL" && pivotsState(page) === "off" && sim().slice(-1)[0] === "STOP", `NORMAL: pivots ${pivotsState(page)}, ${sim()}`);
  s.end();
  toRover(page);
  check(shownScheme(page) === "unknown" && pendingScheme(page) === "ADVANCED", `back on the rover, its wish again: ${shownScheme(page)}, ${pendingScheme(page)}`);
  check(page.sockets.length === 0, `no socket: ${page.sockets.length}`);
  check(page.evalIn("__linkSent.length") === 0, `the Link was handed ${page.evalIn("JSON.stringify(__linkSent)")}`);
  check(page.errors.length === 0, `errors ${page.errors}`);
});

// A wish for the rover's scheme waits while the simulator is the target:
// from there nothing goes to the rover but Stop (targetswitch.js), and the
// toggle shows the simulator's scheme, so a wish sent then changed the
// rover unseen (the reviewer's round 1). It goes as the rover is the
// target again, if the rover has named the other scheme by then (once,
// pending as a press's), nowhere if it named the one wished for, and on
// the next frame if the link is stale then or the rover has named none.
test("target: a scheme wish waits, unsent, while the simulator is the target, and goes once the rover is the target again", () => {
  let page = loadPage();
  page.fire(schemeButton(page, "ADVANCED"), "click");
  toSimulator(page);
  let ws = connectOpen(page);
  liveFor(page, ws, 1500, { mode: "MANUAL", scheme: "NORMAL" });
  check(count(ws) === 0, `sent from the simulator target: ${ws.sent}`);
  check(page.evalIn("schemeToggle.wanted") === "ADVANCED" && pendingScheme(page) === null && shownScheme(page) === "NORMAL", `kept, unseen: ${page.evalIn("schemeToggle.wanted")}, marked ${pendingScheme(page)}, shows the simulator's ${shownScheme(page)}`);
  check(page.$("linkWish").hidden && page.$("connectWish").hidden, "not said either, while the simulator is the target");
  toRover(page);
  check(ws.sent.join() === '{"scheme":"ADVANCED"}', `sent as the rover is the target again: ${ws.sent}`);
  check(page.evalIn("schemeToggle.wanted") === null && pendingScheme(page) === "ADVANCED" && shownScheme(page) === "NORMAL" && page.$("scheme").dataset.state === "pending", `pending as a press's: ${pendingScheme(page)}, shows ${shownScheme(page)}`);
  check(page.$("linkWish").hidden, "a request, no longer a wish");
  liveFor(page, ws, 1000, { mode: "MANUAL", scheme: "ADVANCED" });
  check(shownScheme(page) === "ADVANCED" && pendingScheme(page) === null && count(ws) === 1, `confirmed, sent once: ${shownScheme(page)}, ${ws.sent}`);
  check(page.errors.length === 0, `errors ${page.errors}`);

  // The rover named the scheme wished for: nothing to send.
  page = loadPage();
  page.fire(schemeButton(page, "ADVANCED"), "click");
  toSimulator(page);
  ws = connectOpen(page);
  liveFor(page, ws, 1000, { mode: "MANUAL", scheme: "ADVANCED" });
  toRover(page);
  check(count(ws) === 0 && page.evalIn("schemeToggle.wanted") === null && pendingScheme(page) === null && shownScheme(page) === "ADVANCED", `met: sent ${ws.sent}, wanted ${page.evalIn("schemeToggle.wanted")}, shows ${shownScheme(page)}`);
  check(page.errors.length === 0, `errors ${page.errors}`);

  // Stale as the rover is the target again: no request on a link whose
  // telemetry cannot confirm it. The next frame sends it.
  page = loadPage();
  page.fire(schemeButton(page, "NORMAL"), "click");
  toSimulator(page);
  ws = connectOpen(page);
  ws.serverMsg(telemetry({ mode: "MANUAL", scheme: "ADVANCED" }));
  page.clock.advance(page.evalIn("Link.STALE_MS"));
  check(page.doc.body.dataset.link === "stale", `stale: ${page.doc.body.dataset.link}`);
  toRover(page);
  check(count(ws) === 0 && page.evalIn("schemeToggle.wanted") === "NORMAL" && pendingScheme(page) === "NORMAL", `stale: sent ${ws.sent}, wanted ${page.evalIn("schemeToggle.wanted")}, marked ${pendingScheme(page)}`);
  ws.serverMsg(telemetry({ mode: "MANUAL", scheme: "ADVANCED" }));
  check(ws.sent.join() === '{"scheme":"NORMAL"}' && page.evalIn("schemeToggle.wanted") === null, `the next frame sent ${ws.sent}`);
  check(page.errors.length === 0, `errors ${page.errors}`);

  // A rover that names no scheme leaves the wish waiting, on either
  // target; back on the rover's, the first frame that names one sends it.
  page = loadPage();
  page.fire(schemeButton(page, "ADVANCED"), "click");
  toSimulator(page);
  ws = connectOpen(page);
  liveFor(page, ws, 1000, { mode: "MANUAL", scheme: undefined });
  toRover(page);
  check(count(ws) === 0 && pendingScheme(page) === "ADVANCED", `no scheme named: sent ${ws.sent}, marked ${pendingScheme(page)}`);
  ws.serverMsg(telemetry({ mode: "MANUAL", scheme: "NORMAL" }));
  check(ws.sent.join() === '{"scheme":"ADVANCED"}', `the first frame naming one sent ${ws.sent}`);
  check(page.errors.length === 0, `errors ${page.errors}`);
});

test("target: the simulator's scheme starts from the rover's and is its own while it is the target", () => {
  const { page, ws } = connected(telemetry({ mode: "MANUAL", scheme: "ADVANCED" }));
  const scheme = () => page.evalIn("targets.simulator.scheme");
  check(scheme() === "ADVANCED", "on the rover target the simulator takes the rover's");
  toSimulator(page);
  check(shownScheme(page) === "ADVANCED", "a switch starts from it");
  page.fire(schemeButton(page, "NORMAL"), "click");
  check(count(ws) === 0, `the rover was sent ${ws.sent}`);
  // The rover's reports go on, kept and not shown; the rover changing its
  // scheme leaves the simulator's alone.
  liveFor(page, ws, 1000, { mode: "MANUAL", scheme: "ADVANCED" });
  ws.serverMsg(telemetry({ mode: "MANUAL", scheme: "NORMAL" }));
  ws.serverMsg(telemetry({ mode: "MANUAL", scheme: "ADVANCED" }));
  check(shownScheme(page) === "NORMAL" && scheme() === "NORMAL", `its own: ${shownScheme(page)} ${scheme()}`);
  // The rover's link stale or gone changes nothing shown.
  page.clock.advance(3000);
  check(page.$("scheme").dataset.state === "known" && SCHEMES.every((x) => !schemeButton(page, x).disabled), "stale link: still offered");
  ws.serverDrop();
  check(shownScheme(page) === "NORMAL", "link gone: still the simulator's");
  // Back on the rover: the rover's again, unknown with no link, and the
  // simulator keeps its own until the rover reports one.
  toRover(page);
  check(shownScheme(page) === "unknown" && scheme() === "NORMAL", `the rover's: ${shownScheme(page)}, the simulator's ${scheme()}`);
  const ws2 = connectOpen(page);
  ws2.serverMsg(telemetry({ mode: "MANUAL", scheme: "ADVANCED" }));
  check(shownScheme(page) === "ADVANCED" && scheme() === "ADVANCED", `then follows it: ${scheme()}`);
  check(count(ws2) === 0, `sent ${ws2.sent}`);
  check(page.errors.length === 0, `errors ${page.errors}`);
});

test("target: a request to the rover still pending is not shown on the simulator, and lands as ever", () => {
  const { page, ws } = connected(telemetry({ mode: "MANUAL", scheme: "NORMAL" }));
  page.fire(schemeButton(page, "ADVANCED"), "click");
  check(pendingScheme(page) === "ADVANCED", "pending");
  toSimulator(page);
  check(pendingScheme(page) === null && page.$("scheme").dataset.state === "known" && shownScheme(page) === "NORMAL", `the simulator's, with no mark: ${pendingScheme(page)} ${shownScheme(page)}`);
  ws.serverMsg(telemetry({ mode: "MANUAL", scheme: "ADVANCED" }));
  check(shownScheme(page) === "NORMAL", "the rover's report is not shown here");
  toRover(page);
  check(shownScheme(page) === "ADVANCED" && pendingScheme(page) === null, `the rover's, confirmed: ${shownScheme(page)}`);
  check(ws.sent.join() === '{"scheme":"ADVANCED"}', `sent ${ws.sent}`);
  check(page.errors.length === 0, `errors ${page.errors}`);
});

test("program: the editor is told the scheme the toggle shows, the target's, so that a pivot under NORMAL says so", () => {
  const { page, ws } = connected(telemetry({ mode: "MANUAL", scheme: "ADVANCED" }));
  standInEditor(page);
  const told = () => page.evalIn("__editor.schemes.join()");
  check(told() === "ADVANCED", `on attaching: ${told()}`);
  ws.serverMsg(telemetry({ mode: "MANUAL", scheme: "NORMAL" }));
  check(told() === "ADVANCED,NORMAL", `the rover's change: ${told()}`);
  toSimulator(page);
  page.fire(schemeButton(page, "ADVANCED"), "click");
  check(told() === "ADVANCED,NORMAL,ADVANCED", `the simulator's: ${told()}`);
  toRover(page);
  check(told() === "ADVANCED,NORMAL,ADVANCED,NORMAL", `the rover's again: ${told()}`);
  ws.serverDrop();
  check(page.evalIn("__editor.schemes[__editor.schemes.length - 1]") === null, `unknown with the link gone: ${told()}`);
  check(page.errors.length === 0, `errors ${page.errors}`);

  // A page that opens on the simulator: the editor, built later, is told
  // the simulator's scheme, not nothing.
  const onSim = loadPage({ stored: { "rover.target": "simulator" } });
  standInEditor(onSim);
  check(onSim.evalIn("__editor.schemes.join()") === "NORMAL", `opened on the simulator: ${onSim.evalIn("__editor.schemes.join()")}`);
  check(onSim.errors.length === 0, `errors ${onSim.errors}`);
});

// Blockly never loads here, so the editor gets a stand-in workspace of a few
// blocks, as far as BlockEditor reaches them, and the warnings they carry.
test("program: the editor warns each pivot that runs, under NORMAL only, and clears what Blockly echoes on a folded block", () => {
  const page = loadPage();
  page.evalIn(`
    // A block as Blockly gives it: its warnings by id, and what it holds.
    const block = (type, move, { enabled = true, inherited = false, collapsed = false, holds = [] } = {}) => ({
      type, move, enabled, inherited, collapsed, holds, next: null, warnings: new Map(),
      getFieldValue() { return this.move; },
      isEnabled() { return this.enabled; },
      getInheritedDisabled() { return this.inherited; },
      isCollapsed() { return this.collapsed; },
      getNextBlock() { return this.next; },
      // Blockly's own counts the blocks after it too.
      getDescendants() { return [this, ...[...this.holds, this.next].filter(Boolean).flatMap((b) => b.getDescendants())]; },
      getIcon(type) { return type === "warning" && this.warnings.size > 0 ? {} : null; },
      setWarningText(text, id) { if (text) this.warnings.set(id, text); else this.warnings.delete(id); },
    });
    const pivot = block("rover_drive_for", "PIVOT_RIGHT_FORWARD");
    const forward = block("rover_drive_until", "MOVE_FORWARD");
    const off = block("rover_drive_for", "PIVOT_LEFT_FORWARD", { enabled: false });
    const inside = block("rover_drive_for", "PIVOT_LEFT_BACKWARD", { inherited: true });
    const folded = block("rover_drive_for", "PIVOT_SIDEWAYS_FORWARD_RIGHT");
    const fold = block("controls_repeat_ext", null, { collapsed: true, holds: [folded] });
    // A warned pivot after the folded block is not in it.
    fold.next = block("rover_drive_for", "PIVOT_RIGHT_BACKWARD");
    // Blockly's echo, as it puts it on a folded block holding a warning.
    fold.warnings.set("TEMP_COLLAPSED_WARNING_", "Collapsed blocks contain warnings.");
    globalThis.__blocks = { pivot, forward, off, inside, folded, fold, after: fold.next };
    const all = Object.values(__blocks);
    const any = new Proxy(function () {}, { get: () => any, apply: () => any, construct: () => any });
    const workspace = new Proxy({
      getAllBlocks: () => all,
      getTopBlocks: () => [pivot, forward, off, fold],
      addChangeListener: (fn) => { globalThis.__changed = fn; },
    }, { get: (t, key) => t[key] || any });
    const stub = {
      inject: () => workspace,
      Theme: { defineTheme: (_, theme) => theme },
      icons: { IconType: { WARNING: "warning" } },
      BlockSvg: { COLLAPSED_WARNING_ID: "TEMP_COLLAPSED_WARNING_" },
    };
    globalThis.javascript = { Order: any };
    window.matchMedia = () => ({ matches: false, addEventListener() {} });
    byId("programWorkspace").style.setProperty = () => {};
    globalThis.__editor = new BlockEditor(byId("programWorkspace"), { Blockly: new Proxy(stub, { get: (t, key) => t[key] || any }), generator: any, storageKey: "test.program" });
  `);
  const warned = () => JSON.parse(page.evalIn(`JSON.stringify(Object.fromEntries(Object.entries(__blocks).map(([k, b]) => [k, [...b.warnings.keys()].join()])))`));
  const pivots = () => page.evalIn("__editor.pivots.join('; ')");
  check(Object.entries(warned()).every(([k, ids]) => k === "fold" ? ids === "TEMP_COLLAPSED_WARNING_" : ids === ""), `no scheme yet, nothing marked: ${JSON.stringify(warned())}`);
  page.evalIn('__editor.setScheme("NORMAL")');
  let w = warned();
  check(w.pivot === "scheme" && w.folded === "scheme" && w.after === "scheme", `the pivots that run are marked: ${JSON.stringify(w)}`);
  check(w.forward === "" && w.off === "" && w.inside === "", `a translation, a disabled pivot and one in a disabled block are not: ${JSON.stringify(w)}`);
  check(page.evalIn("__blocks.pivot.warnings.get('scheme')") === page.evalIn("RoverBlocks.PIVOT_WARNING"), "in the pivot warning's words");
  check(w.fold === "TEMP_COLLAPSED_WARNING_", `the folded block keeps Blockly's echo while it holds a warning: ${JSON.stringify(w)}`);
  check(!/Pivot left, backward|Pivot left, forward/.test(pivots()), `Run asks about no pivot that never runs: ${pivots()}`);
  page.evalIn('__editor.setScheme("ADVANCED")');
  w = warned();
  check(Object.values(w).every((ids) => ids === ""), `under ADVANCED nothing, Blockly's echo on the folded block included: ${JSON.stringify(w)}`);
  // A change re-marks: the disabled pivot enabled under NORMAL.
  page.evalIn('__editor.setScheme("NORMAL"); __blocks.off.enabled = true; __changed({ isUiEvent: false })');
  check(warned().off === "scheme", `an enabled pivot is marked at the next change: ${JSON.stringify(warned())}`);
  page.evalIn('__blocks.off.move = "MOVE_LEFT"; __changed({ isUiEvent: false })');
  check(warned().off === "", `and cleared once it drives otherwise: ${JSON.stringify(warned())}`);
  // The folded pivot driving otherwise leaves the folded block holding no
  // warning, though the pivot after it still has one.
  page.evalIn('__blocks.fold.warnings.set("TEMP_COLLAPSED_WARNING_", "echo"); __blocks.folded.move = "MOVE_FORWARD"; __changed({ isUiEvent: false })');
  w = warned();
  check(w.folded === "" && w.after === "scheme" && w.fold === "", `the echo goes with what it folds: ${JSON.stringify(w)}`);
  check(page.errors.length === 0, `errors ${page.errors}`);
});

// Blockly's scrollbars only while the program runs past the view: on an
// empty workspace, or one whose blocks all show, they said there was more
// to see when there was nothing (the review's laptops 14). Marked on the
// editor's box at once, on every change (a scroll or a zoom among them)
// and on a resize; where Blockly cannot say, they show.
test("program: the editor marks whether the program runs past its view, and the scrollbars show only then", () => {
  const page = loadPage();
  page.evalIn(`
    globalThis.__metrics = { view: { left: 0, top: 0, width: 400, height: 300 }, content: { left: 0, top: 0, width: 0, height: 0 } };
    const any = new Proxy(function () {}, { get: () => any, apply: () => any, construct: () => any });
    const workspace = new Proxy({
      getMetricsManager: () => ({ getViewMetrics: () => __metrics.view, getContentMetrics: () => __metrics.content }),
      addChangeListener: (fn) => { globalThis.__changed = fn; },
    }, { get: (t, key) => t[key] || any });
    const stub = { inject: () => workspace, Theme: { defineTheme: (_, theme) => theme } };
    globalThis.javascript = { Order: any };
    window.matchMedia = () => ({ matches: false, addEventListener() {} });
    byId("programWorkspace").style.setProperty = () => {};
    globalThis.__editor = new BlockEditor(byId("programWorkspace"), { Blockly: new Proxy(stub, { get: (t, key) => t[key] || any }), generator: any, storageKey: "test.program" });
  `);
  const mark = () => page.$("programWorkspace").dataset.overflow;
  check(mark() === "no", `empty: nothing past the view: ${mark()}`);
  page.evalIn("__metrics.content = { left: 20, top: 20, width: 200, height: 100 }; __changed({ isUiEvent: false });");
  check(mark() === "no", `blocks that all show: ${mark()}`);
  page.evalIn("__metrics.content = { left: 20, top: 20, width: 200, height: 400 }; __changed({ isUiEvent: false });");
  check(mark() === "yes", `a program longer than the view: ${mark()}`);
  page.evalIn("__metrics.view = { left: 0, top: 150, width: 400, height: 300 }; __metrics.content = { left: 20, top: 20, width: 200, height: 100 }; __changed({ isUiEvent: true });");
  check(mark() === "yes", `scrolled past it, a scroll is a UI event: ${mark()}`);
  page.evalIn("__metrics.view = { left: 0, top: 0, width: 400, height: 300 }; __editor.resize();");
  check(mark() === "no", `back in sight on a resize: ${mark()}`);
  page.evalIn("__metrics.view = { left: NaN, top: 0, width: 400, height: 300 }; __changed({ isUiEvent: true });");
  check(mark() === "yes", `Blockly cannot say: they show: ${mark()}`);
  const rules = cssRules(outside(stylesheet("program.css"), "@media")).filter((r) => /data-overflow="no"/.test(r.selector));
  check(rules.some((r) => /blocklyScrollbarHorizontal/.test(r.selector) && /blocklyScrollbarVertical/.test(r.selector) && /visibility:\s*hidden;/.test(r.body)), `the scrollbars hidden while nothing is past the view: ${rules.map((r) => r.selector)}`);
  check(page.errors.length === 0, `errors ${page.errors}`);
});

test("target: leaving the Drive tab on the simulator lets go of a held rotate button too", () => {
  // Off the Drive tab the view plays at the operator's speed, and at 4x each
  // re-sent move ran out before the next: the simulated rover drove in jerks.
  const page = loadPage();
  const sim = simCommands(page);
  toSimulator(page);
  press(page, page.$("cw"), 1);
  page.clock.advance(250);
  page.fire(page.$("tabProgram"), "click");
  check(sim().join() === "ROTATE_CLOCKWISE,ROTATE_CLOCKWISE,STOP", `one STOP: ${sim()}`);
  page.clock.advance(1000);
  lift(page, page.$("cw"), 1);
  check(sim.count() === 3, `then nothing: ${sim()}`);
  check(page.errors.length === 0, `errors ${page.errors}`);
});

test("target: a drive press takes the simulated rover over from a preview, and only the Driver's moves reach it then", async () => {
  const { page } = connected(telemetry({ mode: "MANUAL" }));
  const sim = simCommands(page);
  toSimulator(page);
  page.evalIn("globalThis.__end = null; runner.run(async (api) => { for (;;) await api.drive(MOVE_BACKWARD, 100, 5); }, targets.simulator).then((end) => { __end = end; });");
  await pageFrames(page, 300, page.evalIn("targets.simulator"));
  check(page.evalIn("targets.simulator.state.held && targets.simulator.state.held.move") === CODES.MOVE_BACKWARD, "the preview drives");
  const s = stickTouch(page, 0);
  s.start(); s.move(0, -100);
  await pageFrames(page, 600, page.evalIn("targets.simulator"));
  const end = ended(page);
  check(end && end.outcome === "stopped" && /driven by hand/.test(end.reason), `ended ${JSON.stringify(end)}`);
  const state = page.evalIn("targets.simulator.state");
  check(state.move === CODES.MOVE_FORWARD && state.moving && state.held === null, `the stick's move, not the program's: ${state.move}`);
  check(sim().every((m) => m === "MOVE_FORWARD"), `the Driver's moves alone: ${sim()}`);
  s.end();

  // The same for a rotate button, which acts before it says it was pressed.
  page.evalIn("globalThis.__end = null; runner.run(async (api) => { for (;;) await api.drive(MOVE_BACKWARD, 100, 5); }, targets.simulator).then((end) => { __end = end; });");
  await pageFrames(page, 300, page.evalIn("targets.simulator"));
  press(page, page.$("cw"), 1);
  await pageFrames(page, 300, page.evalIn("targets.simulator"));
  check(ended(page) && /driven by hand/.test(ended(page).reason), `rotate: ${JSON.stringify(ended(page))}`);
  check(page.evalIn("targets.simulator.state.move") === CODES.ROTATE_CLOCKWISE && page.evalIn("targets.simulator.state.moving"), "rotating, the program's release stopped nothing");
  lift(page, page.$("cw"), 1);

  // Stop names itself, as on the rover.
  page.evalIn("globalThis.__end = null; runner.run(async (api) => { await api.wait(5); }, targets.simulator).then((end) => { __end = end; });");
  await flush();
  page.fire(page.$("stop"), "click");
  await pageFrames(page, 100, page.evalIn("targets.simulator"));
  check(ended(page) && /Stop was pressed/.test(ended(page).reason), `Stop: ${JSON.stringify(ended(page))}`);
  check(page.errors.length === 0, `errors ${page.errors}`);
});

// One view of the simulator, in the view pane's one slot whatever the tab
// and the target: it never moves. On the Drive tab with the simulator the
// target, the Driver re-sends in real time, so the view plays at 1x there,
// and a pause left on the Program tab is lifted.
test("target: one view of the simulator, in one slot, held at 1x while the Drive tab drives it", () => {
  const page = loadPage();
  const view = () => page.doc.documentElement.querySelectorAll(".sim")[0];
  const slot = () => view().parentNode;
  const home = page.$("simSlot");
  const sim = page.evalIn("targets.simulator");
  const pick = () => view().querySelectorAll(".sim-speed-pick")[0];
  const options = () => all(view()).filter((n) => n.tagName === "OPTION" && n.parentNode.getAttribute("class") === "sim-speed-pick");
  const play = (rate) => {
    pick().value = String(rate);
    page.fire(pick(), "change");
  };
  const why = () => view().querySelectorAll(".sim-held")[0];
  check(page.doc.documentElement.querySelectorAll(".sim").length === 1, "one view");
  check(slot() === home && home.parentNode === page.$("view"), "in the view pane's slot");
  page.fire(page.$("tabProgram"), "click");
  play(4);
  check(sim.playback === 4, "4x chosen on the Program tab");

  toSimulator(page);
  check(slot() === home && page.doc.documentElement.querySelectorAll(".sim").length === 1, "the same slot on the simulator");
  check(sim.playback === 4, `the Program tab keeps its speed on the simulator: ${sim.playback}`);
  page.fire(page.$("tabDrive"), "click");
  check(slot() === home, "and on the Drive tab");
  check(sim.playback === 1, `held at 1x while the Drive tab drives it: ${sim.playback}`);
  // Held: the list leaves the bar (sim.css) and the settings say why, in
  // words on screen rather than a title on greyed-out speeds; the faster
  // speeds are refused all the same.
  check(view().dataset.held === "yes", "the view knows it is held");
  check(!why().hidden && /^Held at 1× on the Drive tab$/.test(why().textContent) && /real time/.test(why().getAttribute("title")), `the settings say why, in a line that fits, the rest in its title: ${why().textContent}`);
  const [one, two, four] = options();
  check(!one.disabled && two.disabled && four.disabled, `2x and 4x refused: ${options().map((o) => o.disabled)}`);
  check(/real time/.test(two.getAttribute("title")) && /real time/.test(four.getAttribute("title")) && /Play at 1 times/.test(one.getAttribute("title")),
    `and say why: ${two.getAttribute("title")}`);
  check(/real time/.test(pick().getAttribute("title")), "and so does the list");
  play(4);
  check(sim.playback === 1, `a choice past the hold does nothing: ${sim.playback}`);

  page.fire(page.$("tabProgram"), "click");
  check(slot() === home && sim.playback === 4, `back on the Program tab, at the speed chosen there: ${sim.playback}`);
  check(view().dataset.held === "no" && why().hidden, "the list back on the bar, the line gone");
  check(!options()[2].disabled && /Play at 4 times/.test(options()[2].getAttribute("title")), "4x offered again");
  page.fire(page.$("tabDrive"), "click");
  check(slot() === home && sim.playback === 1, "and held again on the Drive tab");
  // A pause left on the Program tab would freeze what the Drive tab drives,
  // on a phone with no bar to resume it from: driven, the view plays.
  page.fire(page.$("tabProgram"), "click");
  page.fire(view().querySelectorAll(".sim-pause")[0], "click");
  check(sim.paused, "paused on the Program tab");
  page.fire(page.$("tabDrive"), "click");
  check(!sim.paused && sim.playback === 1, `playing at 1x on the Drive tab: paused ${sim.paused}`);
  // On the rover target the Drive tab drives the rover, not the view: the
  // hold lifts, and the view keeps its own speed for a preview.
  toRover(page);
  check(slot() === home && sim.playback === 4, `on the rover, the speed chosen: ${sim.playback}`);
  check(page.errors.length === 0, `errors ${page.errors}`);
});

/* --- the look ------------------------------------------------------------- */

// The page's look (look.js), picked in the Options popover under the gear:
// a Dark | Light toggle and a tile per theme. Looks of the tests' own, read
// after css/looks.css, give each a colour the default does not have,
// whatever the file holds: console-light is the toggle away from the
// default, blueprint-dark a tile away.
const TEST_LOOKS = `
[data-look="console-light"] { --case: #f4f6f8; --live: #0a6f63; --faint: #a3adb8; --stick-rim: #054a42; --stick-ring: var(--faint); }
[data-look="blueprint-dark"] { --case: #0b1a33; --live: #3fc9b8; --faint: #34507c; }`;
const { LOOKS } = require("../js/look.js").LookPicker;
const DEFAULT_CASE = lookBlocks()[0].declared.get("--case");
const lookRadios = (page) => page.$("lookChoice").querySelectorAll('input[name="look"]');
const flavourSegments = (page) => page.$("flavourChoice").querySelectorAll("button");
const checkedTheme = (page) => lookRadios(page).filter((radio) => radio.checked).map((radio) => radio.getAttribute("value")).join();
const pressedFlavour = (page) => flavourSegments(page).filter((button) => button.getAttribute("aria-pressed") === "true").map((button) => button.textContent).join();
// As the operator picks a theme: its radio checked, the others not, and its
// change event. A flavour: a click on its segment.
function pickTheme(page, theme) {
  for (const radio of lookRadios(page)) radio.checked = radio.getAttribute("value") === theme;
  page.fire(lookRadios(page).find((radio) => radio.checked), "change");
}
const pickFlavour = (page, flavour) => page.fire(flavourSegments(page).find((button) => button.textContent === flavour), "click");
// A look, as the operator gets to it: its theme's tile where that differs,
// then its flavour's segment where that does.
function pickLook(page, id) {
  const look = LOOKS.find((each) => each.id === id);
  if (checkedTheme(page) !== look.theme.toLowerCase()) pickTheme(page, look.theme.toLowerCase());
  if (pressedFlavour(page) !== look.flavour) pickFlavour(page, look.flavour);
}
const worn = (page) => page.doc.documentElement.getAttribute("data-look");
const themeColor = (page) => page.doc.querySelector('meta[name="theme-color"]').getAttribute("content");

// Which looks, and in what order, is looks.test.js's (against css/looks.css).
test("look: each theme a Dark and a Light, each look's id its theme and flavour", () => {
  const { LookPicker } = require("../js/look.js");
  check(LookPicker.LOOKS.every((look) => look.id === `${look.theme}-${look.flavour}`.toLowerCase()), "each id is its theme and flavour");
  for (const theme of new Set(LookPicker.LOOKS.map((look) => look.theme))) {
    const flavours = LookPicker.LOOKS.filter((look) => look.theme === theme).map((look) => look.flavour);
    check(flavours.join() === "Dark,Light", `${theme}: ${flavours}`);
  }
});

test("look: Dark | Light and a tile per theme in the gear's popover, the look in force shown", () => {
  const page = loadPage();
  const flavours = page.$("flavourChoice");
  check(flavours.getAttribute("role") === "group" && flavours.getAttribute("aria-label") === "Dark or light", "a group named Dark or light");
  check((flavours.getAttribute("class") || "").split(/\s+/).includes("segmented"), "drawn as the page's other switches are");
  check(flavourSegments(page).map((button) => button.textContent).join() === "Dark,Light", `segments ${flavourSegments(page).map((button) => button.textContent)}`);
  check(flavourSegments(page).every((button) => button.getAttribute("type") === "button"), "buttons that submit nothing");
  check(pressedFlavour(page) === "Dark", `pressed ${pressedFlavour(page)}`);

  const group = page.$("lookChoice");
  check(group.getAttribute("role") === "radiogroup" && page.$(group.getAttribute("aria-labelledby")).textContent === "Theme", "a radiogroup named Theme");
  const tiles = group.children;
  check(tiles.length === 3 && tiles.every((tile) => tile.tagName === "LABEL"), `three tiles, each a label: ${tiles.length}`);
  const words = (n) => all(n).filter((m) => m.children.length === 0).map((m) => m.textContent).join("");
  check(tiles.map(words).join() === "Console,Field,Blueprint", `names ${tiles.map(words)}`);
  tiles.forEach((tile, i) => {
    const theme = ["console", "field", "blueprint"][i];
    const [radio] = tile.querySelectorAll("input");
    check(radio && radio.getAttribute("type") === "radio" && radio.getAttribute("name") === "look" && radio.getAttribute("value") === theme, `tile ${i}: a radio for ${theme}`);
    const swatches = tile.querySelectorAll(".lookSwatch");
    check(swatches.length === 1 && swatches[0].getAttribute("data-look") === `${theme}-dark`, `tile ${i}: previewed in ${theme}-dark's own tokens`);
    check(swatches[0] && swatches[0].parentNode.getAttribute("aria-hidden") === "true", `tile ${i}: the preview is for the eye`);
  });
  check(checkedTheme(page) === "console", `the default checked: ${checkedTheme(page)}`);
  check(worn(page) === "console-dark", `html wears ${worn(page)}`);
  check(page.errors.length === 0, `errors ${page.errors}`);
});

// Options, sized to what it holds (the reviewer's round 1): Dark | Light as
// wide as its words, as every other toggle is, not stretched across the
// popover; and on a touch screen with nothing to hover, where no keyboard
// is likely, no list of keys over Update. The rest stays: the looks and
// the firmware update.
test("look: Dark | Light as wide as its words, and a touch screen's Options leaves out the keys", () => {
  const rules = cssRules(panelCss());
  const flavours = rules.filter((r) => /\.flavours\b/.test(r.selector));
  check(flavours.some((r) => r.selector === ".options .flavours" && /align-self:\s*flex-start/.test(r.body)), `as wide as its words: ${flavours.map((r) => `${r.selector}{${r.body}}`)}`);
  check(!flavours.some((r) => /(^|[\s;{])(width|flex|flex-grow)\s*:/.test(r.body)), `nothing stretches it: ${flavours.map((r) => r.body)}`);

  const touch = blockRules(panelCss(), "@media (hover: none) and (pointer: coarse) {");
  const gone = touch.filter((r) => /display:\s*none/.test(r.body)).flatMap((r) => r.selector.split(/\s*,\s*/));
  check(["#keysLabel", "#keyList", ".keysNote"].every((s) => gone.includes(s)), `the keys left out: ${gone}`);
  check(gone.every((s) => ["#keysLabel", "#keyList", ".keysNote"].includes(s)), `nothing else left out: ${gone}`);
  // What it leaves out is the whole Keys section, between the looks and
  // the firmware update.
  const page = loadPage();
  const kids = page.$("optionsPanel").children.map((n) => n.id || (n.getAttribute("class") || ""));
  const at = (id) => kids.indexOf(id);
  check(at("lookChoice") < at("keysLabel") && at("keysLabel") + 1 === at("keyList") && at("keyList") + 1 === at("keysNote") && at("keysNote") + 1 === at("firmwareLabel"), `the Keys section, whole: ${kids}`);
  check(page.errors.length === 0, `errors ${page.errors}`);
});

// The owner's ask: Dark or Light as a toggle, apart from the theme.
test("look: the toggle keeps the theme, a tile keeps the flavour, and the tiles preview the flavour in force", () => {
  const { page, ws } = connected(telemetry(), { stored: { "rover.look": "blueprint-dark" } }); // exploring: any frame would take control
  page.evalIn("globalThis.__picked = []; lookPicker.onChange((id) => __picked.push(id));");
  const swatchLooks = () => page.$("lookChoice").querySelectorAll(".lookSwatch").map((swatch) => swatch.getAttribute("data-look")).join();
  check(checkedTheme(page) === "blueprint" && pressedFlavour(page) === "Dark", `shows ${checkedTheme(page)}, ${pressedFlavour(page)}`);

  pickFlavour(page, "Light");
  check(worn(page) === "blueprint-light" && page.store["rover.look"] === "blueprint-light", `Light: wears ${worn(page)}, remembered ${page.store["rover.look"]}`);
  check(checkedTheme(page) === "blueprint" && pressedFlavour(page) === "Light", `Light: shows ${checkedTheme(page)}, ${pressedFlavour(page)}`);
  check(swatchLooks() === "console-light,field-light,blueprint-light", `Light: the tiles in ${swatchLooks()}`);

  pickTheme(page, "field");
  check(worn(page) === "field-light" && page.store["rover.look"] === "field-light", `Field: wears ${worn(page)}, remembered ${page.store["rover.look"]}`);
  check(pressedFlavour(page) === "Light" && swatchLooks() === "console-light,field-light,blueprint-light", `Field: ${pressedFlavour(page)}, ${swatchLooks()}`);

  pickFlavour(page, "Dark");
  check(worn(page) === "field-dark" && checkedTheme(page) === "field", `Dark: wears ${worn(page)}, shows ${checkedTheme(page)}`);
  check(swatchLooks() === "console-dark,field-dark,blueprint-dark", `Dark: the tiles in ${swatchLooks()}`);

  // A press on the flavour in force changes nothing, and says so to no one.
  pickFlavour(page, "Dark");
  check(page.evalIn("__picked.join()") === "blueprint-light,field-light,field-dark", `heard ${page.evalIn("__picked.join()")}`);
  page.clock.advance(2000);
  check(count(ws) === 0, `sent ${names(ws)}`);
  check(page.errors.length === 0, `errors ${page.errors}`);
});

// The chosen segment is inverted: the ink as its fill. Its word in the ink
// as well, as a stale scheme's and an off family's once were, vanishes.
test("look: whatever is filled in --chosen is written in --on-chosen", () => {
  const sheets = ["panel.css", "program.css", "sim.css"];
  const chosen = sheets.flatMap((file) => cssRules(stylesheet(file)).filter((rule) => /background:\s*var\(--chosen\)/.test(rule.body)));
  check(chosen.length > 0, "found the chosen segment's rule");
  const unlike = chosen.filter((rule) => !/(^|[^-])color:\s*var\(--on-chosen\)/.test(rule.body));
  check(unlike.length === 0, `written otherwise: ${unlike.map((rule) => rule.selector)}`);
  // A disabled segment is unlit but for the one in force (a stale scheme,
  // the family under NORMAL), which keeps its chip whatever disables it.
  const unlit = cssRules(panelCss()).filter((rule) => /\.segmented button:disabled/.test(rule.selector) && /background:\s*none/.test(rule.body));
  check(unlit.length === 1 && unlit[0].selector === '.segmented button:disabled:not([aria-pressed="true"])', `the segment in force kept inverted while disabled: ${unlit.map((rule) => rule.selector)}`);
});

test("look: the chosen block category is ringed in the ink, not tinted in its colour", () => {
  // Its own colour as a ring fell under 2:1 in the dark looks, and as a
  // tint over Blueprint's blue it mixed to teal. --readout on --raised-hi
  // is audited (looks.test.js).
  const rule = cssRules(stylesheet("program.css")).find((r) => r.selector === ".blocklyToolboxCategory.roverCategory.blocklyToolboxSelected");
  check(rule && /background:\s*var\(--raised-hi\)/.test(rule.body) && /box-shadow:\s*inset 0 0 0 2px var\(--readout\)/.test(rule.body), `ringed in the ink: ${rule && rule.body}`);
});

test("look: what else marks the chosen chip is drawn in its ink, not in blue or green", () => {
  // Blue on the chip fell to 1.9:1 (Blueprint Dark), green to under 3:1.
  const rule = (file, selector) => (cssRules(stylesheet(file)).find((r) => r.selector === selector) || {}).body || "";
  const pending = rule("panel.css", '.segmented button[aria-pressed="true"][data-pending="yes"]');
  check(/(^|[^-])color:\s*var\(--on-chosen\)/.test(pending) && /outline-color:\s*var\(--on-chosen\)/.test(pending),
    `a chosen scheme also asked for: its word and frame in --on-chosen: ${pending}`);
  // The tabs are words on the cell's panel, not chips: the open tab is its
  // ink over an underline in --chosen, a straight 2 px bar with square
  // ends under its word (an inset shadow on a rounded box curled up at its
  // ends: the critics' round 3), and the running dot stays green on the
  // panel, open or not (paired in looks.test.js), with nothing chosen
  // under it to take its ink from.
  const open = rule("panel.css", '.hcell .tabs [role="tab"][aria-selected="true"]');
  check(/(^|[^-])color:\s*var\(--readout\)/.test(open) && /background:\s*linear-gradient\(var\(--chosen\), var\(--chosen\)\) center bottom 3px \/ calc\(100% - 2 \* var\(--tab-x, 10px\)\) 2px no-repeat;/.test(open) && !/box-shadow/.test(open),
    `the open tab: its word in the ink over a straight --chosen bar, no chip: ${open}`);
  const tab = rule("panel.css", '.hcell .tabs [role="tab"]');
  check(/border-radius:\s*0;/.test(tab) && !/box-shadow/.test(tab), `the tab square, no shadow: ${tab}`);
  const dots = cssRules(stylesheet("program.css")).filter((r) => /data-running="yes"\]::after/.test(r.selector) && /background:/.test(r.body));
  check(dots.length === 1 && /background:\s*var\(--ok\)/.test(dots[0].body) && !/aria-selected/.test(dots[0].selector),
    `the running dot green on either tab, no override for the open one: ${dots.map((r) => `${r.selector} { ${r.body.trim()} }`)}`);
});

test("look: a disabled Run keeps the edge its filled state drops", () => {
  const rule = (selector) => (cssRules(stylesheet("program.css")).find((r) => r.selector === selector) || {}).body || "";
  check(/border-color:\s*transparent/.test(rule(".programBar .run")), "Run, filled, drops its edge");
  check(/border-color:\s*var\(--edge\)/.test(rule(".programBar .run:disabled")), "disabled, unfilled, it is edged as every other control");
});

// The link chip is quiet when all is well: its lamp is the only colour it
// has, so no width may drop it but for the rover's glyph, which takes its
// place and its colour; and a link that went is told by more than hue:
// tinted and worded (its title where the word gives way). One outline per
// cell, the cell's: the chip is told from it by its fill, never an edge of
// its own, and so are the cell's tracks, and the gear has neither (the
// critics' round 3: three and four nested hairlines in a cell). The caret
// turns over while its popover is open, and the gear is lit then too.
test("look: the link chip keeps its lamp's colour at every width, a link that went is tinted and worded, and a cell has one outline", () => {
  const css = panelCss();
  const rules = cssRules(css.replace(/@(media|container)[^{]*\{/g, ""));
  const dropped = rules.filter((r) => selectorsOf(r.selector).some((each) => /\.lamp\b/.test(each)) && /display:\s*none/.test(r.body));
  check(dropped.length === 1 && selectorsOf(dropped[0].selector).every((each) => /\.chipFor:not\(\[hidden\]\) \+ \.lamp$|^\.cells\[data-fitting\] /.test(each)),
    `the lamp gives way only to the rover's glyph, or while the fit measures: ${dropped.map((r) => r.selector)}`);
  const up = rules.find((r) => r.selector === '.linkChip[data-say="up"] .lamp');
  check(up && /background:\s*var\(--ok\)/.test(up.body), `up: the lamp green: ${up && up.body}`);
  const upGlyph = rules.find((r) => r.selector === '.linkChip[data-say="up"] .roverGlyph');
  check(upGlyph && /color:\s*var\(--ok\)/.test(upGlyph.body), `up: the rover's glyph green in its place: ${upGlyph && upGlyph.body}`);
  // A browser without :has() drops a whole selector list that holds one.
  check(rules.filter((r) => /\.linkChip|\.chipFor|\.lamp\b/.test(r.selector)).every((r) => !/:has\(/.test(r.selector)), "no chip rule leans on :has()");
  // A link that went, went quiet or never came: amber, worded and tinted.
  const went = rules.find((r) => r.selector === '.linkChip:is([data-say="lost"], [data-say="stale"], [data-say="unreachable"])');
  check(went && /(^|[^-])color:\s*var\(--warn\)/.test(went.body), `lost, stale or never reached: worded in amber: ${went && went.body}`);
  const tint = rules.find((r) => r.selector === '.linkChip:is([data-say="lost"], [data-say="stale"], [data-say="unreachable"], :not([data-alert=""]))');
  check(tint && /background:\s*var\(--warn-soft\)/.test(tint.body), `and tinted, as an alert tints it: ${tint && tint.body}`);
  // Where its cell cannot hold a word (the first cell's last step,
  // measured), the chip is its lamp, the alerts' glyphs and its caret
  // alone, its title saying the rest. The caret never goes: a press opens
  // the popover at every width.
  const hides = rules.filter((r) => /^\.drives/.test(r.selector) && /data-fit/.test(r.selector) && /display:\s*none/.test(r.body)).map((r) => r.selector);
  check(hides.includes('.drives[data-fit="lamp"] .chipWord') && !hides.some((each) => /\.caret\b/.test(each)), `at the last step the chip's word goes, its caret stays: ${hides}`);
  check(!rules.some((r) => r.selector.split(",").some((each) => /\.caret\b/.test(each) && /linkChip|drives/.test(each)) && /display:\s*none/.test(r.body)), "the chip's caret at every width");
  // One outline per cell: no edge on the chip, a track or the gear in a
  // cell, the chip and the tracks on their fill.
  const base = cssRules(outside(css, "@media"));
  const chipBase = base.find((r) => r.selector === ".linkChip");
  check(chipBase && /border-radius:\s*var\(--r-full\)/.test(chipBase.body) && /border-color:\s*transparent;/.test(chipBase.body) && /background:\s*var\(--raised\);/.test(chipBase.body), `the chip a pill on its fill, no edge: ${chipBase && chipBase.body}`);
  check(!rules.some((r) => /\.linkChip\b/.test(r.selector) && /border-color:\s*var\(/.test(r.body)), "no state gives it an edge");
  const track = base.find((r) => r.selector === ".hcell .segmented");
  check(track && /box-shadow:\s*none;/.test(track.body), `a track in a cell, no hairline: ${track && track.body}`);
  const gear = base.find((r) => r.selector === ".optionsButton");
  check(gear && /border-color:\s*transparent;/.test(gear.body) && /background:\s*none;/.test(gear.body), `the gear, no edge or fill: ${gear && gear.body}`);
  // Open: the caret turned over, the chip and the gear lit.
  const turned = rules.find((r) => r.selector === '.linkChip[aria-expanded="true"] .caret');
  check(turned && /transform:\s*rotate\(180deg\);/.test(turned.body), `the caret turned over while open: ${turned && turned.body}`);
  for (const selector of ['.linkChip[aria-expanded="true"]', '.optionsButton[aria-expanded="true"]']) {
    const lit = rules.find((r) => r.selector === selector);
    check(lit && /background:\s*var\(--raised-hi\)/.test(lit.body), `${selector}: lit while open: ${lit && lit.body}`);
  }
  const page = loadPage();
  page.fire(page.$("linkChip"), "click");
  check(page.$("linkChip").getAttribute("aria-expanded") === "true", "open, the chip says so");
  page.fire(page.$("linkChip"), "click");
  const ws = connectOpen(page);
  ws.serverMsg(telemetry());
  ws.serverDrop();
  check(page.$("linkChip").dataset.say === "lost" && /^Link lost/.test(page.$("linkChip").title), `a link lost under the panel: ${page.$("linkChip").dataset.say}, '${page.$("linkChip").title}'`);
  const again = connectOpen(page);
  again.serverMsg(telemetry());
  page.fire(page.$("connect"), "click");
  check(page.$("linkChip").dataset.say === "down" && /^Not connected/.test(page.$("linkChip").title), `put down by the panel: ${page.$("linkChip").dataset.say}`);
  check(page.errors.length === 0, `errors ${page.errors}`);
});

// Stop's square most of its glyph's box, 14 to 16 px in its 16 px glyph:
// at 8 px it was a dot, and the red alone said what it was (the critics'
// round 3).
test("look: Stop's square fills its glyph", () => {
  const page = loadPage();
  const rect = all(page.$("stop")).find((n) => n.tagName === "RECT");
  const svg = all(page.$("stop")).find((n) => n.tagName === "SVG");
  const box = Number(((svg && svg.getAttribute("viewBox")) || "").split(/\s+/)[2]);
  const glyph = cssRules(outside(panelCss(), "@media")).find((r) => r.selector === "#stop .icon");
  const px = glyph && /width:\s*var\(--glyph\);/.test(glyph.body) ? 16 : NaN;
  const side = rect ? (Number(rect.getAttribute("width")) / box) * px : NaN;
  check(side >= 14 && side <= 16 && rect.getAttribute("width") === rect.getAttribute("height"), `a square of ${side} px`);
});

test("look: the chosen segment's word stays on its chip, the only ground its ink reads on, at the narrowest layouts", () => {
  // Measured headless: at 375 px upright the second cell's words at 13 px
  // ran past it, at 414 px the first cell's at their widest, and on a phone
  // on its side under about 570 px "sideways" at --t-sm ran past its chip;
  // the part past a chip lay on its frame in --on-chosen. So each cell
  // steps its words down until they fit it, measured (fitSteps), wherever
  // it is: the long words short, the segments closer, and in the second
  // cell a size down at its last steps. Measured headless at 320 to 1440
  // px, with the chip's alerts shown, neither cell overflows.
  const css = panelCss();
  const flat = cssRules(css.replace(/@(media|container)[^{]*\{/g, ""));
  const smaller = flat.find((r) => r.selector === '.hands:is([data-fit="short"], [data-fit="small"]) :is(button, .segmented button)');
  check(smaller && /font-size:\s*var\(--t-sm\)/.test(smaller.body), `the tabs and every switch in the second cell a size down at its last step: ${smaller && smaller.body}`);
  const shows = flat.filter((r) => /data-fit/.test(r.selector) && /display:\s*inline/.test(r.body)).map((r) => r.selector);
  check(shows.some((each) => /^\.drives:is\(\[data-fit="short"\]/.test(each) && /\.target \.segShort/.test(each) && /\.autoShort/.test(each)), `Sim and Auto from the first cell's short step: ${shows}`);
  // "Advanced" whole wherever it fits, Adv only at the second cell's last
  // step, where nothing else does (a 320 px phone): the critic's round 2.
  check(shows.some((each) => each === '.hands[data-fit="short"] .scheme .segShort'), `Adv only at the second cell's last step: ${shows}`);
  const appJs = fs.readFileSync(path.join(PANEL_ROOT, "js", "app.js"), "utf8");
  check(/fitSteps\(secondCell, \["words", "tight", "snug", "small", "short"\]/.test(appJs), "the short step the second cell's last");
  // 13 px words, the first cell's size, down to "snug" (a 375 px phone and
  // one on its side, measured headless): the segments and the tabs closer,
  // never smaller. A size down only at "small" and "short".
  const snug = flat.find((r) => r.selector === '.hands[data-fit="snug"]');
  check(snug && /--seg-x:\s*5px/.test(snug.body) && /--tab-x:\s*3px/.test(snug.body) && !/font-size/.test(snug.body), `snug: closer, at 13 px: ${snug && snug.body}`);
  check(!flat.some((r) => /^\.hands/.test(r.selector) && /tight|snug/.test(r.selector) && /font-size/.test(r.body)), "no size down at tight or snug");
  // Stop at least 16 px from the scheme at every step.
  const steps = '.hands:is([data-fit="short"], [data-fit="tight"], [data-fit="snug"], [data-fit="small"])';
  const stopGap = flat.find((r) => r.selector === `${steps} #stop`);
  const tightGap = flat.find((r) => r.selector === steps);
  check(stopGap && /margin-left:\s*12px/.test(stopGap.body) && tightGap && /gap:\s*4px/.test(tightGap.body), "Stop 12 px and the cell's 4 px gap from the scheme when tight: 16 px");
  const bar = cssRules(outside(css, "@media")).find((r) => r.selector === ".bar");
  check(bar && /container:\s*bar \/ inline-size;/.test(bar.body), `the top a container the cells ask: ${bar && bar.body}`);
  // The pivot stick's family steps down by its own area's width, as the
  // cells do by theirs: 13 px where its words fit with the top's sides,
  // 12 px and closer under 152 px (a 320 px phone, a phone on its side at
  // the stick's floor), never 11 (the review's phones 20), and its
  // segments 28 px as every switch's (24 were the page's smallest
  // targets: the review's phones 21).
  const familyStep = blockRules(outside(css, "@media"), "@container family (max-width: 151.98px) {") || [];
  check(familyStep.length === 1 && familyStep[0].selector === ".family .segmented button" && /font-size:\s*var\(--t-sm\)/.test(familyStep[0].body) && /--seg-x:\s*5px/.test(familyStep[0].body), `the family's words a size down where its area is narrow: ${familyStep.map((r) => r.body)}`);
  check(!flat.some((r) => /\.family/.test(r.selector) && (/font-size:\s*var\(--t-xs\)/.test(r.body) || /--seg\s*:/.test(r.body))), "never 11 px, never a smaller segment");
  // A narrow phone on its side has a block of its own for the top (the
  // cells spanning the screen), but no family step: the container query
  // above is the family's one step, wherever its area is narrow.
  const narrowSide = mediaRules("@media (orientation: landscape) and (max-height: 520px) and (max-width: 567.98px) {") || [];
  check(!narrowSide.some((r) => /\.family|\.segmented/.test(r.selector)), `no family step of its own for a narrow phone on its side: ${narrowSide.map((r) => r.selector)}`);
  // The short words stand in for the long ones, and are never what is read.
  const page = loadPage();
  const sim = page.$("target").children[1];
  check(sim.getAttribute("aria-label") === "Simulator" && all(sim).some((n) => n.getAttribute && n.getAttribute("class") === "segShort" && n.textContent === "Sim" && n.getAttribute("aria-hidden") === "true"),
    "Sim, hidden from a reader, in the segment named Simulator");
});

test("look: the Program tab's running dot sits in its tab's corner, so it widens nothing as it comes and goes", () => {
  const dot = cssRules(stylesheet("program.css")).find((r) => r.selector === '.tabs [role="tab"][data-running="yes"]::after');
  check(dot && /position:\s*absolute/.test(dot.body) && /top:/.test(dot.body) && /right:/.test(dot.body), `the dot out of the word's line: ${dot && dot.body}`);
  const button = cssRules(outside(panelCss(), "@media")).find((r) => r.selector === ".hcell button");
  check(button && /position:\s*relative/.test(button.body), `placed by its own tab: ${button && button.body}`);
  const page = loadPage();
  check(all(page.doc.documentElement.querySelector(".hands")).includes(page.$("tabProgram")), "the tab in a cell");
});

test("look: a tile's preview is painted only in the tokens every look declares for it", () => {
  // css/looks.css gives each look these, and the preview shows the look by
  // them alone; anything else would show the page's look, not the tile's.
  const PREVIEW = ["--case", "--panel", "--raised", "--rule", "--readout", "--dim", "--live", "--on-live", "--ok", "--warn", "--stop", "--on-stop"];
  const rules = cssRules(panelCss()).filter((rule) => /\.look(Swatch|Card|Text|Lamps|Lamp|Foot|Go|Stop)\b/.test(rule.selector));
  check(rules.length >= 8, `found the preview's rules: ${rules.length}`);
  const tokens = rules.flatMap((rule) => [...rule.body.matchAll(/var\((--[\w-]+)\)/g)].map(([, token]) => token));
  const stray = tokens.filter((token) => !PREVIEW.includes(token) && !/^--[sr]-/.test(token)); // spaces and radii are the page's
  check(stray.length === 0, `painted in ${stray}`);
  const literal = rules.filter((rule) => /#[0-9a-f]{3,8}\b|\b(rgb|hsl)a?\(|\b(white|black)\b/i.test(rule.body));
  check(literal.length === 0, `a colour of its own: ${literal.map((rule) => rule.selector)}`);
});

test("look: a remembered look is on <html> from the start; an unknown one, or storage that fails, gives the default", () => {
  // look.js runs in <head>, after support.js, so the look is on before the
  // page is first drawn.
  const html = fs.readFileSync(path.join(PANEL_ROOT, "joystick.html"), "utf8");
  const head = html.slice(0, html.indexOf("</head>"));
  check(/<script src="js\/support\.js"><\/script>\s*<script src="js\/look\.js"><\/script>/.test(head), "support.js, then look.js, in <head>");
  // The fake reads css/looks.css whether or not the page links it.
  check(/<link rel="stylesheet" href="css\/looks\.css">/.test(head), "css/looks.css linked in <head>");

  const page = loadPage({ stored: { "rover.look": "blueprint-dark" }, looks: TEST_LOOKS });
  check(worn(page) === "blueprint-dark", `wears ${worn(page)}`);
  check(checkedTheme(page) === "blueprint" && pressedFlavour(page) === "Dark", `its tile checked, its flavour pressed: ${checkedTheme(page)}, ${pressedFlavour(page)}`);
  check(page.headThemeColor === "#0b1a33" && themeColor(page) === "#0b1a33", `the browser's bar in its --case from <head>: ${page.headThemeColor}, then ${themeColor(page)}`);
  check(page.joyParameters.internalFillColor === "#3fc9b8", `the knob in its --live: ${page.joyParameters.internalFillColor}`);
  check(page.errors.length === 0, `errors ${page.errors}`);

  for (const options of [{ stored: { "rover.look": "neon" } }, { stored: { "rover.look": "" } }, { storage: "throws" }, { storage: "null" }]) {
    const fallback = loadPage(options);
    check(worn(fallback) === "console-dark", `${JSON.stringify(options)}: wears ${worn(fallback)}`);
    check(checkedTheme(fallback) === "console" && pressedFlavour(fallback) === "Dark", `${JSON.stringify(options)}: shows ${checkedTheme(fallback)}, ${pressedFlavour(fallback)}`);
    check(themeColor(fallback) === DEFAULT_CASE, `${JSON.stringify(options)}: the bar ${themeColor(fallback)}`);
    check(fallback.errors.length === 0, `${JSON.stringify(options)}: errors ${fallback.errors}`);
  }
});

test("look: picking one puts it on <html>, remembers it, repaints the browser's bar, and sends nothing", () => {
  const { page, ws } = connected(telemetry(), { looks: TEST_LOOKS }); // exploring: any frame would take control
  page.evalIn("globalThis.__picked = []; lookPicker.onChange((id) => __picked.push(id));");
  pickLook(page, "console-light");
  check(worn(page) === "console-light", `wears ${worn(page)}`);
  check(page.store["rover.look"] === "console-light", `remembered ${page.store["rover.look"]}`);
  check(themeColor(page) === "#f4f6f8", `the browser's bar in its --case: ${themeColor(page)}`);
  check(page.evalIn("__picked.join()") === "console-light", `heard ${page.evalIn("__picked.join()")}`);
  pickLook(page, "console-dark");
  check(worn(page) === "console-dark" && themeColor(page) === DEFAULT_CASE, `back: ${worn(page)}, ${themeColor(page)}`);
  page.clock.advance(2000);
  check(count(ws) === 0, `sent ${names(ws)}`);
  check(page.errors.length === 0, `errors ${page.errors}`);
});

test("look: the gear opens a popover that Escape and a press outside close, and that is not modal: Stop stays one press", () => {
  const { page, ws } = connected(telemetry()); // exploring
  const gear = page.$("options");
  const panel = page.$("optionsPanel");
  check(gear.getAttribute("aria-label") === "Options" && gear.getAttribute("title") === "Options", "the gear is named Options");
  check(gear.getAttribute("aria-controls") === "optionsPanel" && gear.getAttribute("aria-expanded") === "false" && panel.hidden, "closed at first");
  check(!gear.hasAttribute("aria-haspopup") && panel.getAttribute("role") === "group" && panel.tagName === "DIV" && !panel.hasAttribute("aria-modal"),
    `a group, not a menu or a dialog: ${panel.tagName} role=${panel.getAttribute("role")}`);
  check((panel.getAttribute("class") || "").split(/\s+/).includes("menu"), "it wears the File menu's .menu: over the page, hanging below the top");
  // Its scroll fades take a layer over its own lines, inside the popover's
  // (a positioned .menu with a z-index stacks what it holds), which can
  // never rise over the top: the popover itself takes none.
  const layered = cssRules(panelCss()).filter((rule) => /\.options\b|#optionsPanel\b/.test(rule.selector) && /z-index/.test(rule.body));
  const fades = layered.filter((rule) => rule.selector.split(/,(?![^(]*\))/).every((part) => /::(before|after)$/.test(part.trim())) && /pointer-events:\s*none;/.test(rule.body));
  check(layered.length === fades.length, `.menu's layer, never one of its own over Stop: ${layered.filter((rule) => !fades.includes(rule)).map((rule) => rule.selector)}`);
  const menuRule = cssRules(outside(panelCss(), "@media")).find((rule) => rule.selector === ".menu");
  check(menuRule && /position:\s*absolute;/.test(menuRule.body) && /z-index:\s*1;/.test(menuRule.body), `a .menu stacks its own fades: ${menuRule && menuRule.body}`);
  // The last thing in the top's second cell, beside Stop: the hand that
  // reaches for the gear lands, at worst, on Stop.
  const holder = gear.parentNode;
  const cell = holder.parentNode;
  check(/\bhands\b/.test(cell.getAttribute("class") || "") && cell.children.at(-1) === holder && cell.children.at(-2) === page.$("stop"),
    `at the end of the second cell, after Stop: ${cell.children.map((n) => n.id || n.getAttribute("class"))}`);
  const key = (target, k) => page.fire(target, "keydown", { key: k });

  page.fire(gear, "click");
  check(!panel.hidden && gear.getAttribute("aria-expanded") === "true", "the gear opens it");
  check(page.doc.activeElement !== panel && !panel.contains(page.doc.activeElement), "opening takes no focus into it");
  const shut = all(page.doc.documentElement).filter((n) => n.hasAttribute("inert") || n.getAttribute("aria-hidden") === "true" && n.contains(page.$("stop")));
  check(shut.length === 0, `nothing made inert: ${shut.map((n) => n.id || n.tagName)}`);
  check(!key(panel, "Tab").defaultPrevented && !panel.hidden, "Tab moves on as ever: nothing holds the focus");
  key(panel, "Escape");
  check(panel.hidden && gear.getAttribute("aria-expanded") === "false" && page.doc.activeElement === gear, "Escape closes it, back on the gear");

  page.fire(gear, "click");
  page.fire(panel, "pointerdown");
  check(!panel.hidden, "a press inside leaves it open");
  page.fire(page.$("scan"), "pointerdown");
  check(panel.hidden, "a press outside closes it");
  page.fire(gear, "click");
  page.fire(gear, "click");
  check(panel.hidden, "the gear closes it again");

  // Stop, with the popover open: one press stops the rover, and closes it.
  page.fire(gear, "click");
  page.fire(page.$("stop"), "pointerdown");
  page.fire(page.$("stop"), "click");
  check(names(ws).join() === "STOP", `Stop sent ${names(ws)}`);
  check(panel.hidden, "and the popover closed");

  // One popup at a time: the File menu, opening, closes it.
  standInEditor(page);
  page.fire(gear, "click");
  key(page.$("programMenu"), "ArrowDown");
  check(panel.hidden && !page.$("programMenuList").hidden, "the File menu, opening, closes it");
  check(page.errors.length === 0, `errors ${page.errors}`);
});

test("look: Options hangs from the top below the cells, never runs off the screen, and fades an end with more past it", () => {
  // From the foot of the cells, 6 px below them, as the link's popover
  // does, so it hangs as far below the cells in every layout: hung from
  // the gear, it touched them; hung from the top's foot, it lay flush on
  // the view's edge (the critics' round 3). Never taller than the screen
  // under it, 8 px clear of the foot, scrolling inside rather than move
  // the page and the sticks with it; at 844 x 390 its Firmware section was
  // past the foot with nothing to say so (the critic's round 2).
  const base = cssRules(outside(panelCss(), "@media"));
  const rule = (selector) => base.filter((r) => r.selector.replace(/\s+/g, " ") === selector).map((r) => r.body).join("");
  check(/position:\s*static;/.test(rule(".hands > .menuHolder")), `the gear's holder not positioned: the popover hangs from the cells: ${rule(".hands > .menuHolder")}`);
  check(/position:\s*sticky;/.test(rule(".bar")) && /position:\s*relative;/.test(rule(".cells")), "the cells are what it hangs from, in the top stuck to the screen");
  const below = /max-height:\s*calc\(100 \* var\(--svh\) - 100% - var\(--shell-top\) - 6px - var\(--s-2\) - env\(safe-area-inset-bottom, 0px\)\);/;
  const options = rule(".options");
  check(/(^|[\s;])top:\s*calc\(100% \+ 6px\);/.test(options) && below.test(options) && /overflow-y:\s*auto;/.test(options),
    `6 px below the cells, never past the screen's foot, scrolling inside: ${options}`);
  const link = rule(".linkPanel");
  const linkTop = (link.match(/(?:^|[\s;])top:\s*([^;]+);/) || [])[1];
  check(linkTop === "calc(100% + 6px)", `the link's popover from the same line: ${linkTop}`);
  check(below.test(link) && /overflow-y:\s*auto;/.test(link),
    `nor the link's, whose fault and note together ran past a phone on its side: ${link}`);
  // The link's from the chip's left edge (app.js gives its place), as far
  // right as the cells let it: from the cells' left edge it read as the
  // target's (the critics' round 3).
  check(/(^|[\s;])left:\s*clamp\(0px, var\(--chip-x, 0px\), 100% - min\(22rem, 100%\)\);/.test(link), `from the chip's left edge: ${link}`);
  const appJs = fs.readFileSync(path.join(PANEL_ROOT, "js", "app.js"), "utf8");
  check(/byId\("linkPanel"\)\.style\.setProperty\("--chip-x"/.test(appJs) && /placeLinkPanel\(\);\n\}/.test(appJs), "its place set as the top is fitted");
  const atLoad = loadPage().$("linkPanel").style.getPropertyValue("--chip-x");
  check(/^\d+px$/.test(atLoad), `set at load: ${atLoad}`);
  // The fades: the panel's own ground over each end, under nothing it
  // could take a press from, shown only by data-more, and weightless while
  // hidden so data-more outweighs the File menu's id.
  const hidden = rule(":where(.options, .linkPanel, #programMenuList)::before, :where(.options, .linkPanel, #programMenuList)::after");
  check(/position:\s*sticky;/.test(hidden) && /pointer-events:\s*none;/.test(hidden) && /opacity:\s*0;/.test(hidden), `the fades sticky, hidden and pressed through: ${hidden}`);
  for (const end of ["before", "after"]) {
    const ground = rule(`.options::${end}, .linkPanel::${end}, #programMenuList::${end}`);
    check(/linear-gradient\(to (top|bottom), var\(--panel\) 20%, transparent\)/.test(ground), `${end}: the panel's own ground: ${ground}`);
  }
  check(/opacity:\s*1;/.test(rule('.menu[data-more~="above"]::before, .menu[data-more~="below"]::after')), "shown by data-more");

  // popover.js marks the ends with more past them, as it opens and scrolls,
  // and clears them as it closes.
  const page = loadPage();
  const gear = page.$("options");
  const panel = page.$("optionsPanel");
  panel.clientHeight = 280;
  panel.scrollHeight = 531;
  panel.scrollTop = 0;
  page.fire(gear, "click");
  check(panel.getAttribute("data-more") === "below", `open at its top: ${panel.getAttribute("data-more")}`);
  panel.scrollTop = 120;
  page.fire(panel, "scroll", { bubbles: false });
  check(panel.getAttribute("data-more") === "above below", `scrolled part way: ${panel.getAttribute("data-more")}`);
  panel.scrollTop = 251;
  page.fire(panel, "scroll", { bubbles: false });
  check(panel.getAttribute("data-more") === "above", `scrolled to its end: ${panel.getAttribute("data-more")}`);
  page.fire(gear, "click");
  check(panel.hidden && !panel.hasAttribute("data-more"), "closed, nothing marked");
  panel.scrollHeight = 280;
  panel.scrollTop = 0;
  page.fire(gear, "click");
  check(!panel.hasAttribute("data-more"), "all of it in sight: nothing marked");
  check(page.errors.length === 0, `errors ${page.errors}`);
});

test("look: the stick's knob is painted from the look's tokens", () => {
  const page = loadPage();
  const root = lookBlocks()[0].declared;
  const knob = page.joyParameters;
  check(knob.internalFillColor === root.get("--live"), `fill ${knob.internalFillColor}, --live ${root.get("--live")}`);
  check(knob.internalStrokeColor === root.get("--stick-rim"), `rim ${knob.internalStrokeColor}, --stick-rim ${root.get("--stick-rim")}`);
  check(knob.externalStrokeColor === root.get("--stick-ring"), `ring ${knob.externalStrokeColor}, --stick-ring ${root.get("--stick-ring")}`);
  check(page.errors.length === 0, `errors ${page.errors}`);
});

// css/looks.css missing (a partial copy of the panel), or the page's styles
// turned off: the tokens read as nothing. joy.js's canvas throws on an empty
// colour, and the panel stopped loading before Stop was wired. The stick
// takes joy.js's own colours instead, and the rest of the panel loads.
test("look: with no look to read, the panel still loads, and Stop still stops", () => {
  const blank = tokensOf(lookBlocks()[0]).map((name) => `${name}: ;`).join(" ");
  const { page, ws } = connected(telemetry(), { looks: `[data-look="console-dark"] { ${blank} }` }); // exploring
  check(page.errors.length === 0, `errors ${page.errors}`);
  check(page.headThemeColor === DEFAULT_CASE && themeColor(page) === DEFAULT_CASE, `the browser's bar as joystick.html gives it: ${page.headThemeColor}, ${themeColor(page)}`);
  const knob = page.joyParameters;
  check(!("internalFillColor" in knob) && !("internalStrokeColor" in knob) && !("externalStrokeColor" in knob), `joy.js's own colours: ${JSON.stringify(knob)}`);
  page.fire(page.$("stop"), "click");
  check(names(ws).join() === "STOP", `Stop sent ${names(ws)}`);
});

test("look: a change under a held stick lets go of it: one STOP, nothing until a fresh press, and the knob in the new look", () => {
  const { page, ws } = connected(telemetry({ mode: "MANUAL" }), { looks: TEST_LOOKS });
  const first = page.canvas;
  const thumb = stickTouch(page, 0);
  thumb.start(); thumb.move(0, -50);
  page.clock.advance(250);
  check(count(ws) >= 2 && names(ws).every((n) => n === "MOVE_FORWARD"), `drove ${names(ws)}`);
  let mark = count(ws);
  pickLook(page, "console-light");
  check(names(ws, mark).join() === "STOP" && ws.sentAt.at(-1) === page.clock.now(), `the change sent ${names(ws, mark)}`);
  check(page.$("stickLabel").textContent === page.evalIn("FamilySelector.PRESS_AGAIN"), `the caption asks for a fresh press: '${page.$("stickLabel").textContent}'`);
  check(page.canvas !== first && first.parentNode === null && stickCanvases(page).length === 1, "one new canvas in place of the old");
  check(first.width === 0 && first.height === 0, `the old canvas emptied: ${first.width} x ${first.height}`);
  const knob = page.joyParameters;
  check(knob.internalFillColor === "#0a6f63" && knob.internalStrokeColor === "#054a42" && knob.externalStrokeColor === "#a3adb8",
    `the knob in console-light: ${JSON.stringify(knob)}`);
  check(page.joy.GetWidth() === 230, `built at the box's size: ${page.joy.GetWidth()}`);
  // A second change before the fresh press sends nothing, and still asks for one.
  pickLook(page, "blueprint-dark");
  check(count(ws) === mark + 1, `the second change sent ${names(ws, mark + 1)}`);
  check(page.$("stickLabel").textContent === page.evalIn("FamilySelector.PRESS_AGAIN"), `still asks for a fresh press: '${page.$("stickLabel").textContent}'`);
  mark = count(ws);
  thumb.move(30, -60); thumb.move(0, -80);
  page.clock.advance(1000);
  thumb.end();
  check(count(ws) === mark, `the thumb on the old canvas sent ${names(ws, mark)}`);
  const fresh = stickTouch(page, 1);
  fresh.start(); fresh.move(0, -50);
  fresh.end();
  check(names(ws, mark).join() === "MOVE_FORWARD,STOP", `a fresh press drove ${names(ws, mark)}`);

  // A held rotate button drives on: the change lets go of the stick alone.
  press(page, page.$("cw"), 4);
  mark = count(ws);
  pickLook(page, "console-light");
  page.clock.advance(1000);
  const after = names(ws, mark);
  check(after.length >= 4 && after.every((n) => n === "ROTATE_CLOCKWISE"), `rotate through a change ${after}`);
  check(page.errors.length === 0, `errors ${page.errors}`);
});

test("look: a change under both sticks lets go of both with one STOP, and each asks for its own fresh press", () => {
  const { page, ws } = connected(telemetry({ mode: "MANUAL", scheme: "ADVANCED" }), { looks: TEST_LOOKS });
  const PRESS_AGAIN = page.evalIn("FamilySelector.PRESS_AGAIN");
  const caption = page.$("stickLabel");
  const note = page.$("pivotNote");
  const asks = () => `${caption.textContent === PRESS_AGAIN ? "move" : "-"},${note.textContent === PRESS_AGAIN ? "pivot" : "-"}`;
  const move = stickTouch(page, 0);
  const pivot = pivotTouch(page, 1);
  move.start(); pushTo(page, move, 0, 70);
  pivot.start(); pushTo(page, pivot, 60, 60);
  let mark = count(ws);
  pickLook(page, "console-light");
  check(names(ws, mark).join() === "STOP", `the change sent ${names(ws, mark)}`);
  check(asks() === "move,pivot", `both ask: ${asks()}`);
  check(page.pivotJoyParameters.internalFillColor === "#0a6f63" && page.joyParameters.internalFillColor === "#0a6f63", "both knobs in the new look");
  move.end(); pivot.end();

  // A fresh press of one stick answers its own request; the other still
  // asks, since a thumb resting on it drives nothing. The pivot stick first,
  // then the translate stick, and the other way round.
  mark = count(ws);
  const p1 = pivotTouch(page, 2);
  p1.start(); pushTo(page, p1, 60, 60);
  check(asks() === "move,-" && names(ws, mark).join() === "PIVOT_RIGHT_FORWARD", `the pivot stick pressed: ${asks()}, ${names(ws, mark)}`);
  const t1 = stickTouch(page, 3);
  t1.start();
  check(asks() === "-,-", `the translate stick pressed: ${asks()}`);
  pushTo(page, t1, 0, 70);
  pickLook(page, "blueprint-dark");
  check(asks() === "move,pivot", `both asked again: ${asks()}`);
  t1.end(); p1.end();
  stickTouch(page, 4).start();
  check(asks() === "-,pivot", `the translate stick pressed: ${asks()}`);
  pivotTouch(page, 5).start();
  check(asks() === "-,-", `the pivot stick pressed: ${asks()}`);

  // One stick held: only that one asks; and a press of anything else
  // answers every request.
  const p = pivotTouch(page, 6);
  p.start(); pushTo(page, p, 60, 60);
  pickLook(page, "console-light");
  check(asks() === "-,pivot", `the pivot stick alone held: ${asks()}`);
  page.fire(page.$("stop"), "click");
  check(asks() === "-,-", `Stop answers it: ${asks()}`);
  check(page.errors.length === 0, `errors ${page.errors}`);
});

test("look: a change with nothing held sends nothing, and builds the knob in the new look", () => {
  const { page, ws } = connected(telemetry(), { looks: TEST_LOOKS }); // exploring
  const first = page.canvas;
  const caption = page.$("stickLabel").textContent;
  pickLook(page, "blueprint-dark");
  page.clock.advance(1000);
  check(count(ws) === 0, `sent ${names(ws)}`);
  check(page.$("stickLabel").textContent === caption, `the caption asks for nothing: '${page.$("stickLabel").textContent}', was '${caption}'`);
  check(page.canvas !== first && page.joyParameters.internalFillColor === "#3fc9b8", `the knob ${page.joyParameters.internalFillColor}`);
  check(page.errors.length === 0, `errors ${page.errors}`);
});

test("look: a change while the Drive tab is hidden builds the stick as it is shown, at its size, in the new look", () => {
  // joy.js cannot draw a stick at no size: a hidden one waits.
  const page = loadPage({ frames: true, looks: TEST_LOOKS });
  const ws = connectOpen(page);
  const first = page.canvas;
  page.fire(page.$("tabProgram"), "click");
  resizeStick(page, 230);
  pickLook(page, "console-light");
  check(page.canvas === first && page.joyParameters.internalFillColor !== "#0a6f63", "nothing built while hidden");
  page.fire(page.$("tabDrive"), "click");
  check(page.canvas !== first && page.canvas.width === 230, `built as it is shown, at ${page.canvas.width}`);
  check(page.joyParameters.internalFillColor === "#0a6f63", `in the new look: ${page.joyParameters.internalFillColor}`);

  // Built then, not when the box's size settles: a press that lands as the
  // tab shows is not let go of a moment later.
  const thumb = stickTouch(page, 0);
  thumb.start(); thumb.move(0, -50);
  resizeStick(page, 230);
  page.clock.advance(400);
  check(names(ws).length >= 2 && names(ws).every((n) => n === "MOVE_FORWARD"), `the press as the tab shows drove on: ${names(ws)}`);
  thumb.end();
  check(names(ws).at(-1) === "STOP", `its release stopped: ${names(ws).at(-1)}`);
  const mark = count(ws);
  // Built in it once: a settle at the same size, later, builds nothing.
  const built = page.canvas;
  resizeStick(page, 230);
  check(page.canvas === built, "the same size and the same look: no rebuild");
  check(count(ws) === mark, `sent ${names(ws, mark)}`);
  check(page.errors.length === 0, `errors ${page.errors}`);
});

test("look: a change repaints the block editor, and is harmless before there is one", () => {
  const page = loadPage({ looks: TEST_LOOKS });
  pickLook(page, "console-light");
  check(page.errors.length === 0, `with no editor yet: errors ${page.errors}`);
  standInEditor(page);
  pickTheme(page, "blueprint");
  check(page.evalIn("__editor.restyled") === 1, `a tile: the editor restyled ${page.evalIn("__editor.restyled")} times`);
  pickFlavour(page, "Dark");
  check(page.evalIn("__editor.restyled") === 2, `the toggle: the editor restyled ${page.evalIn("__editor.restyled")} times`);
  check(page.errors.length === 0, `errors ${page.errors}`);
});

test("look: each tile's radio stays in the focus order, and its preview shows the focus and the check", () => {
  const rules = cssRules(panelCss());
  const radio = rules.filter((rule) => rule.selector.split(",").some((s) => /\.lookTile input$/.test(s.trim())));
  check(radio.length > 0 && radio.every((rule) => !/\bdisplay:\s*none|\bvisibility:\s*hidden/.test(rule.body)), `hidden from the keyboard: ${radio.map((rule) => rule.body)}`);
  const shows = (state, property) => rules.some((rule) => rule.selector === `.lookTile input:${state} ~ .lookPreview` && new RegExp(`\\b${property}:[^;]*var\\(--live\\)`).test(rule.body));
  check(shows("focus-visible", "outline") && shows("checked", "border-color"), "the preview shows the focus and the check");
});

test("look: the block editor is built in the look in force, and takes a new one", () => {
  const page = loadPage({ looks: TEST_LOOKS, stored: { "rover.look": "blueprint-dark" } });
  page.evalIn(`
    globalThis.__themes = [];
    // Blockly, as far as BlockEditor reaches it: anything it asks of it works,
    // and the themes it is given are kept, by their workspace colour.
    const any = new Proxy(function () {}, { get: () => any, apply: () => any, construct: () => any });
    const workspace = new Proxy({}, { get: (_, key) => (key === "setTheme" ? (theme) => __themes.push(theme.componentStyles.workspaceBackgroundColour) : any) });
    const stub = { inject: (_, { theme }) => (__themes.push(theme && theme.componentStyles.workspaceBackgroundColour), workspace), Theme: { defineTheme: (_, theme) => theme } };
    globalThis.javascript = { Order: any };
    window.matchMedia = () => ({ matches: false, addEventListener() {} });
    byId("programWorkspace").style.setProperty = () => {};
    globalThis.__blockEditor = new BlockEditor(byId("programWorkspace"), { Blockly: new Proxy(stub, { get: (t, key) => t[key] || any }), generator: any, storageKey: "test.program" });
  `);
  check(page.evalIn("__themes.join()") === "#0b1a33", `built in ${page.evalIn("__themes.join()")}`);
  page.evalIn('document.documentElement.setAttribute("data-look", "console-light"); __blockEditor.restyle();');
  check(page.evalIn("__themes.join()") === "#0b1a33,#f4f6f8", `restyled in ${page.evalIn("__themes.join()")}`);
  check(page.errors.length === 0, `errors ${page.errors}`);
});

test("look: a change leaves a running program driving", () => {
  const { page, ws } = connected(telemetry({ mode: "MANUAL" }), { looks: TEST_LOOKS });
  page.evalIn("driver.program(MOVE_FORWARD, 60)");
  const mark = count(ws);
  pickLook(page, "console-light");
  page.clock.advance(1000);
  const after = names(ws, mark);
  check(after.length >= 4 && after.every((n) => n === "MOVE_FORWARD"), `the program through a change: ${after}`);
  check(page.errors.length === 0, `errors ${page.errors}`);
});

test("every part's on...(fn) returns a function that unsubscribes fn", () => {
  const page = loadPage();
  const kinds = page.evalIn(`[
    link.onState(() => {}), link.onTelemetry(() => {}), driver.onManualInput(() => {}), driver.onStandDown(() => {}),
    schemeToggle.onChange(() => {}), familySelector.onChange(() => {}), tabs.onChange(() => {}),
    runner.onState(() => {}), runner.onLog(() => {}), runner.onHighlight(() => {}), targetSwitch.onChange(() => {}),
    lookPicker.onChange(() => {}), link.onOta(() => {}), firmwareUpdate.onStart(() => {}),
    targets.rover.onTelemetry(() => {}), targets.rover.onLost(() => {}),
  ].map((unsubscribe) => typeof unsubscribe)`);
  check(kinds.every((kind) => kind === "function"), `returned ${kinds}`);
  const ws = connectOpen(page);
  page.evalIn(`
    globalThis.__frames = 0;
    globalThis.__stop = link.onTelemetry(() => { __frames++; });
  `);
  ws.serverMsg(telemetry());
  page.evalIn("__stop()");
  ws.serverMsg(telemetry());
  check(page.evalIn("__frames") === 1, `heard ${page.evalIn("__frames")} frames, one before unsubscribing`);
  check(page.errors.length === 0, `errors ${page.errors}`);
});

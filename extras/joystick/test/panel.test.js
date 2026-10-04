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
const { stylesheet, cssRules, blockRules, outside } = require("./css.js");
const { degrees } = require("../js/support.js");

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

// A thumb on the stick's canvas as it is now; (dx, dy) is from its centre.
function stickTouch(page, id = 0) {
  const c = page.canvas;
  const touch = (dx, dy) => ({ identifier: id, target: c, pageX: c.width / 2 + dx, pageY: c.height / 2 + dy });
  return {
    start(dx = 0, dy = 0) { page.fire(c, "touchstart", { targetTouches: [touch(dx, dy)], changedTouches: [touch(dx, dy)] }); },
    move(dx, dy) { page.fire(c, "touchmove", { targetTouches: [touch(dx, dy)], changedTouches: [touch(dx, dy)] }); },
    end() { page.fire(c, "touchend", { targetTouches: [], changedTouches: [{ identifier: id }] }); },
    cancel() { page.fire(c, "touchcancel", { targetTouches: [], changedTouches: [{ identifier: id }] }); },
  };
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
  check(order[0] === "joy.js" && order[order.length - 1] === "js/app.js", `joy.js first, app.js last: ${order}`);
  check(new Set(order).size === order.length, `each script once: ${order}`);
  for (const [a, b] of [
    ["js/support.js", "js/link.js"], ["js/support.js", "js/drive.js"], ["js/support.js", "js/tabs.js"],
    ["js/protocol.js", "js/mecanum.js"], ["js/protocol.js", "js/link.js"], ["js/protocol.js", "js/scan.js"],
    ["js/mecanum.js", "js/drive.js"],
  ]) check(loadsBefore(order, a, b), `${a} loads before ${b}: ${order}`);
  check(page.errors.length === 0, `errors ${page.errors}`);
  check(page.doc.body.dataset.link === "down", "link down");
  check(page.$("connect").textContent === "Connect", "button Connect");
  check(page.$("linkState").textContent === "No link", "label");
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
  check(page.$("linkState").textContent === "Connecting", "Connecting label");
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

// A mouse on the stick's canvas; (dx, dy) is from its centre. joy.js follows
// a drag on the document, as it does the release.
function mouseStick(page) {
  const c = page.canvas;
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

test("telemetry: five wedges coloured by STOP/GO, no echo faded at full reach", () => {
  const { page, ws } = connected(telemetry({ distanceLeft: 20, distanceFrontLeft: 30, distanceFront: 150, distanceFrontRight: 999, distanceRight: 25 }));
  const B = scanBearings(page);
  const by = Object.fromEntries(B.map((b) => [b.key, b]));
  for (const b of B) check(b.wedge.getAttribute("d") !== "", `${b.key} drawn`);
  check(by.distanceLeft.wedge.getAttribute("fill") === "var(--stop)", "20 cm red");
  check(by.distanceRight.wedge.getAttribute("fill") === "var(--stop)", "25 cm (= STOP) red");
  check(by.distanceFrontLeft.wedge.getAttribute("fill") === "var(--warn)", "30 cm amber");
  check(by.distanceFront.wedge.getAttribute("fill") === "var(--live)", "150 cm teal");
  const fr = by.distanceFrontRight;
  check(fr.wedge.getAttribute("fill") === "var(--dim)" && fr.wedge.getAttribute("opacity") === "0.4", "no echo faded");
  check(fr.wedge.getAttribute("d").includes("A140.0 140.0"), "no echo at full reach");
  check(fr.reading.textContent === "no echo", fr.reading.textContent);
  check(by.distanceLeft.reading.textContent === "20cm", by.distanceLeft.reading.textContent);
  ws.serverMsg(telemetry({ distanceFrontLeft: 40 }));
  check(by.distanceFrontLeft.wedge.getAttribute("fill") === "var(--warn)", "40 cm (= GO) amber");
  ws.serverMsg(telemetry({ distanceFrontLeft: 41 }));
  check(by.distanceFrontLeft.wedge.getAttribute("fill") === "var(--live)", "41 cm teal");

  // Screen placement: the rover's left is the panel's left.
  const firstX = (b) => Number(b.wedge.getAttribute("d").match(/^M([\d.]+)/)[1]);
  check(firstX(by.distanceLeft) < 210 && firstX(by.distanceRight) > 210, "left drawn on the left");

  // Distances missing (fresh boot): every wedge cleared, not left standing.
  ws.serverMsg(FRAMES.manualBeforeScan);
  for (const b of B) {
    check(b.wedge.getAttribute("d") === "", `${b.key} cleared`);
    check(b.reading.textContent === "—", `${b.key} reading cleared`);
  }
  // One key missing only clears that one.
  ws.serverMsg(telemetry({ distanceFront: undefined }));
  check(by.distanceFront.wedge.getAttribute("d") === "" && by.distanceLeft.wedge.getAttribute("d") !== "", "partial");
  for (const junk of ["not json", "null", "42", "[]", '"x"', '{"distanceFront":"12"}', '{"distanceFront":-1}']) ws.serverMsg(junk);
  check(page.errors.length === 0, `errors ${page.errors}`);
});

test("phase readout: autonomous only, halt reason shown", () => {
  const { page, ws } = connected(telemetry({ phase: "CRUISE" }));
  check(!page.$("phaseCell").hidden && page.$("phase").textContent === "CRUISE", page.$("phase").textContent);
  check(page.$("auto").getAttribute("aria-pressed") === "true", "auto pressed");
  ws.serverMsg(telemetry({ phase: "HALTED", halt: "boxed in" }));
  check(page.$("phase").textContent === "HALTED: boxed in", page.$("phase").textContent);
  check(page.$("phase").dataset.tone === "warn", "halt tone");
  ws.serverMsg(telemetry({ phase: "HALTED", halt: "sensor silent" }));
  check(page.$("phase").textContent === "HALTED: sensor silent", page.$("phase").textContent);
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
      check(phase.textContent === (frame.halt ? `${frame.phase}: ${frame.halt}` : frame.phase), `${name}: phase '${phase.textContent}'`);
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

test("Stop always sends STOP; Autonomous sends only RESUME and ends the repeat", () => {
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

  const s = stickTouch(page, 0);
  s.start(); s.move(0, -50);
  mark = count(ws);
  page.fire(page.$("auto"), "click");
  page.clock.advance(1000);
  check(names(ws, mark).join() === "RESUME_AUTONOMOUS", `auto ${names(ws, mark)}`);
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
    check(page.$("linkState").textContent === "No link", `${storage}: initial state rendered`);
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

// The shield warning, and its data-ready, which the header's motors pill
// keys on: "shown/no", "hidden/yes" or "hidden/unknown".
const shield = (fault) => `${fault.hidden ? "hidden" : "shown"}/${fault.dataset.ready}`;

test("motorsReady: false shows the shield warning; missing or true does not", () => {
  const page = loadPage();
  const fault = page.$("motorsFault");
  check(fault !== null, "#motorsFault exists");
  check(shield(fault) === "hidden/unknown", `at load: ${shield(fault)}`);
  check(fault.getAttribute("role") === "alert", "announced as an alert");
  check(/Motor shield not found/.test(fault.children.map((c) => c.textContent).join(" ")), "says what is wrong");

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

// The right column is the rover's at all times (F3c): with nothing to show
// yet it says so, in its own place and at its full size, rather than look
// broken. Only before a frame: a link that goes leaves its scan, dimmed.
test("the scan says no rover is connected until the first frame, and not after a link goes", () => {
  const page = loadPage();
  const empty = () => page.$("scan").dataset.empty;
  check(empty() === "yes", `at load: ${empty()}`);
  let ws = connectOpen(page);
  check(empty() === "yes", "up, before a frame: still nothing to draw");
  ws.serverMsg(FRAMES.manualBeforeScan);
  check(empty() === "no", "a frame without distances is a frame: the rover is there");
  ws.serverDrop();
  check(page.doc.body.dataset.link === "down" && empty() === "no", "gone: its last scan stays, as history");
  ws = connectOpen(page);
  check(empty() === "yes", "a new link starts from nothing");
  ws.serverMsg(telemetry({ distanceFront: 80 }));
  check(empty() === "no", "until its first frame");
  page.fire(page.$("host"), "keydown", { key: "Enter" });
  check(page.doc.body.dataset.link === "connecting" && empty() === "yes", "replaced: nothing again");

  // panel.css shows the words while the scan is empty and no link is up:
  // with a link up and its first frame still to come, the pill says so.
  const shown = cssRules(panelCss()).filter((r) => /\.scanEmpty\b/.test(r.selector) && /display:\s*block/.test(r.body));
  check(shown.length === 1, `one rule shows it: ${shown.map((r) => r.selector)}`);
  const selector = shown.length ? shown[0].selector : "";
  check(/#scan\[data-empty="yes"\]/.test(selector), `only while empty: ${selector}`);
  const states = (selector.match(/data-link="(\w+)"/g) || []).map((m) => m.slice(11, -1)).sort().join();
  check(states === "connecting,down", `only with no link up: ${states}`);
  // One cell the card's own size: an auto row, sized by the hidden words
  // in a small card, let the fan spill out of it.
  const card = cssRules(panelCss()).find((r) => r.selector === ".scan" && /grid-template:/.test(r.body));
  check(card && /grid-template:\s*minmax\(0, 1fr\) \/ minmax\(0, 1fr\);/.test(card.body), `the card's cell: ${card && card.body}`);
  const own = cssRules(panelCss()).find((r) => r.selector === ".scanEmpty");
  check(own && /display:\s*none/.test(own.body), "otherwise not shown");
  check(page.$("scan").parentNode.querySelectorAll(".scanEmpty").length === 1, "in the scan's own card");
  // The rule reaches the words only as the scan's next sibling.
  check(/#scan\[data-empty="yes"\]\s*\+\s*\.scanEmpty$/.test(selector), `the words right after the scan: ${selector}`);
  const cardKids = page.$("scan").parentNode.children;
  const next = cardKids[cardKids.indexOf(page.$("scan")) + 1];
  check(next && /\bscanEmpty\b/.test(next.getAttribute("class") || ""), "and so they are, in the page");
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
  check(page.$("scan").getAttribute("viewBox") === `0 0 ${W} ${H}`, "viewBox set");
  const nodes = all(page.$("scan"));
  const rings = nodes.filter((n) => /^ring/.test(n.getAttribute("class") || ""));
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

  // Text boxes (worst-case strings) must stay inside the view, off every wedge's
  // largest possible sector, and off each other.
  const texts = nodes.filter((n) => n.tagName === "TEXT");
  const boxes = texts.map((n) => {
    const cls = n.getAttribute("class");
    const big = cls === "reading";
    const str = big ? "no echo" : n.textContent;
    const w = str.length * (big ? 9.0 : 6.8);
    const x = Number(n.getAttribute("x"));
    const y = Number(n.getAttribute("y"));
    const a = n.getAttribute("text-anchor");
    const x0 = a === "end" ? x - w : a === "start" ? x : x - w / 2;
    return { str, x0, x1: x0 + w, y0: y - (big ? 11 : 7), y1: y + (big ? 3 : 1) };
  });
  check(texts.every((n) => n.getAttribute("text-anchor")), "every label anchored");
  for (const b of boxes) {
    check(b.x0 >= 0 && b.x1 <= W && b.y0 >= 0 && b.y1 <= H, `'${b.str}' inside view: ${JSON.stringify(b)}`);
    let hits = 0;
    for (let x = b.x0; x <= b.x1; x += 0.5) {
      for (let y = b.y0; y <= b.y1; y += 0.5) {
        const r = Math.hypot(x - CX, CY - y);
        const ang = degrees(Math.atan2(CY - y, x - CX));
        if (r < RMIN || r > RMAX) continue;
        for (const brg of g("BEARINGS")) if (Math.abs(ang - (90 + brg.bearing)) <= HW) hits++;
      }
    }
    check(hits === 0, `'${b.str}' overlaps a wedge (${hits} samples)`);
  }
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const p = boxes[i], q = boxes[j];
      const overlap = p.x0 < q.x1 && q.x0 < p.x1 && p.y0 < q.y1 && q.y0 < p.y1;
      check(!overlap, `'${p.str}' overlaps '${q.str}'`);
    }
  }
  const tickTexts = texts.filter((n) => n.getAttribute("class").startsWith("tick")).map((n) => n.textContent);
  check(["100", "40 GO", "25 STOP", "L", "FL", "F", "FR", "R"].every((t) => tickTexts.includes(t)), `ticks ${tickTexts}`);
  check(!tickTexts.some((t) => /°/.test(t)), "no servo-angle ticks");
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
// with whether anything was still being driven) and __presses (onManualInput).
function listen(page) {
  page.evalIn(`
    globalThis.__downs = [];
    globalThis.__presses = 0;
    driver.onStandDown((reason) => __downs.push(reason + (driver.driving ? " while driving" : "")));
    driver.onManualInput(() => { __presses++; });
  `);
  return {
    downs: () => page.evalIn("__downs.join()"),
    presses: () => page.evalIn("__presses"),
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

test("setFamily: a held stick re-steers at once, into the family's quadrant move", () => {
  const page = loadPage();
  const ws = connectOpen(page);
  check(page.evalIn("driver.family") === "TRANSLATE", `default family ${page.evalIn("driver.family")}`);

  // Nothing held: changing the family sends nothing.
  page.evalIn("driver.setFamily(FAMILY_PIVOT)");
  page.evalIn("driver.setFamily(FAMILY_TRANSLATE)");
  page.clock.advance(500);
  check(count(ws) === 0, `idle setFamily sent ${names(ws)}`);

  const s = stickTouch(page, 0);
  s.start(); s.move(0, -50);
  check(names(ws).join() === "MOVE_FORWARD", `translate ${names(ws)}`);
  page.clock.advance(30); // inside STICK_SEND_MS: only a new direction may go now
  let mark = count(ws);
  page.evalIn("driver.setFamily(FAMILY_PIVOT)");
  check(names(ws, mark).join() === "PIVOT_RIGHT_FORWARD", `pivot ${names(ws, mark)}`); // on an axis: right and forward
  check(ws.sentAt[mark] === page.clock.now(), "sent at once");
  check(page.evalIn("driver.family") === "PIVOT", "family getter");

  page.clock.advance(30);
  mark = count(ws);
  page.evalIn("driver.setFamily(FAMILY_PIVOT_SIDEWAYS)");
  check(names(ws, mark).join() === "PIVOT_SIDEWAYS_FORWARD_RIGHT", `sideways ${names(ws, mark)}`);
  check(ws.sentAt[mark] === page.clock.now(), "sent at once");

  mark = count(ws);
  s.move(-60, 40); // down and left
  check(names(ws, mark).join() === "PIVOT_SIDEWAYS_BACKWARD_LEFT", `quadrant ${names(ws, mark)}`);

  // The same family again changes nothing; the repeat carries the pivot.
  mark = count(ws);
  page.evalIn("driver.setFamily(FAMILY_PIVOT_SIDEWAYS)");
  check(count(ws) === mark, `same family sent ${names(ws, mark)}`);
  page.clock.advance(450);
  check(names(ws, mark).length === 2 && names(ws, mark).every((n) => n === "PIVOT_SIDEWAYS_BACKWARD_LEFT"), `repeat ${names(ws, mark)}`);

  // An unknown family throws and changes nothing.
  mark = count(ws);
  let threw = null;
  try { page.evalIn('driver.setFamily("SIDEWAYS")'); } catch (err) { threw = err; }
  check(threw && threw.name === "RangeError", `unknown family: ${threw}`);
  check(page.evalIn("driver.family") === "PIVOT_SIDEWAYS" && count(ws) === mark, "unchanged");

  mark = count(ws);
  page.evalIn("driver.setFamily(FAMILY_TRANSLATE)");
  check(names(ws, mark).join() === "MOVE_DIAGONAL225", `back to translate ${names(ws, mark)}`);

  // A rotate button still wins over the stick, whatever the family.
  press(page, page.$("cw"), 4);
  mark = count(ws);
  page.evalIn("driver.setFamily(FAMILY_PIVOT)");
  check(count(ws) === mark, `re-steered under a held rotate: ${names(ws, mark)}`);
  lift(page, page.$("cw"), 4);
  check(names(ws, mark).join() === "PIVOT_LEFT_BACKWARD", `stick again ${names(ws, mark)}`);
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

  const touch = loadPage();
  connectOpen(touch);
  const touched = listen(touch);
  stickTouch(touch, 0).start();
  check(touched.presses() === 1, `touch on the stick: ${touched.presses()}`);
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

  // The scheme toggle sits outside the tabs, in the header; the family
  // selector belongs to the stick, on the Drive tab.
  check(page.$("schemeSlot") !== null && !inside("schemeSlot", "driveTab") && !inside("schemeSlot", "programTab"), "#schemeSlot outside the tabs");
  check(page.$("familySlot") !== null && inside("familySlot", "driveTab"), "#familySlot on the Drive tab");
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
// size unchanged: a phone turned, where 54vw upright is 54vmin on its side.
// joy.js measures a thumb against where the box is now.
function moveStick(page, left, top) {
  page.$("stick").offsetLeft = left;
  page.$("stick").offsetTop = top;
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
// (on a phone on its side, the address put away as the link comes up), or
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
// The scheme the toggle shows as the rover's, or "unknown".
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

test("schemes: the toggle is disabled and unknown until telemetry names a scheme", () => {
  const page = loadPage();
  const group = page.$("scheme");
  const unknown = (when) => {
    check(shownScheme(page) === "unknown", `${when}: shows ${shownScheme(page)}`);
    check(SCHEMES.every((s) => schemeButton(page, s).disabled === true), `${when}: both disabled`);
    check(group.dataset.state === "unknown", `${when}: state ${group.dataset.state}`);
    check(page.$("family").hidden === true && page.evalIn("driver.family") === "TRANSLATE", `${when}: no family selector, translating`);
  };
  check(SCHEMES.every((s) => schemeButton(page, s) !== undefined), "two segments built");
  unknown("at load");

  const ws = connectOpen(page);
  unknown("connected, no telemetry yet");
  // Firmware from before schemes, a scheme this panel does not know, junk.
  for (const scheme of [undefined, "EXPERT", "advanced", 1, null, { name: "ADVANCED" }]) {
    ws.serverMsg(telemetry({ scheme }));
    unknown(`scheme ${JSON.stringify(scheme)}`);
    for (const s of SCHEMES) page.fire(schemeButton(page, s), "click");
  }
  check(count(ws) === 0, `a disabled toggle sent ${ws.sent}`);

  ws.serverMsg(telemetry({ scheme: "NORMAL" }));
  check(shownScheme(page) === "NORMAL" && group.dataset.state === "known", `NORMAL: ${shownScheme(page)} ${group.dataset.state}`);
  check(SCHEMES.every((s) => schemeButton(page, s).disabled === false), "enabled");
  check(page.evalIn("schemeToggle.scheme") === "NORMAL", "scheme getter");
  ws.serverMsg(telemetry({ scheme: "ADVANCED" }));
  check(shownScheme(page) === "ADVANCED", `follows telemetry, as after the pad's SELECT: ${shownScheme(page)}`);
  ws.serverMsg(telemetry({ scheme: undefined })); // a frame that names none says nothing is known
  unknown("a frame without scheme");
  check(count(ws) === 0, `sent ${ws.sent}`);
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
  check(page.$("family").hidden === true, "no selector before the rover reports ADVANCED");
  page.fire(schemeButton(page, "ADVANCED"), "click"); // again, impatiently
  check(count(ws) === 1, `a second click on the pending scheme sent ${ws.sent}`);

  liveFor(page, ws, 500, { scheme: "ADVANCED" });
  check(shownScheme(page) === "ADVANCED" && pendingScheme(page) === null, `confirmed: ${shownScheme(page)}, pending ${pendingScheme(page)}`);
  check(page.$("scheme").getAttribute("aria-busy") === "false", "not busy");
  check(page.$("mode").textContent === "AUTONOMOUS" && page.$("auto").getAttribute("aria-pressed") === "true", `mode ${page.$("mode").textContent}`);
  check(page.$("family").hidden === false, "selector offered");
  page.fire(schemeButton(page, "ADVANCED"), "click"); // the scheme already in force
  liveFor(page, ws, 2000, { scheme: "ADVANCED" });
  check(count(ws) === 1, `sent ${ws.sent}`);
  check(heard.presses() === 0 && heard.downs() === "", `manual input ${heard.presses()}, stand-downs '${heard.downs()}'`);

  page.fire(schemeButton(page, "NORMAL"), "click");
  liveFor(page, ws, 500, { scheme: "NORMAL" });
  check(ws.sent.join(" ") === '{"scheme":"ADVANCED"} {"scheme":"NORMAL"}', `sent ${ws.sent.join(" ")}`);
  check(shownScheme(page) === "NORMAL" && page.$("family").hidden === true, "back to NORMAL");
  check(page.$("mode").textContent === "AUTONOMOUS", "still exploring");
  check(page.errors.length === 0, `errors ${page.errors}`);
});

test("schemes: the toggle bypasses the Driver: a held stick drives on until the rover reports the change", () => {
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
  check(names(ws, mark).join() === "STOP", `confirmed under the thumb ${names(ws, mark)}`);
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

test("schemes: the family selector is offered under ADVANCED only; corner hints under a pivot family", () => {
  const page = loadPage();
  const ws = connectOpen(page);
  const heard = listen(page);
  const offered = () => page.$("family").hidden === false;
  check(familyButton(page, "TRANSLATE") && familyButton(page, "PIVOT") && familyButton(page, "PIVOT_SIDEWAYS"), "three segments built");

  // Each segment shows its family's icon as the up-and-right corner draws
  // it, so the segment and the corner it lights up cannot disagree. Drawn,
  // not typed: the arrow characters fell back to fonts of different weights.
  ICONS = page.evalIn("FamilySelector.ICONS");
  check(new Set(Object.values(ICONS)).size === 3 && Object.values(ICONS).every((d) => /^M[\d. ]/.test(d)), `three icons ${JSON.stringify(ICONS)}`);
  for (const family of ["TRANSLATE", "PIVOT", "PIVOT_SIDEWAYS"]) {
    const [icon, name] = familyButton(page, family).children;
    const drawn = icon.children[0];
    check(icon.getAttribute("aria-hidden") === "true" && name.textContent.length > 0, `${family}: icon hidden, name read`);
    check(drawn.getAttribute("d") === ICONS[family] && drawn.getAttribute("transform") === MIRROR.upRight, `${family}: segment drew ${drawn.getAttribute("d")}`);
  }

  ws.serverMsg(telemetry({ scheme: "NORMAL" }));
  check(!offered() && page.$("stickLabel").textContent === "Translate", "NORMAL: hidden, translating");
  check(page.$("stickHints").hidden === true && page.$("pivotCaveat").hidden === true, "NORMAL: no hints, no caveat");
  page.fire(familyButton(page, "PIVOT"), "click"); // hidden, so not clickable; and if it were
  check(page.evalIn("driver.family") === "TRANSLATE", `a withdrawn selector changed the family to ${page.evalIn("driver.family")}`);

  ws.serverMsg(telemetry({ scheme: "ADVANCED" }));
  check(offered() && isPressed(familyButton(page, "TRANSLATE")), "ADVANCED: offered, starting at Translate");
  check(page.$("stickHints").hidden === true && page.$("pivotCaveat").hidden === true, "Translate: no hints, no caveat");

  const want = {
    PIVOT: ["Pivot", "upLeft:PIVOT_LEFT_FORWARD,upRight:PIVOT_RIGHT_FORWARD,downLeft:PIVOT_LEFT_BACKWARD,downRight:PIVOT_RIGHT_BACKWARD"],
    PIVOT_SIDEWAYS: ["Pivot sideways", "upLeft:PIVOT_SIDEWAYS_FORWARD_LEFT,upRight:PIVOT_SIDEWAYS_FORWARD_RIGHT,downLeft:PIVOT_SIDEWAYS_BACKWARD_LEFT,downRight:PIVOT_SIDEWAYS_BACKWARD_RIGHT"],
  };
  for (const [family, [label, hints]] of Object.entries(want)) {
    page.fire(familyButton(page, family), "click");
    check(page.evalIn("driver.family") === family && page.evalIn("familySelector.family") === family, `${family}: driver ${page.evalIn("driver.family")}`);
    check(["TRANSLATE", "PIVOT", "PIVOT_SIDEWAYS"].every((f) => isPressed(familyButton(page, f)) === (f === family)), `${family}: one segment pressed`);
    check(page.$("stickLabel").textContent === label, `${family}: caption ${page.$("stickLabel").textContent}`);
    check(page.$("stickHints").hidden === false && hintMoves(page) === hints, `${family}: hints ${hintMoves(page)}`);
    check(page.$("pivotCaveat").hidden === false, `${family}: caveat shown`);
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
  page.fire(familyButton(page, "TRANSLATE"), "click");
  check(page.$("stickHints").hidden === true && page.$("stickLabel").textContent === "Translate", "back to Translate");

  page.clock.advance(1000);
  check(count(ws) === 0 && heard.presses() === 0, `choosing families sent ${ws.sent}, presses ${heard.presses()}`);

  page.fire(familyButton(page, "PIVOT"), "click");
  ws.serverMsg(telemetry({ scheme: "NORMAL" }));
  check(!offered() && page.evalIn("driver.family") === "TRANSLATE" && page.$("stickHints").hidden === true, "NORMAL withdraws the selector and the pivot family");
  ws.serverMsg(telemetry({ scheme: "ADVANCED" }));
  check(isPressed(familyButton(page, "TRANSLATE")) && page.evalIn("driver.family") === "TRANSLATE", "offered again at Translate, not the pivot left behind");
  check(count(ws) === 0, `sent ${ws.sent}`);
  check(page.errors.length === 0, `errors ${page.errors}`);
});

// The phone-on-its-side block's opening, as css/panel.css writes it, and the
// rules inside one @media block of panel.css (css.js).
const LANDSCAPE_PHONE = "@media (orientation: landscape) and (max-height: 520px) {";
const panelCss = () => stylesheet("panel.css");
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

test("schemes: the stick hints cannot take a touch from joy.js, and nothing above the stick is positioned", () => {
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

  // joy.js places a touch by its canvas's offsetParent: no ancestor of the
  // canvas may become one, by a stylesheet or its own style attribute.
  const page = loadPage();
  const ancestors = [];
  for (let n = page.canvas.parentNode; n && n.tagName !== "BODY"; n = n.parentNode) ancestors.push(n);
  check(ancestors.some((n) => n.id === "stick") && ancestors.some((n) => n.id === "driveTab"), `ancestors ${ancestors.map((n) => n.id || n.tagName)}`);
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

// Layout the fake DOM cannot lay out, held by the stylesheet's words. Beside
// a landscape stick the motor-fault card takes the scan's place; at its own
// height the page grew and the stick slid half off a 568 x 320 screen. And a
// line clamp in a card the grid stretches cut the text mid-sentence and still
// showed the lines after its ellipsis. Measured in a browser at 480 x 320 to
// 812 x 375 (css/panel.css says what it found).
test("motorsReady: the fault beside a landscape stick takes no height of its own, and no fault card clamps its lines", () => {
  const besideStick = (selector) =>
    /:has\(>\s*#driveTab:not\(\[hidden\]\)\).*#motorsFault:not\(\[hidden\]\)\)\s+\.fault$/.test(selector.trim());
  // Only in the landscape block: anywhere else, the upright phone's card too
  // would shrink to two lines.
  const beside = (mediaRules(LANDSCAPE_PHONE) || []).filter((r) => r.selector.split(",").some(besideStick));
  check(beside.length === 1, `the Drive tab's fault card, in the landscape block: ${beside.map((r) => r.selector)}`);
  const body = beside.length === 1 ? beside[0].body : "";
  check(/\bcontain:\s*size\b/.test(body) && /\boverflow-y:\s*auto\b/.test(body), `sized by the room it is given: ${body}`);
  // And only beside the stick: the Program tab's card, contained, fell to its
  // floor and scrolled inside a page that scrolls.
  const rules = cssRules(panelCss());
  const contained = rules.filter((r) => /\.fault\b/.test(r.selector) && /\bcontain:(?!\s*none\b)/.test(r.body));
  check(contained.every((r) => r.selector.split(",").every(besideStick)), `contained beyond the Drive tab: ${contained.map((r) => r.selector)}`);
  const clamped = rules.filter((r) => /\.fault\b/.test(r.selector) && /line-clamp/.test(r.body));
  check(clamped.length === 0, `clamped: ${clamped.map((r) => r.selector)}`);
});

// The scripts read the stylesheet's tokens by name: blocks.js's Blockly
// theme through token(), which reads nothing at all for a name that is gone,
// and the scan's and the simulator's SVG fills through var(), which leave a
// wedge or a ray unfilled. Three colours cannot be read so, and are copied:
// joy.js paints the stick's knob from drive.js (and the page takes its teal
// from there), and Blockly takes the stop block's red and the grid's colour
// as plain values. Each copy must be its token's value.
test("every CSS token a script reads is declared on :root in css/panel.css, and the copies agree", () => {
  const root = new Map(cssRules(panelCss())
    .filter((rule) => rule.selector === ":root")
    .flatMap((rule) => [...rule.body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map(([, name, value]) => [name, value.trim()])));
  const declared = new Set(root.keys());
  const script = (file) => fs.readFileSync(path.join(PANEL_ROOT, "js", file), "utf8");
  const { RoverBlocks } = require("../js/blocks.js");
  for (const [what, copy, token] of [
    ["drive.js's stick knob", (script("drive.js").match(/\binternalFillColor:\s*"([^"]*)"/) || [])[1], "--live"],
    ["blocks.js's stop block", RoverBlocks.PALETTE.stop, "--stop"],
    ["blocks.js's workspace grid", (script("blocks.js").match(/\bgrid:\s*\{[^}]*\bcolour:\s*"([^"]*)"/) || [])[1], "--raised-hi"],
  ]) check(copy !== undefined && copy.toLowerCase() === (root.get(token) || "").toLowerCase(), `${what} is ${copy}, but ${token} is ${root.get(token)}`);
  const readers = new Map(); // token -> the scripts that read it
  const js = path.join(PANEL_ROOT, "js");
  for (const file of fs.readdirSync(js).filter((name) => name.endsWith(".js"))) {
    const text = fs.readFileSync(path.join(js, file), "utf8");
    for (const [, token] of [...text.matchAll(/token\("(--[\w-]+)"/g), ...text.matchAll(/var\((--[\w-]+)\)/g)]) {
      readers.set(token, new Set(readers.get(token)).add(file));
    }
  }
  check(readers.size > 0, "found the tokens the scripts read");
  for (const [token, files] of readers) check(declared.has(token), `${token}, read by ${[...files]}, is not declared on :root`);
});

test("schemes: each quadrant of each family sends the move test/vectors/stick_moves.json gives it", () => {
  const { cases: stickCases } = vectors("stick_moves.json");
  const runs = [["NORMAL", "TRANSLATE"], ["ADVANCED", "TRANSLATE"], ["ADVANCED", "PIVOT"], ["ADVANCED", "PIVOT_SIDEWAYS"]];
  for (const [scheme, family] of runs) {
    const { page, ws } = connected(telemetry({ mode: "MANUAL", scheme }));
    if (scheme === "ADVANCED") page.fire(familyButton(page, family), "click");
    check(page.evalIn("driver.family") === family, `${scheme}/${family}: driver ${page.evalIn("driver.family")}`);
    const cases = stickCases.filter((c) => c.family === family);
    check(cases.length >= 5, `${family}: ${cases.length} cases`);
    const s = stickTouch(page, 0);
    for (const { x, yUp, move } of cases) {
      const mark = count(ws);
      s.start(); pushTo(page, s, x, yUp);
      check(names(ws, mark).join() === move, `${scheme}/${family} (${x}, ${yUp}): want ${move}, sent ${names(ws, mark)}`);
      s.end();
      check(names(ws, mark + 1).join() === "STOP", `${scheme}/${family} (${x}, ${yUp}): release ${names(ws, mark + 1)}`);
    }
    check(page.errors.length === 0, `errors ${page.errors}`);
  }

  // The headline case: ADVANCED, Pivot, the stick up and to the right.
  const { page, ws } = connected(telemetry({ mode: "MANUAL", scheme: "ADVANCED" }));
  page.fire(familyButton(page, "PIVOT"), "click");
  const s = stickTouch(page, 0);
  s.start(); pushTo(page, s, 60, 60);
  check(ws.moves()[0].move === 9 && names(ws).join() === "PIVOT_RIGHT_FORWARD", `up-right under Pivot sent ${ws.sent}`);
});

test("schemes: the operator's family change re-steers a held stick at once", () => {
  const { page, ws } = connected(telemetry({ mode: "MANUAL", scheme: "ADVANCED" }));
  const s = stickTouch(page, 0);
  s.start(); pushTo(page, s, 60, 60);
  check(names(ws).join() === "MOVE_DIAGONAL45", `translate ${names(ws)}`);
  for (const [family, move] of [["PIVOT", "PIVOT_RIGHT_FORWARD"], ["PIVOT_SIDEWAYS", "PIVOT_SIDEWAYS_FORWARD_RIGHT"], ["TRANSLATE", "MOVE_DIAGONAL45"]]) {
    page.clock.advance(30); // inside STICK_SEND_MS: only a new direction may go now
    const mark = count(ws);
    page.fire(familyButton(page, family), "click");
    check(names(ws, mark).join() === move && ws.sentAt[mark] === page.clock.now(), `${family}: ${names(ws, mark)} at once`);
  }
  // A held rotate button wins over the stick: the family changes nothing sent.
  press(page, page.$("ccw"), 4);
  const mark = count(ws);
  page.fire(familyButton(page, "PIVOT"), "click");
  check(count(ws) === mark, `under a held rotate: ${names(ws, mark)}`);
  lift(page, page.$("ccw"), 4);
  check(names(ws, mark).join() === "PIVOT_RIGHT_FORWARD", `the stick again, in its new family: ${names(ws, mark)}`);
});

test("schemes: telemetry flipping the scheme mid-hold sends one STOP, then nothing until a fresh press", () => {
  // NORMAL to ADVANCED, by touch: the family stays Translate, and the stick
  // still lets go -- whoever flipped it, the change is not this thumb's.
  {
    const { page, ws } = connected(telemetry({ mode: "MANUAL", scheme: "NORMAL" }));
    const s = stickTouch(page, 0);
    s.start(); pushTo(page, s, 0, 70);
    liveFor(page, ws, 500, { mode: "MANUAL", scheme: "NORMAL" });
    check(count(ws) >= 3 && names(ws).every((n) => n === "MOVE_FORWARD"), `drove ${names(ws)}`);
    let mark = count(ws);
    ws.serverMsg(telemetry({ mode: "MANUAL", scheme: "ADVANCED" })); // the pad's SELECT, say
    check(names(ws, mark).join() === "STOP", `flip ${names(ws, mark)}`);
    mark = count(ws);
    for (let i = 0; i < 10; i++) { pushTo(page, s, 10 * i, 70); liveFor(page, ws, 150, { mode: "MANUAL", scheme: "ADVANCED" }); }
    check(count(ws) === mark, `the thumb still down sent ${names(ws, mark)}`);
    s.end();
    check(count(ws) === mark, `lifting sent ${names(ws, mark)}`);
    s.start(); pushTo(page, s, 0, 70);
    liveFor(page, ws, 400, { mode: "MANUAL", scheme: "ADVANCED" });
    check(names(ws, mark).length >= 3 && names(ws, mark).every((n) => n === "MOVE_FORWARD"), `a fresh press drives: ${names(ws, mark)}`);
    check(page.errors.length === 0, `errors ${page.errors}`);
  }

  // ADVANCED (Pivot) to NORMAL, by touch: the pivot under the thumb must not
  // become a diagonal.
  {
    const { page, ws } = connected(telemetry({ mode: "MANUAL", scheme: "ADVANCED" }));
    page.fire(familyButton(page, "PIVOT"), "click");
    const s = stickTouch(page, 0);
    s.start(); pushTo(page, s, 60, 60);
    liveFor(page, ws, 500, { mode: "MANUAL", scheme: "ADVANCED" });
    check(names(ws).every((n) => n === "PIVOT_RIGHT_FORWARD"), `pivoted ${names(ws)}`);
    let mark = count(ws);
    ws.serverMsg(telemetry({ mode: "MANUAL", scheme: "NORMAL" }));
    check(names(ws, mark).join() === "STOP", `flip ${names(ws, mark)}`);
    check(page.evalIn("driver.family") === "TRANSLATE" && page.$("family").hidden === true, "translating, selector withdrawn");
    mark = count(ws);
    pushTo(page, s, 61, 60);
    liveFor(page, ws, 1500, { mode: "MANUAL", scheme: "NORMAL" });
    check(count(ws) === mark, `the thumb still down sent ${names(ws, mark)}`);
    s.end(); s.start(); pushTo(page, s, 60, 60);
    check(names(ws, mark).join() === "MOVE_DIAGONAL45", `a fresh press drives in the new scheme: ${names(ws, mark)}`);
  }

  // By mouse, held through the change and released afterwards.
  {
    const { page, ws } = connected(telemetry({ mode: "MANUAL", scheme: "ADVANCED" }), { touch: false });
    const m = mouseStick(page);
    m.down(); m.move(95, 0);
    check(names(ws).join() === "MOVE_RIGHT", `mouse ${names(ws)}`);
    let mark = count(ws);
    ws.serverMsg(telemetry({ mode: "MANUAL", scheme: "NORMAL" }));
    m.move(90, -20);
    liveFor(page, ws, 1000, { mode: "MANUAL", scheme: "NORMAL" });
    check(names(ws, mark).join() === "STOP", `mouse flip ${names(ws, mark)}`);
    mark = count(ws);
    m.up();
    m.down(); m.move(0, -95);
    check(names(ws, mark).join() === "MOVE_FORWARD", `a fresh click drives: ${names(ws, mark)}`);
  }
});

test("schemes: a scheme flip leaves a held rotate button driving", () => {
  const { page, ws } = connected(telemetry({ mode: "MANUAL", scheme: "NORMAL" }));
  press(page, page.$("cw"), 2);
  ws.serverMsg(telemetry({ mode: "MANUAL", scheme: "ADVANCED" }));
  liveFor(page, ws, 1000, { mode: "MANUAL", scheme: "ADVANCED" });
  check(count(ws) >= 6 && names(ws).every((n) => n === "ROTATE_CLOCKWISE"), `rotate alone ${names(ws)}`);

  // The stick under the rotate button lets go; the rotation does not.
  const s = stickTouch(page, 1);
  s.start(); pushTo(page, s, 0, 80);
  let mark = count(ws);
  ws.serverMsg(telemetry({ mode: "MANUAL", scheme: "NORMAL" }));
  liveFor(page, ws, 1000, { mode: "MANUAL", scheme: "NORMAL" });
  check(!names(ws, mark).includes("STOP") && names(ws, mark).every((n) => n === "ROTATE_CLOCKWISE"), `rotate and stick ${names(ws, mark)}`);
  mark = count(ws);
  lift(page, page.$("cw"), 2);
  liveFor(page, ws, 1000, { mode: "MANUAL", scheme: "NORMAL" });
  check(names(ws, mark).join() === "STOP", `the stick does not take over from a released rotate: ${names(ws, mark)}`);
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

test("schemes: losing the link makes the scheme unknown and the family Translate", () => {
  const page = loadPage();
  let ws = connectOpen(page);
  ws.serverMsg(telemetry({ scheme: "ADVANCED" }));
  page.fire(familyButton(page, "PIVOT"), "click");
  check(page.evalIn("driver.family") === "PIVOT", "pivoting");
  ws.serverDrop();
  check(shownScheme(page) === "unknown" && SCHEMES.every((s) => schemeButton(page, s).disabled), `lost: ${shownScheme(page)}`);
  check(page.evalIn("driver.family") === "TRANSLATE" && page.$("family").hidden === true, "translating, selector withdrawn");
  check(page.$("stickLabel").textContent === "Translate" && page.$("stickHints").hidden === true, "caption and hints follow");

  ws = connectOpen(page);
  check(shownScheme(page) === "unknown", "unknown until the new link reports it");
  ws.serverMsg(telemetry({ scheme: "ADVANCED" }));
  check(shownScheme(page) === "ADVANCED" && isPressed(familyButton(page, "TRANSLATE")), "reported again, at Translate");
  page.fire(familyButton(page, "PIVOT_SIDEWAYS"), "click");
  page.fire(page.$("connect"), "click"); // a deliberate disconnect
  check(shownScheme(page) === "unknown" && page.evalIn("driver.family") === "TRANSLATE", "disconnect too");
  check(count(ws) === 0, `sent ${ws.sent}`);
  check(page.errors.length === 0, `errors ${page.errors}`);
});

test("schemes: a stick a scheme change let go of asks for a fresh press, until one comes", () => {
  const page = loadPage();
  const ws = connectOpen(page);
  const caption = page.$("stickLabel");
  const asking = () => caption.textContent === page.evalIn("FamilySelector.PRESS_AGAIN") && caption.dataset.tone === "warn";
  const naming = (family) => caption.textContent === family && caption.dataset.tone === undefined;
  ws.serverMsg(telemetry({ mode: "MANUAL", scheme: "ADVANCED" }));
  page.fire(familyButton(page, "PIVOT"), "click");

  // Nothing held: the caption only follows the family back to Translate.
  ws.serverMsg(telemetry({ mode: "MANUAL", scheme: "NORMAL" }));
  check(naming("Translate"), `nothing held: '${caption.textContent}' ${caption.dataset.tone}`);

  // Held: joy.js still draws the knob under the thumb, over a stopped rover.
  const s = stickTouch(page, 0);
  s.start(); pushTo(page, s, 0, 70);
  ws.serverMsg(telemetry({ mode: "MANUAL", scheme: "ADVANCED" }));
  check(asking(), `held through the change: '${caption.textContent}' ${caption.dataset.tone}`);
  pushTo(page, s, 30, 70);
  liveFor(page, ws, 1000, { mode: "MANUAL", scheme: "ADVANCED" });
  s.end();
  check(asking(), `still asking after the thumb lifts: '${caption.textContent}'`);
  const mark = count(ws);
  s.start(); // the fresh press it asked for
  check(naming("Translate"), `answered: '${caption.textContent}' ${caption.dataset.tone}`);
  pushTo(page, s, 0, 70);
  check(names(ws, mark).join() === "MOVE_FORWARD", `and drives: ${names(ws, mark)}`);

  // A rotate button under the stick: the stick will not take over when it is
  // let go, so the caption asks too; pressing anything answers it.
  press(page, page.$("cw"), 3);
  ws.serverMsg(telemetry({ mode: "MANUAL", scheme: "NORMAL" }));
  check(asking(), "asked under a held rotate button");
  lift(page, page.$("cw"), 3);
  press(page, page.$("ccw"), 4);
  check(naming("Translate"), `a rotate press answers it: '${caption.textContent}'`);
  lift(page, page.$("ccw"), 4);

  // Losing the link withdraws the request with everything else.
  s.end(); s.start(); pushTo(page, s, 0, 70);
  ws.serverMsg(telemetry({ mode: "MANUAL", scheme: "ADVANCED" }));
  check(asking(), "asked again");
  ws.serverDrop();
  check(naming("Translate"), `link lost: '${caption.textContent}' ${caption.dataset.tone}`);
  check(page.errors.length === 0, `errors ${page.errors}`);
});

// What is above the stick holds its height as the family and the caption
// change, so the stick stays where a held thumb pressed it (js/drive.js). A
// browser measured it; this keeps the two rules that made it so.
test("schemes: the caption and the pivot caveat change nothing's height above the stick", () => {
  const page = loadPage();
  const request = page.evalIn("FamilySelector.PRESS_AGAIN");
  const longest = Math.max(...page.evalIn("FamilySelector.OPTIONS").map((option) => option.label.length));
  check(request.length <= longest, `the press-again request '${request}' is no longer than a family's name (${longest}): it wrapped`);

  // The phone on its side has the family's row above the stick: there the
  // caveat keeps its line while hidden, as long as the selector shows.
  const kept = (mediaRules(LANDSCAPE_PHONE) || [])
    .find((rule) => rule.selector.split(",").some((s) => /\.caveat\[hidden\]$/.test(s.trim())));
  check(kept && /visibility:\s*hidden/.test(kept.body) && !/display:\s*none/.test(kept.body),
    `the landscape layout keeps the hidden caveat's line: ${kept && kept.selector} { ${kept && kept.body.trim()} }`);
});

test("schemes: a stale link keeps the scheme shown, dimmed, and offers no change until telemetry resumes", () => {
  const page = loadPage();
  const ws = connectOpen(page);
  const group = page.$("scheme");
  const staleMs = page.evalIn("Link.STALE_MS");
  ws.serverMsg(telemetry({ scheme: "ADVANCED" }));
  page.fire(familyButton(page, "PIVOT"), "click");

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
  // Stale is not lost: the stick still drives in the family chosen.
  check(page.$("family").hidden === false && page.evalIn("driver.family") === "PIVOT", "the family stays");

  ws.serverMsg(telemetry({ scheme: "ADVANCED" })); // telemetry resumes
  check(group.dataset.state === "known" && SCHEMES.every((s) => schemeButton(page, s).disabled === false), `resumed: ${group.dataset.state}`);
  page.fire(schemeButton(page, "NORMAL"), "click");
  check(ws.sent.slice(1).join() === '{"scheme":"NORMAL"}', `offered again: ${ws.sent.slice(1)}`);

  // A rover that rebooted is back on its default scheme, whatever was shown.
  page.clock.advance(staleMs);
  check(group.dataset.state === "stale", "stale again");
  ws.serverMsg(telemetry({ scheme: "NORMAL" }));
  check(shownScheme(page) === "NORMAL" && group.dataset.state === "known" && page.$("family").hidden === true, "the rebooted rover's scheme");
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
      empty: false, stacks: 1, pivots: [], highlighted: [], readOnly: [], resized: 0, loaded: [], cleared: 0,
      compile() { return async (api) => { ${program} }; },
      onChange() { return () => {}; },
      highlight(id) { this.highlighted.push(id); },
      setReadOnly(on) { this.readOnly.push(on); },
      resize() { this.resized++; },
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
  // when its scripts registered one; its view's place shows only then.
  const sim = page.evalIn("'simulator' in targets");
  check(segments(page).length === (sim ? 2 : 1), `segments ${segments(page).map((b) => b.textContent)}`);
  check(page.$("target").hidden === !sim && page.$("programSim").hidden === !sim && page.$("driveView").hidden === !sim,
    "the switch and both places for the view follow the registry");
  check(page.$("programStage").dataset.sim === (sim ? "yes" : "no"), "stage layout follows it");
  check(page.$("simSlot") !== null && all(page.$("programTab")).includes(page.$("simSlot")), "#simSlot is in the Program tab");
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
  check(/Connect to the rover/.test(page.$("programRun").title) && /Connect to the rover/.test(page.$("programState").textContent), `says why: ${page.$("programRun").title}`);
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

test("program: a manual press, blur, a hidden page, Stop, Autonomous, the tab's Stop, link loss and a stale link each stop it", async () => {
  const cases = [
    // [what, act, the reason, what goes out after it]
    ["a rotate press", (page) => press(page, page.$("ccw"), 3), /^the rover was driven by hand\.$/, "ROTATE_COUNTERCLOCKWISE"],
    ["a stick press", (page) => stickTouch(page, 0).start(), /^the rover was driven by hand\.$/, "STOP"],
    ["blur", (page) => page.fire(page.win, "blur", { bubbles: false }), /lost focus/, "STOP"],
    ["a hidden page", (page) => { page.doc.hidden = true; page.fire(page.doc, "visibilitychange", { bubbles: false }); }, /hidden/, "STOP"],
    ["Stop", (page) => page.fire(page.$("stop"), "click"), /^Stop was pressed\.$/, "STOP"],
    ["Autonomous", (page) => page.fire(page.$("auto"), "click"), /^Autonomous was pressed\.$/, "RESUME_AUTONOMOUS"],
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
    check(/^Stopped: /.test(page.$("programState").textContent) && page.$("programState").dataset.tone === "stopped", `${what}: state ${page.$("programState").textContent}`);
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
  check(segments(page).map((b) => b.textContent).join() === "Rover,Simulator", `segments ${segments(page).map((b) => b.textContent)}`);
  check(!page.$("target").hidden && !page.$("programSim").hidden, "both offered, and the view shown");
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

  // The view starts folded away under the rover, on every layout, giving
  // the editor the room; switching to the simulator unfolds it, since
  // previewing is when it is wanted. Its heading folds it either way.
  const folded = loadPage();
  check(folded.$("programSim").dataset.collapsed === "yes", "folded under the rover");
  folded.fire(segments(folded)[1], "click");
  check(folded.$("programSim").dataset.collapsed === "no", "unfolded on the simulator");
  folded.fire(folded.$("simToggle"), "click");
  check(folded.$("programSim").dataset.collapsed === "yes" && folded.$("simToggle").getAttribute("aria-expanded") === "false", "its heading folds it");
  // The fold is no layout's alone (beside the editor it once always
  // showed): its rule is outside every @media.
  const programCss = stylesheet("program.css");
  const foldRule = '.programSim[data-collapsed="yes"] #simSlot';
  check(cssRules(outside(programCss, "@media")).some((r) => r.selector === foldRule && /display:\s*none/.test(r.body)), "folded on every layout");
  // Wide, the view takes its column's height, the console under the
  // editor; tall enough, the console goes under the view. Folded, or with
  // no simulator, the editor takes the width, the console under it.
  const stageRules = (opening) => (blockRules(programCss, opening) || []).filter((r) => /^\.programStage\b/.test(r.selector));
  const wideStage = stageRules("@media (min-width: 960px) and (min-height: 521px) {");
  const areas = (rules, find) => ((rules.find(find) || {}).body || "").match(/grid-template-areas:([^;]*);/);
  const unfolded = areas(wideStage, (r) => r.selector === ".programStage");
  // Only with the view there and unfolded: folded, the editor's row would
  // be as tall as its content, which is nothing.
  const unfoldedOnly = '.programStage:not([data-sim="no"]):not(:has(> .programSim[data-collapsed="yes"]))';
  const tallStage = stageRules("@media (min-width: 960px) and (min-height: 861px) {");
  check(tallStage.every((r) => r.selector.startsWith(unfoldedOnly)), `wide and tall: the view unfolded only: ${tallStage.map((r) => r.selector)}`);
  const tall = areas(tallStage, (r) => r.selector === unfoldedOnly);
  const foldedRule = wideStage.find((r) => r.selector.includes(':has(> .programSim[data-collapsed="yes"])'));
  const foldedAreas = areas(wideStage, (r) => r === foldedRule);
  const noSim = areas(wideStage, (r) => r.selector === '.programStage[data-sim="no"]');
  check(unfolded && /"editor\s+toggle sim"\s*"console toggle sim"/.test(unfolded[1]), `wide: the view the column's height: ${unfolded && unfolded[1]}`);
  check(tall && /"editor toggle sim"\s*"editor toggle console"/.test(tall[1]), `wide and tall: the console under the view: ${tall && tall[1]}`);
  check(foldedAreas && /"editor\s+toggle"\s*"console toggle"/.test(foldedAreas[1]), `wide, folded: under the editor, the heading still there: ${foldedAreas && foldedAreas[1]}`);
  // A hidden view counts as folded: the no-simulator rule must win.
  check(foldedRule && foldedRule.selector.includes(':not([data-sim="no"])'), `folded, never with no simulator: ${foldedRule && foldedRule.selector}`);
  check(noSim && /^\s*"editor"\s*"console"\s*$/.test(noSim[1]), `no simulator: the editor the width: ${noSim && noSim[1]}`);
  // The heading and the view take their areas only as the stage's own grid
  // items, which they are through .programSim.
  const wide = blockRules(programCss, "@media (min-width: 960px) and (min-height: 521px) {") || [];
  check(wide.some((r) => r.selector === ".programSim" && /display:\s*contents/.test(r.body)), "the view's parts are the stage's grid items");
  check(folded.$("simToggle").parentNode === folded.$("programSim") && folded.$("simSlot").parentNode === folded.$("programSim") &&
    folded.$("programSim").parentNode === folded.$("programStage"), "the heading and the view in .programSim, in the stage");
  check(folded.$("programState").parentNode.parentNode === folded.$("programStage"), "the console is in the stage");
  // The narrowest wide pane (960 px windows) keeps the toolbar to one row
  // on either target: the buttons a step narrower again.
  const narrowPane = blockRules(programCss, "@container program (max-width: 599.98px) {") || [];
  check(narrowPane.some((r) => /\.programBar > button/.test(r.selector) && /padding-inline:\s*var\(--s-2\)/.test(r.body)), "a narrow pane's toolbar a step narrower");

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

test("program: Run is off with nothing to run, and asks before running several stacks on the rover", async () => {
  const { page, ws } = connected(telemetry({ mode: "MANUAL" }));
  standInEditor(page);
  page.evalIn("__editor.empty = true; __editor.stacks = 0; programTab.refresh();");
  check(page.$("programRun").disabled === true, "Run off on an empty editor");
  check(/^Nothing to run yet/.test(page.$("programRun").title) && /^Nothing to run yet/.test(page.$("programState").textContent), `says why: ${page.$("programState").textContent}`);
  // The examples are out of sight in the File menu: both lines say so.
  check(/an example from the File menu\.$/.test(page.$("programState").textContent) && /an example in the File menu\.$/.test(page.$("programHint").textContent),
    `says where the examples are: ${page.$("programState").textContent} / ${page.$("programHint").textContent}`);
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
    "scrolled into view as it opened, clear of the Stop bar on a phone, and no further: the button stays in sight");
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

  // An item that cannot act stays, disabled, and the keys pass it by.
  page.evalIn("__editor.empty = true; programTab.refresh();");
  check(page.$("programClear").disabled && !page.$("programClear").hidden, "nothing to clear: Clear disabled, still there");
  check(key(button, "ArrowUp").defaultPrevented, "Up on the button opens the menu, and scrolls nothing");
  check(!menu.hidden && focused() === "Export", `Up on the button opens on the last that can act: ${focused()}`);
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
  check(titles().join("|") === "on:|on:|on:|on:|on:Open a program saved with Export|on:Remove every block", `idle: ${titles()}`);
  startProgram(page, "await api.wait(5);");
  await flush();
  check(titles().every((t) => t === "off:Stop the program first"), `mid-run: ${titles()}`);
  check(page.$("programExport").disabled === false, "Export still works");
  page.evalIn("runner.abort('done')");
  await liveForAsync(page, ws, 200);
  page.evalIn("__editor.empty = true; programTab.refresh();");
  check(titles().at(-1) === "off:Nothing to clear", `empty: ${titles().at(-1)}`);
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
      return { empty: true, stacks: 0, pivots: [], onChange() { return () => {}; }, setReadOnly() {}, resize() {} };
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

// The wide layout's two columns are the same beside both tabs (F3, F3d):
// two rail widths, one per tab, left the address, the scan and Autonomous
// starting at different edges, and Autonomous under nothing on the Program
// tab. Layout itself is measured in a browser; this holds the shape.
test("wide: one rail width beside both tabs, for the address, the note, the rail and Autonomous; Stop under the left pane", () => {
  const css = panelCss();
  const rules = cssRules(css);
  const root = rules.filter((r) => r.selector === ":root").map((r) => r.body).join("");
  check(/--rail:\s*clamp\(320px, 30vw, 460px\);/.test(root), "one rail, from the viewport alone");
  const setsRail = rules.filter((r) => r.selector !== ":root" && /--rail\s*:/.test(r.body));
  check(setsRail.length === 0, `nothing narrows it per tab: ${setsRail.map((r) => r.selector)}`);
  const wide = mediaRules("@media (min-width: 960px) and (min-height: 521px) {") || [];
  // The Drive tab splits only the left pane, for the simulator's view (F1):
  // the rail stays the last column, as wide, and the bar under all three.
  const driveView = ".shell:has(> #driveTab:not([hidden]) + .driveView:not([hidden]))";
  const perTab = wide.filter((r) => r.selector !== driveView && /#(programTab|driveTab)/.test(r.selector) && /\.shell/.test(r.selector) && /grid-template/.test(r.body));
  check(perTab.length === 0, `no grid of its own beside either tab: ${perTab.map((r) => r.selector)}`);
  const split = (wide.find((r) => r.selector === driveView) || {}).body || "";
  check(/grid-template-columns:\s*auto minmax\(0, 1fr\) var\(--rail\);/.test(split), `the Drive tab's left pane split in two, the rail as ever: ${split}`);
  const areas = (split.match(/grid-template-areas:([^;]*);/) || ["", ""])[1].match(/"[^"]*"/g) || [];
  check(areas.join(" ") === '"head head head" "main view fault" "main view scan" "main view read" "act  act  act"', `the dock, the view, then the rail; the bar across: ${areas}`);
  const body = (selector) => (wide.find((r) => r.selector === selector) || {}).body || "";
  for (const selector of [".shell", ".bar", ".actions"]) {
    check(/grid-template-columns:\s*minmax\(0, 1fr\) var\(--rail\);/.test(body(selector)), `${selector}: the left pane, then the rail`);
  }
  for (const selector of [".link", "#note"]) check(!/\bwidth:/.test(body(selector)), `${selector} fills the rail's column: ${body(selector)}`);
  check(/justify-self:\s*start/.test(body("#stop")) && /width:\s*min\(100%, 480px\)/.test(body("#stop")), `Stop from the left pane's edge, at most 480 px: ${body("#stop")}`);
  check(/min-height:\s*calc\(var\(--tap\) \+ var\(--s-3\)\)/.test(body(".actions button")), "Stop and Autonomous 56 px");
  check(/grid-area:\s*1 \/ 1;/.test(body("#stop")) && /grid-area:\s*1 \/ 2;/.test(body("#auto")), "Stop under the left pane, Autonomous under the rail");
  // The short wide block (521 to 640 px tall) sizes the stick again, and
  // keeps the bar's 56 px.
  const short = mediaRules("@media (min-width: 960px) and (min-height: 521px) and (max-height: 640px) {") || [];
  for (const [where, rules] of [["wide", wide], ["short", short]]) {
    const stick = (((rules.find((r) => r.selector === ":root" && /--stick:/.test(r.body)) || {}).body || "").match(/--stick:([^;]*);/) || [])[1] || "";
    check(/var\(--rail\)/.test(stick), `${where}: the stick budgets the one rail: ${stick}`);
  }
  check(!short.some((r) => /\.actions button/.test(r.selector) && /min-height/.test(r.body)), "short: Stop and Autonomous stay 56 px");
  // A renamed variable left behind reads as nothing: the stick at 0.
  const declared = new Set(fs.readdirSync(path.join(PANEL_ROOT, "css")).filter((f) => f.endsWith(".css"))
    .flatMap((f) => [...stylesheet(f).replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1])));
  const undeclared = [...new Set([...css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/var\(\s*(--[\w-]+)/g)].map((m) => m[1]))].filter((v) => !declared.has(v));
  check(undeclared.length === 0, `panel.css reads only variables a stylesheet declares: ${undeclared}`);
  // The scan fills its column beside both tabs: no card sized to its drawing.
  check(!rules.some((r) => /\.scan\b/.test(r.selector) && /aspect-ratio/.test(r.body)), "the scan's card is the column's");
});

test("program: the File menu opens over the page but under the Stop bar, and on a phone scrolls clear of it", () => {
  // Nothing may cover Stop. The menu hangs over the editor and the
  // simulator, and opened near the foot of a phone it scrolls up clear of
  // the bar stuck there rather than hide under it.
  const zIndex = (selector) => {
    const rule = cssRules(panelCss()).find((r) => r.selector === selector && /z-index/.test(r.body));
    return rule && Number(/z-index:\s*(\d+)/.exec(rule.body)[1]);
  };
  check(zIndex(".menu") >= 1 && zIndex(".menu") < zIndex(".actions"), `the menu at ${zIndex(".menu")}, the Stop bar at ${zIndex(".actions")}`);
  const margin = (mediaRules("@media (max-width: 959.98px), (max-height: 520.98px) {") || [])
    .find((r) => /scroll-margin-bottom:[^;]*var\(--tap-lg\)/.test(r.body));
  const popups = margin ? margin.selector.split(",").map((part) => part.trim()) : [];
  check(popups.includes(".menu") && popups.includes(".sim-more"), `a scroll margin as tall as the Stop bar, wherever the bar sticks to the foot: ${popups}`);
  // A phone on its side has Stop at the side: a margin there pushed the File
  // button off the top of the screen as its menu opened.
  const side = (mediaRules("@media (orientation: landscape) and (max-height: 520px) {") || []).find((r) => /scroll-margin-bottom/.test(r.body));
  const sidePopups = side ? side.selector.split(",").map((part) => part.trim()) : [];
  check(sidePopups.includes(".menu") && sidePopups.includes(".sim-more") && /scroll-margin-bottom:\s*0\s*;/.test(side.body), `no margin on a phone on its side: ${side && side.body}`);
  // The simulator's box clips its room without being a scroll container,
  // which would swallow the settings' margin before the window scrolled.
  const slot = cssRules(stylesheet("program.css")).filter((r) => r.selector === "#simSlot").map((r) => r.body).join("");
  check(/overflow:\s*clip\s*;/.test(slot), `#simSlot clips, not scrolls: ${slot}`);
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
  const caption = page.$("stickLabel");
  const asking = () => caption.textContent === page.evalIn("FamilySelector.PRESS_AGAIN") && caption.dataset.tone === "warn";
  ws.serverMsg(telemetry({ mode: "MANUAL", scheme: "ADVANCED" }));
  const s = stickTouch(page, 0);
  s.start(); pushTo(page, s, 0, 70);
  ws.serverMsg(telemetry({ mode: "MANUAL", scheme: "NORMAL" }));
  s.end();
  check(asking(), `asked for a fresh press: '${caption.textContent}'`);
  await flush(); // the touch's own events have all landed, as in a browser before any click

  const heard = listen(page);
  const mark = count(ws);
  startProgram(page, "await api.stop(); await api.explore(); await api.log('after');");
  await liveForAsync(page, ws, 1000, { fields: { mode: "MANUAL", scheme: "NORMAL" } });
  check(ended(page) && ended(page).outcome === "done", `ended ${JSON.stringify(ended(page))}`);
  check(names(ws, mark).join() === "STOP,RESUME_AUTONOMOUS", `sent ${names(ws, mark)}`);
  check(heard.presses() === 0 && heard.downs() === "", `the Driver raised ${heard.presses()} presses, stand-downs '${heard.downs()}'`);
  check(asking(), `still asking: '${caption.textContent}' ${caption.dataset.tone}`);
  check(page.errors.length === 0, `errors ${page.errors}`);
});

test("program: the Program tab is marked while a program drives the rover, not while it previews", async () => {
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
  check(page.evalIn("runner.state") === "idle" && !marked() && tab.getAttribute("title") === null, "unmarked once it stopped");
  lift(page, page.$("cw"), 1);
  if (page.evalIn("'simulator' in targets")) {
    page.evalIn("runner.run(async (api) => { await api.wait(5); }, targets.simulator);");
    await flush();
    check(page.evalIn("runner.target && runner.target.kind") === "simulator" && !marked(), "a preview drives nothing: not marked");
    page.evalIn("runner.abort('done')");
    await flush();
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
  check(page.$("stop").textContent === "Stop" && /whatever is driving it/.test(page.$("stop").getAttribute("title") || ""), "the bar's always stops the rover, and says so");
  check(page.errors.length === 0, `errors ${page.errors}`);
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

test("target: one switch in the header, after the tabs and the scheme, for both tabs", () => {
  const page = loadPage();
  const switches = page.doc.documentElement.querySelectorAll(".switches")[0];
  const order = switches.children.map((n) => n.id || n.getAttribute("class"));
  check(order.join() === "tabs,schemeSlot,target", `the switch row: ${order}`);
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

  // The family, under ADVANCED, as on the rover.
  ws.serverMsg(telemetry({ mode: "MANUAL", scheme: "ADVANCED" }));
  page.evalIn("driver.setFamily(FAMILY_PIVOT)");
  s.start(); s.move(60, -60);
  check(/^PIVOT_/.test(sim().slice(-1)[0]), `a pivot: ${sim()}`);
  s.end();

  check(count(ws) === 0, `the rover got ${names(ws)}`);
  // Autonomous: the simulator alone, which says exploring is not simulated.
  page.fire(page.$("auto"), "click");
  check(count(ws) === 0 && state().mode === "AUTONOMOUS", `Autonomous: ${names(ws)}, ${state().mode}`);
  check(/exploring is not simulated/.test(page.$("auto").getAttribute("title")), `its title says so: ${page.$("auto").getAttribute("title")}`);
  // Stop: everything, the rover included.
  page.fire(page.$("stop"), "click");
  check(names(ws).join() === "STOP", `Stop reached the rover: ${names(ws)}`);
  check(sim().slice(-1)[0] === "STOP" && state().mode === "MANUAL", `and the simulator: ${sim()}`);
  // With no link, Stop still stops the simulator, and nothing fails.
  ws.serverDrop();
  page.fire(page.$("stop"), "click");
  check(sim().slice(-1)[0] === "STOP", "Stop with the link down");
  toRover(page);
  check(/Let the rover explore/.test(page.$("auto").getAttribute("title")), "back on the rover, Autonomous's own title");
  check(page.errors.length === 0, `errors ${page.errors}`);
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

test("target: a lost or stale link lets go of nothing driving the simulator, and stops what drives the rover", () => {
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
  // On the rover, the simulator's preview is not there to stop: a press on
  // the rover's target never reaches it.
  check(page.errors.length === 0, `errors ${page.errors}`);
});

test("target: one view of the simulator, on the Drive tab while it is driven, held at 1x there", () => {
  const page = loadPage();
  const view = () => page.doc.documentElement.querySelectorAll(".sim")[0];
  const slot = () => view().parentNode.id;
  const sim = page.evalIn("targets.simulator");
  const speeds = () => all(view()).filter((n) => n.parentNode && n.parentNode.getAttribute("class") === "segmented sim-speed");
  const options = () => all(view()).filter((n) => n.tagName === "OPTION" && n.parentNode.getAttribute("class") === "sim-speed-pick");
  check(page.doc.documentElement.querySelectorAll(".sim").length === 1, "one view");
  check(slot() === "simSlot", "on the Program tab's slot, at first");
  page.fire(speeds()[2], "click");
  check(sim.playback === 4, "4x chosen on the Program tab's view");

  toSimulator(page);
  check(slot() === "driveSimSlot", `beside the Drive tab's controls: ${slot()}`);
  check(sim.playback === 1, `held at 1x: ${sim.playback}`);
  check(page.$("driveSimSlot").style.getPropertyValue("--room-aspect") === (4 / 3).toFixed(4), "the room's shape went with it");
  for (const list of [speeds(), options()]) {
    const [one, two, four] = list;
    check(!one.disabled && two.disabled && four.disabled, `2x and 4x disabled: ${list.map((b) => b.disabled)}`);
    check(/real time/.test(two.getAttribute("title")) && /real time/.test(four.getAttribute("title")) && /Play at 1 times/.test(one.getAttribute("title")),
      `the disabled ones say why: ${two.getAttribute("title")}`);
  }
  check(/real time/.test(view().querySelectorAll(".sim-speed-pick")[0].getAttribute("title")), "and so does the list");
  check(speeds()[0].getAttribute("aria-pressed") === "true", "1x shows pressed");
  page.fire(speeds()[2], "click");
  const pick = view().querySelectorAll(".sim-speed-pick")[0];
  pick.value = "4";
  page.fire(pick, "change");
  check(sim.playback === 1, `a choice past the hold does nothing: ${sim.playback}`);

  page.fire(page.$("tabProgram"), "click");
  check(slot() === "simSlot" && sim.playback === 4, `back on the Program tab, at the speed chosen there: ${slot()} ${sim.playback}`);
  check(!speeds()[2].disabled && /Play at 4 times/.test(speeds()[2].getAttribute("title")), "4x offered again");
  page.fire(page.$("tabDrive"), "click");
  check(slot() === "driveSimSlot" && sim.playback === 1, "and held again on the Drive tab");
  toRover(page);
  check(slot() === "simSlot" && sim.playback === 4, "on the rover, the Program tab's view keeps it");
  check(page.errors.length === 0, `errors ${page.errors}`);
});

test("every part's on...(fn) returns a function that unsubscribes fn", () => {
  const page = loadPage();
  const kinds = page.evalIn(`[
    link.onState(() => {}), link.onTelemetry(() => {}), driver.onManualInput(() => {}), driver.onStandDown(() => {}),
    schemeToggle.onChange(() => {}), familySelector.onChange(() => {}), tabs.onChange(() => {}),
    runner.onState(() => {}), runner.onLog(() => {}), runner.onHighlight(() => {}), targetSwitch.onChange(() => {}),
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

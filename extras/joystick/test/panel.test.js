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
const { loadPage, all, PANEL_ROOT } = require("./fake-dom.js");

const REPO = path.join(__dirname, "..", "..", "..");

let failed = null; // the running test's failed checks
let passes = 0;
function check(cond, what) {
  if (cond) passes++;
  else failed.push(what);
}
function test(name, fn) {
  nodeTest.test(name, () => {
    failed = [];
    fn();
    assert.deepEqual(failed, [], `${failed.length} check(s) failed:\n  ${failed.join("\n  ")}`);
  });
}
nodeTest.after(() => console.log(`panel.test.js: ${passes} checks passed`));

// Codes, straight from the firmware header (not from the panel).
const CODES = {};
for (const [, n, v] of fs.readFileSync(path.join(REPO, "src", "MoveCodes.h"), "utf8").matchAll(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(\d+)\s*,/gm)) CODES[n] = Number(v);
const NAME = Object.fromEntries(Object.entries(CODES).map(([k, v]) => [v, k]));

/* --- helpers ------------------------------------------------------------- */

function connectOpen(page, host = "10.0.0.7") {
  page.$("host").value = host;
  page.fire(page.$("connect"), "click");
  const ws = page.sockets[page.sockets.length - 1];
  ws.serverOpen();
  return ws;
}
const names = (ws, from = 0) => ws.moves().slice(from).map((m) => NAME[m.move]);
const count = (ws) => ws.sent.length;

function stickTouch(page, id = 0) {
  const c = page.canvas;
  const touch = (dx, dy) => ({ identifier: id, target: c, pageX: 115 + dx, pageY: 115 + dy });
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
const telemetry = (extra = {}) => ({
  mode: "AUTONOMOUS", move: "STOP", moving: false, temperature: 41.5, phase: "SWEEP",
  distanceLeft: 120, distanceFrontLeft: 80, distanceFront: 200, distanceFrontRight: 60, distanceRight: 150, ...extra,
});

/* --- tests --------------------------------------------------------------- */

test("loads clean from the HTML: scripts, ids, initial state", () => {
  const page = loadPage();
  const order = page.scripts;
  check(order[0] === "joy.js" && order[order.length - 1] === "js/app.js", `joy.js first, app.js last: ${order}`);
  check(new Set(order).size === order.length, `each script once: ${order}`);
  const before = (a, b) => order.includes(a) && order.includes(b) && order.indexOf(a) < order.indexOf(b);
  for (const [a, b] of [
    ["js/support.js", "js/link.js"], ["js/support.js", "js/drive.js"], ["js/support.js", "js/tabs.js"],
    ["js/protocol.js", "js/mecanum.js"], ["js/protocol.js", "js/link.js"], ["js/protocol.js", "js/scan.js"],
    ["js/mecanum.js", "js/drive.js"],
  ]) check(before(a, b), `${a} loads before ${b}: ${order}`);
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

test("hover across a rotate button sends nothing (autonomous, idle)", () => {
  const page = loadPage({ touch: false });
  const ws = connectOpen(page);
  ws.serverMsg(telemetry());
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
  const page = loadPage();
  const ws = connectOpen(page);
  ws.serverMsg(telemetry());
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
  const k = page.fire(page.$("host"), "keydown", { key: "Enter" });
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
  const page = loadPage();
  const ws = connectOpen(page);
  ws.serverMsg(telemetry());
  page.fire(page.$("connect"), "click");
  check(count(ws) === 0, `autonomous idle rover not stopped: ${names(ws)}`);
  page.clock.advance(3000);
  check(page.doc.body.dataset.link === "down", `link ${page.doc.body.dataset.link}`);
  check(page.$("note").textContent === "Disconnected.", `note '${page.$("note").textContent}'`);
  check(page.$("connect").textContent === "Connect", "Connect");
  check(page.clock.pending() === 0, `timers pending ${page.clock.pending()}`);
});

test("stale telemetry, then a dropped link, stays down", () => {
  const page = loadPage();
  const ws = connectOpen(page);
  ws.serverMsg(telemetry());
  page.clock.advance(1900);
  check(page.doc.body.dataset.link === "stale", "stale after 1.8 s of silence");
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

/* --- review round 2: the stick latches, primary presses only, repeat phase --- */

function mouseStick(page) {
  const c = page.canvas;
  return {
    down(extra = {}) { page.fire(c, "mousedown", { button: 0, ...extra }); },
    move(dx, dy) { page.fire(page.doc, "mousemove", { pageX: 115 + dx, pageY: 115 + dy }); },
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
    const page = loadPage({ touch: false });
    const ws = connectOpen(page);
    ws.serverMsg(telemetry());
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
  const page = loadPage({ touch: false });
  const ws = connectOpen(page);
  ws.serverMsg(telemetry());
  const m = mouseStick(page);
  m.down(); m.up(); // a plain click on the stick: joy.js reports centre, nothing driven
  m.down({ button: 2 }); m.move(0, -95);
  page.clock.advance(1000);
  check(count(ws) === 0, `sent ${names(ws)}`);
});

test("ctrl-click on a rotate button sends nothing; its menu is suppressed", () => {
  const page = loadPage({ touch: false });
  const ws = connectOpen(page);
  ws.serverMsg(telemetry());
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
  const t0 = page.clock.now();
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
  void t0;
});

test("telemetry: five wedges coloured by STOP/GO, no echo faded at full reach", () => {
  const page = loadPage();
  const ws = connectOpen(page);
  ws.serverMsg(telemetry({ distanceLeft: 20, distanceFrontLeft: 30, distanceFront: 150, distanceFrontRight: 999, distanceRight: 25 }));
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
  const bare = { mode: "MANUAL", move: "STOP", moving: false, temperature: 40 };
  ws.serverMsg(bare);
  for (const b of B) {
    check(b.wedge.getAttribute("d") === "", `${b.key} cleared`);
    check(b.reading.textContent === "—", `${b.key} reading cleared`);
  }
  // One key missing only clears that one.
  const partial = telemetry();
  delete partial.distanceFront;
  ws.serverMsg(partial);
  check(by.distanceFront.wedge.getAttribute("d") === "" && by.distanceLeft.wedge.getAttribute("d") !== "", "partial");
  for (const junk of ["not json", "null", "42", "[]", '"x"', '{"distanceFront":"12"}', '{"distanceFront":-1}']) ws.serverMsg(junk);
  check(page.errors.length === 0, `errors ${page.errors}`);
});

test("phase readout: autonomous only, halt reason shown", () => {
  const page = loadPage();
  const ws = connectOpen(page);
  ws.serverMsg(telemetry({ phase: "CRUISE" }));
  check(!page.$("phaseCell").hidden && page.$("phase").textContent === "CRUISE", page.$("phase").textContent);
  check(page.$("auto").getAttribute("aria-pressed") === "true", "auto pressed");
  ws.serverMsg(telemetry({ phase: "HALTED", halt: "boxed in" }));
  check(page.$("phase").textContent === "HALTED: boxed in", page.$("phase").textContent);
  check(page.$("phase").dataset.tone === "warn", "halt tone");
  ws.serverMsg(telemetry({ phase: "HALTED", halt: "sensor silent" }));
  check(page.$("phase").textContent === "HALTED: sensor silent", page.$("phase").textContent);
  const manual = telemetry({ mode: "MANUAL", move: "MOVE_FORWARD" });
  delete manual.phase;
  ws.serverMsg(manual);
  check(page.$("phaseCell").hidden === true, "hidden in manual");
  check(page.$("auto").getAttribute("aria-pressed") === "false", "auto not pressed");
  check(page.$("move").textContent === "MOVE_FORWARD", "move shown");
  check(page.$("temp").textContent === "41.5°C", page.$("temp").textContent);
  ws.serverMsg(telemetry({ phase: "SWEEP" }));
  check(!page.$("phaseCell").hidden && page.$("phase").textContent === "SWEEP" && page.$("phase").dataset.tone === "", "back");
});

test("Stop always sends STOP; Autonomous sends only RESUME and ends the repeat", () => {
  const page = loadPage();
  const ws = connectOpen(page);
  ws.serverMsg(telemetry());
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

test("motorsReady: false shows the shield warning; missing or true does not", () => {
  const page = loadPage();
  const fault = page.$("motorsFault");
  check(fault !== null, "#motorsFault exists");
  check(fault.hidden === true, "hidden at load");
  check(fault.getAttribute("role") === "alert", "announced as an alert");
  check(/Motor shield not found/.test(fault.children.map((c) => c.textContent).join(" ")), "says what is wrong");

  const ws = connectOpen(page);
  ws.serverMsg(telemetry()); // no motorsReady key at all: older firmware
  check(fault.hidden === true, "missing key is unknown, not false");
  ws.serverMsg(telemetry({ motorsReady: true }));
  check(fault.hidden === true, "true: hidden");
  ws.serverMsg(telemetry({ motorsReady: false }));
  check(fault.hidden === false, "false: shown");
  for (const junk of ["not json", "null", "42", "[]"]) ws.serverMsg(junk);
  check(fault.hidden === false, "frames that are not objects change nothing");
  for (const odd of ["false", 0, null, "no"]) {
    ws.serverMsg(telemetry({ motorsReady: false }));
    ws.serverMsg(telemetry({ motorsReady: odd }));
    check(fault.hidden === true, `motorsReady ${JSON.stringify(odd)} is not an explicit false`);
  }
  ws.serverMsg(telemetry({ motorsReady: false }));
  ws.serverMsg(telemetry());
  check(fault.hidden === true, "a frame without the key hides it again");
  ws.serverMsg(telemetry({ motorsReady: true, mode: "MANUAL" }));
  check(fault.hidden === true, "rebooted with the shield: hidden");
  check(page.errors.length === 0, `errors ${page.errors}`);
});

test("motorsReady: the warning goes with its link, and controls still send", () => {
  const page = loadPage();
  const fault = page.$("motorsFault");
  let ws = connectOpen(page);
  ws.serverMsg(telemetry({ mode: "MANUAL", motorsReady: false }));
  check(fault.hidden === false, "shown");
  // Nothing is disabled: the operator can still drive, stop and resume.
  press(page, page.$("cw"), 3);
  lift(page, page.$("cw"), 3);
  page.fire(page.$("stop"), "click");
  page.fire(page.$("auto"), "click");
  check(names(ws).join() === "ROTATE_CLOCKWISE,STOP,STOP,RESUME_AUTONOMOUS", `sent ${names(ws)}`);

  ws.serverDrop();
  check(fault.hidden === true, "cleared when the link drops");
  check(/Lost the link/.test(page.$("note").textContent), "link note unaffected");

  ws = connectOpen(page);
  ws.serverMsg(telemetry({ motorsReady: false }));
  check(fault.hidden === false, "shown again on the new link");
  page.fire(page.$("connect"), "click"); // deliberate disconnect
  check(fault.hidden === true, "cleared on disconnect");
  page.clock.advance(100);
  check(fault.hidden === true, "still clear after the close event");

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

test("a JSON array is not telemetry: wedges and warning untouched", () => {
  const page = loadPage();
  const ws = connectOpen(page);
  ws.serverMsg(telemetry({ motorsReady: false }));
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
        const ang = (Math.atan2(CY - y, x - CX) * 180) / Math.PI;
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

// Advance the clock as a live rover would, with telemetry every 500 ms, so
// the link never goes stale (a stale link ends a program).
function liveFor(page, ws, ms) {
  for (let left = ms; left > 0; left -= 500) {
    page.clock.advance(Math.min(500, left));
    ws.serverMsg(telemetry({ mode: "MANUAL" }));
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
  const page = loadPage();
  const ws = connectOpen(page);
  ws.serverMsg(telemetry({ mode: "MANUAL" }));
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
  const page = loadPage({ touch: false });
  const ws = connectOpen(page);
  ws.serverMsg(telemetry());
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
  const page = loadPage();
  const ws = connectOpen(page);
  ws.serverMsg(telemetry()); // exploring: any frame would take control
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

  // The slots the scheme toggle and the family selector fill.
  check(page.$("schemeSlot") !== null && page.$("schemeSlot").children.length === 0, "#schemeSlot, empty");
  check(page.$("familySlot") !== null && page.$("familySlot").children.length === 0 && inside("familySlot", "driveTab"), "#familySlot, empty, on the Drive tab");
  check(page.$("programTab").tagName === "SECTION", "#programTab is a section");
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

/* --- mirrored constants -------------------------------------------------- */

test("mirrored constants match the firmware (check_protocol.py's regex)", () => {
  const js = fs.readFileSync(path.join(PANEL_ROOT, "js", "protocol.js"), "utf8");
  const consts = {};
  for (const [, n, v] of js.matchAll(/^\s*const\s+([A-Z][A-Z0-9_]*)\s*=\s*(\d+)\s*;/gm)) consts[n] = Number(v);
  const strings = {};
  for (const [, n, v] of js.matchAll(/^\s*const\s+([A-Z][A-Z0-9_]*)\s*=\s*"([^"]*)"\s*;/gm)) strings[n] = v;

  // Every move code, 0 to 19, the pivots included.
  check(Object.keys(CODES).length === 20, `src/MoveCodes.h has 20 codes, read ${Object.keys(CODES).length}`);
  for (const [n, code] of Object.entries(CODES)) check(consts[n] === code, `${n}: panel ${consts[n]} firmware ${code}`);
  // What the page runs is what the file says: no later script redefines one.
  const page = loadPage();
  for (const [n, value] of Object.entries(consts)) check(page.evalIn(n) === value, `the page's ${n} is ${value}`);

  const src = (f) => fs.readFileSync(path.join(REPO, "src", f), "utf8");
  const num = (text, re) => Number(text.match(re)[1]);
  check(consts.STOP_CM === num(src("Tuning.h"), /EXPLORE_STOP_CM\s*=\s*([\d.]+)/), "STOP_CM");
  check(consts.GO_CM === num(src("Tuning.h"), /EXPLORE_GO_CM\s*=\s*([\d.]+)/), "GO_CM");
  check(consts.PORT === num(src("Tuning.h"), /WEBSOCKET_PORT\s*=\s*(\d+)/), "PORT");
  check(consts.FAR_CM === num(src("Kinematics.h"), /DISTANCE_FAR_CM\s*=\s*([\d.]+)/), "FAR_CM");
  check(consts.SPEED_MAX === num(src("Kinematics.h"), /MOTOR_SPEED_MAX\s*=\s*(\d+)/), "SPEED_MAX");
  const cap = num(src("Tuning.h"), /COMMAND_DURATION_MAX_MS\s*=\s*(\d+)/);
  check(consts.MOVE_DURATION_MS < cap && consts.REPEAT_MS * 2 <= consts.MOVE_DURATION_MS, "repeat refreshes each move before it expires");
  check(consts.STICK_SEND_MS === num(src("Tuning.h"), /GAMEPAD_SPEED_CHANGE_MS\s*=\s*(\d+)/), "STICK_SEND_MS is the gamepad's speed-change rule");
  check(consts.REPEAT_MS === num(src("Tuning.h"), /GAMEPAD_REFRESH_MS\s*=\s*(\d+)/), "the panel and the gamepad re-send a held move equally often");

  // The scheme names, as protocol::schemeName() spells them.
  const schemeName = src("Protocol.cpp").match(/schemeName\([^)]*\)\s*\{\s*return\s+scheme\s*==\s*kinematics::(\w+)\s*\?\s*"(\w+)"\s*:\s*"(\w+)"/);
  check(schemeName !== null, "src/Protocol.cpp's schemeName() is readable");
  if (schemeName) {
    const [, which, yes, no] = schemeName;
    const other = which === "SCHEME_ADVANCED" ? "SCHEME_NORMAL" : "SCHEME_ADVANCED";
    check(strings[which] === yes && strings[other] === no, `schemes: panel ${JSON.stringify(strings)}, firmware ${which} = "${yes}", else "${no}"`);
  }
});

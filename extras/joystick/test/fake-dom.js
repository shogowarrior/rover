// A minimal fake DOM, WebSocket and virtual clock: just enough to run the
// panel's real scripts (joy.js included, unmodified) in a Node vm context, as
// the page loads them, and the steps every test takes with such a page.
// Nothing here is a test; the tests drive it.
//
// The page is read from joystick.html, and every <script src> in it is run
// in page order in one shared context, as a browser runs classic scripts. A
// remote script (http, https or protocol-relative) is skipped, so the page
// runs its offline path, as it must when opened from disk with no network.
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// The panel's own directory: extras/joystick/.
const PANEL_ROOT = process.env.PANEL_ROOT || path.join(__dirname, "..");

const isRemote = (src) => /^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(src);

/* --- clock ---------------------------------------------------------------- */

function makeClock() {
  let now = 1000;
  let nextId = 1;
  const timers = new Map(); // id -> {at, fn, every}
  const clock = {
    now: () => now,
    setTimeout(fn, ms = 0) { const id = nextId++; timers.set(id, { at: now + Math.max(0, ms), fn }); return id; },
    setInterval(fn, ms) { const id = nextId++; timers.set(id, { at: now + ms, fn, every: ms }); return id; },
    clear(id) { timers.delete(id); },
    pending() { return timers.size; },
    advance(ms) {
      const end = now + ms;
      for (;;) {
        let best = null;
        for (const [id, t] of timers) if (t.at <= end && (!best || t.at < best[1].at || (t.at === best[1].at && id < best[0]))) best = [id, t];
        if (!best) break;
        const [id, t] = best;
        now = t.at;
        if (t.every) t.at += t.every; else timers.delete(id);
        t.fn();
      }
      now = end;
    },
  };
  return clock;
}

/* --- elements ------------------------------------------------------------- */

class Node_ {
  constructor(tag, doc) {
    this.tagName = tag.toUpperCase();
    this.ownerDocument = doc;
    this.attributes = {};
    this.children = [];
    this.parentNode = null;
    this.listeners = {};
    this.dataset = {};
    this.style = {};
    this._text = "";
    this.hidden = false;
    this.offsetLeft = 0;
    this.offsetTop = 0;
    this._clientWidth = 0;
    this._clientHeight = 0;
    if (this.tagName === "DIALOG") { this.open = false; this.returnValue = ""; }
  }
  get id() { return this.attributes.id || ""; }
  set id(v) { this.attributes.id = v; }
  get offsetParent() { return this.parentNode; }
  get textContent() { return this._text; }
  set textContent(v) { this._text = String(v); }
  // As in a browser, an element inside a hidden (display: none) ancestor has
  // no layout box and measures 0. joy.js sizes its canvas from its container
  // as it is built, so a stick built while its tab is hidden is drawn at 0.
  get rendered() { for (let n = this; n && n.tagName !== "#DOCUMENT"; n = n.parentNode) if (n.hidden) return false; return true; }
  get clientWidth() { return this.rendered ? this._clientWidth : 0; }
  set clientWidth(v) { this._clientWidth = v; }
  get clientHeight() { return this.rendered ? this._clientHeight : 0; }
  set clientHeight(v) { this._clientHeight = v; }
  setAttribute(n, v) { this.attributes[n] = String(v); }
  getAttribute(n) { return n in this.attributes ? this.attributes[n] : null; }
  hasAttribute(n) { return n in this.attributes; }
  removeAttribute(n) { delete this.attributes[n]; }
  appendChild(c) { c.parentNode = this; this.children.push(c); return c; }
  remove() { if (this.parentNode) { this.parentNode.children = this.parentNode.children.filter((c) => c !== this); this.parentNode = null; } }
  addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); }
  removeEventListener(t, f) { this.listeners[t] = (this.listeners[t] || []).filter((g) => g !== f); }
  dispatchEvent(e) { return dispatch(this, e); }
  focus() { if (this.ownerDocument) this.ownerDocument.activeElement = this; }
  // A <dialog>, as a browser's: showModal() opens it; close(value) shuts an
  // open one, setting returnValue when given one, and "close" follows as a
  // task of its own. Escape is a close() with no value, which leaves
  // returnValue as it was.
  showModal() { if (this.tagName !== "DIALOG" || this.open) throw new Error("showModal() on a closed <dialog> only"); this.open = true; }
  close(value) {
    if (!this.open) return;
    this.open = false;
    if (value !== undefined) this.returnValue = String(value);
    setImmediate(() => dispatch(this, { type: "close", bubbles: false }));
  }
  getContext() { return fakeContext(); }
  // As in a browser, an element with no layout box has no rects, and an
  // empty bounding rect. Laid out, it sits at the sum of its own and its
  // ancestors' offsets: a test moves one by changing offsetLeft/offsetTop.
  getClientRects() { return this.rendered ? [{}] : []; }
  getBoundingClientRect() {
    let left = 0;
    let top = 0;
    if (this.rendered) for (let n = this; n; n = n.offsetParent) { left += n.offsetLeft; top += n.offsetTop; }
    return { left, top, width: this.clientWidth, height: this.clientHeight };
  }
}

function fakeContext() {
  const noop = () => {};
  return {
    beginPath: noop, arc: noop, stroke: noop, fill: noop, clearRect: noop,
    createRadialGradient: () => ({ addColorStop: noop }),
  };
}

// Listener exceptions are reported, not propagated, as in a browser. An event
// bubbles through the target's ancestors as they are when it fires, so one
// on a node taken out of the page (a stick canvas rebuilt under a thumb)
// never reaches the document, as in a browser.
function dispatch(target, e) {
  const path = [];
  for (let n = target; n; n = n.parentNode) path.push(n);
  const bubbles = e.bubbles !== false;
  for (let i = 0; i < path.length; i++) {
    if (i > 0 && !bubbles) break;
    for (const f of (path[i].listeners[e.type] || []).slice()) {
      try { f.call(path[i], e); } catch (err) { (target.ownerDocument || target).__errors.push(err); }
    }
  }
  return true;
}

/* --- HTML ----------------------------------------------------------------- */

const VOID = new Set(["meta", "input", "br", "img", "link", "hr"]);

function parseHtml(html, doc) {
  // Drop comments and the contents of <style>/<script>; the scripts are loaded separately.
  html = html.replace(/<!--[\s\S]*?-->/g, "");
  const scripts = [...html.matchAll(/<script\s+src="([^"]+)"/g)].map((m) => m[1]);
  html = html.replace(/<(style|script)\b[^>]*>[\s\S]*?<\/\1>/g, "<$1></$1>");
  const root = doc.documentElement;
  let cur = root;
  const re = /<(\/?)([a-zA-Z][\w-]*)([^>]*)>|([^<]+)/g;
  let m;
  while ((m = re.exec(html))) {
    if (m[4] !== undefined) { if (cur !== root && m[4].trim()) cur._text += m[4].trim(); continue; }
    const [, close, tagRaw, rest] = m;
    const tag = tagRaw.toLowerCase();
    if (tag === "html" || tag === "!doctype") continue;
    if (close) { if (tag !== "html") cur = cur.parentNode || root; continue; }
    const el = tag === "body" ? doc.body : tag === "head" ? doc.head : new Node_(tag, doc);
    for (const a of rest.matchAll(/([\w:-]+)(?:="([^"]*)")?/g)) {
      const [, name, value = ""] = a;
      el.attributes[name] = value;
      if (name.startsWith("data-")) el.dataset[name.slice(5).replace(/-(\w)/g, (_, c) => c.toUpperCase())] = value;
      if (name === "hidden") el.hidden = true;
      if (name === "value") el.value = value;
    }
    if (el !== doc.body && el !== doc.head) cur.appendChild(el);
    else if (!el.parentNode) root.appendChild(el);
    const selfClosing = /\/\s*$/.test(rest);
    if (!VOID.has(tag) && !selfClosing) cur = el;
  }
  return scripts;
}

function all(node, out = []) { out.push(node); node.children.forEach((c) => all(c, out)); return out; }

/* --- WebSocket -------------------------------------------------------------- */

function makeWebSocketClass(clock, sockets) {
  return class WebSocket {
    static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3;
    constructor(url) {
      this.url = url; this.readyState = 0; this.sent = []; this.listeners = {};
      this.closeCalls = 0;
      this.sentAt = [];
      sockets.push(this);
    }
    addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); }
    emit(t, e = {}) { (this.listeners[t] || []).forEach((f) => f({ type: t, ...e })); }
    send(d) { if (this.readyState !== 1) throw new Error("send on non-open socket"); this.sent.push(d); this.sentAt.push(clock.now()); }
    // Like a browser: close() is asynchronous; 'close' arrives later.
    close() {
      this.closeCalls++;
      if (this.readyState >= 2) return;
      this.readyState = 2;
      clock.setTimeout(() => { this.readyState = 3; this.emit("error"); this.emit("close"); }, 50);
    }
    // test helpers (the "server side")
    serverOpen() { this.readyState = 1; this.emit("open"); }
    serverMsg(o) { this.emit("message", { data: typeof o === "string" ? o : JSON.stringify(o) }); }
    serverDrop() { this.readyState = 3; this.emit("error"); this.emit("close"); }
    moves() { return this.sent.map((s) => JSON.parse(s)); }
  };
}

/* --- page ------------------------------------------------------------------- */

// storage: "ok" (a working localStorage, `store` holds its contents), "null"
// (the global is null) or "throws" (reading the global throws, as with site
// data blocked). stored: what "ok" storage holds before the page loads.
// frames: give the page requestAnimationFrame, a frame every frameMs (16) ms
// of the clock, and a ResizeObserver whose callbacks page.resized() runs
// (nothing here lays the page out to notice a change). Off by default, so
// that no other test's clock runs the simulator's view. A large frameMs is a
// throttled display: a pane out of view, where timers still run on time.
function loadPage({ touch = true, storage = "ok", stored = {}, stickSize = 230, frames = false, frameMs = 16 } = {}) {
  const clock = makeClock();
  const sockets = [];

  const doc = new Node_("#document", null);
  doc.ownerDocument = null;
  doc.__errors = [];
  doc.documentElement = new Node_("html", doc);
  if (touch) doc.documentElement.ontouchstart = null; // "ontouchstart" in documentElement
  doc.head = new Node_("head", doc);
  doc.body = new Node_("body", doc);
  doc.hidden = false;
  doc.activeElement = doc.body;
  doc.documentElement.parentNode = doc; // bubble html -> document
  doc.getElementById = (id) => all(doc.documentElement).find((n) => n.id === id) || null;
  doc.createElement = (tag) => new Node_(tag, doc);
  doc.createElementNS = (_ns, tag) => new Node_(tag, doc);

  const html = fs.readFileSync(path.join(PANEL_ROOT, "joystick.html"), "utf8");
  const scripts = parseHtml(html, doc);

  const stick = doc.getElementById("stick");
  if (stick) { stick.clientWidth = stickSize; stick.clientHeight = stickSize; }

  const win = new Node_("#window", doc);
  win.tagName = "#WINDOW";
  win.ownerDocument = doc;

  const store = { ...stored };
  let localStorage;
  if (storage === "ok") localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } };
  else if (storage === "null") localStorage = null;

  const WebSocket = makeWebSocketClass(clock, sockets);
  const ctx = {
    document: doc, window: win, WebSocket, console, Event,
    // A program run's waits are aborted through one (js/program.js).
    AbortController,
    setTimeout: clock.setTimeout, clearTimeout: clock.clear, setInterval: clock.setInterval, clearInterval: clock.clear,
    performance: { now: clock.now },
    // As in a browser: report an error without throwing it. Collected, so a
    // test that expects no errors sees one a listener raised.
    reportError: (err) => doc.__errors.push(err),
  };
  if (storage !== "throws") ctx.localStorage = localStorage;
  const resizeCallbacks = [];
  if (frames) {
    ctx.requestAnimationFrame = (fn) => clock.setTimeout(() => fn(clock.now()), frameMs);
    ctx.cancelAnimationFrame = clock.clear;
    ctx.ResizeObserver = class { constructor(fn) { resizeCallbacks.push(fn); } observe() {} unobserve() {} disconnect() {} };
  }
  vm.createContext(ctx);
  if (storage === "throws") {
    // As Chrome/Firefox with site data blocked: merely reading the global throws.
    vm.runInContext(`Object.defineProperty(globalThis, "localStorage", { configurable: true,
      get() { const e = new Error("The operation is insecure."); e.name = "SecurityError"; throw e; } });`, ctx);
  }

  const loaded = scripts.filter((src) => !isRemote(src));
  for (const src of loaded) {
    vm.runInContext(fs.readFileSync(path.join(PANEL_ROOT, src), "utf8"), ctx, { filename: src });
    if (src === "joy.js") {
      // Keep a handle on the instance the panel creates, to read its knob.
      vm.runInContext("var __RealJoy = JoyStick; JoyStick = function (...a) { return (globalThis.__joy = new __RealJoy(...a)); };", ctx);
    }
  }

  const $ = (id) => doc.getElementById(id);
  const page = {
    ctx, doc, win, clock, sockets, store, scripts: loaded, allScripts: scripts, $,
    get canvas() { return stick.children.find((c) => c.tagName === "CANVAS"); },
    get joy() { return ctx.__joy; },
    evalIn: (code) => vm.runInContext(code, ctx),
    fire(target, type, props = {}) {
      const e = { type, bubbles: true, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...props };
      dispatch(target, e);
      return e;
    },
    errors: doc.__errors,
    resized: () => resizeCallbacks.forEach((fn) => fn([])),
  };
  return page;
}

/* --- driving a page --------------------------------------------------------- */

// One turn of Node's event loop: every promise that can settle, settles.
const flush = () => new Promise((resolve) => setImmediate(resolve));

// Type a host, press Connect and open the socket from the server's side;
// returns the fake socket.
function connectOpen(page, host = "10.0.0.7") {
  page.$("host").value = host;
  page.fire(page.$("connect"), "click");
  const ws = page.sockets[page.sockets.length - 1];
  ws.serverOpen();
  return ws;
}

// ms of the page's clock in 16 ms frames, with the event loop's turns between
// them. sim, if given, is pumped a frame first, where the page has no
// requestAnimationFrame to do it.
async function pageFrames(page, ms, sim = null) {
  for (let t = 0; t < ms; t += 16) {
    if (sim) sim.pump(16);
    page.clock.advance(16);
    await flush();
  }
}

module.exports = { loadPage, all, PANEL_ROOT, flush, connectOpen, pageFrames };

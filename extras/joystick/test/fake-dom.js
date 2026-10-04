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
  const timers = new Map(); // id -> {at, fn}
  const clock = {
    now: () => now,
    setTimeout(fn, ms = 0) { const id = nextId++; timers.set(id, { at: now + Math.max(0, ms), fn }); return id; },
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
        timers.delete(id);
        t.fn();
      }
      now = end;
    },
  };
  return clock;
}

/* --- elements ------------------------------------------------------------- */

// An element's inline style: a script sets plain properties directly
// (el.style.width) and custom ones through setProperty, as in a browser.
class Style_ {
  #custom = {};
  setProperty(name, value) { this.#custom[name] = String(value); }
  getPropertyValue(name) { return this.#custom[name] || ""; }
}

class Node_ {
  constructor(tag, doc) {
    this.tagName = tag.toUpperCase();
    this.ownerDocument = doc;
    this.attributes = {};
    this.children = [];
    this.parentNode = null;
    this.listeners = {};
    this.captureListeners = {};
    this.dataset = {};
    this.style = new Style_();
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
  // A listener for the capture phase (a third argument of true, or
  // {capture: true}) runs on the way down to the target, before any on the
  // way back up.
  addEventListener(t, f, options) {
    const list = options === true || (options && options.capture) ? this.captureListeners : this.listeners;
    (list[t] = list[t] || []).push(f);
  }
  removeEventListener(t, f, options) {
    const list = options === true || (options && options.capture) ? this.captureListeners : this.listeners;
    list[t] = (list[t] || []).filter((g) => g !== f);
  }
  dispatchEvent(e) { return dispatch(this, e); }
  // As in a browser, focus() does nothing on an element with no layout box
  // or a disabled one, and, while a modal <dialog> is open, on anything
  // outside it: the rest of the page is inert.
  focus() {
    const doc = this.ownerDocument;
    if (!doc || !this.rendered || this.disabled || (doc.__modal && !doc.__modal.contains(this))) return;
    doc.activeElement = this;
  }
  // A <dialog>, as a browser's: showModal() opens it, makes the rest of the
  // page inert, and focuses its autofocus control, remembering what had the
  // focus; close(value) shuts an open one, setting returnValue when given
  // one, and gives the focus back to what had it, or to the body if that
  // has no layout box now (a menu item hidden meanwhile). "close" follows as
  // a task of its own. Escape is a close() with no value, which leaves
  // returnValue as it was.
  showModal() {
    if (this.tagName !== "DIALOG" || this.open) throw new Error("showModal() on a closed <dialog> only");
    const doc = this.ownerDocument;
    this.open = true;
    this.previouslyFocused = doc.activeElement;
    doc.__modal = this;
    (all(this).find((n) => n.hasAttribute("autofocus")) || this).focus();
  }
  close(value) {
    if (!this.open) return;
    const doc = this.ownerDocument;
    this.open = false;
    if (value !== undefined) this.returnValue = String(value);
    doc.__modal = null;
    const back = this.previouslyFocused;
    doc.activeElement = back && back.rendered && doc.contains(back) ? back : doc.body;
    setImmediate(() => dispatch(this, { type: "close", bubbles: false }));
  }
  // As in a browser, click() fires a click that bubbles. A file <input>'s
  // picker is the browser's: here a test counts the clicks (pickerOpened)
  // and fires "change" itself.
  click() {
    if (this.tagName === "INPUT" && this.getAttribute("type") === "file") this.pickerOpened = (this.pickerOpened || 0) + 1;
    dispatch(this, { type: "click", bubbles: true, preventDefault() {} });
  }
  // As in a browser, an element with no layout box scrolls nowhere.
  scrollIntoView(options) {
    if (!this.rendered) return;
    this.scrolledIntoView = (this.scrolledIntoView || 0) + 1;
    this.scrollOptions = options;
  }
  contains(other) { for (let n = other; n; n = n.parentNode) if (n === this) return true; return false; }
  closest(selector) { const test = parseSelector(selector); for (let n = this; n && n.tagName !== "#DOCUMENT"; n = n.parentNode) if (test(n)) return n; return null; }
  querySelectorAll(selector) { const test = parseSelector(selector); return all(this).slice(1).filter(test); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
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

// A test for one compound selector -- a tag, #id, .class, [attr] or
// [attr="value"], in any combination -- which is all the panel asks of
// closest() and querySelectorAll(). Anything more (a combinator,
// a list, a pseudo-class) throws, rather than match the wrong elements.
function parseSelector(selector) {
  const parts = [];
  const re = /^(?:([a-zA-Z][\w-]*)|#([\w-]+)|\.([\w-]+)|\[([\w-]+)(?:="([^"]*)")?\])/;
  let rest = selector.trim();
  while (rest) {
    const m = rest.match(re);
    if (!m) throw new Error(`fake-dom: unsupported selector "${selector}"`);
    const [, tag, id, cls, attr, value] = m;
    if (tag) parts.push((n) => n.tagName === tag.toUpperCase());
    else if (id) parts.push((n) => n.id === id);
    else if (cls) parts.push((n) => (n.getAttribute("class") || "").split(/\s+/).includes(cls));
    else parts.push((n) => (value === undefined ? n.hasAttribute(attr) : n.getAttribute(attr) === value));
    rest = rest.slice(m[0].length);
  }
  return (n) => typeof n.getAttribute === "function" && parts.every((test) => test(n));
}

function fakeContext() {
  const noop = () => {};
  return {
    beginPath: noop, arc: noop, stroke: noop, fill: noop, clearRect: noop,
    // A colour Chromium cannot parse, "" among them, throws, as there.
    createRadialGradient: () => ({
      addColorStop(offset, colour) {
        if (typeof colour !== "string" || colour.trim() === "") throw new SyntaxError(`addColorStop: '${colour}' could not be parsed as a color`);
      },
    }),
  };
}

// Listener exceptions are reported, not propagated, as in a browser. An event
// travels the target's ancestors as they are when it fires, so one on a node
// taken out of the page (a stick canvas rebuilt under a thumb) never reaches
// the document, as in a browser: down from the top through the capture
// listeners, then at the target, then back up through the others if it
// bubbles. stopPropagation() ends the trip after the node it was called on,
// as Blockly's workspace does to every press. Its target is the node it was
// fired at, unless the test gave it another.
function dispatch(target, e) {
  if (e.target === undefined) e.target = target;
  let stopped = false;
  e.stopPropagation = () => { stopped = true; };
  const path = [];
  for (let n = target; n; n = n.parentNode) path.push(n);
  const run = (node, listeners) => {
    for (const f of (listeners[e.type] || []).slice()) {
      try { f.call(node, e); } catch (err) { (target.ownerDocument || target).__errors.push(err); }
    }
  };
  for (let i = path.length - 1; i > 0 && !stopped; i--) run(path[i], path[i].captureListeners);
  if (!stopped) {
    run(target, target.captureListeners);
    run(target, target.listeners);
  }
  const bubbles = e.bubbles !== false;
  for (let i = 1; i < path.length && bubbles && !stopped; i++) run(path[i], path[i].listeners);
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

/* --- the look's tokens -------------------------------------------------------- */

// css/looks.css, and then `extra` (CSS in the same shape), as a map from a
// look's id to the tokens its block declares; the default block's are under
// ":root" too. Custom properties only: all a script reads of a look.
function readLooks(extra) {
  const { lookBlocks } = require("./css.js"); // here, not at the top: css.js requires this file
  const looks = new Map();
  for (const { selector, id, declared } of lookBlocks(extra)) {
    const tokens = Object.fromEntries([...declared].filter(([name]) => name.startsWith("--")));
    const keys = selector.split(",").some((each) => each.trim() === ":root") ? [":root", id] : [id];
    for (const key of keys) if (key) looks.set(key, { ...looks.get(key), ...tokens });
  }
  return looks;
}

// getComputedStyle(element), as far as the look's tokens go. A custom
// property inherits, so a token's value is the one declared by the nearest
// data-look at or above element that has a block, else :root's (<html> is
// :root), with each var() in it taken where it was declared. An unknown
// token, or an element out of the page, gives "", as in a browser.
function lookStyle(looks, element) {
  const value = (name, from) => {
    for (let n = from; n && n.tagName !== "#DOCUMENT"; n = n.parentNode) {
      const look = looks.get(n.getAttribute("data-look"));
      let declared = look && look[name];
      if (declared === undefined && n.tagName === "HTML") declared = looks.get(":root")[name];
      if (declared !== undefined) return declared.replace(/var\((--[\w-]+)\)/g, (_, ref) => value(ref, n));
    }
    return "";
  };
  return { getPropertyValue: (name) => value(name, element) };
}

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
// (nothing here lays the page out to notice a change); what it observes is
// marked resizeObserved. Off by default, so
// that no other test's clock runs the simulator's view. A large frameMs is a
// throttled display: a pane out of view, where timers still run on time.
// looks: CSS in css/looks.css's shape, read after it, for a test that needs
// looks of its own: colours it can tell apart whatever the file holds.
function loadPage({ touch = true, storage = "ok", stored = {}, stickSize = 230, frames = false, frameMs = 16, looks = "" } = {}) {
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
  doc.querySelector = (selector) => doc.documentElement.querySelector(selector);

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
  const lookBlocks = readLooks(looks);
  const ctx = {
    document: doc, window: win, WebSocket, console, Event,
    // A program run's waits are aborted through one (js/program.js).
    AbortController,
    // No setInterval: nothing in the panel repeats on one (the Driver sets a
    // timeout per send), and a script that started to would fail here.
    setTimeout: clock.setTimeout, clearTimeout: clock.clear,
    performance: { now: clock.now },
    // As in a browser: report an error without throwing it. Collected, so a
    // test that expects no errors sees one a listener raised.
    reportError: (err) => doc.__errors.push(err),
    getComputedStyle: (element) => lookStyle(lookBlocks, element),
  };
  if (storage !== "throws") ctx.localStorage = localStorage;
  const resizeCallbacks = [];
  if (frames) {
    ctx.requestAnimationFrame = (fn) => clock.setTimeout(() => fn(clock.now()), frameMs);
    ctx.cancelAnimationFrame = clock.clear;
    ctx.ResizeObserver = class { constructor(fn) { resizeCallbacks.push(fn); } observe(target) { target.resizeObserved = true; } unobserve() {} disconnect() {} };
  }
  vm.createContext(ctx);
  if (storage === "throws") {
    // As Chrome/Firefox with site data blocked: merely reading the global throws.
    vm.runInContext(`Object.defineProperty(globalThis, "localStorage", { configurable: true,
      get() { const e = new Error("The operation is insecure."); e.name = "SecurityError"; throw e; } });`, ctx);
  }

  const loaded = scripts.filter((src) => !isRemote(src));
  let headThemeColor = null;
  for (const src of loaded) {
    vm.runInContext(fs.readFileSync(path.join(PANEL_ROOT, src), "utf8"), ctx, { filename: src });
    // The browser's bar as the scripts in <head> leave it: the first paint's.
    if (src === "js/look.js") headThemeColor = doc.querySelector('meta[name="theme-color"]').getAttribute("content");
    if (src === "joy.js") {
      // Keep a handle on the instance the panel creates, to read its knob,
      // and on the parameters it was built with, its colours among them.
      vm.runInContext("var __RealJoy = JoyStick; JoyStick = function (...a) { globalThis.__joyParameters = a[1]; return (globalThis.__joy = new __RealJoy(...a)); };", ctx);
    }
  }

  const $ = (id) => doc.getElementById(id);
  const page = {
    doc, win, clock, sockets, store, scripts: loaded, allScripts: scripts, $, headThemeColor,
    get canvas() { return stick.children.find((c) => c.tagName === "CANVAS"); },
    get joy() { return ctx.__joy; },
    get joyParameters() { return ctx.__joyParameters; },
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

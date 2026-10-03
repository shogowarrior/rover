// The panel's looks (css/looks.css): every colour the page paints is a token,
// declared once in each look's block, and the chosen look is data-look on
// <html>. This checks that the stylesheet holds the six looks the options
// offer, in their order, each declaring the same tokens; that every token a
// stylesheet or a script reads is declared; the values no look may change;
// and that every look holds the contrast its text and marks need, pair by
// pair, as audited below.
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("./harness.js");
const { PANEL_ROOT } = require("./fake-dom.js");
const { stylesheet, cssRules } = require("./css.js");

// The looks the options offer, in their order (js/look.js). The first is
// the default, and its block is also :root's, so the page paints in it
// before anything has set data-look.
const LOOKS = require("../js/look.js").LookPicker.LOOKS.map((look) => look.id);
const DEFAULT_SELECTOR = `:root,\n[data-look="${LOOKS[0]}"]`;

/* --- the audit ----------------------------------------------------------- */

const TEXT = 4.5; // WCAG 1.4.3
const MARK = 3; // WCAG 1.4.11: a mark, or a control's edge, that carries meaning
// A quiet mark carries no meaning of its own (a rule, a notch, the room's
// grid): it need only stay in sight. How well is a matter for the eye.
const QUIET = 1.1;
// Field is the look for glare or a bright room, and holds more wherever these
// are drawn: its ink at 7:1 (WCAG 1.4.6) and its rules strong.
const FIELD = { "--readout": 7, "--dim": 7, "--rule": 3 };

// Where the panel paints text or a meaningful mark in a token, and on what:
// [foreground, backgrounds, minimum contrast, where]. "--a over --b" is the
// tint --a composited over --b; "--x at 0.95" is --x drawn at that opacity.
// A disabled control's faded text is exempt (WCAG 1.4.3), and is left out.
// A rule that paints a token on a surface not listed here adds its pair.
//
// The surfaces: the page, under the header, the Program tab, Blockly's
// workspace and the log (--case); the cards, menus, the dock and the bars
// (--panel), with the glow behind the scan and the wide dock; buttons,
// tracks, idle pills, the flyout and the room's floor (--raised); a hovered
// or pressed one (--raised-hi); the chosen segment (--chosen). A tinted pill
// or button replaces its fill with the tint.
const AUDIT = [
  ["--readout", ["--case", "--panel", "--raised", "--raised-hi", "--chosen", "--live-glow over --panel", "--warn-soft over --case"], TEXT,
    "the page's text, the readouts, buttons, menus, Blockly's toolbox and flyout, the fault card"],
  ["--dim", ["--case", "--panel", "--raised", "--live-glow over --panel"], TEXT,
    "captions, the note, unchosen segments, idle pills, the log, the scan's ticks, the room's walls and labels"],
  ["--live", ["--case", "--raised", "--live-soft over --case", "--live-soft over --panel"], TEXT,
    "the log's done, a pending segment, the link and motors pills, Autonomous as last reported"],
  ["--live-ink", ["--live-soft over --raised"], TEXT, "the open tab"],
  ["--on-live", ["--live"], TEXT, "Connect, Run, Yes, a held rotate button, the mode pill while exploring"],
  ["--warn", ["--case", "--panel", "--live-glow over --panel", "--warn-soft over --case"], TEXT,
    "the note gone bad, the phase, the stick's caption, the GO tick, the pills, the fault's headline, the log"],
  ["--stop-ink", ["--panel", "--live-glow over --panel", "--stop-soft over --case"], TEXT,
    "the STOP tick, the link pill down, Stop program, a stall or a bump in the simulator"],
  ["--on-stop", ["--stop", "--stop-hi"], TEXT, "Stop"],

  // The stick's well shades from --raised to --case; its knob is --live,
  // edged in --case (js/drive.js). A fresh sonar ray is drawn at 0.95.
  ["--live", ["--case", "--panel", "--live-glow over --panel", "--raised", "--raised-hi", "--chosen", "--sim-plate"], MARK,
    "the focus ring, the slider's thumb, the stick's knob, the scan's rover, the stick's and families' icons, a pressed tool, a forward wheel"],
  ["--warn at 0.95", ["--live-glow over --panel", "--raised", "--raised-hi"], MARK, "the caveat's dot, a sonar ray closing in, Pause held"],
  ["--stop at 0.95", ["--case", "--raised"], MARK, "Stop program's edge, a sonar ray inside STOP, a bump, a stalled rover's outline"],
  ["--live", ["--live-glow over --panel"], MARK, "the scan's wedge, clear"],
  ["--warn", ["--live-glow over --panel"], MARK, "the scan's wedge, closing in"],
  ["--stop", ["--live-glow over --panel"], MARK, "the scan's wedge, inside STOP"],
  ["--case", ["--live", "--sim-back"], MARK, "the stick knob's edge, the arrow on a turning wheel"],
  ["--readout", ["--sim-plate"], MARK, "the simulated rover's outline and nose"],
  ["--sim-back", ["--raised", "--panel", "--sim-plate"], MARK, "a backward wheel, in the room, its inset and its key"],

  ["--rule", ["--case", "--panel"], QUIET, "the rules between parts, a card's and an input's edge"],
  ["--warn at 0.55", ["--live-glow over --panel"], QUIET, "the scan's GO ring, faded: its tick names it, the wedges' colour shows it"],
  ["--stop-ink at 0.65", ["--live-glow over --panel"], QUIET, "the scan's STOP ring, likewise"],
  ["--faint", ["--case", "--raised"], QUIET, "the stick's notches and ring, a free wheel's and a box's edge"],
  ["--chosen", ["--raised"], QUIET, "the chosen segment in its track; its ink says so too"],
  ["--raised-hi", ["--raised"], QUIET, "a box on the room's floor"],
  ["--sim-grid", ["--raised"], QUIET, "the room's grid"],
  ["--sim-grid-major", ["--raised"], QUIET, "the room's grid, every metre"],
];

/* --- reading the looks --------------------------------------------------- */

// css/looks.css, block by block: its selector, the look it is for, and what
// it declares, name to value.
function readLooks() {
  return cssRules(stylesheet("looks.css")).map(({ selector, body }) => ({
    selector,
    id: (selector.match(/\[data-look="([\w-]+)"\]$/) || [])[1],
    declared: new Map([...body.matchAll(/([\w-]+)\s*:\s*([^;]+);/g)].map(([, name, value]) => [name, value.trim()])),
  }));
}

const tokensOf = (look) => [...look.declared.keys()].filter((name) => name.startsWith("--"));

// [r, g, b, alpha], from the forms looks.css writes: #rgb, #rrggbb and
// rgb(r g b / alpha). Anything else fails by name rather than be guessed at.
function rgba(value, what) {
  const hex = value.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    const digits = hex[1].length === 3 ? [...hex[1]].map((c) => c + c).join("") : hex[1];
    return [0, 2, 4].map((i) => parseInt(digits.slice(i, i + 2), 16)).concat(1);
  }
  const rgb = value.match(/^rgb\(\s*(\d+)\s+(\d+)\s+(\d+)\s*(?:\/\s*([\d.]+))?\s*\)$/);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3]), rgb[4] === undefined ? 1 : Number(rgb[4])];
  throw new Error(`${what} is ${value}, which this test cannot read as a colour`);
}

// A token's colour in a look, through any var() it is an alias for.
function colour(look, token) {
  const value = look.declared.get(token);
  assert.ok(value !== undefined, `${look.id} declares no ${token}`);
  const alias = value.match(/^var\((--[\w-]+)\)$/);
  return alias ? colour(look, alias[1]) : rgba(value, `${look.id}'s ${token}`);
}

// top drawn on an opaque under, at its own alpha times opacity.
function over(top, under, opacity = 1) {
  const alpha = top[3] * opacity;
  return [0, 1, 2].map((i) => top[i] * alpha + under[i] * (1 - alpha)).concat(1);
}

// "--a over --b": each tint laid on the opaque surface under it.
function surface(look, spec) {
  const layers = spec.split(" over ").map((token) => colour(look, token));
  const ground = layers.pop();
  assert.equal(ground[3], 1, `${look.id}: ${spec} does not end on an opaque surface`);
  return layers.reduceRight((under, top) => over(top, under), ground);
}

// WCAG 2.x relative luminance, and the contrast ratio of two colours.
function luminance([r, g, b]) {
  const linear = (c) => (c / 255 <= 0.04045 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4);
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/* --- the tests ----------------------------------------------------------- */

test("looks.css holds the six looks, in the options' order, the default first and on :root", () => {
  const looks = readLooks();
  assert.deepEqual(looks.map((look) => look.id), LOOKS);
  assert.equal(looks[0].selector, DEFAULT_SELECTOR);
  for (const look of looks.slice(1)) assert.equal(look.selector, `[data-look="${look.id}"]`);
  // One place for a look's colours: a block anywhere else would win or lose
  // by the order the stylesheets load in.
  for (const file of fs.readdirSync(path.join(PANEL_ROOT, "css")).filter((name) => name.endsWith(".css") && name !== "looks.css")) {
    const keyed = cssRules(stylesheet(file)).filter((rule) => /\[data-look\b/.test(rule.selector));
    assert.deepEqual(keyed.map((rule) => rule.selector), [], `${file} keys on a look`);
  }
});

test("every look declares exactly the default look's tokens", () => {
  const [first, ...rest] = readLooks();
  const expected = tokensOf(first);
  for (const look of rest) {
    const tokens = tokensOf(look);
    const missing = expected.filter((name) => !tokens.includes(name));
    const extra = tokens.filter((name) => !expected.includes(name));
    assert.ok(missing.length === 0 && extra.length === 0, `${look.id}: missing ${missing}; not in ${first.id}: ${extra}`);
  }
});

// A token read but declared nowhere reads as nothing: a var() drops its
// whole declaration, blocks.js's token() hands Blockly an empty colour.
// The look's tokens and panel.css's :root are everywhere; a stylesheet's own
// (sim.css's .sim aliases, program.css's --dot) only in that stylesheet; and
// blocks.js gives the editor --block-<category> from its PALETTE.
test("every token the stylesheets and scripts read is declared", () => {
  const everywhere = new Set(readLooks().flatMap(tokensOf));
  const sheets = fs.readdirSync(path.join(PANEL_ROOT, "css")).filter((name) => name.endsWith(".css"));
  const own = new Map(); // stylesheet -> the tokens it declares in other rules
  for (const file of sheets) {
    own.set(file, new Set());
    if (file === "looks.css") continue;
    for (const { selector, body } of cssRules(stylesheet(file))) {
      const into = selector === ":root" ? everywhere : own.get(file);
      for (const [, name] of body.matchAll(/(--[\w-]+)\s*:/g)) into.add(name);
    }
  }
  const blocks = fs.readFileSync(path.join(PANEL_ROOT, "js", "blocks.js"), "utf8");
  assert.match(blocks, /setProperty\(`--block-\$\{key\}`/, "blocks.js sets --block-<category> on the editor");
  const { RoverBlocks } = require("../js/blocks.js");
  const editor = new Set(Object.keys(RoverBlocks.PALETTE).map((key) => `--block-${key}`));

  const undeclared = [];
  for (const file of sheets) {
    for (const [, name] of stylesheet(file).matchAll(/var\((--[\w-]+)/g)) {
      if (!everywhere.has(name) && !own.get(file).has(name) && !editor.has(name)) undeclared.push(`${name} in css/${file}`);
    }
  }
  const scripts = path.join(PANEL_ROOT, "js");
  for (const file of fs.readdirSync(scripts).filter((name) => name.endsWith(".js"))) {
    const text = fs.readFileSync(path.join(scripts, file), "utf8");
    for (const [, name] of [...text.matchAll(/var\((--[\w-]+)/g), ...text.matchAll(/["'](--[\w-]+)["']/g)]) {
      if (!everywhere.has(name)) undeclared.push(`${name} in js/${file}`);
    }
  }
  assert.ok(everywhere.has("--case") && everywhere.has("--sans"), "read the looks and panel.css's :root");
  assert.deepEqual([...new Set(undeclared)], []);
});

// The red that means Stop is the same in every look, and so is the white on
// it: blocks.js copies --stop for the stop block, and a look whose Stop were
// another red would teach the eye two.
test("every look's Stop is #d23c37, and its text on a fill #ffffff", () => {
  for (const look of readLooks()) {
    assert.equal(look.declared.get("--stop"), "#d23c37", `${look.id}'s --stop`);
    assert.equal(look.declared.get("--on-fill"), "#ffffff", `${look.id}'s --on-fill`);
  }
});

// The browser draws its own parts (a select's list, scrollbars, the
// caret) dark or light by color-scheme.
test("every look's color-scheme is its flavour", () => {
  for (const look of readLooks()) {
    assert.equal(look.declared.get("color-scheme"), look.id.split("-").pop(), `${look.id}'s color-scheme`);
  }
});

for (const id of LOOKS) {
  test(`${id}: every audited pair holds its contrast`, () => {
    const look = readLooks().find((each) => each.id === id);
    assert.ok(look, `looks.css has no ${id}`);
    const field = id.startsWith("field-");
    const short = [];
    for (const [ink, grounds, min, where] of AUDIT) {
      const [token, opacity = "1"] = ink.split(" at ");
      const need = field && FIELD[token] ? Math.max(min, FIELD[token]) : min;
      for (const ground of grounds) {
        const under = surface(look, ground);
        const ratio = contrast(over(colour(look, token), under, Number(opacity)), under);
        if (ratio < need) short.push(`${ink} on ${ground}: ${ratio.toFixed(2)}, under ${need} (${where})`);
      }
    }
    assert.deepEqual(short, []);
  });
}

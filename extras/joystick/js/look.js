/**
 * The page's look: the colours it paints in, picked under the gear in the
 * header and remembered between visits.
 *
 * Every colour is a token of css/looks.css, one block of them per look,
 * keyed by data-look, and the look in force is <html>'s. A look is a theme
 * in one of two flavours, Dark or Light, and the two are picked apart: a
 * Dark | Light toggle, and a tile per theme. This file loads in <head>,
 * before anything is drawn, and its one top-level call (at its foot) puts
 * the remembered look on <html> there, so the first paint is already in it.
 * A look the memory does not hold, an id no look has any more, or a memory
 * that cannot be read gives the default.
 *
 *   LookPicker.LOOKS   every look, the default first: { id, theme, flavour }.
 *                      Every theme comes in every flavour.
 *   LookPicker.STORAGE_KEY
 *                      where the look is remembered. It is not app.js's to
 *                      give, as other parts' keys are: the look is put on
 *                      before app.js runs.
 *   LookPicker.restore()
 *                      put the remembered look on <html>, and paint the
 *                      browser's own bar (theme-color) in its case colour.
 *
 *   new LookPicker({ flavours, themes })
 *     flavours  the Options popover's empty .segmented group: a segment per
 *               flavour, the one in force pressed. A press keeps the theme.
 *     themes    its empty radiogroup: a tile per theme, each a radio, a
 *               miniature of the panel in that theme's colours in the flavour
 *               in force (css/panel.css draws it), and its name. A pick keeps
 *               the flavour. The theme in force is checked.
 *   onChange(fn)
 *     fn(id) after the operator picks a theme or a flavour, once the new look
 *     is on <html> and remembered. Picking one sends nothing anywhere.
 *
 *   lookToken(name)
 *     A token of the look in force, or "" when the page cannot read it
 *     (css/looks.css missing). For whatever takes a colour as a plain value
 *     -- joy.js's canvas, Blockly's theme, the browser's theme-color -- and
 *     so must be given it again when the look changes; anything styled with
 *     var() follows by itself.
 */
class LookPicker {
  static STORAGE_KEY = "rover.look";

  // What each theme is for: css/looks.css's header.
  static LOOKS = Object.freeze([
    { id: "console-dark", theme: "Console", flavour: "Dark" },
    { id: "console-light", theme: "Console", flavour: "Light" },
    { id: "field-dark", theme: "Field", flavour: "Dark" },
    { id: "field-light", theme: "Field", flavour: "Light" },
    { id: "blueprint-dark", theme: "Blueprint", flavour: "Dark" },
    { id: "blueprint-light", theme: "Blueprint", flavour: "Light" },
  ].map(Object.freeze));

  #look; // the entry of LOOKS in force
  #flavours = new Map(); // flavour -> its segment
  #swatches = new Map(); // theme -> its tile's miniature
  #changeListeners = new Listeners();

  static restore() {
    LookPicker.#wear(LookPicker.#find(memory.recall(LookPicker.STORAGE_KEY)));
  }

  // The look with this id, or the default if none has it.
  static #find(id) {
    return LookPicker.LOOKS.find((look) => look.id === id) || LookPicker.LOOKS[0];
  }

  // The look of this theme in this flavour.
  static #of(theme, flavour) {
    return LookPicker.LOOKS.find((look) => look.theme === theme && look.flavour === flavour);
  }

  // Each value of a look's field, once, in LOOKS's order.
  static #each(field) {
    return [...new Set(LookPicker.LOOKS.map((look) => look[field]))];
  }

  // Put the look on <html>. The browser's bar takes a colour as a plain
  // value: in <head>, the stylesheets before this file have loaded, so it is
  // painted with the page's first paint, not when app.js runs. A look the
  // page cannot read leaves it as joystick.html gives it.
  static #wear(look) {
    document.documentElement.setAttribute("data-look", look.id);
    const bar = document.querySelector('meta[name="theme-color"]');
    const colour = lookToken("--case");
    if (bar && colour) bar.setAttribute("content", colour);
  }

  constructor({ flavours, themes }) {
    this.#look = LookPicker.#find(document.documentElement.getAttribute("data-look"));
    for (const flavour of LookPicker.#each("flavour")) {
      const button = segment(flavours, () => this.#pick(LookPicker.#of(this.#look.theme, flavour)));
      button.textContent = flavour;
      this.#flavours.set(flavour, button);
    }
    for (const theme of LookPicker.#each("theme")) {
      const tile = dom.html("label", { class: "lookTile" }, themes);
      const radio = dom.html("input", { type: "radio", name: "look", value: theme.toLowerCase() }, tile);
      radio.checked = theme === this.#look.theme;
      radio.addEventListener("change", () => this.#pick(LookPicker.#of(theme, this.#look.flavour)));
      this.#swatches.set(theme, LookPicker.#preview(tile));
      dom.html("span", { class: "lookName" }, tile, theme);
    }
    this.#show();
  }

  onChange(fn) {
    return this.#changeListeners.add(fn);
  }

  // A press on the flavour already in force changes nothing.
  #pick(look) {
    if (look === this.#look) return;
    this.#look = look;
    LookPicker.#wear(look);
    memory.remember(LookPicker.STORAGE_KEY, look.id);
    this.#show();
    this.#changeListeners.emit(look.id);
  }

  // The flavour in force pressed, and each tile previewed in it.
  #show() {
    pressSegment(this.#flavours, this.#look.flavour);
    for (const [theme, swatch] of this.#swatches) swatch.setAttribute("data-look", LookPicker.#of(theme, this.#look.flavour).id);
  }

  // The panel in miniature, which css/panel.css paints in the tokens of the
  // look its data-look names (#show sets it): a card on the case, with two
  // lines of text and a status pill; under it, a button in the controls'
  // blue, and Stop. The frame round it is the page's, and shows which tile
  // is checked and which has the focus. Returns the miniature.
  static #preview(tile) {
    const frame = dom.html("span", { class: "lookPreview", "aria-hidden": "true" }, tile);
    const swatch = dom.html("span", { class: "lookSwatch" }, frame);
    const card = dom.html("span", { class: "lookCard" }, swatch);
    dom.html("i", { class: "lookText" }, card);
    dom.html("i", { class: "lookText dim" }, card);
    const pill = dom.html("span", { class: "lookLamps" }, card);
    dom.html("i", { class: "lookLamp ok" }, pill);
    dom.html("i", { class: "lookLamp warn" }, pill);
    const foot = dom.html("span", { class: "lookFoot" }, swatch);
    dom.html("i", { class: "lookGo" }, foot);
    dom.html("i", { class: "lookStop" }, foot);
    return swatch;
  }
}

function lookToken(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

// The reason this file loads in <head>: the remembered look is on <html>
// before the page is first drawn. In Node, where a test reads LOOKS, there
// is no page.
if (typeof document !== "undefined") LookPicker.restore();

if (typeof module !== "undefined") module.exports = { LookPicker };

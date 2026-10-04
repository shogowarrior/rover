/**
 * The page's look: the colours it paints in, picked under the gear in the
 * header and remembered between visits.
 *
 * Every colour is a token of css/looks.css, one block of them per look,
 * keyed by data-look, and the look in force is <html>'s. This file loads in
 * <head>, before anything is drawn, and its one top-level call (at its foot)
 * puts the remembered look on <html> there, so the first paint is already
 * in it. A look the memory does not hold, an id no look has any more, or a
 * memory that cannot be read gives the default.
 *
 *   LookPicker.LOOKS   every look, the default first: { id, theme, flavour }.
 *   LookPicker.STORAGE_KEY
 *                      where the look is remembered. It is not app.js's to
 *                      give, as other parts' keys are: the look is put on
 *                      before app.js runs.
 *   LookPicker.restore()
 *                      put the remembered look on <html>, and paint the
 *                      browser's own bar (theme-color) in its case colour.
 *
 *   new LookPicker(group)
 *     group   the Options popover's empty radiogroup. Each theme gets a row of
 *             it, with a tile per flavour: a radio, a miniature of the panel
 *             in that look's own colours (css/panel.css draws it), and its
 *             name. The look in force is checked.
 *   onChange(fn)
 *     fn(id) after the operator picks a look, once it is on <html> and
 *     remembered. Picking one sends nothing anywhere.
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

  #changeListeners = new Listeners();

  static restore() {
    LookPicker.#wear(memory.recall(LookPicker.STORAGE_KEY));
  }

  // Put the look with this id on <html>, or the default if none has it.
  // The browser's bar takes a colour as a plain value: in <head>, the
  // stylesheets before this file have loaded, so it is painted with the
  // page's first paint, not when app.js runs. A look the page cannot read
  // leaves it as joystick.html gives it.
  static #wear(id) {
    const look = LookPicker.LOOKS.find((candidate) => candidate.id === id) || LookPicker.LOOKS[0];
    document.documentElement.setAttribute("data-look", look.id);
    const bar = document.querySelector('meta[name="theme-color"]');
    const colour = lookToken("--case");
    if (bar && colour) bar.setAttribute("content", colour);
  }

  constructor(group) {
    const worn = document.documentElement.getAttribute("data-look");
    for (const theme of new Set(LookPicker.LOOKS.map((look) => look.theme))) {
      const row = dom.html("div", { class: "lookTheme" }, group);
      // For the eye: each tile's own name says its theme to a screen reader.
      dom.html("span", { class: "lookThemeName", "aria-hidden": "true" }, row, theme);
      for (const look of LookPicker.LOOKS.filter((candidate) => candidate.theme === theme)) {
        const tile = dom.html("label", { class: "lookTile" }, row);
        const radio = dom.html("input", { type: "radio", name: "look", value: look.id }, tile);
        radio.checked = look.id === worn;
        radio.addEventListener("change", () => this.#pick(look.id));
        LookPicker.#preview(tile, look.id);
        const name = dom.html("span", { class: "lookName" }, tile);
        dom.html("span", { class: "srOnly" }, name, `${theme} `);
        dom.html("span", {}, name, look.flavour);
      }
    }
  }

  onChange(fn) {
    return this.#changeListeners.add(fn);
  }

  #pick(id) {
    LookPicker.#wear(id);
    memory.remember(LookPicker.STORAGE_KEY, id);
    this.#changeListeners.emit(id);
  }

  // The panel in miniature, which css/panel.css paints in the look's own
  // tokens: a card on the case, with two lines of text and a status pill;
  // under it, Autonomous lit and Stop. The frame round it is the page's, and
  // shows which tile is checked and which has the focus.
  static #preview(tile, id) {
    const frame = dom.html("span", { class: "lookPreview", "aria-hidden": "true" }, tile);
    const swatch = dom.html("span", { class: "lookSwatch", "data-look": id }, frame);
    const card = dom.html("span", { class: "lookCard" }, swatch);
    dom.html("i", { class: "lookText" }, card);
    dom.html("i", { class: "lookText dim" }, card);
    const pill = dom.html("span", { class: "lookLamps" }, card);
    dom.html("i", { class: "lookLamp live" }, pill);
    dom.html("i", { class: "lookLamp warn" }, pill);
    const foot = dom.html("span", { class: "lookFoot" }, swatch);
    dom.html("i", { class: "lookGo" }, foot);
    dom.html("i", { class: "lookStop" }, foot);
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

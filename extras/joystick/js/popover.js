/**
 * A button and the popup it opens: the Program tab's File menu, the
 * simulator's settings, the page's Options, and the link chip's address and
 * Connect. While it is open its button
 * says so (aria-expanded); Escape closes it with the focus back on its
 * button, and a press anywhere outside it closes it.
 *
 *   new Popover(button, panel, { menu })
 *     button  what opens and closes it.
 *     panel   the popup, hidden while closed. It needs an id, for the
 *             button's aria-controls.
 *     menu    true for a menu: panel is role="menu", and its actions are
 *             buttons of role="menuitem". Opening it puts the focus on its
 *             first item that can act (Up, on the button, on its last); Up
 *             and Down move through those and wrap, Home and End go to the
 *             ends, and Tab closes it and moves on. An item, once pressed,
 *             closes it with the focus back on the button. An item that
 *             cannot act now stays in the menu, disabled, and the keys pass
 *             it by.
 *
 * A popup taller than the room the page leaves it scrolls inside (its
 * stylesheet's max-height), and says so: while it is open its data-more
 * names each end with more of it past the edge, "above", "below" or both,
 * which the stylesheet fades. Measured as it opens, scrolls or the window
 * changes size; absent where nothing is past either edge.
 *
 * Its only interface is the elements' own: everything else is the
 * operator's to open and close.
 */
class Popover {
  static ITEM = '[role="menuitem"]';
  static #current = null; // the popup open now, if any

  #button;
  #panel;
  #menu;

  constructor(button, panel, { menu = false } = {}) {
    this.#button = button;
    this.#panel = panel;
    this.#menu = menu;
    if (menu) button.setAttribute("aria-haspopup", "menu");
    button.setAttribute("aria-controls", panel.id);
    this.#show(false);

    button.addEventListener("click", () => {
      if (!panel.hidden) this.#show(false);
      else this.#open("first");
    });
    button.addEventListener("keydown", (event) => this.#onButtonKey(event));
    panel.addEventListener("keydown", (event) => this.#onPanelKey(event));
    panel.addEventListener("scroll", () => this.#markMore(), { passive: true });
    if (typeof window !== "undefined") window.addEventListener("resize", () => this.#markMore());
    if (menu) {
      // Closed before the item's own click acts (the capture phase): an item
      // that asks opens the page's modal <dialog>, which makes the button
      // inert and later gives the focus back to whatever had it when it
      // opened. That must be the button, not an item hidden meanwhile.
      panel.addEventListener("click", (event) => {
        const item = event.target.closest(Popover.ITEM);
        if (item && !item.disabled) this.#close();
      }, true);
    }
    // The capture phase, because Blockly stops every press on its workspace
    // from going any further, and the editor is most of the Program tab.
    document.addEventListener("pointerdown", (event) => {
      if (panel.hidden || panel.contains(event.target) || button.contains(event.target)) return;
      this.#show(false);
    }, true);
  }

  #show(open) {
    this.#panel.hidden = !open;
    this.#button.setAttribute("aria-expanded", String(open));
    if (!open) this.#panel.removeAttribute("data-more");
  }

  // One popup open at a time: opening one closes any other. It scrolls into
  // view, clear of anything its stylesheet's scroll margins keep it from (the
  // top stuck over a phone's page). A menu takes the focus to the item `at`
  // ("first" or "last"); any other popup leaves it on the button.
  #open(at) {
    if (Popover.#current && Popover.#current !== this) Popover.#current.#show(false);
    Popover.#current = this;
    this.#show(true);
    this.#panel.scrollIntoView({ block: "nearest" });
    this.#markMore();
    if (this.#menu) this.#focusItem(at);
  }

  // Which ends of the open popup have more of it past the edge: the
  // stylesheet fades those, so a list cut by the screen's foot reads as one
  // that scrolls (the critic's round 2: Options ran past a phone on its
  // side, its Firmware section out of sight with nothing to say so). A
  // pixel's slack, for a fractional scroll position.
  #markMore() {
    const panel = this.#panel;
    const more = [];
    if (!panel.hidden) {
      if (panel.scrollTop > 1) more.push("above");
      if (panel.scrollTop + panel.clientHeight < panel.scrollHeight - 1) more.push("below");
    }
    if (more.length > 0) panel.setAttribute("data-more", more.join(" "));
    else panel.removeAttribute("data-more");
  }

  #close() {
    this.#show(false);
    this.#button.focus();
  }

  #onButtonKey(event) {
    if (event.key === "Escape" && !this.#panel.hidden) {
      this.#close();
    } else if (this.#menu && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      // Not a scroll of the page.
      event.preventDefault();
      this.#open(event.key === "ArrowDown" ? "first" : "last");
    }
  }

  #onPanelKey(event) {
    if (event.key === "Escape") {
      this.#close();
      return;
    }
    if (!this.#menu) return;
    const step = { ArrowDown: 1, ArrowUp: -1, Home: "first", End: "last" }[event.key];
    if (step !== undefined) {
      event.preventDefault();
      this.#focusItem(step);
    } else if (event.key === "Tab") {
      // The focus moves on as Tab would have moved it anyway.
      this.#show(false);
    }
  }

  // Focus the first or last item that can act, or the one `step` (1 or -1)
  // from the focused one, wrapping round; from none, Down is the first and
  // Up the last.
  #focusItem(step) {
    const items = [...this.#panel.querySelectorAll(Popover.ITEM)].filter((item) => !item.disabled);
    if (items.length === 0) return;
    const from = items.indexOf(document.activeElement);
    let i;
    if (step === "first" || (step === 1 && from < 0)) i = 0;
    else if (step === "last" || from < 0) i = items.length - 1;
    else i = (from + step + items.length) % items.length;
    items[i].focus();
  }
}

/**
 * A button and the popup it opens: the Program tab's File menu, the
 * simulator's settings, and the page's Options. While it is open its button
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
    if (menu) {
      // After the item's own click has done its action.
      panel.addEventListener("click", (event) => {
        const item = event.target.closest(Popover.ITEM);
        if (item && !item.disabled) this.#close();
      });
    }
    document.addEventListener("pointerdown", (event) => {
      if (panel.hidden || panel.contains(event.target) || button.contains(event.target)) return;
      this.#show(false);
    });
  }

  #show(open) {
    this.#panel.hidden = !open;
    this.#button.setAttribute("aria-expanded", String(open));
  }

  // One popup open at a time: opening one closes any other. It scrolls into
  // view, clear of anything its stylesheet's scroll margins keep it from (the
  // Stop bar on a phone). A menu takes the focus to the item `at` ("first"
  // or "last"); any other popup leaves it on the button.
  #open(at) {
    if (Popover.#current && Popover.#current !== this) Popover.#current.#show(false);
    Popover.#current = this;
    this.#show(true);
    this.#panel.scrollIntoView({ block: "nearest" });
    if (this.#menu) this.#focusItem(at);
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

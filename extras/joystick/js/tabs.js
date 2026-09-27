/**
 * The panel's tabs: a WAI-ARIA tablist whose tabs each show one tabpanel.
 *
 *   new Tabs(tabs, { storageKey })
 *     tabs        the role="tab" elements, in order. Each names its panel
 *                 with aria-controls.
 *     storageKey  where the last tab chosen is remembered, or omitted.
 *
 *   select(tab, { focus })  show tab's panel and hide the others.
 *   selected                the selected tab element.
 *   onChange(fn)            fn(tab, panel) after the operator (or select())
 *                           shows another tab.
 *
 * A click selects a tab; with focus on the tablist, the arrow keys move to the
 * previous or next tab (wrapping round), Home and End to the first and last,
 * and selecting follows focus. Only the selected tab is in the Tab order.
 *
 * Switching tabs is not driving: it sends nothing and changes nothing held.
 * A control held while its tab is hidden stays held until it is let go, and
 * its release still arrives: joy.js listens for it on the document, and a
 * touch keeps delivering to the element it started on.
 */
class Tabs {
  #tabs;
  #storageKey;
  #selected = null;
  #listeners = new Listeners();

  constructor(tabs, { storageKey } = {}) {
    this.#tabs = tabs;
    this.#storageKey = storageKey;

    tabs.forEach((tab, i) => {
      tab.addEventListener("click", () => this.select(tab));
      tab.addEventListener("keydown", (event) => {
        const last = tabs.length - 1;
        const to = {
          ArrowRight: i === last ? 0 : i + 1,
          ArrowLeft: i === 0 ? last : i - 1,
          Home: 0,
          End: last,
        }[event.key];
        if (to === undefined) return;
        event.preventDefault(); // Home and End would scroll the page
        this.select(tabs[to], { focus: true });
      });
    });

    const remembered = storageKey && tabs.find((tab) => tab.id === memory.recall(storageKey));
    const marked = tabs.find((tab) => tab.getAttribute("aria-selected") === "true");
    this.#show(remembered || marked || tabs[0]);
  }

  get selected() {
    return this.#selected;
  }

  onChange(fn) {
    this.#listeners.add(fn);
  }

  select(tab, { focus = false } = {}) {
    if (!this.#tabs.includes(tab)) throw new RangeError("not one of these tabs");
    if (focus) tab.focus();
    if (tab === this.#selected) return;
    this.#show(tab);
    if (this.#storageKey) memory.remember(this.#storageKey, tab.id);
    this.#listeners.emit(tab, Tabs.#panelOf(tab));
  }

  #show(selected) {
    this.#selected = selected;
    for (const tab of this.#tabs) {
      const on = tab === selected;
      tab.setAttribute("aria-selected", String(on));
      tab.setAttribute("tabindex", on ? "0" : "-1");
      Tabs.#panelOf(tab).hidden = !on;
    }
  }

  static #panelOf(tab) {
    return document.getElementById(tab.getAttribute("aria-controls"));
  }
}

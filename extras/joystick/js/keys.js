/**
 * The keyboard: client/drive.py's keys, on the panel.
 *
 *   W S    forward, back               Q E    rotate left, right
 *   A D    strafe left, right          - +    speed down, up
 *   Space  Stop                        T      Autonomous
 *
 * A drive key is held as a rotate button is (Driver.holdKey): it drives from
 * its keydown to its keyup, at the slider's speed, re-sent meanwhile, and the
 * rotate button or key pressed last wins. It is held by where it is on the
 * keyboard (event.code), not by what it types, which its keyup may not: on
 * Linux AltGr, which sets no Ctrl or Alt there, turned a held E's keyup into
 * "€", and a layout switched mid-hold turned a held W's into "ц", and the key
 * drove on. One move at a time, as in
 * drive.py: W and D together strafe right, the key pressed last; the stick
 * has the diagonals. The keyboard's own repeats are not presses, so a key the
 * panel let go of (blur, Stop, a modifier) drives again only from a fresh
 * press. - and + step the slider by SPEED_STEP, as drive.py steps its speed,
 * and _ and = do too, unshifted. The drive and speed keys act while the
 * Drive tab shows, where what they drive is in view; Space and T press the
 * Stop and Autonomous buttons, so they do exactly what those do, on either
 * tab.
 *
 *   new Keyboard({ driver, speed, stop, auto, driveTab, dialog, legend })
 *     driver      the Driver;
 *     speed       the speed slider;
 *     stop, auto  the Stop and Autonomous buttons;
 *     driveTab    the Drive tab's panel;
 *     dialog      the page's <dialog>: while it is open, every key is its;
 *     legend      an empty element, Options', that the keys are listed in.
 *
 * Where a keydown is not the panel's:
 *   - in a text field, a select, or anything editable: typing is typing;
 *   - in a <dialog>: the page's own, and Blockly's alert and prompt for a
 *     variable's name, which it adds to the page;
 *   - in anything marked data-keys="own": the File menu, Options and the
 *     simulator's settings, which take the arrows and Space, and the block
 *     editor;
 *   - in Blockly's own pop-ups, which it adds to the page outside the editor;
 *   - with Ctrl, Alt or Cmd held: a shortcut;
 *   - while the dialog is open;
 *   - when something on the page has already acted on it: the simulator's
 *     rover, focused, turns on Q and E and moves on the arrows, and W, A, S,
 *     D, Space and T still drive, so that dragging it into place leaves the
 *     keys working.
 * The speed slider and the tabs are the panel's: neither takes a letter or
 * Space, and both take the focus when pressed, which would have left the
 * keys dead after every change of speed or tab. A keyup always counts,
 * wherever the focus has gone: a key that drives stops when it is let go.
 *
 * Where the panel takes Space, its keydown and keyup are both cancelled: a
 * focused button (Autonomous, Run, Connect) would otherwise be clicked on
 * the keyup too, after Stop, and the page would scroll on the keydown.
 *
 * Ctrl, Alt or Cmd going down lets go of every held key: macOS sends no
 * keyup for a key released while Cmd is held, and the key would have driven
 * on until the tab lost the focus. So does a context menu opening, which
 * takes the keyboard, and with it the keyup, without blurring the page; the
 * sticks and rotate buttons suppress theirs (Driver), and leave the keys be.
 */
class Keyboard {
  // The drive keys, as drive.py's KEYS has them (test/keys.test.js reads
  // that file to check).
  static DRIVE = Object.freeze({
    w: MOVE_FORWARD,
    s: MOVE_BACKWARD,
    a: MOVE_LEFT,
    d: MOVE_RIGHT,
    q: ROTATE_COUNTERCLOCKWISE,
    e: ROTATE_CLOCKWISE,
  });
  static SLOWER = Object.freeze(["-", "_"]);
  static FASTER = Object.freeze(["+", "="]);
  // drive.py's step: two of the slider's.
  static SPEED_STEP = 16;

  // Options' list: the keys as printed on them, and what they do.
  static LEGEND = Object.freeze([
    Object.freeze({ keys: ["W", "S"], does: "Forward, back" }),
    Object.freeze({ keys: ["A", "D"], does: "Strafe left, right" }),
    Object.freeze({ keys: ["Q", "E"], does: "Rotate left, right" }),
    Object.freeze({ keys: ["−", "+"], does: "Slower, faster" }),
    Object.freeze({ keys: ["Space"], does: "Stop" }),
    Object.freeze({ keys: ["T"], does: "Autonomous" }),
  ]);
  #ui;

  constructor({ driver, speed, stop, auto, driveTab, dialog, legend }) {
    this.#ui = { driver, speed, stop, auto, driveTab, dialog };
    Keyboard.#list(legend);
    // On the document, after the focused element's own listeners, so that
    // what the page's controls do with a key comes first.
    document.addEventListener("keydown", (event) => this.#down(event));
    document.addEventListener("keyup", (event) => this.#up(event));
    document.addEventListener("contextmenu", (event) => {
      if (!event.defaultPrevented) driver.releaseKeys();
    });
  }

  #down(event) {
    const { driver, speed, stop, auto, driveTab } = this.#ui;
    if (event.ctrlKey || event.altKey || event.metaKey) {
      driver.releaseKeys();
      return;
    }
    if (event.defaultPrevented || event.isComposing || !this.#ours(event)) return;
    const key = String(event.key).toLowerCase();
    if (key === " ") {
      event.preventDefault();
      if (!event.repeat) stop.click();
    } else if (key === "t") {
      if (!event.repeat) auto.click();
    } else if (driveTab.hidden) {
      // Nothing more off the Drive tab.
    } else if (key in Keyboard.DRIVE) {
      if (!event.repeat) driver.holdKey(Keyboard.#where(event), Keyboard.DRIVE[key]);
    } else if (Keyboard.SLOWER.includes(key) || Keyboard.FASTER.includes(key)) {
      const step = Keyboard.FASTER.includes(key) ? Keyboard.SPEED_STEP : -Keyboard.SPEED_STEP;
      const before = speed.value;
      // The slider keeps the value to its own steps and ends.
      speed.value = String(clamp(Number(before) + step, Number(speed.getAttribute("min")), Number(speed.getAttribute("max"))));
      // As dragging it reports a change: the readout and the Driver follow.
      if (speed.value !== before) speed.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }

  #up(event) {
    this.#ui.driver.releaseKey(Keyboard.#where(event));
    if (event.key === " " && this.#ours(event)) event.preventDefault();
  }

  // Which key it is on the keyboard; what it types where the browser does not
  // say (some on-screen keyboards).
  static #where(event) {
    return event.code || String(event.key).toLowerCase();
  }

  // Whether the key belongs to the panel, rather than to where the focus is.
  #ours(event) {
    if (this.#ui.dialog.open) return false;
    for (let n = event.target; n && n.getAttribute; n = n.parentNode) {
      const tag = n.tagName;
      if (tag === "SELECT" || tag === "TEXTAREA" || tag === "DIALOG") return false;
      if (tag === "INPUT" && n.getAttribute("type") !== "range") return false;
      if (n.isContentEditable || n.getAttribute("data-keys") === "own") return false;
      if (/\bblockly(?:WidgetDiv|DropDownDiv)\b/.test(n.getAttribute("class") || "")) return false;
    }
    return true;
  }

  static #list(legend) {
    for (const { keys, does } of Keyboard.LEGEND) {
      const row = dom.html("div", { class: "keysRow" }, legend);
      const dt = dom.html("dt", {}, row);
      for (const key of keys) dom.html("kbd", {}, dt, key);
      dom.html("dd", {}, row, does);
    }
  }
}

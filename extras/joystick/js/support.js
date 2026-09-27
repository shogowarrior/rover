/**
 * Two small helpers the panel's parts share: a list of event listeners, and
 * best-effort storage for what the panel remembers between visits.
 */

// The listeners for one event. Each runs in turn, and one that throws is
// reported without stopping the rest, or the part that raised the event: a
// broken listener for "the link is going down" must not keep the panel from
// stopping the rover and closing the socket.
class Listeners {
  #listeners = [];

  add(listener) {
    if (typeof listener !== "function") throw new TypeError("a listener must be a function");
    this.#listeners.push(listener);
  }

  emit(...args) {
    for (const listener of this.#listeners) {
      try {
        listener(...args);
      } catch (err) {
        // Shown in the console as an uncaught error would be, and carried on.
        if (typeof reportError === "function") reportError(err);
        else console.error(err);
      }
    }
  }
}

// Remembering the address and the last tab is a convenience. Where storage is
// blocked (file:// with site data disabled, a hardened profile) even reading
// `localStorage` throws, and that must not stop the panel loading or
// connecting.
const memory = Object.freeze({
  recall(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },

  remember(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {
      // Not remembered; nothing else depends on it.
    }
  },
});

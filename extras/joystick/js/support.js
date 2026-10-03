/**
 * What the panel's parts share:
 *
 *   Listeners       the listeners for one event
 *   reportFault     report an error without throwing it
 *   memory          best-effort storage for what the panel remembers
 *   clamp           a value kept within bounds
 *   abortableWait   a wait an AbortSignal ends at once
 *   isPrimaryPress  whether a press is the primary button alone
 */

// Reported as an uncaught error would be, where the page has reportError,
// and on the console otherwise (Node).
function reportFault(err) {
  if (typeof reportError === "function") reportError(err);
  else console.error(err);
}

// The listeners for one event. Each runs in turn, and one that throws is
// reported without stopping the rest, or the part that raised the event: a
// broken listener for "the link is going down" must not keep the panel from
// stopping the rover and closing the socket.
class Listeners {
  #listeners = [];

  // Returns a function that removes the listener again, for a listener that
  // lives only as long as something else (a running program, one wait).
  add(listener) {
    if (typeof listener !== "function") throw new TypeError("a listener must be a function");
    this.#listeners.push(listener);
    return () => {
      const i = this.#listeners.indexOf(listener);
      if (i >= 0) this.#listeners.splice(i, 1);
    };
  }

  emit(...args) {
    // A copy: a listener may remove itself, or another, as it runs.
    for (const listener of [...this.#listeners]) {
      try {
        listener(...args);
      } catch (err) {
        // Reported, and the rest still run.
        reportFault(err);
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

// value kept within lo..hi: the panel's kinematics::clampInt. NaN stays NaN.
function clamp(value, lo, hi) {
  return Math.min(hi, Math.max(lo, value));
}

// A wait that start(done) begins and that ends when start calls done(). If
// the signal aborts first, it rejects with the signal's reason and undoes the
// wait with cancel(handle): how a Stop ends a program's sleep at once.
function abortableWait(signal, start, cancel) {
  return new Promise((resolve, reject) => {
    if (signal && signal.aborted) {
      reject(signal.reason);
      return;
    }
    const onAbort = () => {
      cancel(handle);
      reject(signal.reason);
    };
    const handle = start(() => {
      if (signal) signal.removeEventListener("abort", onAbort);
      resolve();
    });
    if (signal) signal.addEventListener("abort", onAbort, { once: true });
  });
}

// A press is the primary button alone. Right-click, middle-click and a Mac's
// ctrl-click (which arrives as button 0 with ctrlKey set) are not: each can
// open a context menu, which takes the release with it and leaves the input
// held with nobody holding it.
function isPrimaryPress(event) {
  return event.button === 0 && !event.ctrlKey;
}

if (typeof module !== "undefined") module.exports = { Listeners, reportFault, memory, clamp, abortableWait };

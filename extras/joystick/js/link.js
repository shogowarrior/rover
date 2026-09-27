/**
 * The WebSocket link to the rover: connecting and disconnecting, knowing
 * whether telemetry still arrives, remembering the address, showing the link
 * state, and turning frames into telemetry objects.
 *
 *   new Link({ body, host, connect, linkState, note })
 *     body       gets data-link = the state, which the page's CSS keys on;
 *     host       the address field (host or host:port); Enter connects;
 *     connect    the Connect / Cancel / Disconnect button;
 *     linkState  the state's label; note: the status line.
 *
 *   send(obj)          serialise obj and send it as one frame. Returns false,
 *                      sending nothing, when no socket is open.
 *   onTelemetry(fn)    fn(data) once per telemetry frame: always a plain
 *                      object; a frame that is not one is dropped here.
 *   onState(fn)        fn(state, cause) on every change of state:
 *                        "down"        no socket;
 *                        "connecting"  a socket that has not opened yet;
 *                        "up"          open, and telemetry is arriving;
 *                        "stale"       open, but no telemetry for STALE_MS.
 *                      For "down", cause says why: "disconnect" when the panel
 *                      closed its own socket (Disconnect, Cancel, or a new
 *                      Connect replacing it), "linkLost" when the socket
 *                      closed under it or never opened. When the panel closes
 *                      its own socket, the listeners run before it is closed,
 *                      so a STOP sent from one still goes out on it.
 *   state              the current state, as above.
 *   note(text, tone)   show text in the status line; tone "bad" marks trouble.
 */
class Link {
  // Telemetry arrives every 500 ms (tuning::TELEMETRY_INTERVAL_MS). Miss
  // several and the link is not trustworthy even though the socket still
  // claims to be open.
  static STALE_MS = 1800;

  static LABEL = Object.freeze({ down: "No link", connecting: "Connecting", up: "Link", stale: "No data" });

  #ui;
  #state = null;
  // The one current socket. Every listener checks it first: a socket that has
  // been replaced or closed on purpose must not touch the page, or its late
  // 'close' would halt the new session and show the link as down.
  #socket = null;
  #staleTimer = null;
  #stateListeners = new Listeners();
  #telemetryListeners = new Listeners();

  constructor({ body, host, connect, linkState, note }) {
    this.#ui = { body, host, connect, linkState, note };

    connect.addEventListener("click", () => {
      if (this.#socket) this.disconnect();
      else this.connect();
    });
    host.addEventListener("keydown", (event) => {
      if (event.key === "Enter") this.connect();
    });

    host.value = memory.recall("rover.host") || host.value;
    this.#setState("down");
    this.note("Enter the rover's address and connect.");
  }

  get state() {
    return this.#state;
  }

  onState(fn) {
    this.#stateListeners.add(fn);
  }

  onTelemetry(fn) {
    this.#telemetryListeners.add(fn);
  }

  send(obj) {
    const ws = this.#socket;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify(obj));
    return true;
  }

  note(text, tone) {
    this.#ui.note.textContent = text;
    this.#ui.note.dataset.tone = tone || "";
  }

  connect() {
    const host = this.#ui.host.value.trim();
    if (!host) {
      this.note("Enter the rover's address first.", "bad");
      return;
    }
    memory.remember("rover.host", host);

    // One socket at a time. An old one left open would hold one of the rover's
    // five client slots, and pressing Enter or Connect again must replace the
    // link, not add to it.
    this.#dropSocket();

    const url = host.includes(":") ? `ws://${host}` : `ws://${host}:${PORT}`;
    let ws;
    try {
      ws = new WebSocket(url);
    } catch (err) {
      this.#setState("down", "linkLost");
      this.note(`Cannot open ${url}: ${err.message}`, "bad");
      return;
    }
    this.#socket = ws;
    let opened = false;
    this.#setState("connecting");
    this.note(`Connecting to ${url}`);

    ws.addEventListener("open", () => {
      if (ws !== this.#socket) return;
      opened = true;
      this.#markFresh(ws);
    });

    ws.addEventListener("message", (event) => {
      if (ws !== this.#socket) return;
      this.#markFresh(ws);
      this.#receive(event.data);
    });

    // 'error' carries no detail and is always followed by 'close', so only
    // 'close' is handled.
    ws.addEventListener("close", () => {
      if (ws !== this.#socket) return;
      this.#socket = null;
      clearTimeout(this.#staleTimer);
      // Nothing can reach the rover now. The listeners stop repeating; the
      // firmware stops the wheels itself when the client driving it
      // disconnects.
      this.#setState("down", "linkLost");
      this.note(
        opened
          ? `Lost the link to ${url}.`
          : `Not reachable at ${url}. Check the rover is powered and on this network.`,
        "bad",
      );
    });
  }

  disconnect() {
    this.#dropSocket();
    this.#setState("down", "disconnect");
    this.note("Disconnected.");
  }

  // The state is "down" exactly when there is no socket, so the button always
  // offers to get rid of one that exists -- including one still connecting to
  // a slow or wrong host.
  #setState(state, cause) {
    if (state === this.#state) return;
    this.#state = state;
    const { body, linkState, connect } = this.#ui;
    body.dataset.link = state;
    linkState.textContent = Link.LABEL[state];
    connect.textContent =
      state === "down" ? "Connect" : state === "connecting" ? "Cancel" : "Disconnect";
    this.#stateListeners.emit(state, cause);
  }

  // Close the current socket, open or still connecting. The state goes down
  // first, while the socket can still carry a STOP for whatever this panel is
  // driving; only then is the socket forgotten and closed.
  #dropSocket() {
    const ws = this.#socket;
    if (!ws) return;
    this.#setState("down", "disconnect");
    this.#socket = null; // before close(): its 'close' event is now stale and ignored
    clearTimeout(this.#staleTimer);
    ws.close();
  }

  #markFresh(ws) {
    clearTimeout(this.#staleTimer);
    if (this.#state !== "up") {
      this.#setState("up");
      this.note("");
    }
    this.#staleTimer = setTimeout(() => {
      // A timer armed by an earlier socket must not relabel a newer one, and a
      // link that has closed is already shown as down.
      if (ws !== this.#socket || ws.readyState !== WebSocket.OPEN) return;
      this.#setState("stale");
      this.note("Telemetry stopped. The rover may have rebooted.");
    }, Link.STALE_MS);
  }

  #receive(raw) {
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      return;
    }
    // Telemetry is always a JSON object. An array is an object to typeof, and
    // read as one it blanked every wedge and cleared the motor warning.
    if (!data || typeof data !== "object" || Array.isArray(data)) return;
    this.#telemetryListeners.emit(data);
  }
}

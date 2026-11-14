/**
 * The WebSocket link to the rover: connecting and disconnecting, knowing
 * whether telemetry still arrives, remembering the address, showing the link
 * state, and turning frames into telemetry objects and the rover's word about
 * a firmware update.
 *
 *   new Link({ body, host, connect, chip, linkState, linkHost, note, storageKey })
 *     body        gets data-link = the state, which the page's CSS keys on;
 *     host        the address field (host or host:port), in the link
 *                 popover; Enter connects, and leaves the field, so the
 *                 keyboard's Space and T (keys.js) stop and explore rather
 *                 than type into it;
 *     connect     the Connect / Cancel / Disconnect button beside it, titled
 *                 with what a press does;
 *     chip        the link chip in the top's first cell, which opens the
 *                 popover: it gets data-say = the word it shows ("down",
 *                 "lost", "connecting", "up", "stale"), and is titled with
 *                 the state and the address in full, since a narrow cell
 *                 shows its lamp alone;
 *     linkState   the state's word, in it; linkHost: the address, in it (a
 *                 wide screen shows it);
 *     note        the status line, in the popover;
 *     storageKey  where the address is remembered.
 *
 *   send(obj)          serialise obj and send it as one frame. Returns false,
 *                      sending nothing, when no socket is open.
 *   sendBinary(bytes)  send bytes (a view of them, such as a Uint8Array) as
 *                      one binary frame, as they are. Returns false, sending
 *                      nothing, when no socket is open.
 *   onTelemetry(fn)    fn(data) once per telemetry frame: always a plain
 *                      object; a frame that is not one is dropped here.
 *   onOta(fn)          fn(message) for each message about a firmware update
 *                      (firmware.js): an object whose "ota" is a string. It
 *                      never reaches onTelemetry, where one blanked the scan,
 *                      hid the motor warning and forgot the scheme.
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
 *   note(text, tone)   show text in the status line, and as its title; tone
 *                      "bad" marks trouble.
 */
class Link {
  // Telemetry arrives every TELEMETRY_MS (protocol.js). Three intervals with
  // no frame, plus slack for one arriving late, and the link is not
  // trustworthy even though the socket still claims to be open. Derived, so
  // a change to the firmware's interval cannot leave it under two frames.
  static STALE_MS = 3 * TELEMETRY_MS + 300;

  // The chip's word for each state: "down" splits into the link never made
  // or put down by the panel, and the link lost under it.
  static LABEL = Object.freeze({
    down: "Not connected",
    lost: "Link lost",
    connecting: "Connecting…",
    up: "Connected",
    stale: "No data",
  });
  static TITLE = Object.freeze({
    down: (address) => `Not connected to the rover (${address}). Press for the address and Connect.`,
    lost: (address) => `Link lost: the rover at ${address} stopped answering. Press for the address and Connect.`,
    connecting: (address) => `Connecting to the rover at ${address}.`,
    up: (address) => `Connected to the rover at ${address}: its telemetry is arriving.`,
    stale: (address) => `No data: the rover at ${address} has stopped sending telemetry.`,
  });
  // What a press of the Connect button does, in each state.
  static CONNECT_TITLE = Object.freeze({
    down: "Connect to the rover at this address (Enter in the address does too).",
    connecting: "Cancel: stop trying to reach the rover.",
    up: "Disconnect: close the link to the rover, stopping what this panel drives on it. A rover exploring keeps exploring: press Stop for that.",
    stale: "Disconnect: close the link to the rover, stopping what this panel drives on it. A rover exploring keeps exploring: press Stop for that.",
  });

  #ui;
  #storageKey;
  #state = null;
  #address = ""; // the address the chip names: the last connected to, or the field's
  // The one current socket. Every listener checks it first: a socket that has
  // been replaced or closed on purpose must not touch the page, or its late
  // 'close' would halt the new session and show the link as down.
  #socket = null;
  #staleTimer = null;
  #stateListeners = new Listeners();
  #telemetryListeners = new Listeners();
  #otaListeners = new Listeners();

  constructor({ body, host, connect, chip, linkState, linkHost, note, storageKey }) {
    this.#ui = { body, host, connect, chip, linkState, linkHost, note };
    this.#storageKey = storageKey;

    connect.addEventListener("click", () => {
      if (this.#socket) this.disconnect();
      else this.connect();
    });
    host.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      this.connect();
      host.blur();
    });

    host.value = memory.recall(storageKey) || host.value;
    this.#name(host.value.trim());
    this.#setState("down");
    this.note("Enter the rover's address and connect.");
  }

  get state() {
    return this.#state;
  }

  onState(fn) {
    return this.#stateListeners.add(fn);
  }

  onTelemetry(fn) {
    return this.#telemetryListeners.add(fn);
  }

  onOta(fn) {
    return this.#otaListeners.add(fn);
  }

  send(obj) {
    const ws = this.#socket;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify(obj));
    return true;
  }

  sendBinary(bytes) {
    const ws = this.#socket;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    ws.send(bytes);
    return true;
  }

  // The whole note is its title too: a wide screen's header cuts it short.
  note(text, tone) {
    this.#ui.note.textContent = text;
    this.#ui.note.title = text;
    this.#ui.note.dataset.tone = tone || "";
  }

  connect() {
    const host = this.#ui.host.value.trim();
    if (!host) {
      this.note("Enter the rover's address first.", "bad");
      return;
    }
    memory.remember(this.#storageKey, host);
    this.#name(host);

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

  // #dropSocket() takes the link down, cause "disconnect", while there is a
  // socket to drop; with none, the link is down already.
  disconnect() {
    this.#dropSocket();
    this.note("Disconnected.");
  }

  // The state is "down" exactly when there is no socket, so the button always
  // offers to get rid of one that exists -- including one still connecting to
  // a slow or wrong host. The chip says "Link lost" for a link that went down
  // under the panel, and "Not connected" otherwise.
  #setState(state, cause) {
    if (state === this.#state) return;
    this.#state = state;
    const { body, connect } = this.#ui;
    body.dataset.link = state;
    this.#say(state === "down" && cause === "linkLost" ? "lost" : state);
    connect.textContent =
      state === "down" ? "Connect" : state === "connecting" ? "Cancel" : "Disconnect";
    connect.title = Link.CONNECT_TITLE[state];
    this.#stateListeners.emit(state, cause);
  }

  // The chip: its word, data-say for its colour, and the whole of it, with
  // the address, as its title.
  #say(said) {
    const { chip, linkState } = this.#ui;
    chip.dataset.say = said;
    linkState.textContent = Link.LABEL[said];
    chip.title = Link.TITLE[said](this.#address || "no address yet");
  }

  // The address the chip names, where the top has room (panel.css) and in
  // its title: the one connected to, or about to be.
  #name(address) {
    this.#address = address;
    this.#ui.linkHost.textContent = address;
    if (this.#ui.chip.dataset.say) this.#say(this.#ui.chip.dataset.say);
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
    let message;
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }
    // Telemetry is always a JSON object. An array is an object to typeof, and
    // read as one it blanked every wedge and cleared the motor warning.
    if (!message || typeof message !== "object" || Array.isArray(message)) return;
    // The rover's answers to this panel's firmware update, which carry none
    // of telemetry's keys.
    if (typeof message.ota === "string") this.#otaListeners.emit(message);
    else this.#telemetryListeners.emit(message);
  }
}

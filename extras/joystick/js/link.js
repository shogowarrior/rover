/**
 * The WebSocket link to the rover: connecting and disconnecting, knowing
 * whether telemetry still arrives, remembering the address, showing the link
 * state, and telling the rover's frames apart by their key: telemetry, a
 * line of its log, its metrics, its settings, and its word about a firmware
 * update. Only telemetry says the link is live: the other frames come at
 * other paces (the log's lines in a burst as the link opens, the metrics
 * every 2 s, the settings as they change), and a rover that sent them but
 * no telemetry would have kept a dead scan looking fresh.
 *
 *   new Link({ body, host, connect, chip, linkState, note, proxy, cardTitle, cardHost, storageKey })
 *     body        gets data-link = the state, which the page's CSS keys on;
 *     host        the address field (host or host:port), in the link
 *                 popover; Enter connects, and leaves the field, so the
 *                 keyboard's Space and T (keys.js) stop and explore rather
 *                 than type into it;
 *     connect     the Connect / Cancel / Disconnect button beside it, titled
 *                 with what a press does;
 *     chip        the link chip in the top's first cell, which opens the
 *                 popover: it gets data-say = the word it shows ("down",
 *                 "lost", "unreachable", "connecting", "up", "stale"),
 *                 data-host and --host = the address it names (a CSS
 *                 string, which a wide screen draws after its word,
 *                 panel.css), and is titled with the state and the address
 *                 in full, since a narrow cell shows its lamp alone;
 *     linkState   the state's word, in it: one word for each state, the
 *                 same at every width (the critic's round 3: "Connect" and
 *                 "Linking…" on a phone said other things than the words
 *                 elsewhere). Beside it Link puts a sizer for each word,
 *                 out of sight, so its slot is as wide as the longest;
 *     note        the status line, in the popover;
 *     proxy       the connect card's button, in the view pane while there
 *                 is no link: a press of it is a press of connect. It says
 *                 what that press does, and to which address: "Connect
 *                 to" it, "Cancel" while connecting, "Reconnect to" it
 *                 after a lost link, and "Try" it "again" after a rover
 *                 that was never reached; "Connect to" once the address is
 *                 not the one that went (the reviewers' round 2: "Reconnect"
 *                 alone went to an address typed since, unseen). Its
 *                 data-full holds those words, and its data-verb the verb
 *                 alone ("Connect", "Reconnect", "Try again", "Cancel"),
 *                 for a card too narrow for both, which then names the
 *                 address on a line of its own (app.js, fitConnect());
 *     cardTitle   the connect card's title: the link's state, as the chip
 *                 says it, and the address while connecting;
 *     cardHost    that line on the card: the address, as the button
 *                 names it;
 *     storageKey  where the address is remembered.
 *
 *   With no socket the chip and the card name the address in the field, as
 *   Connect would use it: typed, or as it was when a link went. While there
 *   is one, the address it went to.
 *
 *   send(obj)          serialise obj and send it as one frame. Returns false,
 *                      sending nothing, when no socket is open.
 *   sendBinary(bytes)  send bytes (a view of them, such as a Uint8Array) as
 *                      one binary frame, as they are. Returns false, sending
 *                      nothing, when no socket is open.
 *   onTelemetry(fn)    fn(data) once per telemetry frame: always a plain
 *                      object; a frame that is not one is dropped here.
 *                      Telemetry is any object that is none of the frames
 *                      below; only it (and an update's reply) keeps the
 *                      link from going stale.
 *   onOta(fn)          fn(message) for each message about a firmware update
 *                      (firmware.js): an object whose "ota" is a string. It
 *                      never reaches onTelemetry, where one blanked the scan,
 *                      hid the motor warning and forgot the scheme.
 *   onLog(fn)          fn(frame) for each line of the rover's event log:
 *                      an object whose "log" is a string, with "seq", "t",
 *                      "src" and "warn" (src/Protocol.h). A link that opens
 *                      is sent every line the rover still holds first.
 *   onMetrics(fn)      fn(frame) for each of the rover's metrics frames: an
 *                      object whose "metrics" is an object.
 *   onSettings(fn)     fn(frame) for each of the rover's settings frames: an
 *                      object whose "settings" is an object, holding every
 *                      setting. Sent as a link opens, and as they change.
 *                      None of these three reaches onTelemetry: a line read
 *                      as telemetry blanked the scan and the readouts and
 *                      made the mode unknown, since none has "mode".
 *   onSay(fn)          fn(said) whenever the chip is said again: its word
 *                      ("down", "lost", "unreachable", "connecting", "up" or
 *                      "stale", as data-say) or the address it names, which
 *                      can change while the state does not (a Connect to an
 *                      address that cannot be opened at all stays down,
 *                      "Not reachable"). The chip's title is Link's again
 *                      then: what app.js puts before it goes back on here
 *                      (the reviewers' round 2: the alerts' words were lost
 *                      from it until the next frame).
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
 *   title              the chip's own title, as the link has it: its state
 *                      and the address, in full (app.js puts what needs the
 *                      operator before it).
 *   note(text, tone)   show text in the status line, and as its title; tone
 *                      "bad" marks trouble.
 */
class Link {
  // Telemetry arrives every TELEMETRY_MS (protocol.js). Three intervals with
  // no frame, plus slack for one arriving late, and the link is not
  // trustworthy even though the socket still claims to be open. Derived, so
  // a change to the firmware's interval cannot leave it under two frames.
  static STALE_MS = 3 * TELEMETRY_MS + 300;

  // The chip's word for each state, at every width: "down" splits into the
  // link never made or put down by the panel, the link lost under it, and
  // a rover that never answered at all (link.js's close, before 'open').
  static LABEL = Object.freeze({
    down: "Not connected",
    lost: "Link lost",
    unreachable: "Not reachable",
    connecting: "Connecting…",
    up: "Connected",
    stale: "No data",
  });
  static TITLE = Object.freeze({
    down: (address) => `Not connected to the rover (${address}). Press for the address and Connect.`,
    lost: (address) => `Link lost: the rover at ${address} stopped answering. Press for the address and Connect.`,
    unreachable: (address) => `Not reachable: no rover answered at ${address}. Check it is powered and on this network. Press for the address and Connect.`,
    connecting: (address) => `Connecting to the rover at ${address}.`,
    up: (address) => `Connected to the rover at ${address}: its telemetry is arriving.`,
    stale: (address) => `No data: the rover at ${address} has stopped sending telemetry.`,
  });
  // The connect card's title: the chip's word, and while connecting the
  // address being tried (the critics' round 3: "No rover connected" over
  // Cancel said nothing of what was going on).
  static CARD = Object.freeze({
    down: () => Link.LABEL.down,
    lost: () => Link.LABEL.lost,
    unreachable: () => Link.LABEL.unreachable,
    connecting: (address) => (address ? `Connecting to ${address}…` : Link.LABEL.connecting),
    up: () => Link.LABEL.up,
    stale: () => Link.LABEL.stale,
  });
  // The connect card's button, in each state but up and stale, where the
  // card is not shown: what a press does, and where. "lost" and
  // "unreachable" are "down" after a link that went under the panel, or
  // never came: again to the address that went, or to another typed
  // since, which is a Connect like any other. PROXY_VERB is the verb
  // alone, for a card too narrow for the address beside it.
  static PROXY = Object.freeze({
    down: (address) => address ? `Connect to ${address}` : "Connect",
    lost: (address, again) => (again ? `Reconnect to ${address}` : Link.PROXY.down(address)),
    unreachable: (address, again) => (again ? `Try ${address} again` : Link.PROXY.down(address)),
    connecting: () => "Cancel",
    up: () => "Disconnect",
    stale: () => "Disconnect",
  });
  static PROXY_VERB = Object.freeze({
    down: () => "Connect",
    lost: (again) => (again ? "Reconnect" : "Connect"),
    unreachable: (again) => (again ? "Try again" : "Connect"),
    connecting: () => "Cancel",
    up: () => "Disconnect",
    stale: () => "Disconnect",
  });
  static PROXY_TITLE = Object.freeze({
    down: (address) => `Connect to the rover at ${address || "the address in the link's popover"}.`,
    lost: (address, again) => (again ? `Reconnect: try the rover at ${address} again.` : Link.PROXY_TITLE.down(address)),
    unreachable: (address, again) => (again ? `Try again: connect to the rover at ${address}.` : Link.PROXY_TITLE.down(address)),
    connecting: () => Link.CONNECT_TITLE.connecting,
    up: () => Link.CONNECT_TITLE.up,
    stale: () => Link.CONNECT_TITLE.stale,
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
  #said = "down"; // the chip's word: the state, "down" split three ways
  #address = ""; // the address the chip names: the one a socket went to, or the field's
  #wentTo = null; // the address the last socket went to, or null
  // The one current socket. Every listener checks it first: a socket that has
  // been replaced or closed on purpose must not touch the page, or its late
  // 'close' would halt the new session and show the link as down.
  #socket = null;
  #staleTimer = null;
  #stateListeners = new Listeners();
  #sayListeners = new Listeners();
  #telemetryListeners = new Listeners();
  #otaListeners = new Listeners();
  #logListeners = new Listeners();
  #metricsListeners = new Listeners();
  #settingsListeners = new Listeners();

  constructor({ body, host, connect, chip, linkState, note, proxy, cardTitle, cardHost, storageKey }) {
    this.#ui = { body, host, connect, chip, linkState, note, proxy, cardTitle, cardHost };
    this.#storageKey = storageKey;

    // The word's slot as wide as its longest word: a sizer for each, out of
    // sight and out of the reading order, under the word (panel.css).
    for (const word of new Set(Object.values(Link.LABEL))) {
      dom.html("span", { class: "chipSizer", "aria-hidden": "true" }, linkState.parentNode, word);
    }

    // The card's button does what Connect does, whatever that is now, and
    // names the address Connect would use: the field's, while there is no
    // socket to name.
    proxy.addEventListener("click", () => connect.click());
    host.addEventListener("input", () => {
      if (!this.#socket) this.#name(host.value.trim());
    });

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

  get title() {
    return Link.TITLE[this.#said](this.#address || "no address yet");
  }

  onState(fn) {
    return this.#stateListeners.add(fn);
  }

  onSay(fn) {
    return this.#sayListeners.add(fn);
  }

  onTelemetry(fn) {
    return this.#telemetryListeners.add(fn);
  }

  onOta(fn) {
    return this.#otaListeners.add(fn);
  }

  onLog(fn) {
    return this.#logListeners.add(fn);
  }

  onMetrics(fn) {
    return this.#metricsListeners.add(fn);
  }

  onSettings(fn) {
    return this.#settingsListeners.add(fn);
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
    this.#wentTo = host;
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
      this.#setState("down", "linkLost", "unreachable");
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
      if (this.#receive(event.data)) this.#markFresh(ws);
    });

    // 'error' carries no detail and is always followed by 'close', so only
    // 'close' is handled.
    ws.addEventListener("close", () => {
      if (ws !== this.#socket) return;
      this.#socket = null;
      clearTimeout(this.#staleTimer);
      // With no socket, the chip and the card name the field's address,
      // which a press of Connect will use: edited while the link was up, it
      // was the old one they named (the critics' round 3).
      this.#name(this.#ui.host.value.trim());
      // Nothing can reach the rover now. The listeners stop repeating; the
      // firmware stops the wheels itself when the client driving it
      // disconnects. The cause is "linkLost" either way, for them; the chip
      // tells a link that went from a rover that never answered, which it
      // called "Link lost" too (the critics' round 3).
      this.#setState("down", "linkLost", opened ? "lost" : "unreachable");
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
  // a slow or wrong host. The chip says what `said` names: "Link lost" for a
  // link that went down under the panel, "Not reachable" for one that never
  // opened, and "Not connected" otherwise. Said again even where the state
  // stays down (a Connect whose address cannot be opened at all), but the
  // listeners hear only a change of state.
  #setState(state, cause, said = state) {
    const changed = state !== this.#state;
    this.#state = state;
    this.#say(said);
    if (!changed) return;
    const { body, connect } = this.#ui;
    body.dataset.link = state;
    connect.textContent =
      state === "down" ? "Connect" : state === "connecting" ? "Cancel" : "Disconnect";
    connect.title = Link.CONNECT_TITLE[state];
    this.#stateListeners.emit(state, cause);
  }

  // The chip: its word, data-say for its colour, and the whole of it, with
  // the address, as its title. The connect card's title and button with it.
  #say(said) {
    const { chip, linkState, proxy, cardTitle, cardHost } = this.#ui;
    const again = this.#address === this.#wentTo;
    this.#said = said;
    chip.dataset.say = said;
    linkState.textContent = Link.LABEL[said];
    chip.title = this.title;
    proxy.dataset.full = Link.PROXY[said](this.#address, again);
    proxy.dataset.verb = Link.PROXY_VERB[said](again);
    proxy.textContent = proxy.dataset.full;
    proxy.title = Link.PROXY_TITLE[said](this.#address, again);
    cardTitle.textContent = Link.CARD[said](this.#address);
    if (cardHost) cardHost.textContent = this.#address;
    this.#sayListeners.emit(said);
  }

  // The address the chip names, where the top has room (panel.css) and in
  // its title: the one connected to, or about to be. As a CSS string, which
  // the chip draws right after its word, whichever it shows, and in its
  // sizer, so it is as wide whatever it says with the address too, and the
  // address 8 px after the word rather than after the longest word's room
  // (the critic's round 1). JSON's escapes of a quote and a backslash are
  // CSS's too.
  #name(address) {
    this.#address = address;
    this.#ui.chip.dataset.host = address;
    this.#ui.chip.style.setProperty("--host", JSON.stringify(address));
    if (this.#state !== null) this.#say(this.#said);
  }

  // Close the current socket, open or still connecting. The state goes down
  // first, while the socket can still carry a STOP for whatever this panel is
  // driving; only then is the socket forgotten and closed.
  #dropSocket() {
    const ws = this.#socket;
    if (!ws) return;
    this.#name(this.#ui.host.value.trim());
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

  // Hands a frame to its listeners, by its key. Returns whether it says the
  // link is live: telemetry, or the rover's answer to an update, which may
  // be all it sends while it writes flash.
  #receive(raw) {
    let message;
    try {
      message = JSON.parse(raw);
    } catch {
      return false;
    }
    // Telemetry is always a JSON object. An array is an object to typeof, and
    // read as one it blanked every wedge and cleared the motor warning.
    if (!Link.#isObject(message)) return false;
    // The rover's answers to this panel's firmware update, its log, its
    // metrics and its settings, which carry none of telemetry's keys.
    if (typeof message.ota === "string") {
      this.#otaListeners.emit(message);
      return true;
    }
    if (typeof message.log === "string") this.#logListeners.emit(message);
    else if (Link.#isObject(message.metrics)) this.#metricsListeners.emit(message);
    else if (Link.#isObject(message.settings)) this.#settingsListeners.emit(message);
    else {
      this.#telemetryListeners.emit(message);
      return true;
    }
    return false;
  }

  static #isObject(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }
}

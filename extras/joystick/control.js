/**
 * Wires the joystick UI to the rover's WebSocket.
 *
 * Open joystick.html directly in a browser -- the rover cannot serve it.
 * partition.csv allocates the whole flash to nvs, otadata and two OTA app
 * slots, leaving no SPIFFS/LittleFS partition to hold web assets.
 *
 * The wire format is in src/Protocol.h. One rule shapes most of this file:
 * any command, STOP included, takes the rover out of autonomous mode. So the
 * panel sends only when the operator does something, or to stop a motion it
 * is itself driving -- never just because the window lost focus or a mouse
 * passed over a button while the rover was exploring on its own.
 */

/* --- constants mirrored from the firmware -------------------------------- */

// tools/check_protocol.py compares each `const NAME = <number>;` line in this
// section with its source in src/ and fails CI when one drifts, so keep that
// exact form.

// Move codes: the wire protocol. Source: src/MoveCodes.h.
const STOP = 0;
const MOVE_FORWARD = 1;
const MOVE_BACKWARD = 2;
const MOVE_RIGHT = 3;
const MOVE_LEFT = 4;
const MOVE_DIAGONAL45 = 5;
const MOVE_DIAGONAL135 = 6;
const MOVE_DIAGONAL225 = 7;
const MOVE_DIAGONAL315 = 8;
const ROTATE_CLOCKWISE = 17;
const ROTATE_COUNTERCLOCKWISE = 18;
const RESUME_AUTONOMOUS = 19;

// tuning::WEBSOCKET_PORT in src/Tuning.h. The address field also accepts
// "host:port", so the panel can be pointed at a stand-in during development.
const PORT = 81;

// tuning::EXPLORE_STOP_CM and tuning::EXPLORE_GO_CM in src/Tuning.h.
// Exploration ends a cruise when something in its path is within STOP_CM and
// starts one only when the way is clear beyond GO_CM. The scan fan is ringed
// and coloured at the same two distances.
const STOP_CM = 25;
const GO_CM = 40;

// kinematics::DISTANCE_FAR_CM in src/Kinematics.h: what the rover reports
// when no echo came back. It is the absence of a measurement, not a distance.
const FAR_CM = 999;

/* --- panel timing -------------------------------------------------------- */

// Every command asks for MOVE_DURATION_MS of motion and a held input is re-sent
// REPEAT_MS after the last send, so each move is refreshed well before it
// expires, and letting go coasts to a stop within 400 ms instead of running
// on. There is no separate deadman timer: the firmware caps any one command at
// 1.5 s (tuning::COMMAND_DURATION_MAX_MS), and that cap is the deadman for
// every client. If this page dies mid-drive, its last 400 ms move simply runs
// out.
const MOVE_DURATION_MS = 400;
const REPEAT_MS = 200;

// A dragged stick reports every animation frame. A new direction goes out at
// once; the same direction at a new speed no sooner than this after the last
// send, with the repeat carrying the latest speed otherwise. Each speed change
// costs the rover a rewrite of all four motors over I2C (~7 ms of the loop
// that also runs the sonar and this WebSocket), so one per frame would be
// felt. An unchanged repeat usually only moves the deadline: the firmware
// rewrites a held move just once per tuning::MOTOR_REFRESH_MS (500 ms), to
// repair a write the bus lost. The gamepad follows the same rule with
// tuning::GAMEPAD_SPEED_CHANGE_MS in src/Tuning.h; keep the two equal.
const STICK_SEND_MS = 100;

// Telemetry arrives every 500 ms. Miss several and the link is not trustworthy
// even though the socket still claims to be open.
const STALE_MS = 1800;

// Stick deflection, out of 100, below which the stick counts as centred.
const DEADZONE = 12;

const $ = (id) => document.getElementById(id);

const ui = {
  body: document.body,
  host: $("host"),
  connect: $("connect"),
  linkState: $("linkState"),
  speed: $("speed"),
  speedOut: $("speedOut"),
  mode: $("mode"),
  move: $("move"),
  phaseCell: $("phaseCell"),
  phase: $("phase"),
  temp: $("temp"),
  note: $("note"),
  motorsFault: $("motorsFault"),
  auto: $("auto"),
  stop: $("stop"),
  cw: $("cw"),
  ccw: $("ccw"),
  stick: $("stick"),
  scan: $("scan"),
};

// The one current socket. Every listener checks it first: a socket that has
// been replaced or closed on purpose must not touch the page, or its late
// 'close' would halt the new session and show the link as down.
let socket = null;
let staleTimer = null;
let repeatTimer = null;
let driving = null; // {move, speed} this panel is sending, or null
let lastSentAt = 0; // performance.now() of the last drive command sent

// What the operator is holding, per input. Tracked separately so that lifting
// one thumb never cancels what the other is still holding; steer() combines
// them into the one command to send.
const held = {
  stick: null, // {move, strength 0..1} while the stick is deflected
  stickArmed: false, // a primary press on the stick that nothing has cancelled
  rotate: [], // rotate buttons held, oldest first: {button, pointerId, move}
};

/* --- link ---------------------------------------------------------------- */

const LINK_LABEL = { down: "No link", connecting: "Connecting", up: "Link", stale: "No data" };

// The state is "down" exactly when there is no socket, so the button always
// offers to get rid of one that exists -- including one still connecting to a
// slow or wrong host.
function setLink(state) {
  ui.body.dataset.link = state;
  ui.linkState.textContent = LINK_LABEL[state];
  ui.connect.textContent =
    state === "down" ? "Connect" : state === "connecting" ? "Cancel" : "Disconnect";
}

function note(text, tone) {
  ui.note.textContent = text;
  ui.note.dataset.tone = tone || "";
}

function markFresh(ws) {
  clearTimeout(staleTimer);
  if (ui.body.dataset.link !== "up") {
    setLink("up");
    note("");
  }
  staleTimer = setTimeout(() => {
    // A timer armed by an earlier socket must not relabel a newer one, and a
    // link that has closed is already shown as down.
    if (ws !== socket || ws.readyState !== WebSocket.OPEN) return;
    setLink("stale");
    note("Telemetry stopped. The rover may have rebooted.");
  }, STALE_MS);
}

// Remembering the address is a convenience. Where storage is blocked (file://
// with site data disabled, a hardened profile) even reading `localStorage`
// throws, and that must not stop the panel connecting.
function recallHost() {
  try {
    return localStorage.getItem("rover.host");
  } catch {
    return null;
  }
}

function rememberHost(host) {
  try {
    localStorage.setItem("rover.host", host);
  } catch {
    // Not remembered; nothing else depends on it.
  }
}

function connect() {
  const host = ui.host.value.trim();
  if (!host) {
    note("Enter the rover's address first.", "bad");
    return;
  }
  rememberHost(host);

  // One socket at a time. An old one left open would hold one of the rover's
  // five client slots, and pressing Enter or Connect again must replace the
  // link, not add to it.
  dropSocket();

  const url = host.includes(":") ? `ws://${host}` : `ws://${host}:${PORT}`;
  let ws;
  try {
    ws = new WebSocket(url);
  } catch (err) {
    setLink("down");
    note(`Cannot open ${url}: ${err.message}`, "bad");
    return;
  }
  socket = ws;
  let opened = false;
  setLink("connecting");
  note(`Connecting to ${url}`);

  ws.addEventListener("open", () => {
    if (ws !== socket) return;
    opened = true;
    markFresh(ws);
  });

  ws.addEventListener("message", (event) => {
    if (ws !== socket) return;
    markFresh(ws);
    render(event.data);
  });

  // 'error' carries no detail and is always followed by 'close', so only
  // 'close' is handled.
  ws.addEventListener("close", () => {
    if (ws !== socket) return;
    socket = null;
    clearTimeout(staleTimer);
    // Nothing can reach the rover now, so stop repeating. The firmware stops
    // the wheels itself when the client driving it disconnects.
    standDown();
    showMotorsReady(undefined);
    setLink("down");
    note(
      opened
        ? `Lost the link to ${url}.`
        : `Not reachable at ${url}. Check the rover is powered and on this network.`,
      "bad",
    );
  });
}

// Close the current socket, open or still connecting. Whatever this panel is
// driving is stopped first, while the socket can still carry the STOP.
function dropSocket() {
  const ws = socket;
  if (!ws) return;
  standDown();
  socket = null; // before close(): its 'close' event is now stale and ignored
  clearTimeout(staleTimer);
  showMotorsReady(undefined);
  ws.close();
}

function disconnect() {
  dropSocket();
  setLink("down");
  note("Disconnected.");
}

/* --- sending ------------------------------------------------------------- */

function send(move, speed) {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify({ move, speed, duration: MOVE_DURATION_MS }));
}

// The command the held inputs call for, or null. A held rotate button wins
// over the stick, and the latest one pressed wins over an earlier one.
function wanted() {
  const limit = Number(ui.speed.value);
  const rotate = held.rotate[held.rotate.length - 1];
  if (rotate) return { move: rotate.move, speed: limit };
  if (held.stick) return { move: held.stick.move, speed: Math.round(held.stick.strength * limit) };
  return null;
}

// The one place that decides what to send, called whenever an input changes.
// With nothing held the rover stops -- but only if this panel was driving it.
function steer() {
  const next = wanted();
  if (!next) {
    if (driving) halt();
    return;
  }

  const changed = !driving || next.move !== driving.move || next.speed !== driving.speed;
  const turned = !driving || next.move !== driving.move;
  driving = next;
  if (turned || (changed && performance.now() - lastSentAt >= STICK_SEND_MS)) transmit();
}

// Send what is being driven and schedule its repeat. The repeat counts from
// this send, whatever caused it. A fixed-phase interval could tick a few
// milliseconds after a stick send and put a second speed on the wire -- two
// motor rewrites a frame apart, which is what STICK_SEND_MS exists to prevent.
function transmit() {
  if (!driving) return;
  send(driving.move, driving.speed);
  lastSentAt = performance.now();
  clearTimeout(repeatTimer);
  repeatTimer = setTimeout(transmit, REPEAT_MS);
}

function stopRepeating() {
  driving = null;
  clearTimeout(repeatTimer);
  repeatTimer = null;
}

// Stop the rover. This always sends STOP, which also ends autonomous mode, so
// only the Stop button and the end of a motion this panel drove call it.
function halt() {
  stopRepeating();
  send(STOP, 0);
}

// Forget every held input. Clearing held.stick is not enough on its own: joy.js
// still believes it is pressed until its own mouseup or touchend, and its next
// move report would rebuild held.stick. Disarming makes it wait for a new press.
function releaseInputs() {
  held.stick = null;
  held.stickArmed = false;
  for (const { button } of held.rotate) delete button.dataset.held;
  held.rotate = [];
}

// The operator's attention or the link has gone. Forget every held input, so
// nothing drives again without a fresh press, and stop what this panel is
// driving. An exploring rover is left alone: it is not ours to stop.
function standDown() {
  releaseInputs();
  if (driving) halt();
}

/* --- stick mapping ------------------------------------------------------- */

// Mecanum wheels can translate in any direction without turning, so the stick
// maps to eight sectors rather than the four a differential-drive robot would
// get. Sector boundaries sit halfway between headings.
function moveForAngle(degrees) {
  if (degrees >= 337.5 || degrees < 22.5) return MOVE_RIGHT;
  if (degrees < 67.5) return MOVE_DIAGONAL45;
  if (degrees < 112.5) return MOVE_FORWARD;
  if (degrees < 157.5) return MOVE_DIAGONAL135;
  if (degrees < 202.5) return MOVE_LEFT;
  if (degrees < 247.5) return MOVE_DIAGONAL225;
  if (degrees < 292.5) return MOVE_BACKWARD;
  return MOVE_DIAGONAL315;
}

// joy.js reports x and y as strings in -100..100, with y already inverted so
// that pushing up is positive. No sign correction needed here.
function onStick(status) {
  const x = Number(status.x);
  const y = Number(status.y);
  const magnitude = Math.min(100, Math.hypot(x, y));

  // An unarmed stick counts as centred, whatever joy.js reports.
  if (!held.stickArmed || magnitude < DEADZONE) {
    held.stick = null;
  } else {
    let angle = (Math.atan2(y, x) * 180) / Math.PI;
    if (angle < 0) angle += 360;
    held.stick = { move: moveForAngle(angle), strength: magnitude / 100 };
  }
  steer();
}

/* --- scan fan ------------------------------------------------------------ */

// The five bearings Explorer sweeps (ExploreParams in src/Explorer.h), in
// degrees from straight ahead, positive to the rover's left. On screen, up is
// ahead and the rover's left is the panel's left: screen angle = 90 + bearing.
const BEARINGS = [
  { key: "distanceLeft", label: "L", bearing: 70 },
  { key: "distanceFrontLeft", label: "FL", bearing: 35 },
  { key: "distanceFront", label: "F", bearing: 0 },
  { key: "distanceFrontRight", label: "FR", bearing: -35 },
  { key: "distanceRight", label: "R", bearing: -70 },
];

// Layout in the SVG's own units. Readings sit just beyond R_MAX; the strip
// below the rover holds the ring labels.
const VIEW_W = 420;
const VIEW_H = 200;
const CX = VIEW_W / 2; // the rover
const CY = VIEW_H - 20;
const R_MIN = 24; // wedges start clear of the rover's dot
const R_MAX = 140; // where RANGE_CM, and anything beyond it, reaches
const RANGE_CM = 200;
const HALF_WIDTH = 13; // degrees each side of a bearing, which are 35 apart
const FAN_HALF = Math.max(...BEARINGS.map((b) => Math.abs(b.bearing))) + HALF_WIDTH;

// Square-root scale, so the near range -- where the rover makes its decisions
// -- gets the room. A wall 20 cm away draws a 37-unit wedge instead of a
// 12-unit stub, and the STOP and GO rings sit well clear of the rover.
function radiusFor(cm) {
  return R_MIN + (R_MAX - R_MIN) * Math.sqrt(Math.min(1, Math.max(0, cm) / RANGE_CM));
}

function polar(screenDeg, r) {
  const rad = (screenDeg * Math.PI) / 180;
  return [CX + r * Math.cos(rad), CY - r * Math.sin(rad)];
}

const xy = ([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`;

// An annular sector from R_MIN out to r. The outer arc runs anticlockwise on
// screen (sweep flag 0) and the inner one back clockwise (1); the other way
// round bows the outer edge in toward the rover.
function wedgePath(screenDeg, r) {
  const a = polar(screenDeg - HALF_WIDTH, R_MIN);
  const b = polar(screenDeg + HALF_WIDTH, R_MIN);
  const c = polar(screenDeg + HALF_WIDTH, r);
  const d = polar(screenDeg - HALF_WIDTH, r);
  const R = r.toFixed(1);
  return `M${xy(a)} L${xy(d)} A${R} ${R} 0 0 0 ${xy(c)} ` +
    `L${xy(b)} A${R_MIN} ${R_MIN} 0 0 1 ${xy(a)} Z`;
}

// A range ring spans the fan, as the wedges do, rather than a full half circle.
function ringPath(r) {
  const R = r.toFixed(1);
  return `M${xy(polar(90 + FAN_HALF, r))} A${R} ${R} 0 0 1 ${xy(polar(90 - FAN_HALF, r))}`;
}

function svg(tag, attributes, text) {
  const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [name, value] of Object.entries(attributes)) el.setAttribute(name, String(value));
  if (text !== undefined) el.textContent = text;
  ui.scan.appendChild(el);
  return el;
}

// Lay the fan out from the constants above, so a threshold that moves in the
// firmware (and in its copy here) moves its ring, label and colour together.
function buildScan() {
  ui.scan.setAttribute("viewBox", `0 0 ${VIEW_W} ${VIEW_H}`);

  // A wedge that stops short of the red STOP ring has a return within STOP_CM
  // along that ray, which makes the threshold legible spatially rather than
  // only through colour. Exploration stops only for returns in its path:
  // straight ahead, or a front-diagonal return close enough to the centreline
  // to meet the chassis. A side return never stops a cruise; one within a few
  // centimetres of the chassis makes it sidestep away. So a red L or R wedge
  // along a corridor wall, with the rover cruising on, is expected, not a
  // missed obstacle. Labels hang below the rover's baseline, where no wedge can
  // reach, under one foot of their ring: STOP and GO on opposite sides, since
  // their rings are too close together to label on the same one. The outer
  // ring is full reach and needs no label.
  const rings = [
    { cm: RANGE_CM, kind: "" },
    { cm: 100, kind: "", text: "100", side: 1 },
    { cm: GO_CM, kind: "go", text: `${GO_CM} GO`, side: -1 },
    { cm: STOP_CM, kind: "stop", text: `${STOP_CM} STOP`, side: 1 },
  ];
  for (const ring of rings) {
    const r = radiusFor(ring.cm);
    svg("path", { class: `ring ${ring.kind}`.trim(), d: ringPath(r) });
    if (!ring.text) continue;
    const [x] = polar(90 + ring.side * FAN_HALF, r);
    const at = { x: x.toFixed(1), y: CY + 14, "text-anchor": "middle" };
    svg("text", { class: `tick ${ring.kind}`.trim(), ...at }, ring.text);
  }

  for (const b of BEARINGS) {
    b.screen = 90 + b.bearing;
    b.wedge = svg("path", { class: "wedge", d: "" });
  }

  // Each reading sits just past full reach and extends away from the fan, so
  // no wedge ever runs under a number. Its bearing is labelled above it.
  for (const b of BEARINGS) {
    const [x, y] = polar(b.screen, R_MAX + 12);
    const outward = Math.cos((b.screen * Math.PI) / 180);
    const anchor = outward < -0.3 ? "end" : outward > 0.3 ? "start" : "middle";
    const at = { x: x.toFixed(1), "text-anchor": anchor };
    b.reading = svg("text", { class: "reading", ...at, y: (y + 5).toFixed(1) }, "—");
    svg("text", { class: "tick", ...at, y: (y - 10).toFixed(1) }, b.label);
  }

  svg("circle", { cx: CX, cy: CY, r: 4, fill: "var(--dim)" });
}

function colorFor(cm) {
  if (cm <= STOP_CM) return "var(--stop)";
  if (cm <= GO_CM) return "var(--warn)";
  return "var(--live)";
}

function showDistance(b, cm) {
  if (typeof cm !== "number" || !Number.isFinite(cm)) {
    // The rover sends no distances until it has measured every bearing once
    // after booting. Clear the wedge rather than leave an old one standing.
    b.wedge.setAttribute("d", "");
    b.reading.textContent = "—";
    return;
  }

  // A no-echo reading is not a measurement. Show it at full reach but faded,
  // so "nothing came back" never reads as a confirmed clear path.
  const noEcho = cm >= FAR_CM;
  b.wedge.setAttribute("d", wedgePath(b.screen, noEcho ? R_MAX : radiusFor(cm)));
  b.wedge.setAttribute("fill", noEcho ? "var(--dim)" : colorFor(cm));
  b.wedge.setAttribute("opacity", noEcho ? "0.4" : "0.85");
  b.reading.textContent = noEcho ? "no echo" : `${Math.round(cm)}cm`;
}

/* --- telemetry ----------------------------------------------------------- */

function render(raw) {
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return;
  }
  // Telemetry is always a JSON object. An array is an object to typeof, and
  // read as one it blanked every wedge and cleared the motor warning.
  if (!data || typeof data !== "object" || Array.isArray(data)) return;

  for (const b of BEARINGS) showDistance(b, data[b.key]);

  if (typeof data.mode === "string") {
    const exploring = data.mode === "AUTONOMOUS";
    ui.mode.textContent = data.mode;
    ui.auto.setAttribute("aria-pressed", String(exploring));

    // What exploration is doing, and why it has given up when it has. The
    // firmware sends neither in manual mode, so the readout goes with it.
    ui.phaseCell.hidden = !exploring;
    const halted = typeof data.halt === "string";
    ui.phase.textContent = halted
      ? `${data.phase || "HALTED"}: ${data.halt}`
      : typeof data.phase === "string" ? data.phase : "—";
    ui.phase.dataset.tone = halted ? "warn" : "";
  }
  if (typeof data.move === "string") ui.move.textContent = data.move;
  if (typeof data.temperature === "number") {
    ui.temp.textContent = `${data.temperature.toFixed(1)}°C`;
  }
  showMotorsReady(data.motorsReady);
}

// "motorsReady": false means the motor shield did not answer when the rover
// booted. Every command is then accepted and reported -- the Move readout
// says MOVE_FORWARD -- while the wheels never turn, which looks like a
// software fault. Only an explicit false raises the warning: firmware from
// before the key existed sends none, and that says nothing about the motors.
// The warning belongs to the link it came over, so losing that link clears it.
function showMotorsReady(ready) {
  ui.motorsFault.hidden = ready !== false;
}

/* --- wiring -------------------------------------------------------------- */

buildScan();

new JoyStick("stick", {
  internalFillColor: "#4db8a8",
  internalStrokeColor: "#1c1e21",
  externalStrokeColor: "#383c42",
  internalLineWidth: 2,
  externalLineWidth: 2,
  autoReturnToCenter: true,
}, onStick);

// A press is the primary button alone. Right-click, middle-click and a Mac's
// ctrl-click (which arrives as button 0 with ctrlKey set) are not: each can
// open a context menu, which takes the release with it and leaves the input
// held with nobody holding it.
function isPrimaryPress(event) {
  return event.button === 0 && !event.ctrlKey;
}

// Holding a control is not asking for its menu, and a menu that did open would
// swallow the release. On touch screens a long press, which is how these
// controls are held, raises contextmenu too.
for (const control of [ui.stick, ui.cw, ui.ccw]) {
  control.addEventListener("contextmenu", (event) => event.preventDefault());
}

// joy.js counts any mousedown on its canvas as a press, whatever the button,
// and forgets it only on its own mouseup or touchend. So the panel arms the
// stick itself, only on a primary press, and releaseInputs() disarms it.
// Without this, joy.js stayed pressed through anything that let go of the
// stick behind its back -- Stop, Autonomous, blur or link loss under a resting
// thumb or a held mouse button, or a right-click whose mouseup a context menu
// took -- and its next move report drove the rover again, knocking it out of
// autonomous mode if it was exploring. Capture phase, so this decides before
// joy.js sees the press.
ui.stick.addEventListener("mousedown", (event) => {
  held.stickArmed = isPrimaryPress(event);
}, true);
ui.stick.addEventListener("touchstart", () => {
  held.stickArmed = true;
}, true);

// joy.js reports a release only on touchend. A touch the system takes away --
// an edge-swipe gesture, a notification shade, an alert -- ends in touchcancel
// instead, and without this the last move went on repeating every 200 ms with
// no finger on the screen. The event bubbles here from joy.js's canvas.
ui.stick.addEventListener("touchcancel", (event) => {
  // Hand joy.js the ending it listens for, so its knob recentres rather than
  // staying drawn deflected over a stopped rover...
  const ended = new Event("touchend");
  Object.defineProperty(ended, "changedTouches", { value: event.changedTouches });
  document.dispatchEvent(ended);
  // ...and release the stick here regardless, so stopping never depends on
  // joy.js's internals.
  held.stick = null;
  held.stickArmed = false;
  steer();
});

// A button holds only for the pointer that pressed it. Pointer Events fire
// pointerleave for a mouse merely passing over, so without the pointerId check
// a hover sent STOP -- and knocked an exploring rover into manual.
function holdButton(button, move) {
  button.addEventListener("pointerdown", (event) => {
    // Touch and pen presses arrive as button 0 too.
    if (!isPrimaryPress(event)) return;
    event.preventDefault();
    if (held.rotate.some((h) => h.button === button)) return;
    button.dataset.held = "yes";
    held.rotate.push({ button, pointerId: event.pointerId, move });
    steer();
  });

  const release = (event) => {
    const i = held.rotate.findIndex((h) => h.button === button && h.pointerId === event.pointerId);
    if (i < 0) return;
    held.rotate.splice(i, 1);
    delete button.dataset.held;
    steer();
  };
  button.addEventListener("pointerup", release);
  button.addEventListener("pointerleave", release);
  button.addEventListener("pointercancel", release);
}

holdButton(ui.cw, ROTATE_CLOCKWISE);
holdButton(ui.ccw, ROTATE_COUNTERCLOCKWISE);

// Always sends STOP, driving or not: this is also how to stop an exploring
// rover.
ui.stop.addEventListener("click", () => {
  releaseInputs();
  halt();
});

ui.auto.addEventListener("click", () => {
  // Stop repeating first: the next repeated move would take control straight
  // back. RESUME_AUTONOMOUS releases the motors itself.
  releaseInputs();
  stopRepeating();
  send(RESUME_AUTONOMOUS, 0);
});

ui.speed.addEventListener("input", () => {
  ui.speedOut.textContent = ui.speed.value;
  steer(); // a held input picks up the new limit
});

ui.connect.addEventListener("click", () => {
  if (socket) disconnect();
  else connect();
});

ui.host.addEventListener("keydown", (event) => {
  if (event.key === "Enter") connect();
});

// Anything that takes the operator's eyes or hands off the page must not
// leave the rover under this panel's power. It stops only what the panel is
// driving: alt-tabbing away while the rover explores must leave it exploring.
window.addEventListener("blur", standDown);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) standDown();
});
window.addEventListener("pagehide", standDown);

ui.host.value = recallHost() || ui.host.value;
setLink("down");
note("Enter the rover's address and connect.");

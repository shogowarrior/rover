/**
 * Wires the joystick UI to the rover's WebSocket.
 *
 * Open joystick.html directly in a browser -- the rover cannot serve it.
 * partition.csv allocates the whole flash to nvs, otadata and two OTA app
 * slots, leaving no SPIFFS/LittleFS partition to hold web assets.
 */

// These integers are the wire protocol. They must match src/MoveCodes.h.
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

// The rover listens on 81. The address field accepts "host" or "host:port" so
// the panel can also be pointed at a stand-in during development.
const PORT = 81;

// Shorter than the firmware's 1500 ms deadman, so letting go of the stick
// coasts to a stop instead of running on.
const MOVE_DURATION_MS = 400;

// A held-but-stationary stick fires no events, so the current command is
// re-sent on this interval to keep feeding the deadman.
const REPEAT_MS = 200;

// Telemetry arrives every 500 ms. Miss several and the link is not trustworthy
// even though the socket still claims to be open.
const STALE_MS = 1800;

// Matches SAFE_DISTANCE in src/common.h.
const SAFE_CM = 30;
const CAUTION_CM = 60;
const FAR_CM = 999;

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
  temp: $("temp"),
  note: $("note"),
  auto: $("auto"),
  stop: $("stop"),
  cw: $("cw"),
  ccw: $("ccw"),
  wedges: { left: $("wedgeLeft"), front: $("wedgeFront"), right: $("wedgeRight") },
  readings: { left: $("readLeft"), front: $("readFront"), right: $("readRight") },
};

let socket = null;
let repeatTimer = null;
let staleTimer = null;
let current = null; // {move, speed} being repeated, or null when stopped

/* --- link ---------------------------------------------------------------- */

function setLink(state, message) {
  ui.body.dataset.link = state;
  ui.linkState.textContent =
    state === "up" ? "Link" : state === "stale" ? "No data" : "No link";
  ui.connect.textContent = state === "down" ? "Connect" : "Disconnect";
  note(message || "", state === "down" ? "bad" : "");
}

function note(text, tone) {
  ui.note.textContent = text;
  ui.note.dataset.tone = tone || "";
}

function markFresh() {
  clearTimeout(staleTimer);
  if (ui.body.dataset.link !== "up") setLink("up");
  staleTimer = setTimeout(() => {
    setLink("stale", "Telemetry stopped. The rover may have rebooted.");
  }, STALE_MS);
}

function connect() {
  const host = ui.host.value.trim();
  if (!host) {
    note("Enter the rover's address first.", "bad");
    return;
  }
  localStorage.setItem("rover.host", host);

  const url = host.includes(":") ? `ws://${host}` : `ws://${host}:${PORT}`;
  note(`Connecting to ${url}`);

  try {
    socket = new WebSocket(url);
  } catch (err) {
    setLink("down", `Cannot open ${url}: ${err.message}`);
    return;
  }

  socket.addEventListener("open", () => markFresh());
  socket.addEventListener("message", (event) => {
    markFresh();
    render(event.data);
  });
  socket.addEventListener("close", () => {
    halt();
    setLink("down", `Not reachable at ${url}. Check the rover is powered and on this network.`);
  });
  socket.addEventListener("error", () => {
    // 'close' always follows and carries the actionable message.
  });
}

function disconnect() {
  halt();
  if (socket) socket.close();
  socket = null;
  setLink("down");
}

/* --- sending ------------------------------------------------------------- */

function send(move, speed) {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify({ move, speed, duration: MOVE_DURATION_MS }));
}

// Begin repeating a command until something replaces it or halt() clears it.
function drive(move, speed) {
  current = { move, speed };
  send(move, speed);
  if (repeatTimer === null) {
    repeatTimer = setInterval(() => {
      if (current) send(current.move, current.speed);
    }, REPEAT_MS);
  }
}

function halt() {
  current = null;
  clearInterval(repeatTimer);
  repeatTimer = null;
  send(STOP, 0);
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

  if (magnitude < 12) {
    if (current) halt();
    return;
  }

  let angle = (Math.atan2(y, x) * 180) / Math.PI;
  if (angle < 0) angle += 360;

  const speed = Math.round((magnitude / 100) * Number(ui.speed.value));
  drive(moveForAngle(angle), speed);
}

/* --- telemetry ----------------------------------------------------------- */

// Servo angle 20 points left and 160 points right, so screen angle is the
// mirror of servo angle. If left and right look swapped on the bench, the
// servo is mounted the other way round and this is where to correct it.
const SPOKES = [
  { key: "left", servo: 20 },
  { key: "front", servo: 90 },
  { key: "right", servo: 160 },
];

const ORIGIN_X = 210;
const ORIGIN_Y = 188;
const R_MIN = 26;
const R_MAX = 172;
const HALF_WIDTH = 13; // degrees each side of the spoke

function colorFor(cm) {
  if (cm <= SAFE_CM) return "var(--stop)";
  if (cm <= CAUTION_CM) return "var(--warn)";
  return "var(--live)";
}

function wedgePath(servoAngle, cm) {
  const screen = 180 - servoAngle;
  // 200 cm of range fills the panel; beyond that the wedge is simply full.
  const radius = R_MIN + (R_MAX - R_MIN) * Math.min(1, cm / 200);

  const point = (deg, r) => {
    const rad = (deg * Math.PI) / 180;
    return [
      (ORIGIN_X + r * Math.cos(rad)).toFixed(1),
      (ORIGIN_Y - r * Math.sin(rad)).toFixed(1),
    ];
  };

  const a = point(screen - HALF_WIDTH, R_MIN);
  const b = point(screen + HALF_WIDTH, R_MIN);
  const c = point(screen + HALF_WIDTH, radius);
  const d = point(screen - HALF_WIDTH, radius);

  return `M${a} L${d} A${radius} ${radius} 0 0 1 ${c} L${b} A${R_MIN} ${R_MIN} 0 0 0 ${a} Z`;
}

function render(raw) {
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return;
  }

  for (const spoke of SPOKES) {
    const key = spoke.key === "left" ? "distanceLeft"
      : spoke.key === "front" ? "distanceFront" : "distanceRight";
    const cm = data[key];
    const wedge = ui.wedges[spoke.key];
    const reading = ui.readings[spoke.key];

    if (typeof cm !== "number") {
      reading.textContent = "—";
      continue;
    }

    wedge.setAttribute("d", wedgePath(spoke.servo, cm));

    // A no-echo reading is not a measurement. Show it at full reach but faded,
    // so "nothing came back" never reads as a confirmed clear path.
    const noEcho = cm >= FAR_CM;
    wedge.setAttribute("fill", noEcho ? "var(--dim)" : colorFor(cm));
    wedge.setAttribute("opacity", noEcho ? "0.4" : "0.85");
    reading.textContent = noEcho ? "no echo" : `${Math.round(cm)}cm`;
  }

  if (data.mode) {
    ui.mode.textContent = data.mode;
    ui.auto.setAttribute("aria-pressed", String(data.mode === "AUTONOMOUS"));
  }
  if (data.move) ui.move.textContent = data.move;
  if (typeof data.temperature === "number") {
    ui.temp.textContent = `${data.temperature.toFixed(1)}°C`;
  }
}

/* --- wiring -------------------------------------------------------------- */

new JoyStick("stick", {
  internalFillColor: "#4db8a8",
  internalStrokeColor: "#1c1e21",
  externalStrokeColor: "#383c42",
  internalLineWidth: 2,
  externalLineWidth: 2,
  autoReturnToCenter: true,
}, onStick);

function holdButton(button, move) {
  const press = (event) => {
    event.preventDefault();
    button.dataset.held = "yes";
    drive(move, Number(ui.speed.value));
  };
  const release = () => {
    delete button.dataset.held;
    halt();
  };
  button.addEventListener("pointerdown", press);
  button.addEventListener("pointerup", release);
  button.addEventListener("pointerleave", release);
  button.addEventListener("pointercancel", release);
}

holdButton(ui.cw, ROTATE_CLOCKWISE);
holdButton(ui.ccw, ROTATE_COUNTERCLOCKWISE);

ui.stop.addEventListener("click", halt);

ui.auto.addEventListener("click", () => {
  halt();
  send(RESUME_AUTONOMOUS, 0);
});

ui.speed.addEventListener("input", () => {
  ui.speedOut.textContent = ui.speed.value;
});

ui.connect.addEventListener("click", () => {
  if (socket && socket.readyState === WebSocket.OPEN) disconnect();
  else connect();
});

ui.host.addEventListener("keydown", (event) => {
  if (event.key === "Enter") connect();
});

// Anything that takes the operator's eyes or hands off the page should not
// leave the rover under power.
window.addEventListener("blur", halt);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) halt();
});
window.addEventListener("pagehide", halt);

ui.host.value = localStorage.getItem("rover.host") || ui.host.value;
setLink("down");
note("Enter the rover's address and connect.");

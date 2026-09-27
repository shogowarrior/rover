/**
 * The control panel's composition root, like src/main.cpp: it builds every
 * part of the panel, wires them together by reference, and does nothing else.
 *
 * Open joystick.html directly in a browser -- the rover cannot serve it.
 * partition.csv allocates the whole flash to nvs, otadata and two OTA app
 * slots, leaving no SPIFFS/LittleFS partition to hold web assets.
 *
 * The page loads its scripts as classic <script src> files, in order, because
 * Chrome refuses module scripts from file://. Classic scripts share one global
 * scope: what one file declares at top level is visible to every file after
 * it, and a second top-level declaration of the same name stops that whole
 * second file from loading. So each file declares at top level only what it
 * offers the others, and keeps the rest inside its class:
 *
 *   support.js   Listeners, memory: event listeners and best-effort storage
 *   protocol.js  every value mirrored from the firmware
 *   mecanum.js   the motions, and moveForStick() for the stick families
 *   link.js      Link: the WebSocket, the link state, telemetry
 *   scan.js      BEARINGS, ScanView: the scan fan
 *   readouts.js  Readouts: mode, move, phase, chip temperature, motor warning
 *   drive.js     Driver: the stick, rotate buttons and speed, and what to send
 *   tabs.js      Tabs: the Drive and Program tabs
 *   app.js       this file, last
 *
 * Below, each wiring concern is a block of its own. A new part is built and
 * wired in a new block, rather than by growing another.
 */

// A missing element is a page that no longer matches its scripts. Say which,
// at load, rather than fail on the first press.
function byId(id) {
  const element = document.getElementById(id);
  if (!element) throw new Error(`joystick.html has no #${id}`);
  return element;
}

/* --- the parts ----------------------------------------------------------- */

const link = new Link({
  body: document.body,
  host: byId("host"),
  connect: byId("connect"),
  linkState: byId("linkState"),
  note: byId("note"),
});

const scanView = new ScanView(byId("scan"));

const readouts = new Readouts({
  mode: byId("mode"),
  move: byId("move"),
  phaseCell: byId("phaseCell"),
  phase: byId("phase"),
  temp: byId("temp"),
  auto: byId("auto"),
  motorsFault: byId("motorsFault"),
});

// Built while the Drive tab is still showing, before the tabs restore the one
// last chosen: joy.js sizes the stick from its container once, here, and a
// hidden container has no size.
const driver = new Driver({
  link,
  stick: byId("stick"),
  cw: byId("cw"),
  ccw: byId("ccw"),
  speed: byId("speed"),
  speedOut: byId("speedOut"),
});

/* --- telemetry ----------------------------------------------------------- */

link.onTelemetry((data) => {
  scanView.show(data);
  readouts.show(data);
});

/* --- loss of control stops the rover ------------------------------------- */

// When the link goes down, nothing held may drive again without a fresh
// press, and whatever this panel was driving stops. When the panel closes its
// own socket, the Link runs this first, so the STOP still goes out on it; a
// socket that closed under the panel cannot carry one, and the firmware stops
// the wheels itself when the client driving it disconnects. The motor warning
// belongs to the link it came over, so it goes too.
link.onState((state, cause) => {
  if (state === "down") {
    driver.standDown(cause);
    readouts.linkDown();
  } else if (state === "stale") {
    driver.linkStale();
  }
});

// Anything that takes the operator's eyes or hands off the page must not
// leave the rover under this panel's power. It stops only what the panel is
// driving: alt-tabbing away while the rover explores must leave it exploring.
window.addEventListener("blur", () => driver.standDown("blur"));
document.addEventListener("visibilitychange", () => {
  if (document.hidden) driver.standDown("hidden");
});
window.addEventListener("pagehide", () => driver.standDown("pagehide"));

/* --- Stop and Autonomous ------------------------------------------------- */

// Outside the tabs, so both are in reach whatever tab is showing. Stop always
// sends STOP, driving or not: it is also how to stop an exploring rover.
byId("stop").addEventListener("click", () => driver.stopRover());
byId("auto").addEventListener("click", () => driver.resumeAutonomous());

/* --- tabs ---------------------------------------------------------------- */

// Choosing a tab is not driving: nothing here reaches the Driver or the Link.
const tabs = new Tabs([byId("tabDrive"), byId("tabProgram")], { storageKey: "rover.tab" });

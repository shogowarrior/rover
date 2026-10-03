// What the firmware says, for the panel's tests: files in src/, the move codes
// in src/MoveCodes.h, and the shared cases in test/vectors/, which the
// firmware's own tests check too, telemetry frames among them. Not a test
// itself: index.js runs only *.test.js.
"use strict";
const fs = require("node:fs");
const path = require("node:path");

const REPO = path.join(__dirname, "..", "..", "..");

// A file in src/, as text.
const src = (file) => fs.readFileSync(path.join(REPO, "src", file), "utf8");

// A file of cases in test/vectors/, parsed.
const vectors = (name) => JSON.parse(fs.readFileSync(path.join(REPO, "test", "vectors", name), "utf8"));

// Move codes by name, from the enum in src/MoveCodes.h itself rather than
// through protocol.js: protocol.js is the panel's copy of those codes, which
// tools/check_protocol.py checks on its own. mecanum.test.js checks that this
// reads all twenty.
const CODES = {};
for (const [, name, value] of src("MoveCodes.h").matchAll(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(\d+)\s*,/gm)) CODES[name] = Number(value);

// Move names by code.
const NAMES = Object.fromEntries(Object.entries(CODES).map(([name, code]) => [code, name]));

// Telemetry frames by name, each one key for key what src/Protocol.cpp
// writes for its state: test/test_protocol checks writeTelemetry() against
// every one.
const FRAMES = Object.freeze(Object.fromEntries(
  Object.entries(vectors("telemetry.json").frames).map(([name, frame]) => [name, Object.freeze(frame)])));

// A telemetry frame as the firmware writes it: FRAMES.sweeping with extra
// over it. A MANUAL frame carries no phase or halt unless extra gives one, as
// the firmware's never does. A key set to undefined is left out of what the
// fake socket sends (JSON.stringify drops it): firmware from before that key.
function telemetry(extra = {}) {
  const frame = { ...FRAMES.sweeping, ...extra };
  if (frame.mode === "MANUAL") for (const key of ["phase", "halt"]) if (!(key in extra)) delete frame[key];
  return frame;
}

module.exports = { src, vectors, CODES, NAMES, FRAMES, telemetry };

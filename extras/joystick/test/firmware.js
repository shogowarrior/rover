// What the firmware says, for the panel's tests: files in src/, the move codes
// in src/MoveCodes.h, and the shared cases in test/vectors/, which the
// firmware's own tests check too. Not a test itself: index.js runs only
// *.test.js.
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

module.exports = { src, vectors, CODES, NAMES };

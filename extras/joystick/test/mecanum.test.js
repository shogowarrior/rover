// mecanum.js against the firmware: moveForStick() on every case in
// test/vectors/stick_moves.json, the file test/test_kinematics checks
// kinematics::moveForStick against, and the motion table against
// src/MoveCodes.h.
"use strict";
const assert = require("node:assert/strict");
const { test } = require("node:test");
const mecanum = require("../js/mecanum.js");
const { vectors, CODES, NAMES } = require("./firmware.js");

const VECTORS = vectors("stick_moves.json");

// Every test file's CODES comes from this one read of the header.
test("src/MoveCodes.h reads as twenty codes, 0 to 19", () => {
  assert.deepEqual(Object.values(CODES).sort((a, b) => a - b), [...Array(20).keys()]);
});

test("the families are named as the vectors name them", () => {
  const { FAMILY_TRANSLATE, FAMILY_PIVOT, FAMILY_PIVOT_SIDEWAYS, FAMILIES } = mecanum;
  assert.deepEqual([FAMILY_TRANSLATE, FAMILY_PIVOT, FAMILY_PIVOT_SIDEWAYS], ["TRANSLATE", "PIVOT", "PIVOT_SIDEWAYS"]);
  assert.deepEqual([...FAMILIES], ["TRANSLATE", "PIVOT", "PIVOT_SIDEWAYS"]);
  const used = new Set(VECTORS.cases.map((c) => c.family));
  assert.deepEqual([...used].sort(), [...FAMILIES].sort(), "the vectors cover every family, and no other");
});

test("moveForStick matches every case in test/vectors/stick_moves.json", () => {
  assert.ok(VECTORS.cases.length >= 30, `only ${VECTORS.cases.length} cases`);
  const wrong = [];
  for (const { x, yUp, family, move } of VECTORS.cases) {
    assert.ok(move in CODES, `${move} is not in src/MoveCodes.h`);
    const got = mecanum.moveForStick(x, yUp, family);
    if (got !== CODES[move]) wrong.push(`(${x}, ${yUp}) ${family}: want ${move}, got ${NAMES[got] || got}`);
  }
  assert.deepEqual(wrong, []);
});

test("a pivot family always picks from its own four moves, by quadrant", () => {
  const families = {
    PIVOT: ["PIVOT_RIGHT_FORWARD", "PIVOT_LEFT_FORWARD", "PIVOT_RIGHT_BACKWARD", "PIVOT_LEFT_BACKWARD"],
    PIVOT_SIDEWAYS: ["PIVOT_SIDEWAYS_FORWARD_RIGHT", "PIVOT_SIDEWAYS_FORWARD_LEFT", "PIVOT_SIDEWAYS_BACKWARD_RIGHT", "PIVOT_SIDEWAYS_BACKWARD_LEFT"],
  };
  for (const [family, [rf, lf, rb, lb]] of Object.entries(families)) {
    for (let x = -100; x <= 100; x += 5) {
      for (let yUp = -100; yUp <= 100; yUp += 5) {
        const want = yUp >= 0 ? (x >= 0 ? rf : lf) : (x >= 0 ? rb : lb);
        assert.equal(NAMES[mecanum.moveForStick(x, yUp, family)], want, `(${x}, ${yUp}) ${family}`);
      }
    }
  }
});

test("MOTIONS lists all eighteen motions once, in code order, named as the firmware names them", () => {
  const { MOTIONS, motionFor } = mecanum;
  assert.deepEqual(MOTIONS.map((m) => m.move), [...Array(18).keys()].map((i) => i + 1));
  for (const motion of MOTIONS) {
    assert.equal(CODES[motion.name], motion.move, `${motion.name} is ${motion.move}`);
    assert.ok(typeof motion.label === "string" && motion.label.length > 0 && motion.label.length <= 32, `${motion.name} label`);
    assert.ok(typeof motion.glyph === "string" && [...motion.glyph].length === 1, `${motion.name} glyph ${motion.glyph}`);
    assert.equal(motionFor(motion.move), motion);
    assert.ok(Object.isFrozen(motion), `${motion.name} frozen`);
  }
  assert.equal(new Set(MOTIONS.map((m) => m.label)).size, 18, "labels are distinct");
  assert.equal(new Set(MOTIONS.map((m) => m.glyph)).size, 18, "glyphs are distinct");
  for (const notMotion of [CODES.STOP, CODES.RESUME_AUTONOMOUS, 20, -1, "1", undefined]) {
    assert.equal(motionFor(notMotion), undefined, `motionFor(${notMotion})`);
  }
});

test("MOTIONS: the pivots, codes 9 to 16, are the ADVANCED ones, each in the family whose stick reaches it", () => {
  const { MOTIONS, FAMILIES, moveForStick } = mecanum;
  for (const motion of MOTIONS) {
    assert.equal(motion.advanced, motion.move >= 9 && motion.move <= 16, `${motion.name} advanced`);
  }
  // A motion's family is the one whose stick produces it; the rotations have
  // buttons and no family.
  const reached = new Map();
  for (const family of FAMILIES) {
    for (let x = -100; x <= 100; x += 10) {
      for (let yUp = -100; yUp <= 100; yUp += 10) {
        if (x || yUp) reached.set(moveForStick(x, yUp, family), family);
      }
    }
  }
  for (const motion of MOTIONS) assert.equal(motion.family, reached.get(motion.move) || null, `${motion.name} family`);
});

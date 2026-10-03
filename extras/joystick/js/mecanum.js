/**
 * The mecanum motions, how a stick deflection picks one, and the motion a
 * program may hold (heldMotion, the Target's hold() rule).
 *
 * moveForStick() is the panel's copy of kinematics::moveForStick in
 * src/Kinematics.cpp, which maps the gamepad's stick, so the pad and the panel
 * drive the same way. test/mecanum.test.js checks it against the cases in
 * test/vectors/stick_moves.json, which test/test_kinematics checks the
 * firmware against. docs/mecanum.md "Control schemes" has the table.
 *
 * No DOM here: this file also loads in Node, for the tests.
 */

// In the page, support.js and protocol.js have already declared clamp() and
// the move codes, and classic scripts share one scope. Node has no page:
// there each is loaded onto the global object, where this file's bare names
// find them, before anything below reads one.
if (typeof module !== "undefined") {
  if (typeof clamp === "undefined") Object.assign(globalThis, require("./support.js"));
  if (typeof MOVE_FORWARD === "undefined") Object.assign(globalThis, require("./protocol.js"));
}

// Which family of motions a stick deflection selects: kinematics::StickFamily,
// spelt as test/vectors/stick_moves.json spells it. TRANSLATE is the NORMAL
// scheme's only family; the ADVANCED scheme adds the two pivot families.
const FAMILY_TRANSLATE = "TRANSLATE";
const FAMILY_PIVOT = "PIVOT";
const FAMILY_PIVOT_SIDEWAYS = "PIVOT_SIDEWAYS";
const FAMILIES = Object.freeze([FAMILY_TRANSLATE, FAMILY_PIVOT, FAMILY_PIVOT_SIDEWAYS]);

// Stick deflection angle in degrees, in [0, 360): 0 is right, 90 is up
// (forward). yUp is positive when the stick is pushed away from the driver.
function stickAngleDeg(x, yUp) {
  let angle = degrees(Math.atan2(yUp, x));
  if (angle < 0) angle += 360;
  return angle;
}

// The move a deflected stick asks for. The caller rejects a centred stick
// first: this always returns a motion.
function moveForStick(x, yUp, family) {
  // A pivot family has four motions, one per quadrant. Axis-aligned pushes
  // (x or yUp exactly 0) count as right and forward.
  const right = x >= 0;
  const forward = yUp >= 0;
  if (family === FAMILY_PIVOT) {
    if (forward) return right ? PIVOT_RIGHT_FORWARD : PIVOT_LEFT_FORWARD;
    return right ? PIVOT_RIGHT_BACKWARD : PIVOT_LEFT_BACKWARD;
  }
  if (family === FAMILY_PIVOT_SIDEWAYS) {
    if (forward) return right ? PIVOT_SIDEWAYS_FORWARD_RIGHT : PIVOT_SIDEWAYS_FORWARD_LEFT;
    return right ? PIVOT_SIDEWAYS_BACKWARD_RIGHT : PIVOT_SIDEWAYS_BACKWARD_LEFT;
  }

  // Translation. Mecanum wheels can move in any direction without turning,
  // so the stick maps to eight sectors rather than the four a
  // differential-drive robot would get. Sector boundaries sit halfway between
  // headings.
  const angle = stickAngleDeg(x, yUp);
  if (angle >= 337.5 || angle < 22.5) return MOVE_RIGHT;
  if (angle < 67.5) return MOVE_DIAGONAL45;
  if (angle < 112.5) return MOVE_FORWARD;
  if (angle < 157.5) return MOVE_DIAGONAL135;
  if (angle < 202.5) return MOVE_LEFT;
  if (angle < 247.5) return MOVE_DIAGONAL225;
  if (angle < 292.5) return MOVE_BACKWARD;
  return MOVE_DIAGONAL315;
}

// All eighteen motions, in move-code order, for anything that names or lists
// them (a readout, a selector, a block editor).
//   name      the move code's name in src/MoveCodes.h, which is also what
//             telemetry's "move" reports while it runs;
//   label     a name for people;
//   short     the fewest words that tell it apart from the other motions of
//             its family, for a tight space such as a corner of the stick.
//             They follow the move code's own word order, so they read as
//             the Move readout does: Right fwd is PIVOT_RIGHT_FORWARD, Fwd
//             right is PIVOT_SIDEWAYS_FORWARD_RIGHT;
//   glyph     an arrow that suggests it;
//   family    the stick family that reaches it, or null for the rotations,
//             which have their own buttons;
//   advanced  offered only under the ADVANCED scheme. These are the pivots,
//             which docs/mecanum.md warns are not bench-verified: how far one
//             really swings depends on how the rollers slip and grip on the
//             floor, which the simulator's ideal wheels leave out.
const MOTIONS = Object.freeze([
  { move: MOVE_FORWARD, name: "MOVE_FORWARD", label: "Forward", short: "Fwd", glyph: "↑", family: FAMILY_TRANSLATE, advanced: false },
  { move: MOVE_BACKWARD, name: "MOVE_BACKWARD", label: "Backward", short: "Back", glyph: "↓", family: FAMILY_TRANSLATE, advanced: false },
  { move: MOVE_RIGHT, name: "MOVE_RIGHT", label: "Strafe right", short: "Right", glyph: "→", family: FAMILY_TRANSLATE, advanced: false },
  { move: MOVE_LEFT, name: "MOVE_LEFT", label: "Strafe left", short: "Left", glyph: "←", family: FAMILY_TRANSLATE, advanced: false },
  { move: MOVE_DIAGONAL45, name: "MOVE_DIAGONAL45", label: "Diagonal forward-right", short: "Fwd right", glyph: "↗", family: FAMILY_TRANSLATE, advanced: false },
  { move: MOVE_DIAGONAL135, name: "MOVE_DIAGONAL135", label: "Diagonal forward-left", short: "Fwd left", glyph: "↖", family: FAMILY_TRANSLATE, advanced: false },
  { move: MOVE_DIAGONAL225, name: "MOVE_DIAGONAL225", label: "Diagonal backward-left", short: "Back left", glyph: "↙", family: FAMILY_TRANSLATE, advanced: false },
  { move: MOVE_DIAGONAL315, name: "MOVE_DIAGONAL315", label: "Diagonal backward-right", short: "Back right", glyph: "↘", family: FAMILY_TRANSLATE, advanced: false },
  { move: PIVOT_RIGHT_FORWARD, name: "PIVOT_RIGHT_FORWARD", label: "Pivot right, forward", short: "Right fwd", glyph: "↱", family: FAMILY_PIVOT, advanced: true },
  { move: PIVOT_RIGHT_BACKWARD, name: "PIVOT_RIGHT_BACKWARD", label: "Pivot right, backward", short: "Right back", glyph: "↳", family: FAMILY_PIVOT, advanced: true },
  { move: PIVOT_LEFT_FORWARD, name: "PIVOT_LEFT_FORWARD", label: "Pivot left, forward", short: "Left fwd", glyph: "↰", family: FAMILY_PIVOT, advanced: true },
  { move: PIVOT_LEFT_BACKWARD, name: "PIVOT_LEFT_BACKWARD", label: "Pivot left, backward", short: "Left back", glyph: "↲", family: FAMILY_PIVOT, advanced: true },
  { move: PIVOT_SIDEWAYS_FORWARD_RIGHT, name: "PIVOT_SIDEWAYS_FORWARD_RIGHT", label: "Pivot sideways, forward-right", short: "Fwd right", glyph: "↷", family: FAMILY_PIVOT_SIDEWAYS, advanced: true },
  { move: PIVOT_SIDEWAYS_FORWARD_LEFT, name: "PIVOT_SIDEWAYS_FORWARD_LEFT", label: "Pivot sideways, forward-left", short: "Fwd left", glyph: "↶", family: FAMILY_PIVOT_SIDEWAYS, advanced: true },
  { move: PIVOT_SIDEWAYS_BACKWARD_RIGHT, name: "PIVOT_SIDEWAYS_BACKWARD_RIGHT", label: "Pivot sideways, backward-right", short: "Back right", glyph: "⤷", family: FAMILY_PIVOT_SIDEWAYS, advanced: true },
  { move: PIVOT_SIDEWAYS_BACKWARD_LEFT, name: "PIVOT_SIDEWAYS_BACKWARD_LEFT", label: "Pivot sideways, backward-left", short: "Back left", glyph: "⤶", family: FAMILY_PIVOT_SIDEWAYS, advanced: true },
  { move: ROTATE_CLOCKWISE, name: "ROTATE_CLOCKWISE", label: "Rotate clockwise", short: "Clockwise", glyph: "↻", family: null, advanced: false },
  { move: ROTATE_COUNTERCLOCKWISE, name: "ROTATE_COUNTERCLOCKWISE", label: "Rotate counter-clockwise", short: "Counter-clockwise", glyph: "↺", family: null, advanced: false },
].map((motion) => Object.freeze(motion)));

// The MOTIONS entry for a move code, or undefined for STOP,
// RESUME_AUTONOMOUS and anything that is not a code.
function motionFor(move) {
  return MOTIONS.find((motion) => motion.move === move);
}

// The MOTIONS entry for a move code's name (MOVE_FORWARD), as telemetry and
// a block program spell it, or undefined for anything that is not a motion.
function motionNamed(name) {
  return MOTIONS.find((motion) => motion.name === name);
}

// The {move, speed} a program holds: a motion code, and a finite speed rounded
// and kept within 0..SPEED_MAX. Anything else is a RangeError naming the
// caller (the Driver's program(), the simulator's hold()).
function heldMotion(caller, move, speed) {
  if (!motionFor(move)) throw new RangeError(`${caller} takes a motion code, 1 to 18, not ${move}`);
  if (typeof speed !== "number" || !Number.isFinite(speed)) {
    throw new RangeError(`${caller} takes a speed, 0 to ${SPEED_MAX}, not ${speed}`);
  }
  return { move, speed: clamp(Math.round(speed), 0, SPEED_MAX) };
}

if (typeof module !== "undefined") {
  module.exports = {
    FAMILY_TRANSLATE, FAMILY_PIVOT, FAMILY_PIVOT_SIDEWAYS, FAMILIES,
    moveForStick, MOTIONS, motionFor, motionNamed, heldMotion,
  };
}

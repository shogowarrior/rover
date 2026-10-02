#include "MovePatterns.h"

namespace {

// Shorthand so each row below reads as four wheel directions.
constexpr WheelDirection FWD = WHEEL_FORWARD;
constexpr WheelDirection BACK = WHEEL_BACKWARD;
constexpr WheelDirection FREE = WHEEL_FREE;

// #code keeps each telemetry name identical to its enum identifier.
#define PATTERN(code, frontLeft, frontRight, rearRight, rearLeft) \
  { code, #code, { frontLeft, frontRight, rearRight, rearLeft } }

// Columns: front-left, front-right, rear-right, rear-left. FREE means that
// wheel free-wheels for this move, which is how the diagonal and pivot moves
// work on mecanum wheels.
//
// Every row matches DroneBot Workshop's mecanum table
// (https://dronebotworkshop.com/mecanum/), the owner's reference, whose
// constants test_move_patterns decodes; it also says what the pivots got wrong
// before. None of it is bench-verified yet: docs/bench-checklist.md says how.
//
// The panel's simulator copies this table (RoverSim.WHEELS in
// extras/joystick/js/sim.js) to preview programs; its test/sim.test.js parses
// this file and fails when the copy drifts.
const MovePattern PATTERNS[] = {
    PATTERN(STOP, FREE, FREE, FREE, FREE),
    PATTERN(MOVE_FORWARD, FWD, FWD, FWD, FWD),
    PATTERN(MOVE_BACKWARD, BACK, BACK, BACK, BACK),
    PATTERN(MOVE_RIGHT, FWD, BACK, FWD, BACK),
    PATTERN(MOVE_LEFT, BACK, FWD, BACK, FWD),
    PATTERN(MOVE_DIAGONAL45, FWD, FREE, FWD, FREE),
    PATTERN(MOVE_DIAGONAL135, FREE, FWD, FREE, FWD),
    PATTERN(MOVE_DIAGONAL225, BACK, FREE, BACK, FREE),
    PATTERN(MOVE_DIAGONAL315, FREE, BACK, FREE, BACK),
    // Pivot about one side: the other side's pair turns as in MOVE_FORWARD or
    // MOVE_BACKWARD. RIGHT pivots about the right wheels, nose turning right
    // going forward.
    PATTERN(PIVOT_RIGHT_FORWARD, FWD, FREE, FREE, FWD),
    PATTERN(PIVOT_RIGHT_BACKWARD, BACK, FREE, FREE, BACK),
    PATTERN(PIVOT_LEFT_FORWARD, FREE, FWD, FWD, FREE),
    PATTERN(PIVOT_LEFT_BACKWARD, FREE, BACK, BACK, FREE),
    // Pivot sideways about one axle: the other axle turns as in MOVE_RIGHT or
    // MOVE_LEFT. FORWARD swings the front toward the side named, BACKWARD the
    // rear (DroneBot's FRONT and REAR).
    PATTERN(PIVOT_SIDEWAYS_FORWARD_RIGHT, FWD, BACK, FREE, FREE),
    PATTERN(PIVOT_SIDEWAYS_FORWARD_LEFT, BACK, FWD, FREE, FREE),
    PATTERN(PIVOT_SIDEWAYS_BACKWARD_RIGHT, FREE, FREE, FWD, BACK),
    PATTERN(PIVOT_SIDEWAYS_BACKWARD_LEFT, FREE, FREE, BACK, FWD),
    PATTERN(ROTATE_CLOCKWISE, FWD, BACK, BACK, FWD),
    PATTERN(ROTATE_COUNTERCLOCKWISE, BACK, FWD, FWD, BACK),
};

#undef PATTERN

// Every code except RESUME_AUTONOMOUS is a motion and needs a row. Appending a
// motion code without one fails the build here; test_move_patterns checks the
// rows name the right codes.
static_assert(sizeof(PATTERNS) / sizeof(PATTERNS[0]) == MOVE_CODE_COUNT - 1,
              "every motion code needs exactly one row in PATTERNS");

}  // namespace

const MovePattern* findMovePattern(MoveCode move) {
  for (const MovePattern& pattern : PATTERNS) {
    if (pattern.move == move) return &pattern;
  }
  return nullptr;
}

const char* moveName(MoveCode move) {
  const MovePattern* pattern = findMovePattern(move);
  return pattern == nullptr ? "UNKNOWN" : pattern->name;
}

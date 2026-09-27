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
// Transcribed from the eighteen per-move methods this table replaced, and not
// yet verified on the bench -- docs/bench-checklist.md says how.
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
    PATTERN(PIVOT_RIGHT_FORWARD, FREE, BACK, BACK, FREE),
    PATTERN(PIVOT_RIGHT_BACKWARD, FREE, FWD, FWD, FREE),
    PATTERN(PIVOT_LEFT_FORWARD, BACK, FREE, FREE, BACK),
    PATTERN(PIVOT_LEFT_BACKWARD, FWD, FREE, FREE, FWD),
    PATTERN(PIVOT_SIDEWAYS_FORWARD_RIGHT, FWD, BACK, FREE, FREE),
    PATTERN(PIVOT_SIDEWAYS_FORWARD_LEFT, FREE, FREE, BACK, FWD),
    PATTERN(PIVOT_SIDEWAYS_BACKWARD_RIGHT, FREE, FWD, FREE, BACK),
    PATTERN(PIVOT_SIDEWAYS_BACKWARD_LEFT, FWD, FREE, BACK, FREE),
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

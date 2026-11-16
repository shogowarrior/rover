#ifndef MOVE_PATTERNS_H
#define MOVE_PATTERNS_H

#include "MoveCodes.h"

// The complete wire-protocol-to-wheels mapping, in one auditable place, free
// of any motor library so it can be tested on the host (test/test_move_patterns).

// Which way one wheel turns during a move. Deliberately not FORWARD, BACKWARD
// and RELEASE: Adafruit_MotorShield.h #defines those names.
enum WheelDirection { WHEEL_FREE, WHEEL_FORWARD, WHEEL_BACKWARD };

// Wheel order used by every pattern and by DriveTrain, which maps each wheel
// to its motor-shield terminal (pins::MOTOR_TERMINAL).
enum Wheel { WHEEL_FRONT_LEFT, WHEEL_FRONT_RIGHT, WHEEL_REAR_RIGHT, WHEEL_REAR_LEFT, WHEEL_COUNT };

struct MovePattern {
  MoveCode move;
  const char* name;  // the code's name, reported as "move" in telemetry
  WheelDirection wheels[WHEEL_COUNT];
};

// The pattern for a motion, or nullptr for anything that is not one
// (RESUME_AUTONOMOUS, RUN_CHECKS, or a value outside the protocol).
const MovePattern* findMovePattern(MoveCode move);

// `wheel` alone, forward: the checks' (SelfTest), so the operator sees which
// wheel each motor terminal drives, and which way. Not a motion of the wire
// protocol: its `move` is STOP, and telemetry names it under "check".
const MovePattern& wheelAlone(Wheel wheel);

// The telemetry name of a motion, e.g. "MOVE_FORWARD"; "UNKNOWN" otherwise.
const char* moveName(MoveCode move);

#endif

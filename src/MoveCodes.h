#ifndef MOVE_CODES_H
#define MOVE_CODES_H

// Move codes are part of the WebSocket wire protocol. Clients in client/ and
// extras/joystick/ send these numeric values, and tools/check_protocol.py fails
// CI when their copies drift. Append new codes above MOVE_CODE_COUNT; never
// renumber existing ones.
//
// This header is deliberately free of Arduino dependencies so that the pure
// modules and their host-side tests can use it.

enum MoveCode {
  STOP = 0,
  MOVE_FORWARD = 1,
  MOVE_BACKWARD = 2,
  MOVE_RIGHT = 3,
  MOVE_LEFT = 4,
  MOVE_DIAGONAL45 = 5,
  MOVE_DIAGONAL135 = 6,
  MOVE_DIAGONAL225 = 7,
  MOVE_DIAGONAL315 = 8,
  PIVOT_RIGHT_FORWARD = 9,
  PIVOT_RIGHT_BACKWARD = 10,
  PIVOT_LEFT_FORWARD = 11,
  PIVOT_LEFT_BACKWARD = 12,
  PIVOT_SIDEWAYS_FORWARD_RIGHT = 13,
  PIVOT_SIDEWAYS_FORWARD_LEFT = 14,
  PIVOT_SIDEWAYS_BACKWARD_RIGHT = 15,
  PIVOT_SIDEWAYS_BACKWARD_LEFT = 16,
  ROTATE_CLOCKWISE = 17,
  ROTATE_COUNTERCLOCKWISE = 18,

  // Not a motion. Hands control back to autonomous exploration, which any
  // other command takes away. Without this, the first command a client sends
  // pins the rover in manual mode until it is power-cycled.
  RESUME_AUTONOMOUS = 19,

  MOVE_CODE_COUNT  // not a code: one past the last valid value
};

// True when `raw`, straight off the network, names a move code. Check this
// before casting: converting an out-of-range int to MoveCode is undefined
// behaviour, and the unknown-code-means-stop rule must not depend on it.
constexpr bool isMoveCode(int raw) { return raw >= STOP && raw < MOVE_CODE_COUNT; }

#endif

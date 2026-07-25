#ifndef MOVE_CODES_H
#define MOVE_CODES_H

// Move codes are part of the WebSocket wire protocol. Clients in client/ and
// extras/joystick/ send these numeric values. Append new codes; never
// renumber existing ones.
//
// This header is deliberately free of Arduino dependencies so that Kinematics
// and its host-side tests can use it.

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
};

#endif

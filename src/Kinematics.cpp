#include "Kinematics.h"

#include <math.h>
#include <stdlib.h>

#include "Tuning.h"

namespace kinematics {

static_assert(tuning::MOTOR_SPEED_LIMIT <= MOTOR_SPEED_MAX,
              "the speed limit must fit the motor driver's 0..255 range");

int clampInt(int value, int lo, int hi) {
  if (value < lo) return lo;
  if (value > hi) return hi;
  return value;
}

int clampSpeed(int speed) { return clampInt(speed, 0, tuning::MOTOR_SPEED_LIMIT); }

int clampDuration(int durationMs) {
  return clampInt(durationMs, 0, tuning::COMMAND_DURATION_MAX_MS);
}

float normalizeDistance(float rawCm) {
  // The HCSR04 library returns -1 when the echo pulse times out. Testing for
  // == 0 here (as an earlier version did) let -1 through, and -1 is below any
  // sane safe distance -- so every missed reading was interpreted as an
  // obstacle pressed against the sensor.
  if (rawCm < 0.0f) return DISTANCE_FAR_CM;
  return rawCm;
}

int stickSpeed(int x, int y, int maxSpeed) {
  if (maxSpeed <= 0) return 0;

  float magnitude = sqrtf(static_cast<float>(x) * x + static_cast<float>(y) * y);
  if (magnitude > STICK_AXIS_MAX) magnitude = STICK_AXIS_MAX;
  return static_cast<int>((magnitude * maxSpeed) / STICK_AXIS_MAX);
}

int triggerSpeed(int pressure, int maxSpeed) {
  if (maxSpeed <= 0) return 0;
  return clampInt(pressure, 0, TRIGGER_MAX) * maxSpeed / TRIGGER_MAX;
}

namespace {

// Stick deflection angle in degrees, normalised to [0, 360): 0 is right, 90 is
// up (forward). `yUp` is positive when the stick is pushed away from the user.
float stickAngleDeg(int x, int yUp) {
  float angle = atan2f(static_cast<float>(yUp), static_cast<float>(x)) * 180.0f / PI_F;
  if (angle < 0.0f) angle += 360.0f;
  return angle;
}

// The family the gamepad's shoulder buttons select under `scheme`: L1 pivots,
// R1 pivots sideways, and neither (or the NORMAL scheme) translates.
StickFamily gamepadFamily(const GamepadState& pad, ControlScheme scheme) {
  if (scheme != SCHEME_ADVANCED) return FAMILY_TRANSLATE;
  if (pad.l1) return FAMILY_PIVOT;
  if (pad.r1) return FAMILY_PIVOT_SIDEWAYS;
  return FAMILY_TRANSLATE;
}

}  // namespace

MoveCode moveForStick(int x, int yUp, StickFamily family) {
  // A pivot family has four motions, one per quadrant. Axis-aligned pushes
  // (x or yUp exactly 0) count as right and forward.
  const bool right = x >= 0;
  const bool forward = yUp >= 0;
  switch (family) {
    case FAMILY_PIVOT:
      if (forward) return right ? PIVOT_RIGHT_FORWARD : PIVOT_LEFT_FORWARD;
      return right ? PIVOT_RIGHT_BACKWARD : PIVOT_LEFT_BACKWARD;
    case FAMILY_PIVOT_SIDEWAYS:
      if (forward) return right ? PIVOT_SIDEWAYS_FORWARD_RIGHT : PIVOT_SIDEWAYS_FORWARD_LEFT;
      return right ? PIVOT_SIDEWAYS_BACKWARD_RIGHT : PIVOT_SIDEWAYS_BACKWARD_LEFT;
    case FAMILY_TRANSLATE:
      break;
  }

  // Translation: sector boundaries sit halfway between the eight headings.
  const float angle = stickAngleDeg(x, yUp);
  if (angle >= 337.5f || angle < 22.5f) return MOVE_RIGHT;
  if (angle < 67.5f) return MOVE_DIAGONAL45;
  if (angle < 112.5f) return MOVE_FORWARD;
  if (angle < 157.5f) return MOVE_DIAGONAL135;
  if (angle < 202.5f) return MOVE_LEFT;
  if (angle < 247.5f) return MOVE_DIAGONAL225;
  if (angle < 292.5f) return MOVE_BACKWARD;
  return MOVE_DIAGONAL315;
}

DriveRequest translateGamepad(const GamepadState& pad, int deadzone, int maxSpeed,
                              ControlScheme scheme) {
  // One move at a time: the stick wins over the triggers.
  if (abs(pad.lx) > deadzone || abs(pad.ly) > deadzone) {
    const int yUp = -pad.ly;  // the PS3 reports "pushed up" as negative
    const MoveCode move = moveForStick(pad.lx, yUp, gamepadFamily(pad, scheme));
    return {move, stickSpeed(pad.lx, yUp, maxSpeed)};
  }
  if (pad.l2 > deadzone) return {ROTATE_COUNTERCLOCKWISE, triggerSpeed(pad.l2, maxSpeed / 2)};
  if (pad.r2 > deadzone) return {ROTATE_CLOCKWISE, triggerSpeed(pad.r2, maxSpeed / 2)};
  return {STOP, 0};
}

}  // namespace kinematics

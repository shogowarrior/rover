#include "Kinematics.h"

#include <math.h>
#include <stdlib.h>

#include "Tuning.h"

namespace kinematics {

static_assert(tuning::MOTOR_SPEED_LIMIT <= MOTOR_SPEED_MAX,
              "the speed limit must fit the motor driver's 0..255 range");

namespace {

constexpr float PI_F = 3.14159265358979323846f;

int clampInt(int value, int lo, int hi) {
  if (value < lo) return lo;
  if (value > hi) return hi;
  return value;
}

}  // namespace

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

float stickAngleDeg(int x, int yUp) {
  float angle = atan2f(static_cast<float>(yUp), static_cast<float>(x)) * 180.0f / PI_F;
  if (angle < 0.0f) angle += 360.0f;
  return angle;
}

int stickSpeed(int x, int y, int maxSpeed) {
  if (maxSpeed <= 0) return 0;

  float magnitude = sqrtf(static_cast<float>(x) * x + static_cast<float>(y) * y);
  if (magnitude > STICK_AXIS_MAX) magnitude = STICK_AXIS_MAX;

  const int speed = static_cast<int>((magnitude * maxSpeed) / STICK_AXIS_MAX);
  return clampInt(speed, 0, maxSpeed);
}

MoveCode moveForStick(int x, int yUp) {
  // Sector boundaries sit halfway between the eight headings.
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

DriveRequest translateGamepad(const GamepadState& pad, int deadzone, int maxSpeed) {
  // The stick wins over the triggers when both are deflected. The rover can
  // only execute one move at a time, and an earlier version that collected
  // several into an array simply ran them back to back, so the last one won
  // after the others had each briefly twitched the wheels.
  if (abs(pad.lx) > deadzone || abs(pad.ly) > deadzone) {
    const int yUp = -pad.ly;  // the PS3 reports "pushed up" as negative
    return {moveForStick(pad.lx, yUp), stickSpeed(pad.lx, yUp, maxSpeed)};
  }
  if (pad.l2 > deadzone) return {ROTATE_COUNTERCLOCKWISE, stickSpeed(pad.l2, 0, maxSpeed / 2)};
  if (pad.r2 > deadzone) return {ROTATE_CLOCKWISE, stickSpeed(pad.r2, 0, maxSpeed / 2)};
  return {STOP, 0};
}

}  // namespace kinematics

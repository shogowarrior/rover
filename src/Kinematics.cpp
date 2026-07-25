#include "Kinematics.h"

#include <cmath>

namespace kinematics {

namespace {

constexpr float PI_F = 3.14159265358979323846f;

int clampInt(int value, int lo, int hi) {
  if (value < lo) return lo;
  if (value > hi) return hi;
  return value;
}

}  // namespace

float stickAngleDeg(int x, int y) {
  float angle = std::atan2(static_cast<float>(y), static_cast<float>(-x)) * 180.0f / PI_F;
  if (angle < 0.0f) angle += 360.0f;
  return angle;
}

int stickSpeed(int x, int y, int maxSpeed) {
  if (maxSpeed <= 0) return 0;

  float magnitude = std::sqrt(static_cast<float>(x) * x + static_cast<float>(y) * y);
  if (magnitude > STICK_AXIS_MAX) magnitude = STICK_AXIS_MAX;

  int speed = static_cast<int>((magnitude * maxSpeed) / STICK_AXIS_MAX);
  return clampInt(speed, 0, maxSpeed);
}

int clampSpeed(int speed) { return clampInt(speed, 0, MOTOR_SPEED_MAX); }

int clampDuration(int durationMs) { return clampInt(durationMs, 0, MOVE_DURATION_MAX_MS); }

float normalizeDistance(float rawCm) {
  // The HCSR04 library returns a negative value when the echo pulse times out.
  // Testing for == 0 here (as an earlier version did) let -1 through, and -1 is
  // below any sane safe distance -- so every missed reading was interpreted as
  // an obstacle pressed against the sensor.
  if (rawCm < 0.0f) return DISTANCE_FAR_CM;
  return rawCm;
}

ExploreDecision chooseExploreMove(float leftCm, float frontCm, float rightCm,
                                  float safeDistanceCm, int baseDurationMs) {
  const bool leftClear = leftCm > safeDistanceCm;
  const bool frontClear = frontCm > safeDistanceCm;
  const bool rightClear = rightCm > safeDistanceCm;

  if (frontClear && leftClear && rightClear) {
    return {MOVE_FORWARD, baseDurationMs};
  }

  // Something ahead: back off, then rescan before committing to a direction.
  if (!frontClear) {
    return {MOVE_BACKWARD, baseDurationMs / 2};
  }

  // Front is clear but both flanks are pinched -- a corridor too narrow to
  // strafe out of. Reverse rather than scrape along it.
  if (!leftClear && !rightClear) {
    return {MOVE_BACKWARD, baseDurationMs};
  }

  // One flank is close. Strafe away from it; mecanum wheels can do this
  // without changing heading.
  if (!leftClear) {
    return {MOVE_RIGHT, baseDurationMs};
  }
  return {MOVE_LEFT, baseDurationMs};
}

}  // namespace kinematics

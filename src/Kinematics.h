#ifndef KINEMATICS_H
#define KINEMATICS_H

#include "MoveCodes.h"

// Pure geometry, clamping, and decision logic.
//
// Nothing here touches Arduino, FreeRTOS, or any peripheral, which is the
// point: this is the part of the firmware that can be compiled and tested on
// the host (`pio test -e native`) instead of only on the board.
//
// Keep it that way. If a function in here needs millis(), a motor, or a Serial
// print, it belongs in Rover or Controller instead.

namespace kinematics {

// A joystick axis reports -128..127. The magnitude of two axes therefore
// reaches ~180 on a perfect diagonal, which is why speed mapping clamps
// magnitude before scaling -- otherwise a diagonal push returns 1.41x the
// requested maximum.
constexpr int STICK_AXIS_MAX = 127;

// Adafruit_DCMotor::setSpeed takes a uint8_t. Anything above 255 wraps around
// to a small number, so a client asking for 300 would quietly get 44.
constexpr int MOTOR_SPEED_MAX = 255;

// The longest a single command may hold the motors. A move is a nudge, not a
// journey; the client re-sends to keep going. Without this bound an
// unvalidated `duration` from the network pins the motors on for as long as it
// likes, and only a power cycle recovers.
constexpr int MOVE_DURATION_MAX_MS = 5000;

// HC-SR04 wrappers report a failed measurement as a negative number, not zero.
// A failure normally means the echo never came back, which for an ultrasonic
// sensor means nothing is within range -- so it normalises to "far", not to
// "touching". See normalizeDistance.
constexpr float DISTANCE_FAR_CM = 999.0f;

// Angle of a joystick deflection, in degrees, normalised to [0, 360).
float stickAngleDeg(int x, int y);

// Deflection magnitude scaled to [0, maxSpeed]. Saturates rather than
// overshooting on diagonals.
int stickSpeed(int x, int y, int maxSpeed);

// Clamp a speed from an untrusted source into what the motor driver accepts.
int clampSpeed(int speed);

// Clamp a duration from an untrusted source into a survivable range.
int clampDuration(int durationMs);

// Map a raw sensor reading onto a usable distance. Negative (no echo) becomes
// DISTANCE_FAR_CM; everything else passes through.
float normalizeDistance(float rawCm);

struct ExploreDecision {
  MoveCode move;
  int durationMs;
};

// Pick the next autonomous move from a three-point forward scan.
//
// Each call decides one move. Where the old blocking implementation reversed
// and turned as a single uninterruptible unit, this reverses and returns; the
// caller rescans before deciding to turn. That costs one extra scan cycle and
// buys a rover that re-senses between every motion.
ExploreDecision chooseExploreMove(float leftCm, float frontCm, float rightCm,
                                 float safeDistanceCm, int baseDurationMs);

}  // namespace kinematics

#endif

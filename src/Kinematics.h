#ifndef KINEMATICS_H
#define KINEMATICS_H

#include "MoveCodes.h"

// Pure geometry, clamping and input mapping. Pure core (AGENTS.md,
// Architecture): no Arduino here, so it is host-tested in test/test_kinematics.

namespace kinematics {

constexpr float PI_F = 3.14159265358979323846f;

// A joystick axis reports -128..127. The magnitude of two axes therefore
// reaches ~180 on a perfect diagonal, which is why speed mapping clamps
// magnitude before scaling -- otherwise a diagonal push returns 1.41x the
// requested maximum.
constexpr int STICK_AXIS_MAX = 127;

// Adafruit_DCMotor::setSpeed takes a uint8_t. Anything above 255 wraps around
// to a small number, so a client asking for 300 would quietly get 44.
// SPEED_MAX in extras/joystick/js/protocol.js is the panel's copy, and
// tools/check_protocol.py checks it.
constexpr int MOTOR_SPEED_MAX = 255;

// HCSR04 2.0.0's measureDistanceCm() returns -1 for every failed measurement:
// no echo within range (~400 cm), an echo deflected away by an angled surface,
// and a dead or unplugged sensor alike. It never returns 0. For avoidance a
// missing echo is read as "nothing within range", so it normalises to "far",
// safe only because Explorer never drives on a sweep that heard nothing
// (AGENTS.md, Invariants). Telemetry sends it as is: FAR_CM in
// extras/joystick/js/protocol.js and DISTANCE_FAR_CM in client/drive.py are
// copies, and tools/check_protocol.py checks them.
constexpr float DISTANCE_FAR_CM = 999.0f;

// `value`, limited to lo..hi.
int clampInt(int value, int lo, int hi);

// Clamp a speed from an untrusted source into what the motors may be given
// (tuning::MOTOR_SPEED_LIMIT, never above the driver's 255).
int clampSpeed(int speed);

// Clamp a duration from an untrusted source to tuning::COMMAND_DURATION_MAX_MS.
int clampDuration(int durationMs);

// Map a raw sensor reading onto a usable distance. Negative (no echo) becomes
// DISTANCE_FAR_CM; everything else passes through.
float normalizeDistance(float rawCm);

// Deflection magnitude scaled to [0, maxSpeed]. Saturates rather than
// overshooting on diagonals.
int stickSpeed(int x, int y, int maxSpeed);

// The PS3's analogue triggers, L2 and R2, report 0..255: twice a stick axis.
constexpr int TRIGGER_MAX = 255;

// Trigger pressure scaled to [0, maxSpeed] over the trigger's whole travel.
int triggerSpeed(int pressure, int maxSpeed);

// How a controller's stick and buttons map onto the 18 mecanum motions. The
// rover holds one scheme for every controller (the default is in Features.h;
// PS3 SELECT and the panel's toggle change it), so the gamepad and the panel
// always agree.
//   NORMAL    the everyday ten: the stick translates in eight directions,
//             L2/R2 (the panel's rotate buttons) rotate.
//   ADVANCED  all eighteen: as NORMAL, plus the pivots. Hold L1 (or pick
//             "Pivot" on the panel) and the stick's quadrant picks a pivot
//             turn; hold R1 ("Pivot sideways") for a pivot about an axle.
enum ControlScheme { SCHEME_NORMAL, SCHEME_ADVANCED };

// Which family of motions a stick deflection selects.
enum StickFamily { FAMILY_TRANSLATE, FAMILY_PIVOT, FAMILY_PIVOT_SIDEWAYS };

// The mecanum move for a deflected stick. TRANSLATE: eight 45-degree sectors,
// so the rover moves in the direction pushed without turning. PIVOT and
// PIVOT_SIDEWAYS: the quadrant picks one of four pivots (up-right is
// ..._RIGHT_FORWARD / ..._FORWARD_RIGHT, down-left ..._LEFT_BACKWARD /
// ..._BACKWARD_LEFT). extras/joystick/js/mecanum.js is the panel's copy, and
// both are tested against test/vectors/stick_moves.json. The caller rejects a
// centred stick first: this always returns a motion.
MoveCode moveForStick(int x, int yUp, StickFamily family);

// One reading of the PS3 controls the rover uses, in the controller's own
// convention: axes -128..127 with ly NEGATIVE when pushed up; triggers 0..255;
// shoulder buttons held or not.
struct GamepadState {
  int lx;
  int ly;
  int l2;
  int r2;
  bool l1;
  bool r1;
};

struct DriveRequest {
  MoveCode move;
  int speed;
};

// What the gamepad is asking for. The left stick moves within the family the
// shoulder buttons select (see ControlScheme); with the stick centred, L2
// rotates left (counter-clockwise) and R2 right, at up to half the stick's
// speed, by how far the trigger is pulled. Returns {STOP, 0} when nothing is
// deflected past the deadzone, which the triggers share with the stick.
DriveRequest translateGamepad(const GamepadState& pad, int deadzone, int maxSpeed,
                              ControlScheme scheme);

}  // namespace kinematics

#endif

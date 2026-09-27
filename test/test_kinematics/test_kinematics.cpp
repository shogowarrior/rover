#include <ArduinoJson.h>
#include <stdio.h>
#include <string.h>
#include <unity.h>

#include "Kinematics.h"
#include "MovePatterns.h"
#include "Tuning.h"

// Host-side tests for the parts of the firmware that do not touch hardware.
// Run with: ~/.platformio/penv/bin/pio test -e native
//
// Most of these are regression tests for specific bugs. Where that is the
// case the comment says which one, because a test whose reason is forgotten
// is a test someone deletes.

using namespace kinematics;

void setUp(void) {}
void tearDown(void) {}

// --- normalizeDistance -----------------------------------------------------

// The HCSR04 wrapper returns -1 on a timeout, but the old code tested for == 0.
// A missed reading therefore stayed -1, which is below any safe distance, so
// the rover read "nothing in range" as "obstacle against the sensor".
void test_no_echo_reads_as_far(void) {
  TEST_ASSERT_EQUAL_FLOAT(DISTANCE_FAR_CM, normalizeDistance(-1.0f));
}

// HCSR04 2.0.0 never returns 0, so this cannot happen with the current
// library. It stays as a guard: mapping 0 to "far" would be the -1 bug
// pointed the other way, and far more dangerous.
void test_zero_distance_is_not_treated_as_far(void) {
  TEST_ASSERT_EQUAL_FLOAT(0.0f, normalizeDistance(0.0f));
}

void test_valid_distance_passes_through(void) {
  TEST_ASSERT_EQUAL_FLOAT(42.5f, normalizeDistance(42.5f));
}

// --- clamping --------------------------------------------------------------

// Adafruit_DCMotor::setSpeed takes a uint8_t, so an unclamped 300 wrapped to 44
// and the rover quietly ran slower than a client asking for less would get.
void test_speed_above_driver_range_saturates(void) {
  TEST_ASSERT_EQUAL_INT(tuning::MOTOR_SPEED_LIMIT, clampSpeed(300));
  TEST_ASSERT_EQUAL_INT(tuning::MOTOR_SPEED_LIMIT, clampSpeed(1000000));
  TEST_ASSERT_LESS_OR_EQUAL_INT(MOTOR_SPEED_MAX, clampSpeed(1000000));
}

void test_negative_speed_becomes_zero(void) { TEST_ASSERT_EQUAL_INT(0, clampSpeed(-20)); }

void test_speed_in_range_is_untouched(void) { TEST_ASSERT_EQUAL_INT(64, clampSpeed(64)); }

// An unclamped duration from the network held the motors on until it expired.
// Two billion milliseconds is 23 days of driving that only a power cycle stops.
// The cap is also the deadman: no command outlives it.
void test_absurd_duration_saturates(void) {
  TEST_ASSERT_EQUAL_INT(tuning::COMMAND_DURATION_MAX_MS, clampDuration(2000000000));
}

void test_negative_duration_becomes_zero(void) { TEST_ASSERT_EQUAL_INT(0, clampDuration(-1)); }

void test_duration_in_range_is_untouched(void) { TEST_ASSERT_EQUAL_INT(750, clampDuration(750)); }

// --- stick handling --------------------------------------------------------

// Magnitude of two axes reaches ~180 on a diagonal, but the old mapping used an
// input range of 0..127, so a diagonal push returned 1.41x the requested cap.
void test_diagonal_stick_does_not_exceed_max_speed(void) {
  const int speed = stickSpeed(127, 127, 50);
  TEST_ASSERT_LESS_OR_EQUAL_INT(50, speed);
  TEST_ASSERT_EQUAL_INT(50, speed);  // saturates rather than being scaled down
}

void test_full_single_axis_gives_max_speed(void) {
  TEST_ASSERT_EQUAL_INT(50, stickSpeed(127, 0, 50));
}

void test_centred_stick_gives_zero_speed(void) { TEST_ASSERT_EQUAL_INT(0, stickSpeed(0, 0, 50)); }

void test_half_deflection_gives_about_half_speed(void) {
  const int speed = stickSpeed(64, 0, 100);
  TEST_ASSERT_INT_WITHIN(2, 50, speed);
}

void test_angle_is_normalised_into_zero_to_360(void) {
  for (int x = -127; x <= 127; x += 17) {
    for (int y = -127; y <= 127; y += 17) {
      const float angle = stickAngleDeg(x, y);
      TEST_ASSERT_TRUE(angle >= 0.0f);
      TEST_ASSERT_TRUE(angle < 360.0f);
    }
  }
}

// The old angle used atan2(y, -x), a mirrored convention: "right" came out at
// 180 degrees, on the boundary between forward and backward.
void test_angle_convention_is_right_zero_up_ninety(void) {
  TEST_ASSERT_FLOAT_WITHIN(0.01f, 0.0f, stickAngleDeg(100, 0));
  TEST_ASSERT_FLOAT_WITHIN(0.01f, 90.0f, stickAngleDeg(0, 100));
  TEST_ASSERT_FLOAT_WITHIN(0.01f, 180.0f, stickAngleDeg(-100, 0));
  TEST_ASSERT_FLOAT_WITHIN(0.01f, 270.0f, stickAngleDeg(0, -100));
}

void test_stick_maps_to_all_eight_mecanum_directions(void) {
  TEST_ASSERT_EQUAL_INT(MOVE_FORWARD, moveForStick(0, 100));
  TEST_ASSERT_EQUAL_INT(MOVE_BACKWARD, moveForStick(0, -100));
  TEST_ASSERT_EQUAL_INT(MOVE_RIGHT, moveForStick(100, 0));
  TEST_ASSERT_EQUAL_INT(MOVE_LEFT, moveForStick(-100, 0));
  TEST_ASSERT_EQUAL_INT(MOVE_DIAGONAL45, moveForStick(100, 100));
  TEST_ASSERT_EQUAL_INT(MOVE_DIAGONAL135, moveForStick(-100, 100));
  TEST_ASSERT_EQUAL_INT(MOVE_DIAGONAL225, moveForStick(-100, -100));
  TEST_ASSERT_EQUAL_INT(MOVE_DIAGONAL315, moveForStick(100, -100));
}

// A little noise on the other axis must not flip the direction. The old
// mapping chattered between forward and backward for a sideways push.
void test_sideways_push_is_stable_against_axis_noise(void) {
  TEST_ASSERT_EQUAL_INT(MOVE_RIGHT, moveForStick(127, 1));
  TEST_ASSERT_EQUAL_INT(MOVE_RIGHT, moveForStick(127, -1));
  TEST_ASSERT_EQUAL_INT(MOVE_LEFT, moveForStick(-127, 1));
  TEST_ASSERT_EQUAL_INT(MOVE_LEFT, moveForStick(-127, -1));
}

// --- gamepad ---------------------------------------------------------------

namespace {
DriveRequest pad(int lx, int ly, int l2, int r2) {
  const GamepadState state = {lx, ly, l2, r2, false, false};
  return translateGamepad(state, 20, 50);
}

DriveRequest advancedPad(int lx, int ly, bool l1, bool r1) {
  const GamepadState state = {lx, ly, 0, 0, l1, r1};
  return translateGamepad(state, 20, 50, SCHEME_ADVANCED);
}
}  // namespace

// The PS3 reports "pushed up" as a negative ly. The old mapping ignored that,
// so pushing the stick up drove the rover backwards.
void test_gamepad_stick_up_drives_forward(void) {
  const DriveRequest request = pad(0, -128, 0, 0);
  TEST_ASSERT_EQUAL_INT(MOVE_FORWARD, request.move);
  TEST_ASSERT_EQUAL_INT(50, request.speed);
}

void test_gamepad_stick_sideways_strafes(void) {
  TEST_ASSERT_EQUAL_INT(MOVE_RIGHT, pad(127, 0, 0, 0).move);
  TEST_ASSERT_EQUAL_INT(MOVE_LEFT, pad(-128, 0, 0, 0).move);
}

void test_gamepad_inside_deadzone_is_stop(void) {
  const DriveRequest request = pad(15, -15, 10, 10);
  TEST_ASSERT_EQUAL_INT(STOP, request.move);
  TEST_ASSERT_EQUAL_INT(0, request.speed);
}

void test_gamepad_triggers_rotate_at_half_speed(void) {
  const DriveRequest left = pad(0, 0, 255, 0);
  TEST_ASSERT_EQUAL_INT(ROTATE_COUNTERCLOCKWISE, left.move);
  TEST_ASSERT_EQUAL_INT(25, left.speed);
  TEST_ASSERT_EQUAL_INT(ROTATE_CLOCKWISE, pad(0, 0, 0, 255).move);
}

// Only one move can run at a time; the stick takes precedence.
void test_gamepad_stick_beats_triggers(void) {
  TEST_ASSERT_EQUAL_INT(MOVE_FORWARD, pad(0, -128, 255, 255).move);
}

// --- control schemes -------------------------------------------------------

void test_pivot_family_picks_by_quadrant(void) {
  TEST_ASSERT_EQUAL_INT(PIVOT_RIGHT_FORWARD, moveForStick(60, 60, FAMILY_PIVOT));
  TEST_ASSERT_EQUAL_INT(PIVOT_LEFT_FORWARD, moveForStick(-60, 60, FAMILY_PIVOT));
  TEST_ASSERT_EQUAL_INT(PIVOT_RIGHT_BACKWARD, moveForStick(60, -60, FAMILY_PIVOT));
  TEST_ASSERT_EQUAL_INT(PIVOT_LEFT_BACKWARD, moveForStick(-60, -60, FAMILY_PIVOT));
  TEST_ASSERT_EQUAL_INT(PIVOT_SIDEWAYS_FORWARD_RIGHT, moveForStick(60, 60, FAMILY_PIVOT_SIDEWAYS));
  TEST_ASSERT_EQUAL_INT(PIVOT_SIDEWAYS_FORWARD_LEFT, moveForStick(-60, 60, FAMILY_PIVOT_SIDEWAYS));
  TEST_ASSERT_EQUAL_INT(PIVOT_SIDEWAYS_BACKWARD_RIGHT, moveForStick(60, -60, FAMILY_PIVOT_SIDEWAYS));
  TEST_ASSERT_EQUAL_INT(PIVOT_SIDEWAYS_BACKWARD_LEFT, moveForStick(-60, -60, FAMILY_PIVOT_SIDEWAYS));
}

// NORMAL ignores the shoulder buttons: L1 held by habit must not turn a
// strafe into a pivot.
void test_normal_scheme_ignores_shoulder_buttons(void) {
  const GamepadState held = {127, 0, 0, 0, true, true};
  TEST_ASSERT_EQUAL_INT(FAMILY_TRANSLATE, gamepadFamily(held, SCHEME_NORMAL));
  TEST_ASSERT_EQUAL_INT(MOVE_RIGHT, translateGamepad(held, 20, 50, SCHEME_NORMAL).move);
}

void test_advanced_scheme_shoulders_pick_the_pivots(void) {
  TEST_ASSERT_EQUAL_INT(MOVE_DIAGONAL45, advancedPad(100, -100, false, false).move);
  TEST_ASSERT_EQUAL_INT(PIVOT_RIGHT_FORWARD, advancedPad(100, -100, true, false).move);
  TEST_ASSERT_EQUAL_INT(PIVOT_SIDEWAYS_BACKWARD_LEFT, advancedPad(-100, 100, false, true).move);
  TEST_ASSERT_EQUAL_INT(PIVOT_LEFT_FORWARD, advancedPad(-100, -100, true, true).move);  // L1 wins
}

// A shoulder button alone, stick centred, is not a motion.
void test_advanced_shoulder_without_stick_is_stop(void) {
  TEST_ASSERT_EQUAL_INT(STOP, advancedPad(0, 0, true, false).move);
  TEST_ASSERT_EQUAL_INT(STOP, advancedPad(10, -10, false, true).move);
}

// The pivots keep the stick's speed mapping: a full push is full speed.
void test_advanced_pivot_speed_follows_the_stick(void) {
  TEST_ASSERT_EQUAL_INT(50, advancedPad(0, -127, true, false).speed);
  TEST_ASSERT_EQUAL_INT(25, advancedPad(0, -64, true, false).speed);
}

namespace {

StickFamily familyNamed(const char* name) {
  if (strcmp(name, "PIVOT") == 0) return FAMILY_PIVOT;
  if (strcmp(name, "PIVOT_SIDEWAYS") == 0) return FAMILY_PIVOT_SIDEWAYS;
  TEST_ASSERT_EQUAL_STRING("TRANSLATE", name);
  return FAMILY_TRANSLATE;
}

// The test runner starts in the project directory.
bool loadVectors(JsonDocument& doc) {
  FILE* file = fopen("test/vectors/stick_moves.json", "rb");
  if (file == nullptr) return false;
  static char text[8192];
  const size_t length = fread(text, 1, sizeof(text), file);
  fclose(file);
  if (length == sizeof(text)) return false;  // outgrew the buffer
  return !deserializeJson(doc, text, length);
}

}  // namespace

// The panel's mecanum.js is tested against the same file, so the stick on
// screen and the stick on the pad pick the same move for the same push.
void test_stick_matches_the_shared_vectors(void) {
  JsonDocument doc;
  TEST_ASSERT_TRUE_MESSAGE(loadVectors(doc), "test/vectors/stick_moves.json");
  JsonArrayConst cases = doc["cases"].as<JsonArrayConst>();
  TEST_ASSERT_TRUE(cases.size() >= 20);
  for (JsonObjectConst c : cases) {
    char label[96];
    snprintf(label, sizeof(label), "x=%d yUp=%d %s", c["x"].as<int>(), c["yUp"].as<int>(),
             c["family"].as<const char*>());
    const MoveCode move = moveForStick(c["x"], c["yUp"], familyNamed(c["family"]));
    TEST_ASSERT_EQUAL_STRING_MESSAGE(c["move"].as<const char*>(), moveName(move), label);
  }
}

int main(int, char**) {
  UNITY_BEGIN();

  RUN_TEST(test_no_echo_reads_as_far);
  RUN_TEST(test_zero_distance_is_not_treated_as_far);
  RUN_TEST(test_valid_distance_passes_through);

  RUN_TEST(test_speed_above_driver_range_saturates);
  RUN_TEST(test_negative_speed_becomes_zero);
  RUN_TEST(test_speed_in_range_is_untouched);
  RUN_TEST(test_absurd_duration_saturates);
  RUN_TEST(test_negative_duration_becomes_zero);
  RUN_TEST(test_duration_in_range_is_untouched);

  RUN_TEST(test_diagonal_stick_does_not_exceed_max_speed);
  RUN_TEST(test_full_single_axis_gives_max_speed);
  RUN_TEST(test_centred_stick_gives_zero_speed);
  RUN_TEST(test_half_deflection_gives_about_half_speed);
  RUN_TEST(test_angle_is_normalised_into_zero_to_360);
  RUN_TEST(test_angle_convention_is_right_zero_up_ninety);
  RUN_TEST(test_stick_maps_to_all_eight_mecanum_directions);
  RUN_TEST(test_sideways_push_is_stable_against_axis_noise);

  RUN_TEST(test_gamepad_stick_up_drives_forward);
  RUN_TEST(test_gamepad_stick_sideways_strafes);
  RUN_TEST(test_gamepad_inside_deadzone_is_stop);
  RUN_TEST(test_gamepad_triggers_rotate_at_half_speed);
  RUN_TEST(test_gamepad_stick_beats_triggers);

  RUN_TEST(test_pivot_family_picks_by_quadrant);
  RUN_TEST(test_normal_scheme_ignores_shoulder_buttons);
  RUN_TEST(test_advanced_scheme_shoulders_pick_the_pivots);
  RUN_TEST(test_advanced_shoulder_without_stick_is_stop);
  RUN_TEST(test_advanced_pivot_speed_follows_the_stick);
  RUN_TEST(test_stick_matches_the_shared_vectors);

  return UNITY_END();
}

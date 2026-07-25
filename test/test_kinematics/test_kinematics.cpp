#include <unity.h>

#include "Kinematics.h"

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

// Zero is a real (if implausible) reading, not the error sentinel. Mapping it
// to "far" would be the same bug pointed the other way, and far more dangerous.
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
  TEST_ASSERT_EQUAL_INT(255, clampSpeed(300));
  TEST_ASSERT_EQUAL_INT(255, clampSpeed(1000000));
}

void test_negative_speed_becomes_zero(void) { TEST_ASSERT_EQUAL_INT(0, clampSpeed(-20)); }

void test_speed_in_range_is_untouched(void) { TEST_ASSERT_EQUAL_INT(64, clampSpeed(64)); }

// An unclamped duration from the network held the motors on until it expired.
// Two billion milliseconds is 23 days of driving that only a power cycle stops.
void test_absurd_duration_saturates(void) {
  TEST_ASSERT_EQUAL_INT(MOVE_DURATION_MAX_MS, clampDuration(2000000000));
}

void test_negative_duration_becomes_zero(void) {
  TEST_ASSERT_EQUAL_INT(0, clampDuration(-1));
}

void test_duration_in_range_is_untouched(void) {
  TEST_ASSERT_EQUAL_INT(750, clampDuration(750));
}

// --- stick handling --------------------------------------------------------

// magnitude of two axes reaches ~180 on a diagonal, but the old mapping used an
// input range of 0..127, so a diagonal push returned 1.41x the requested cap.
void test_diagonal_stick_does_not_exceed_max_speed(void) {
  const int speed = stickSpeed(127, 127, 50);
  TEST_ASSERT_LESS_OR_EQUAL_INT(50, speed);
  TEST_ASSERT_EQUAL_INT(50, speed);  // saturates rather than being scaled down
}

void test_full_single_axis_gives_max_speed(void) {
  TEST_ASSERT_EQUAL_INT(50, stickSpeed(127, 0, 50));
}

void test_centred_stick_gives_zero_speed(void) {
  TEST_ASSERT_EQUAL_INT(0, stickSpeed(0, 0, 50));
}

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

// --- explore decisions -----------------------------------------------------

void test_all_clear_drives_forward(void) {
  const ExploreDecision d = chooseExploreMove(100, 100, 100, 30, 750);
  TEST_ASSERT_EQUAL_INT(MOVE_FORWARD, d.move);
  TEST_ASSERT_EQUAL_INT(750, d.durationMs);
}

// Backing off is deliberately shorter than a forward move, and the caller
// rescans before deciding which way to turn.
void test_obstacle_ahead_reverses_briefly(void) {
  const ExploreDecision d = chooseExploreMove(100, 10, 100, 30, 750);
  TEST_ASSERT_EQUAL_INT(MOVE_BACKWARD, d.move);
  TEST_ASSERT_EQUAL_INT(375, d.durationMs);
}

void test_pinched_on_both_sides_reverses(void) {
  const ExploreDecision d = chooseExploreMove(10, 100, 10, 30, 750);
  TEST_ASSERT_EQUAL_INT(MOVE_BACKWARD, d.move);
  TEST_ASSERT_EQUAL_INT(750, d.durationMs);
}

void test_obstacle_on_left_strafes_right(void) {
  const ExploreDecision d = chooseExploreMove(10, 100, 100, 30, 750);
  TEST_ASSERT_EQUAL_INT(MOVE_RIGHT, d.move);
}

void test_obstacle_on_right_strafes_left(void) {
  const ExploreDecision d = chooseExploreMove(100, 100, 10, 30, 750);
  TEST_ASSERT_EQUAL_INT(MOVE_LEFT, d.move);
}

// A distance exactly at the threshold counts as blocked, not clear.
void test_reading_exactly_at_safe_distance_counts_as_blocked(void) {
  const ExploreDecision d = chooseExploreMove(100, 30, 100, 30, 750);
  TEST_ASSERT_EQUAL_INT(MOVE_BACKWARD, d.move);
}

// End-to-end on the original bug: three sensors that all time out must read as
// open space and let the rover drive, not freeze it against phantom walls.
void test_all_sensors_timing_out_is_open_space(void) {
  const ExploreDecision d =
      chooseExploreMove(normalizeDistance(-1.0f), normalizeDistance(-1.0f),
                        normalizeDistance(-1.0f), 30, 750);
  TEST_ASSERT_EQUAL_INT(MOVE_FORWARD, d.move);
}

int main(int, char **) {
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

  RUN_TEST(test_all_clear_drives_forward);
  RUN_TEST(test_obstacle_ahead_reverses_briefly);
  RUN_TEST(test_pinched_on_both_sides_reverses);
  RUN_TEST(test_obstacle_on_left_strafes_right);
  RUN_TEST(test_obstacle_on_right_strafes_left);
  RUN_TEST(test_reading_exactly_at_safe_distance_counts_as_blocked);
  RUN_TEST(test_all_sensors_timing_out_is_open_space);

  return UNITY_END();
}

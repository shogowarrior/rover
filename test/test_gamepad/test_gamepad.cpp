#include <unity.h>

#include "../fakes/FakeHardware.h"
#include "GamepadSession.h"
#include "Tuning.h"

// The gamepad's rules, on the host: what a held stick, a released stick, a
// silent pad and START do to the rover. The PS3 library itself stays in
// Gamepad.cpp; GamepadSession gets the controls the way it would from the
// Bluetooth mailbox.

namespace {

FakeMotors* motors;
FakeScanner* scanner;
Rover* rover;
kinematics::ControlScheme scheme;
GamepadSession* session;

GamepadReport pad(int lx, int ly, int l2, int r2, uint32_t reportedAt) {
  GamepadReport report;
  report.controls = {lx, ly, l2, r2, false, false};
  report.hasReport = true;
  report.lastReportMs = reportedAt;
  return report;
}

// Feeds a fresh report every 10 ms, as a connected pad would, from `from`
// for `ms`, running the rover alongside. Returns the new time.
uint32_t hold(const GamepadReport& controls, uint32_t from, uint32_t ms) {
  uint32_t now = from;
  for (; now < from + ms; now += 10) {
    GamepadReport report = controls;
    report.lastReportMs = now;
    session->update(report, now);
    rover->update(now);
  }
  return now;
}

}  // namespace

void setUp(void) {
  motors = new FakeMotors();
  scanner = new FakeScanner();
  rover = new Rover(*motors, *scanner);
  scheme = kinematics::SCHEME_NORMAL;
  session = new GamepadSession(*rover, scheme);
}

void tearDown(void) {
  delete session;
  delete rover;
  delete scanner;
  delete motors;
}

// A pad lying on the table must never touch an exploring rover: an idle pad
// that streamed STOPs would force manual mode over and over.
void test_resting_pad_leaves_exploration_alone(void) {
  rover->begin(Rover::MODE_AUTONOMOUS, 0);
  hold(pad(0, 0, 0, 0, 0), 0, 3000);
  TEST_ASSERT_EQUAL_INT(Rover::MODE_AUTONOMOUS, rover->mode());
}

// Each command lasts DEFAULT_MOVE_DURATION_MS. Sending only on change, as the
// old callback did, stopped a steadily held stick after 750 ms.
void test_held_stick_keeps_the_rover_moving(void) {
  rover->begin(Rover::MODE_MANUAL, 0);
  hold(pad(0, -127, 0, 0, 0), 0, 3 * tuning::DEFAULT_MOVE_DURATION_MS);
  TEST_ASSERT_TRUE(motors->driving);
  TEST_ASSERT_EQUAL_INT(MOVE_FORWARD, motors->lastPattern->move);
}

void test_release_sends_one_stop(void) {
  rover->begin(Rover::MODE_MANUAL, 0);
  uint32_t now = hold(pad(0, -127, 0, 0, 0), 0, 500);
  now = hold(pad(0, 0, 0, 0, 0), now, 20);
  TEST_ASSERT_FALSE(motors->driving);
  const int releases = motors->releaseCalls;
  hold(pad(0, 0, 0, 0, 0), now, 2000);
  TEST_ASSERT_EQUAL_INT(releases, motors->releaseCalls);  // and nothing more
}

// The library never reports a disconnect. Silence is the only sign the pad
// has gone, and what it was driving must stop.
void test_silent_pad_stops_what_it_drove(void) {
  rover->begin(Rover::MODE_MANUAL, 0);
  uint32_t now = hold(pad(0, -127, 0, 0, 0), 0, 500);
  const GamepadReport lastWords = pad(0, -127, 0, 0, now - 10);  // stick still forward
  for (uint32_t t = now; t < now + tuning::GAMEPAD_SILENCE_MS + 50; t += 10) session->update(lastWords, t);
  TEST_ASSERT_FALSE(motors->driving);
}

// An age check written with the signed deadline idiom reads a report 25 days
// old as fresh. Silence must stay silence, however long.
void test_ancient_report_is_not_fresh(void) {
  rover->begin(Rover::MODE_MANUAL, 0);
  const uint32_t reportedAt = 1000;
  const uint32_t muchLater = reportedAt + 0x80000000u + 1000;  // over 24.8 days
  session->update(pad(0, -127, 0, 0, reportedAt), muchLater);
  TEST_ASSERT_FALSE(motors->driving);
  TEST_ASSERT_EQUAL_INT(0, motors->driveCalls);
}

void test_no_report_yet_sends_nothing(void) {
  rover->begin(Rover::MODE_AUTONOMOUS, 0);
  GamepadReport nothing;
  for (uint32_t t = 0; t < 1000; t += 10) session->update(nothing, t);
  TEST_ASSERT_EQUAL_INT(Rover::MODE_AUTONOMOUS, rover->mode());
}

void test_start_hands_control_back_to_exploration(void) {
  rover->begin(Rover::MODE_MANUAL, 0);
  uint32_t now = hold(pad(0, -127, 0, 0, 0), 0, 300);
  GamepadReport start = pad(0, 0, 0, 0, now);
  start.startPressed = true;
  session->update(start, now);
  TEST_ASSERT_EQUAL_INT(Rover::MODE_AUTONOMOUS, rover->mode());
  hold(pad(0, 0, 0, 0, 0), now + 10, 1000);  // resting afterwards changes nothing
  TEST_ASSERT_EQUAL_INT(Rover::MODE_AUTONOMOUS, rover->mode());
}

// A new direction goes at once; a new speed in the same direction waits up
// to GAMEPAD_SPEED_CHANGE_MS, because each costs a four-motor rewrite.
void test_speed_changes_are_rate_limited(void) {
  rover->begin(Rover::MODE_MANUAL, 0);
  session->update(pad(0, -127, 0, 0, 0), 0);
  TEST_ASSERT_EQUAL_INT(1, motors->driveCalls);
  session->update(pad(0, -100, 0, 0, 10), 10);  // slower, 10 ms later
  TEST_ASSERT_EQUAL_INT(1, motors->driveCalls);
  session->update(pad(0, -100, 0, 0, tuning::GAMEPAD_SPEED_CHANGE_MS), tuning::GAMEPAD_SPEED_CHANGE_MS);
  TEST_ASSERT_EQUAL_INT(2, motors->driveCalls);
  session->update(pad(127, 0, 0, 0, tuning::GAMEPAD_SPEED_CHANGE_MS + 10), tuning::GAMEPAD_SPEED_CHANGE_MS + 10);
  TEST_ASSERT_EQUAL_INT(MOVE_RIGHT, motors->lastPattern->move);  // new direction: at once
}

GamepadReport pressSelect(uint32_t now) {
  GamepadReport report = pad(0, 0, 0, 0, now);
  report.selectPressed = true;
  return report;
}

// SELECT flips the scheme both ways, and by itself neither moves the rover
// nor takes control from exploration.
void test_select_toggles_the_scheme_without_taking_control(void) {
  rover->begin(Rover::MODE_AUTONOMOUS, 0);
  session->update(pressSelect(0), 0);
  TEST_ASSERT_EQUAL_INT(kinematics::SCHEME_ADVANCED, scheme);
  session->update(pressSelect(10), 10);
  TEST_ASSERT_EQUAL_INT(kinematics::SCHEME_NORMAL, scheme);
  TEST_ASSERT_EQUAL_INT(Rover::MODE_AUTONOMOUS, rover->mode());
  TEST_ASSERT_EQUAL_INT(0, motors->driveCalls);
}

// Under ADVANCED, holding L1 turns the stick into the pivots.
void test_advanced_l1_pivots(void) {
  rover->begin(Rover::MODE_MANUAL, 0);
  session->update(pressSelect(0), 0);
  GamepadReport pivot = pad(100, -100, 0, 0, 0);  // up and right
  pivot.controls.l1 = true;
  hold(pivot, 10, 100);
  TEST_ASSERT_TRUE(motors->driving);
  TEST_ASSERT_EQUAL_INT(PIVOT_RIGHT_FORWARD, motors->lastPattern->move);
}

// The scheme is shared: a change made elsewhere (the panel) applies to a stick
// already held, at once, as a change of direction.
void test_scheme_change_redirects_a_held_stick(void) {
  rover->begin(Rover::MODE_MANUAL, 0);
  GamepadReport held = pad(-100, 100, 0, 0, 0);  // down and left
  held.controls.r1 = true;
  uint32_t now = hold(held, 0, 100);
  TEST_ASSERT_EQUAL_INT(MOVE_DIAGONAL225, motors->lastPattern->move);  // NORMAL: R1 ignored
  scheme = kinematics::SCHEME_ADVANCED;
  hold(held, now, 20);
  TEST_ASSERT_EQUAL_INT(PIVOT_SIDEWAYS_BACKWARD_LEFT, motors->lastPattern->move);
}

int main(int, char**) {
  UNITY_BEGIN();
  RUN_TEST(test_resting_pad_leaves_exploration_alone);
  RUN_TEST(test_held_stick_keeps_the_rover_moving);
  RUN_TEST(test_release_sends_one_stop);
  RUN_TEST(test_silent_pad_stops_what_it_drove);
  RUN_TEST(test_ancient_report_is_not_fresh);
  RUN_TEST(test_no_report_yet_sends_nothing);
  RUN_TEST(test_start_hands_control_back_to_exploration);
  RUN_TEST(test_speed_changes_are_rate_limited);
  RUN_TEST(test_select_toggles_the_scheme_without_taking_control);
  RUN_TEST(test_advanced_l1_pivots);
  RUN_TEST(test_scheme_change_redirects_a_held_stick);
  return UNITY_END();
}

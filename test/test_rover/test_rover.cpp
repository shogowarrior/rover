#include <unity.h>

#include "../fakes/FakeHardware.h"
#include "Rover.h"
#include "Tuning.h"

// The invariants AGENTS.md lists, as tests: motors released by deadline,
// external input clamped, autonomous and manual never both drive, and every
// way of losing control ends with the motors released.

namespace {

FakeMotors* motors;
FakeScanner* scanner;
Rover* rover;

// Runs rover.update() every 5 ms from `from` for `ms`, returning the new time.
uint32_t runFor(uint32_t from, uint32_t ms) {
  uint32_t now = from;
  const uint32_t end = from + ms;
  while (static_cast<int32_t>(now - end) < 0) {
    rover->update(now);
    now += 5;
  }
  return now;
}

// Runs from `from` until exploration first drives forward (an open world
// needs one sweep, about a second), returning the time it did.
uint32_t runUntilCruising(uint32_t from) {
  uint32_t now = from;
  for (int i = 0; i < 1000; i++) {
    rover->update(now);
    if (motors->driving && motors->lastPattern->move == MOVE_FORWARD) return now;
    now += 5;
  }
  TEST_FAIL_MESSAGE("exploration never drove forward");
  return now;
}

}  // namespace

void setUp(void) {
  motors = new FakeMotors();
  scanner = new FakeScanner();
  rover = new Rover(*motors, *scanner);
}

void tearDown(void) {
  delete rover;
  delete scanner;
  delete motors;
}

// --- deadlines ---------------------------------------------------------------

void test_command_drives_until_its_deadline(void) {
  rover->begin(Rover::MODE_MANUAL, 0);
  rover->command(MOVE_FORWARD, 100, 500, 1000);
  TEST_ASSERT_TRUE(motors->driving);
  TEST_ASSERT_EQUAL_INT(MOVE_FORWARD, motors->lastPattern->move);
  TEST_ASSERT_EQUAL_UINT8(100, motors->lastSpeed);

  rover->update(1499);
  TEST_ASSERT_TRUE(motors->driving);
  rover->update(1500);
  TEST_ASSERT_FALSE(motors->driving);
  TEST_ASSERT_EQUAL_INT(STOP, rover->status().move);
}

// millis() wraps after ~49.7 days. A deadline computed across the wrap must
// still fire on time, neither immediately nor 49 days late.
void test_deadline_survives_the_millis_rollover(void) {
  const uint32_t nearWrap = 0xFFFFFF00u;
  rover->begin(Rover::MODE_MANUAL, nearWrap);
  rover->command(MOVE_FORWARD, 100, 500, nearWrap);
  rover->update(nearWrap + 100);
  TEST_ASSERT_TRUE(motors->driving);
  rover->update(nearWrap + 500);  // wrapped past zero
  TEST_ASSERT_FALSE(motors->driving);
}

// A held move is a stream of identical commands. Each one extends the
// deadline; only a change rewrites the motors.
void test_repeated_command_extends_the_deadline_without_rewriting_motors(void) {
  rover->begin(Rover::MODE_MANUAL, 0);
  rover->command(MOVE_FORWARD, 100, 400, 0);
  rover->command(MOVE_FORWARD, 100, 400, 200);
  rover->command(MOVE_FORWARD, 100, 400, 400);
  TEST_ASSERT_EQUAL_INT(1, motors->driveCalls);
  rover->update(799);
  TEST_ASSERT_TRUE(motors->driving);
  rover->update(800);
  TEST_ASSERT_FALSE(motors->driving);

  rover->command(MOVE_FORWARD, 100, 400, 900);
  rover->command(MOVE_FORWARD, 120, 400, 1000);  // new speed
  rover->command(MOVE_LEFT, 120, 400, 1100);     // new move
  TEST_ASSERT_EQUAL_INT(4, motors->driveCalls);
  TEST_ASSERT_EQUAL_UINT8(120, motors->lastSpeed);
}

// --- clamping at the boundary ------------------------------------------------

void test_speed_is_clamped(void) {
  rover->begin(Rover::MODE_MANUAL, 0);
  rover->command(MOVE_FORWARD, 300, 500, 0);
  TEST_ASSERT_EQUAL_UINT8(tuning::MOTOR_SPEED_LIMIT, motors->lastSpeed);
}

// The duration cap is the deadman: a client that asks for a long move and
// then goes silent still stops within COMMAND_DURATION_MAX_MS.
void test_long_duration_stops_at_the_deadman_cap(void) {
  rover->begin(Rover::MODE_MANUAL, 0);
  rover->command(MOVE_FORWARD, 100, 2000000000, 0);
  rover->update(tuning::COMMAND_DURATION_MAX_MS - 1);
  TEST_ASSERT_TRUE(motors->driving);
  rover->update(tuning::COMMAND_DURATION_MAX_MS);
  TEST_ASSERT_FALSE(motors->driving);
}

void test_zero_speed_or_duration_releases(void) {
  rover->begin(Rover::MODE_MANUAL, 0);
  rover->command(MOVE_FORWARD, 0, 500, 0);
  TEST_ASSERT_FALSE(motors->driving);
  rover->command(MOVE_FORWARD, 100, 0, 0);
  TEST_ASSERT_FALSE(motors->driving);
}

// An instruction we cannot read, from a client we do not control: stop.
void test_unknown_codes_stop_the_rover(void) {
  const int unknown[] = {-1, MOVE_CODE_COUNT, 257, 1000000};
  for (int code : unknown) {
    rover->begin(Rover::MODE_MANUAL, 0);
    rover->command(MOVE_FORWARD, 100, 500, 0);
    rover->command(code, 100, 500, 10);
    TEST_ASSERT_FALSE(motors->driving);
    TEST_ASSERT_EQUAL_INT(Rover::MODE_MANUAL, rover->mode());
  }
}

void test_stop_command_releases(void) {
  rover->begin(Rover::MODE_MANUAL, 0);
  rover->command(MOVE_FORWARD, 100, 500, 0);
  rover->command(STOP, 0, 0, 10);
  TEST_ASSERT_FALSE(motors->driving);
}

// --- mode arbitration --------------------------------------------------------

void test_autonomous_mode_explores(void) {
  rover->begin(Rover::MODE_AUTONOMOUS, 0);
  runUntilCruising(0);  // open world: one sweep, then a cruise
  TEST_ASSERT_EQUAL_UINT8(tuning::EXPLORE_SPEED, motors->lastSpeed);
  TEST_ASSERT_EQUAL_STRING("CRUISE", rover->status().phase);
}

// Any command takes control. Without this, exploration overwrote every
// remote command a few milliseconds after it arrived.
void test_a_command_takes_control_from_exploration(void) {
  rover->begin(Rover::MODE_AUTONOMOUS, 0);
  uint32_t now = runUntilCruising(0);
  rover->command(MOVE_LEFT, 80, 400, now);
  TEST_ASSERT_EQUAL_INT(Rover::MODE_MANUAL, rover->mode());
  TEST_ASSERT_EQUAL_INT(MOVE_LEFT, motors->lastPattern->move);

  // Exploration does not drive again, however long the rover sits.
  now = runFor(now, 500);
  const int drivesSoFar = motors->driveCalls;
  runFor(now, 20000);
  TEST_ASSERT_EQUAL_INT(drivesSoFar, motors->driveCalls);
  TEST_ASSERT_FALSE(motors->driving);
}

// Manual mode keeps scanning, so telemetry shows live distances while a
// person drives -- but it never moves the wheels on its own.
void test_manual_mode_scans_but_never_drives(void) {
  rover->begin(Rover::MODE_MANUAL, 0);
  runFor(0, 20000);
  TEST_ASSERT_EQUAL_INT(0, motors->driveCalls);
  TEST_ASSERT_TRUE(scanner->pings > 20);
  TEST_ASSERT_TRUE(rover->status().hasScan);
  TEST_ASSERT_NULL(rover->status().phase);
}

// Without a way back, the first command ever sent stranded the rover in
// manual until it was power-cycled.
void test_resume_autonomous_hands_control_back(void) {
  rover->begin(Rover::MODE_MANUAL, 0);
  rover->command(MOVE_FORWARD, 100, 500, 0);
  rover->command(RESUME_AUTONOMOUS, 0, 0, 10);
  TEST_ASSERT_EQUAL_INT(Rover::MODE_AUTONOMOUS, rover->mode());
  TEST_ASSERT_FALSE(motors->driving);  // stops, then explores from a fresh sweep
  runUntilCruising(10);
}

// --- losing control ----------------------------------------------------------

void test_stop_keeps_the_mode(void) {
  rover->begin(Rover::MODE_MANUAL, 0);
  rover->command(MOVE_FORWARD, 100, 500, 0);
  rover->stop();
  TEST_ASSERT_FALSE(motors->driving);
  TEST_ASSERT_EQUAL_INT(Rover::MODE_MANUAL, rover->mode());
}

// With the link gone nobody can send STOP, so exploring on would leave the
// rover somewhere it cannot be stopped from.
void test_losing_the_link_stops_exploration(void) {
  rover->begin(Rover::MODE_AUTONOMOUS, 0);
  uint32_t now = runUntilCruising(0);
  rover->standDown(now);
  TEST_ASSERT_FALSE(motors->driving);
  TEST_ASSERT_EQUAL_INT(Rover::MODE_MANUAL, rover->mode());
  const int drivesSoFar = motors->driveCalls;
  runFor(now, 10000);
  TEST_ASSERT_EQUAL_INT(drivesSoFar, motors->driveCalls);
}

// --- status ------------------------------------------------------------------

void test_status_reports_what_the_wheels_are_doing(void) {
  rover->begin(Rover::MODE_MANUAL, 0);
  TEST_ASSERT_EQUAL_INT(STOP, rover->status().move);
  TEST_ASSERT_FALSE(rover->status().moving);
  rover->command(MOVE_DIAGONAL45, 100, 500, 0);
  TEST_ASSERT_EQUAL_INT(MOVE_DIAGONAL45, rover->status().move);
  TEST_ASSERT_TRUE(rover->status().moving);
  rover->update(500);
  // Released by deadline: telemetry no longer names the finished move.
  TEST_ASSERT_EQUAL_INT(STOP, rover->status().move);
  TEST_ASSERT_FALSE(rover->status().moving);
}

void test_status_has_no_scan_until_every_bearing_is_measured(void) {
  rover->begin(Rover::MODE_MANUAL, 0);
  TEST_ASSERT_FALSE(rover->status().hasScan);
  scanner->setAll(123.0f);
  runFor(0, 3000);
  const Rover::Status status = rover->status();
  TEST_ASSERT_TRUE(status.hasScan);
  for (int i = 0; i < Explorer::BEARING_COUNT; i++) TEST_ASSERT_EQUAL_FLOAT(123.0f, status.scanCm[i]);
}

// In manual mode setMode() is a no-op, so only standDown's own release()
// stops a rover a person is driving when the WiFi drops.
void test_losing_the_link_while_driven_releases_at_once(void) {
  rover->begin(Rover::MODE_MANUAL, 0);
  rover->command(MOVE_FORWARD, 100, 1500, 0);
  rover->standDown(10);
  TEST_ASSERT_FALSE(motors->driving);
  TEST_ASSERT_EQUAL_INT(Rover::MODE_MANUAL, rover->mode());
}

// An operator pressing Autonomous on a rover that halted "boxed in" is saying
// the way is open. Before, a resume while already autonomous did nothing, so
// only unplugging it recovered the explorer.
void test_resume_restarts_a_halted_explorer(void) {
  scanner->setAll(10.0f);  // boxed in
  rover->begin(Rover::MODE_AUTONOMOUS, 0);
  uint32_t now = runFor(0, 40000);
  TEST_ASSERT_EQUAL_STRING("HALTED", rover->status().phase);
  scanner->setAll(200.0f);
  rover->command(RESUME_AUTONOMOUS, 0, 0, now);
  TEST_ASSERT_EQUAL_STRING("SWEEP", rover->status().phase);
  runUntilCruising(now);
}

// A resume while exploring normally must not restart anything.
void test_resume_while_exploring_changes_nothing(void) {
  rover->begin(Rover::MODE_AUTONOMOUS, 0);
  const uint32_t now = runUntilCruising(0);
  rover->command(RESUME_AUTONOMOUS, 0, 0, now);
  TEST_ASSERT_TRUE(motors->driving);
  TEST_ASSERT_EQUAL_STRING("CRUISE", rover->status().phase);
}

// The library does not report a lost I2C write, so a held move is rewritten
// every MOTOR_REFRESH_MS even though nothing changed.
void test_held_move_is_rewritten_periodically(void) {
  rover->begin(Rover::MODE_MANUAL, 0);
  for (uint32_t t = 0; t < tuning::MOTOR_REFRESH_MS; t += 200) rover->command(MOVE_FORWARD, 100, 400, t);
  TEST_ASSERT_EQUAL_INT(1, motors->driveCalls);
  rover->command(MOVE_FORWARD, 100, 400, tuning::MOTOR_REFRESH_MS);
  TEST_ASSERT_EQUAL_INT(2, motors->driveCalls);
}

void test_status_reports_a_missing_motor_driver(void) {
  rover->begin(Rover::MODE_MANUAL, 0);
  TEST_ASSERT_TRUE(rover->status().motorsReady);
  motors->isReady = false;
  TEST_ASSERT_FALSE(rover->status().motorsReady);
}

int main(int, char**) {
  UNITY_BEGIN();
  RUN_TEST(test_command_drives_until_its_deadline);
  RUN_TEST(test_deadline_survives_the_millis_rollover);
  RUN_TEST(test_repeated_command_extends_the_deadline_without_rewriting_motors);
  RUN_TEST(test_speed_is_clamped);
  RUN_TEST(test_long_duration_stops_at_the_deadman_cap);
  RUN_TEST(test_zero_speed_or_duration_releases);
  RUN_TEST(test_unknown_codes_stop_the_rover);
  RUN_TEST(test_stop_command_releases);
  RUN_TEST(test_autonomous_mode_explores);
  RUN_TEST(test_a_command_takes_control_from_exploration);
  RUN_TEST(test_manual_mode_scans_but_never_drives);
  RUN_TEST(test_resume_autonomous_hands_control_back);
  RUN_TEST(test_stop_keeps_the_mode);
  RUN_TEST(test_losing_the_link_stops_exploration);
  RUN_TEST(test_losing_the_link_while_driven_releases_at_once);
  RUN_TEST(test_resume_restarts_a_halted_explorer);
  RUN_TEST(test_resume_while_exploring_changes_nothing);
  RUN_TEST(test_held_move_is_rewritten_periodically);
  RUN_TEST(test_status_reports_a_missing_motor_driver);
  RUN_TEST(test_status_reports_what_the_wheels_are_doing);
  RUN_TEST(test_status_has_no_scan_until_every_bearing_is_measured);
  return UNITY_END();
}

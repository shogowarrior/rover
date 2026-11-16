#include <stdint.h>
#include <string.h>
#include <unity.h>

#include <string>
#include <vector>

#include "../fakes/FakeHardware.h"
#include "../support/Loop.h"
#include "EventLog.h"
#include "Rover.h"
#include "Tuning.h"

// The invariants AGENTS.md lists, as tests: motors released by deadline,
// external input clamped, autonomous and manual never both drive, and every
// way of losing control ends with the motors released.

namespace {

FakeMotors* motors;
FakeScanner* scanner;
EventLog* events;
Settings* settings;
Rover* rover;
uint32_t clockNow = 0;  // stamps the scanner's aims and pings

void updateRover(uint32_t now) {
  clockNow = now;
  rover->update(now);
}

// Runs rover.update() every 5 ms from `from` for `ms`, returning the new time.
uint32_t runFor(uint32_t from, uint32_t ms) {
  uint32_t now = from;
  advance(now, ms, 5, updateRover);
  return now;
}

// Runs from `from` until exploration first drives forward (an open world
// needs one sweep, about a second), returning the time it did.
uint32_t runUntilCruising(uint32_t from) {
  uint32_t now = from;
  const bool cruising = advanceUntil(now, 5000, 5, updateRover, [] {
    return motors->driving && motors->lastPattern->move == MOVE_FORWARD;
  });
  TEST_ASSERT_TRUE_MESSAGE(cruising, "exploration never drove forward");
  return now;
}

// Runs from `from` for ten seconds and checks the wheels never move: what an
// operator who stopped the rover expects.
void assertStaysStopped(uint32_t from) {
  const int drivesSoFar = motors->driveCalls;
  runFor(from, 10000);
  TEST_ASSERT_EQUAL_INT(drivesSoFar, motors->driveCalls);
  TEST_ASSERT_FALSE(motors->driving);
}

}  // namespace

void setUp(void) {
  motors = new FakeMotors();
  scanner = new FakeScanner();
  clockNow = 0;
  scanner->clock = &clockNow;
  events = new EventLog();
  settings = new Settings(*events, kinematics::SCHEME_NORMAL);
  rover = new Rover(*motors, *scanner, *settings, *events);
}

void tearDown(void) {
  delete rover;
  delete settings;
  delete events;
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

// The lower bounds matter as much as the upper ones, and readCommand() passes
// negative numbers through. Speed -1 as the driver's byte is 255, full pack
// voltage. Duration INT32_MIN would put the deadline 2^31 ms away: 24.8 days
// past the deadman.
void test_negative_speed_or_duration_releases(void) {
  rover->begin(Rover::MODE_MANUAL, 0);
  rover->command(MOVE_FORWARD, -1, 500, 0);
  TEST_ASSERT_FALSE(motors->driving);
  rover->command(MOVE_FORWARD, 100, INT32_MIN, 0);
  rover->update(10);
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
    TEST_ASSERT_EQUAL_INT(Rover::MODE_MANUAL, rover->status().mode);
  }
}

// STOP stops whatever speed and duration ride along with it. Clients send
// speed 0, which would release on its own; a STOP at speed 100 must too.
void test_stop_command_releases(void) {
  rover->begin(Rover::MODE_MANUAL, 0);
  rover->command(MOVE_FORWARD, 100, 500, 0);
  rover->command(STOP, 0, 0, 10);
  TEST_ASSERT_FALSE(motors->driving);
  rover->command(MOVE_FORWARD, 100, 500, 20);
  rover->command(STOP, 100, 500, 30);
  TEST_ASSERT_FALSE(motors->driving);
  TEST_ASSERT_FALSE(rover->status().moving);
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
  TEST_ASSERT_EQUAL_INT(Rover::MODE_MANUAL, rover->status().mode);
  TEST_ASSERT_EQUAL_INT(MOVE_LEFT, motors->lastPattern->move);

  // Exploration does not drive again, however long the rover sits.
  assertStaysStopped(runFor(now, 500));
}

// STOP takes control too. A STOP that only released the wheels and kept
// exploring would be undone at the next clear ping, tens of milliseconds
// later: the operator could not stop an exploring rover.
void test_stop_takes_control_from_exploration(void) {
  rover->begin(Rover::MODE_AUTONOMOUS, 0);
  const uint32_t now = runUntilCruising(0);
  rover->command(STOP, 0, 0, now);
  TEST_ASSERT_FALSE(motors->driving);
  TEST_ASSERT_EQUAL_INT(Rover::MODE_MANUAL, rover->status().mode);
  assertStaysStopped(now);
}

// And so does a code it cannot read, for the same reason.
void test_unknown_code_takes_control_from_exploration(void) {
  const int unknown[] = {-1, MOVE_CODE_COUNT, 1000};
  for (int code : unknown) {
    rover->begin(Rover::MODE_AUTONOMOUS, 0);
    const uint32_t now = runUntilCruising(0);
    rover->command(code, 100, 500, now);
    TEST_ASSERT_FALSE(motors->driving);
    TEST_ASSERT_EQUAL_INT(Rover::MODE_MANUAL, rover->status().mode);
    assertStaysStopped(now);
  }
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

// A rover at rest does not sweep its servo back and forth: one sweep, so
// every bearing has a reading, then the sonar held straight ahead, still,
// its front reading kept live.
void test_manual_mode_sweeps_once_then_holds_the_sonar_ahead(void) {
  rover->begin(Rover::MODE_MANUAL, 0);
  runFor(0, 20000);
  TEST_ASSERT_TRUE(scanner->pingAngles.size() > 20);
  const int sweep[] = {20, 55, 90, 125, 160};
  bool swept[5] = {false, false, false, false, false};
  for (size_t i = 0; i < 5; i++) {
    for (int b = 0; b < 5; b++) {
      if (scanner->pingAngles[i] == sweep[b]) swept[b] = true;
    }
  }
  for (int b = 0; b < 5; b++) TEST_ASSERT_TRUE(swept[b]);
  for (size_t i = 5; i < scanner->pingAngles.size(); i++) TEST_ASSERT_EQUAL_INT(90, scanner->pingAngles[i]);
  // The servo moved to the front once, and not again.
  size_t aimsAfterSweep = 0;
  for (size_t i = 0; i < scanner->aimTimes.size(); i++) {
    if (scanner->aimTimes[i] > scanner->pingTimes[4]) aimsAfterSweep++;
  }
  TEST_ASSERT_TRUE(aimsAfterSweep <= 1);
  TEST_ASSERT_EQUAL_INT(90, scanner->aims.back());

  scanner->setArc(90, 90, 37.0f);
  runFor(20000, 1000);
  TEST_ASSERT_EQUAL_FLOAT(37.0f, rover->status().scanCm[Explorer::FRONT]);
  TEST_ASSERT_EQUAL_INT(0, motors->driveCalls);
}

// Handed back to exploring, the rover sweeps every bearing before it moves:
// the readings held while it looked ahead are the front's alone.
void test_exploring_after_looking_ahead_sweeps_first(void) {
  rover->begin(Rover::MODE_MANUAL, 0);
  uint32_t now = runFor(0, 3000);
  const size_t before = scanner->pingAngles.size();
  rover->command(RESUME_AUTONOMOUS, 0, 0, now);
  now = runUntilCruising(now);
  bool seen[181] = {false};
  for (size_t i = before; i < scanner->pingAngles.size(); i++) {
    if (scanner->pingTimes[i] <= now) seen[scanner->pingAngles[i]] = true;
  }
  const int sweep[] = {20, 55, 90, 125, 160};
  for (int servo : sweep) TEST_ASSERT_TRUE(seen[servo]);
}

// Without a way back, the first command ever sent stranded the rover in
// manual until it was power-cycled.
void test_resume_autonomous_hands_control_back(void) {
  rover->begin(Rover::MODE_MANUAL, 0);
  rover->command(MOVE_FORWARD, 100, 500, 0);
  rover->command(RESUME_AUTONOMOUS, 0, 0, 10);
  TEST_ASSERT_EQUAL_INT(Rover::MODE_AUTONOMOUS, rover->status().mode);
  TEST_ASSERT_FALSE(motors->driving);  // stops, then explores from a fresh sweep
  runUntilCruising(10);
}

// --- losing control ----------------------------------------------------------

void test_stop_keeps_the_mode(void) {
  rover->begin(Rover::MODE_MANUAL, 0);
  rover->command(MOVE_FORWARD, 100, 500, 0);
  rover->stop(10);
  TEST_ASSERT_FALSE(motors->driving);
  TEST_ASSERT_EQUAL_INT(Rover::MODE_MANUAL, rover->status().mode);
}

// With the link gone nobody can send STOP, so exploring on would leave the
// rover somewhere it cannot be stopped from.
void test_losing_the_link_stops_exploration(void) {
  rover->begin(Rover::MODE_AUTONOMOUS, 0);
  const uint32_t now = runUntilCruising(0);
  rover->standDown(now, "WiFi lost");
  TEST_ASSERT_FALSE(motors->driving);
  TEST_ASSERT_EQUAL_INT(Rover::MODE_MANUAL, rover->status().mode);
  assertStaysStopped(now);
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
  rover->standDown(10, "WiFi lost");
  TEST_ASSERT_FALSE(motors->driving);
  TEST_ASSERT_EQUAL_INT(Rover::MODE_MANUAL, rover->status().mode);
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

// A stop has no next command to repair it. Written only once, a lost release
// left the wheels driving while telemetry said STOP, until some client sent
// another command. Every way of stopping a moving rover writes it again.
void test_a_lost_stop_is_written_again(void) {
  typedef void (*StopAt)(uint32_t now);
  const StopAt ways[] = {
      [](uint32_t now) { rover->command(STOP, 0, 0, now); },
      [](uint32_t now) { rover->command(MOVE_CODE_COUNT, 100, 500, now); },
      [](uint32_t now) { rover->update(now); },  // the deadline, and so the deadman
      [](uint32_t now) { rover->stop(now); },
      [](uint32_t now) { rover->standDown(now, "WiFi lost"); },
  };
  for (StopAt stopAt : ways) {
    rover->begin(Rover::MODE_MANUAL, 0);
    rover->command(MOVE_FORWARD, 100, 500, 0);
    motors->releasesToLose = 1;
    stopAt(500);
    TEST_ASSERT_FALSE(rover->status().moving);
    TEST_ASSERT_TRUE(motors->driving);  // lost on the bus
    rover->update(500 + tuning::MOTOR_REFRESH_MS - 1);
    TEST_ASSERT_TRUE(motors->driving);
    rover->update(500 + tuning::MOTOR_REFRESH_MS);
    TEST_ASSERT_FALSE(motors->driving);
  }
}

// In autonomy the lost stop that matters is a cruise's, at an obstacle: the
// wheels drove on through the sweep that follows, into what it stopped for.
void test_a_lost_obstacle_stop_is_written_again(void) {
  rover->begin(Rover::MODE_AUTONOMOUS, 0);
  uint32_t now = runUntilCruising(0);
  motors->releasesToLose = 1;
  scanner->setAll(tuning::EXPLORE_STOP_CM - 10);  // a wall, inside the stop distance
  const bool stopped = advanceUntil(now, 1000, 5, updateRover, [] { return !rover->status().moving; });
  TEST_ASSERT_TRUE_MESSAGE(stopped, "the cruise never stopped at the wall");
  TEST_ASSERT_TRUE(motors->driving);  // lost on the bus
  const int drivesSoFar = motors->driveCalls;
  runFor(now, tuning::MOTOR_REFRESH_MS + 5);
  TEST_ASSERT_EQUAL_INT(drivesSoFar, motors->driveCalls);  // the retry stopped it, not a new move
  TEST_ASSERT_FALSE(motors->driving);
}

// An OTA upload blocks loop() from its start until the reboot, so update()
// never made the stand-down's second write: a lost release left the wheels
// running through the whole upload. The upload's progress callback makes it
// through servicePendingRelease(), which must do that and nothing else -- no
// sonar ping or servo move in the middle of a flash write, and no new motion.
void test_a_lost_stop_is_written_again_without_the_loop(void) {
  rover->begin(Rover::MODE_MANUAL, 0);
  rover->command(MOVE_FORWARD, 100, 500, 0);
  motors->releasesToLose = 1;
  rover->standDown(100, "an OTA upload started");
  TEST_ASSERT_TRUE(motors->driving);  // lost on the bus
  const int pings = scanner->pings;
  const size_t aims = scanner->aims.size();
  const int drives = motors->driveCalls;
  rover->servicePendingRelease(100 + tuning::MOTOR_REFRESH_MS - 1);
  TEST_ASSERT_TRUE(motors->driving);
  rover->servicePendingRelease(100 + tuning::MOTOR_REFRESH_MS);
  TEST_ASSERT_FALSE(motors->driving);
  TEST_ASSERT_EQUAL_INT(pings, scanner->pings);
  TEST_ASSERT_EQUAL_UINT32(aims, scanner->aims.size());
  TEST_ASSERT_EQUAL_INT(drives, motors->driveCalls);
  // Once, as from update(): the rest of the upload writes nothing more.
  const int releases = motors->releaseCalls;
  rover->servicePendingRelease(100 + 2 * tuning::MOTOR_REFRESH_MS);
  TEST_ASSERT_EQUAL_INT(releases, motors->releaseCalls);
}

// Once, not forever: an idle rover costs no I2C.
void test_a_stop_is_written_twice_and_no_more(void) {
  rover->begin(Rover::MODE_MANUAL, 0);
  const int atBoot = motors->releaseCalls;
  runFor(0, 5000);
  TEST_ASSERT_EQUAL_INT(atBoot, motors->releaseCalls);

  rover->command(MOVE_FORWARD, 100, 500, 5000);
  runFor(5000, 10000);
  TEST_ASSERT_EQUAL_INT(atBoot + 2, motors->releaseCalls);
}

// At rest only once a stop has been written twice, so that what waits for it
// (a flash write) cannot hold up the write that repairs a lost one.
void test_at_rest_once_a_stop_is_written_twice(void) {
  rover->begin(Rover::MODE_MANUAL, 0);
  TEST_ASSERT_TRUE(rover->atRest());
  rover->command(MOVE_FORWARD, 100, 500, 0);
  TEST_ASSERT_FALSE(rover->atRest());
  rover->command(STOP, 0, 0, 100);
  rover->update(100 + tuning::MOTOR_REFRESH_MS - 1);
  TEST_ASSERT_FALSE(rover->atRest());
  rover->update(100 + tuning::MOTOR_REFRESH_MS);
  TEST_ASSERT_TRUE(rover->atRest());
}

// The second write must never stop a move that started after the first.
void test_a_new_move_cancels_the_second_write(void) {
  rover->begin(Rover::MODE_MANUAL, 0);
  rover->command(MOVE_FORWARD, 100, 500, 0);
  rover->command(STOP, 0, 0, 100);
  rover->command(MOVE_LEFT, 100, 1500, 200);
  rover->update(100 + tuning::MOTOR_REFRESH_MS);
  TEST_ASSERT_TRUE(motors->driving);
  TEST_ASSERT_TRUE(rover->status().moving);
  TEST_ASSERT_EQUAL_INT(MOVE_LEFT, motors->lastPattern->move);
}

void test_status_reports_a_missing_motor_driver(void) {
  rover->begin(Rover::MODE_MANUAL, 0);
  TEST_ASSERT_TRUE(rover->status().motorsReady);
  motors->isReady = false;
  TEST_ASSERT_FALSE(rover->status().motorsReady);
}

// --- the sonar in manual mode -------------------------------------------------

const int FRONT_SERVO = 90;

// Every servo angle pinged from the `from`th ping on.
std::vector<int> pingsFrom(size_t from) {
  return std::vector<int>(scanner->pingAngles.begin() + static_cast<long>(from), scanner->pingAngles.end());
}

void test_manual_mode_points_the_sonar_as_set(void) {
  rover->begin(Rover::MODE_MANUAL, 0);
  TEST_ASSERT_EQUAL_INT(Explorer::SONAR_FRONT, rover->status().sonar);  // the default
  settings->setSonar(Explorer::SONAR_SWEEP, SOURCE_WIFI, 0);
  runFor(0, 4000);
  TEST_ASSERT_EQUAL_INT(Explorer::SONAR_SWEEP, rover->status().sonar);
  const std::vector<int> swept = pingsFrom(0);
  const int bearings[] = {20, 55, 90, 125, 160};
  for (int servo : bearings) {
    int times = 0;
    for (int angle : swept) times += angle == servo;
    TEST_ASSERT_TRUE(times >= 2);  // over and over, not once
  }

  scanner->setArc(FRONT_SERVO - 30, FRONT_SERVO - 30, 42.0f);
  settings->setSonar(Explorer::SONAR_AIM, SOURCE_WIFI, 4000);
  settings->setAim(30, SOURCE_WIFI, 4000);
  const size_t before = scanner->pingAngles.size();
  runFor(4000, 1000);
  for (int angle : pingsFrom(before)) TEST_ASSERT_EQUAL_INT(FRONT_SERVO - 30, angle);
  const Rover::Status status = rover->status();
  TEST_ASSERT_EQUAL_INT(Explorer::SONAR_AIM, status.sonar);
  TEST_ASSERT_EQUAL_INT(30, status.aimDeg);
  TEST_ASSERT_TRUE(status.hasAimCm);
  TEST_ASSERT_EQUAL_FLOAT(42.0f, status.aimCm);
  TEST_ASSERT_FALSE(motors->driving);
  TEST_ASSERT_EQUAL_INT(0, motors->driveCalls);
}

// Past the servo's end stops, where a cheap servo strains and buzzes.
void test_the_aim_is_clamped(void) {
  rover->begin(Rover::MODE_MANUAL, 0);
  settings->setSonar(Explorer::SONAR_AIM, SOURCE_WIFI, 0);
  settings->setAim(200, SOURCE_WIFI, 0);
  TEST_ASSERT_EQUAL_INT(tuning::SONAR_AIM_MAX_DEG, rover->status().aimDeg);
  settings->setAim(-200, SOURCE_WIFI, 0);
  TEST_ASSERT_EQUAL_INT(-tuning::SONAR_AIM_MAX_DEG, rover->status().aimDeg);
  runFor(0, 3000);  // the one sweep, then the held aim
  const std::vector<int> held = pingsFrom(Explorer::BEARING_COUNT);
  TEST_ASSERT_TRUE(held.size() >= 5);
  for (int angle : held) TEST_ASSERT_EQUAL_INT(FRONT_SERVO + tuning::SONAR_AIM_MAX_DEG, angle);
}

// A setting, not a command: an exploring rover explores on, and sweeps its
// own way, until a command puts it in manual.
void test_the_sonar_setting_takes_no_control(void) {
  rover->begin(Rover::MODE_AUTONOMOUS, 0);
  uint32_t now = runUntilCruising(0);
  settings->setSonar(Explorer::SONAR_AIM, SOURCE_WIFI, now);
  settings->setAim(50, SOURCE_WIFI, now);
  TEST_ASSERT_EQUAL_INT(Rover::MODE_AUTONOMOUS, rover->status().mode);
  TEST_ASSERT_TRUE(motors->driving);
  const size_t before = scanner->pingAngles.size();
  now = runFor(now, 3000);
  for (int angle : pingsFrom(before)) TEST_ASSERT_NOT_EQUAL(FRONT_SERVO - 50, angle);
  TEST_ASSERT_FALSE(rover->status().hasAimCm);

  rover->command(STOP, 0, 0, now);
  const size_t manual = scanner->pingAngles.size();
  runFor(now, 1000);
  const std::vector<int> after = pingsFrom(manual);
  TEST_ASSERT_TRUE(after.size() >= 3);
  for (int angle : after) TEST_ASSERT_EQUAL_INT(FRONT_SERVO - 50, angle);
}

// A sweep passes through the aim's angle too; that is no aimed reading.
void test_an_aimed_reading_is_reported_only_while_aiming(void) {
  rover->begin(Rover::MODE_MANUAL, 0);
  runFor(0, 3000);
  TEST_ASSERT_FALSE(rover->status().hasAimCm);
}

// --- the checks ----------------------------------------------------------------

// One drive the checks made: the pattern and speed, and when.
struct Drive {
  const MovePattern* pattern;
  int speed;
  uint32_t at;
};

// A client holding the checks, as the panel does: RUN_CHECKS again every
// 200 ms (its REPEAT_MS) since `heldAt`.
void holdChecks(uint32_t now, uint32_t& heldAt) {
  if (now - heldAt >= 200) {
    heldAt = now;
    rover->command(RUN_CHECKS, 0, 0, now);
  }
}

// Runs the checks from `from` until they end, at most 60 s, recording each
// new drive (a rewrite of the one under way is not one), and holding them
// unless `hold` is false. Returns the time they ended.
uint32_t runChecks(uint32_t from, std::vector<Drive>& drives, bool hold = true) {
  uint32_t now = from;
  uint32_t heldAt = from;
  int calls = motors->driveCalls;
  const MovePattern* last = nullptr;
  int lastSpeed = -1;
  const bool ended = advanceUntil(
      now, 60000, 5,
      [&](uint32_t t) {
        if (hold) holdChecks(t, heldAt);
        clockNow = t;
        rover->update(t);
        const char* check = rover->status().check;
        if (check != nullptr) TEST_ASSERT_TRUE_MESSAGE(strlen(check) <= SelfTest::STEP_NAME_MAX, check);
        if (motors->driveCalls != calls) {
          calls = motors->driveCalls;
          if (motors->lastPattern != last || motors->lastSpeed != lastSpeed) {
            drives.push_back({motors->lastPattern, motors->lastSpeed, t});
          }
          last = motors->lastPattern;
          lastSpeed = motors->lastSpeed;
        }
        if (!motors->driving) last = nullptr;
      },
      [] { return rover->status().check == nullptr; });
  TEST_ASSERT_TRUE_MESSAGE(ended, "the checks never ended");
  return now;
}

bool logged(const char* text, EventLog::Level level = EventLog::INFO) {
  for (uint32_t seq = events->oldestSeq(); seq != events->nextSeq(); seq++) {
    const EventLog::Entry* entry = events->from(seq);
    if (entry->level == level && std::string(entry->text).find(text) != std::string::npos) return true;
  }
  return false;
}

// The sonar at each bearing, then each wheel alone, then the four moves, in
// that order, each at its speed, each ended by its own deadline.
void test_the_checks_run_every_step_in_order(void) {
  rover->begin(Rover::MODE_MANUAL, 0);
  scanner->setAll(150.0f);
  rover->command(RUN_CHECKS, 0, 0, 0);
  TEST_ASSERT_EQUAL_STRING("sonar L", rover->status().check);
  std::vector<Drive> drives;
  const uint32_t end = runChecks(0, drives);

  // Three pings at each of the five bearings came before any wheel turned.
  int bearingPings[181] = {0};
  for (size_t i = 0; i < scanner->pingAngles.size(); i++) {
    if (!drives.empty() && scanner->pingTimes[i] >= drives[0].at) break;
    bearingPings[scanner->pingAngles[i]]++;
  }
  const int bearings[] = {20, 55, 90, 125, 160};
  for (int servo : bearings) TEST_ASSERT_TRUE(bearingPings[servo] >= 3);

  const MovePattern* expected[] = {
      &wheelAlone(WHEEL_FRONT_LEFT), &wheelAlone(WHEEL_FRONT_RIGHT), &wheelAlone(WHEEL_REAR_RIGHT),
      &wheelAlone(WHEEL_REAR_LEFT),  findMovePattern(MOVE_FORWARD),  findMovePattern(MOVE_FORWARD),
      findMovePattern(MOVE_RIGHT),   findMovePattern(ROTATE_CLOCKWISE)};
  const int speeds[] = {tuning::CHECK_SPEED, tuning::CHECK_SPEED, tuning::CHECK_SPEED, tuning::CHECK_SPEED,
                        tuning::EXPLORE_SPEED, tuning::CHECK_SPEED, tuning::CHECK_SPEED, tuning::CHECK_SPEED};
  TEST_ASSERT_EQUAL_size_t(8, drives.size());
  for (size_t i = 0; i < drives.size(); i++) {
    TEST_ASSERT_TRUE(drives[i].pattern == expected[i]);
    TEST_ASSERT_EQUAL_INT(speeds[i], drives[i].speed);
    // Each drive ended, and the wheels rested, before the next began.
    if (i > 0) {
      TEST_ASSERT_TRUE(drives[i].at - drives[i - 1].at >=
                       static_cast<uint32_t>(tuning::CHECK_DRIVE_MS) + tuning::CHECK_REST_MS);
    }
  }
  TEST_ASSERT_FALSE(motors->driving);
  TEST_ASSERT_TRUE(logged("Checks done: motor shield answered; the sonar heard 15 of 15 pings"));
  TEST_ASSERT_TRUE(logged("Sonar ahead: 3 of 3 pings heard an echo, the nearest 150 cm"));
  TEST_ASSERT_TRUE(logged("Front-left wheel alone, forward"));
  // In manual mode, and the sonar back to the operator's sweep.
  TEST_ASSERT_EQUAL_INT(Rover::MODE_MANUAL, rover->status().mode);
  assertStaysStopped(end);
}

void test_checks_without_a_shield_turn_no_wheel(void) {
  motors->isReady = false;
  rover->begin(Rover::MODE_MANUAL, 0);
  rover->command(RUN_CHECKS, 0, 0, 0);
  std::vector<Drive> drives;
  runChecks(0, drives);
  TEST_ASSERT_EQUAL_INT(0, motors->driveCalls);
  TEST_ASSERT_TRUE(logged("Motor shield: did not answer at boot", EventLog::WARN));
  TEST_ASSERT_TRUE(logged("Wheels not checked", EventLog::WARN));
  TEST_ASSERT_TRUE(logged("Checks done: motor shield missing", EventLog::WARN));
}

// A dead sensor hears nothing anywhere: said as a warning, never as open
// space.
void test_checks_with_a_silent_sonar_warn(void) {
  rover->begin(Rover::MODE_MANUAL, 0);
  scanner->setAll(-1.0f);
  rover->command(RUN_CHECKS, 0, 0, 0);
  std::vector<Drive> drives;
  runChecks(0, drives);
  TEST_ASSERT_TRUE(logged("Sonar left: none of 3 pings heard an echo", EventLog::WARN));
  TEST_ASSERT_TRUE(logged("Checks done: motor shield answered; the sonar heard 0 of 15 pings", EventLog::WARN));
}

// The checks turn the wheels, so every way of losing control, and any
// command, ends them with the wheels released, and they never resume.
void test_anything_that_takes_control_ends_the_checks(void) {
  typedef void (*EndAt)(uint32_t now);
  const EndAt ways[] = {
      [](uint32_t now) { rover->command(STOP, 0, 0, now); },
      [](uint32_t now) { rover->command(MOVE_BACKWARD, 100, 300, now); },
      [](uint32_t now) { rover->command(RESUME_AUTONOMOUS, 0, 0, now); },
      [](uint32_t now) { rover->command(MOVE_CODE_COUNT + 5, 0, 0, now); },
      [](uint32_t now) { rover->stop(now); },
      [](uint32_t now) { rover->standDown(now, "WiFi lost"); },
  };
  for (EndAt endAt : ways) {
    tearDown();
    setUp();
    rover->begin(Rover::MODE_MANUAL, 0);
    rover->command(RUN_CHECKS, 0, 0, 0);
    uint32_t now = 0;
    uint32_t heldAt = 0;
    const bool wheelTurning = advanceUntil(
        now, 30000, 5,
        [&](uint32_t t) {
          holdChecks(t, heldAt);
          updateRover(t);
        },
        [] { return motors->driving; });
    TEST_ASSERT_TRUE(wheelTurning);
    endAt(now);
    TEST_ASSERT_NULL(rover->status().check);
    TEST_ASSERT_TRUE(logged("Checks stopped"));
    // Whatever the command asked for is its own; no check drives again.
    now = runFor(now, 2000);
    const int calls = motors->driveCalls;
    runFor(now, 20000);
    TEST_ASSERT_TRUE(motors->driveCalls == calls || rover->status().mode == Rover::MODE_AUTONOMOUS);
    TEST_ASSERT_NULL(rover->status().check);
  }
}

void test_the_checks_take_control_from_exploration(void) {
  rover->begin(Rover::MODE_AUTONOMOUS, 0);
  const uint32_t now = runUntilCruising(0);
  rover->command(RUN_CHECKS, 0, 0, now);
  TEST_ASSERT_EQUAL_INT(Rover::MODE_MANUAL, rover->status().mode);
  TEST_ASSERT_FALSE(motors->driving);
  TEST_ASSERT_EQUAL_STRING("sonar L", rover->status().check);
}

void test_the_status_names_the_check_under_way(void) {
  rover->begin(Rover::MODE_MANUAL, 0);
  rover->command(RUN_CHECKS, 0, 0, 0);
  uint32_t now = 0;
  uint32_t heldAt = 0;
  const auto held = [&](uint32_t t) {
    holdChecks(t, heldAt);
    updateRover(t);
  };
  TEST_ASSERT_TRUE(advanceUntil(now, 30000, 5, held, [] { return motors->driving; }));
  TEST_ASSERT_EQUAL_STRING("wheel FL", rover->status().check);
  TEST_ASSERT_TRUE(advanceUntil(now, 60000, 5, held, [] {
    return rover->status().check != nullptr && std::string(rover->status().check) == "rotate cw";
  }));
}

// The deadman's rule: one RUN_CHECKS, from a client that then goes quiet
// (a script that died, a single line typed into the serial console), checks
// the shield and the sonar and turns no wheel.
void test_unheld_checks_turn_no_wheel(void) {
  rover->begin(Rover::MODE_MANUAL, 0);
  scanner->setAll(150.0f);
  rover->command(RUN_CHECKS, 0, 0, 0);
  std::vector<Drive> drives;
  const uint32_t end = runChecks(0, drives, false);
  TEST_ASSERT_EQUAL_size_t(0, drives.size());
  TEST_ASSERT_TRUE(logged("Sonar right: 3 of 3 pings heard an echo"));
  TEST_ASSERT_TRUE(logged("Checks stopped: no RUN_CHECKS for 1000 ms, so no wheel turns", EventLog::WARN));
  assertStaysStopped(end);
}

// Re-sends stop mid-run: the wheel turning stops at its own deadline, and
// no other turns.
void test_checks_stop_soon_after_the_resends_do(void) {
  rover->begin(Rover::MODE_MANUAL, 0);
  rover->command(RUN_CHECKS, 0, 0, 0);
  uint32_t now = 0;
  uint32_t heldAt = 0;
  TEST_ASSERT_TRUE(advanceUntil(
      now, 60000, 5,
      [&](uint32_t t) {
        holdChecks(t, heldAt);
        updateRover(t);
      },
      [] { return rover->status().check != nullptr && std::string(rover->status().check) == "wheel RR"; }));
  // The last re-send was at heldAt: by then and a step's drive later, still.
  const uint32_t stillBy = heldAt + tuning::CHECK_HOLD_MS + tuning::CHECK_DRIVE_MS;
  TEST_ASSERT_TRUE(advanceUntil(now, stillBy - now + 5, 5, updateRover,
                                [] { return !motors->driving && rover->status().check == nullptr; }));
  TEST_ASSERT_TRUE(logged("Checks stopped: no RUN_CHECKS", EventLog::WARN));
  assertStaysStopped(now);
}

// Re-sends that cross the run's end, before the client sees it ended, never
// start a second run; a fresh RUN_CHECKS after a pause, or after any other
// command, does.
void test_resends_never_start_a_second_run(void) {
  rover->begin(Rover::MODE_MANUAL, 0);
  rover->command(RUN_CHECKS, 0, 0, 0);
  std::vector<Drive> drives;
  uint32_t now = runChecks(0, drives);
  TEST_ASSERT_EQUAL_size_t(8, drives.size());
  uint32_t heldAt = now;
  const int calls = motors->driveCalls;
  advance(now, 3000, 5, [&](uint32_t t) {
    holdChecks(t, heldAt);
    updateRover(t);
    TEST_ASSERT_NULL(rover->status().check);
  });
  TEST_ASSERT_EQUAL_INT(calls, motors->driveCalls);

  now = runFor(now, tuning::CHECK_HOLD_MS + 100);
  rover->command(RUN_CHECKS, 0, 0, now);
  TEST_ASSERT_EQUAL_STRING("sonar L", rover->status().check);

  rover->command(STOP, 0, 0, now + 5);
  TEST_ASSERT_NULL(rover->status().check);
  rover->command(RUN_CHECKS, 0, 0, now + 10);
  TEST_ASSERT_EQUAL_STRING("sonar L", rover->status().check);
}

// The checks at boot turn no wheel, and a RUN_CHECKS during them starts the
// whole checks.
void test_a_run_during_the_boot_checks_starts_the_whole_checks(void) {
  rover->begin(Rover::MODE_MANUAL, 0);
  rover->checkWithoutWheels(0);
  TEST_ASSERT_EQUAL_STRING("sonar L", rover->status().check);
  uint32_t now = runFor(0, 300);
  rover->command(RUN_CHECKS, 0, 0, now);
  TEST_ASSERT_TRUE(logged("Checks stopped: started again"));
  std::vector<Drive> drives;
  runChecks(now, drives);
  TEST_ASSERT_EQUAL_size_t(8, drives.size());
}

// --- the log ------------------------------------------------------------------

void test_mode_changes_and_stand_downs_are_logged(void) {
  rover->begin(Rover::MODE_AUTONOMOUS, 0);
  rover->command(MOVE_FORWARD, 100, 300, 10);
  TEST_ASSERT_TRUE(logged("Manual: a command took control"));
  rover->command(RESUME_AUTONOMOUS, 0, 0, 20);
  TEST_ASSERT_TRUE(logged("Autonomous: exploring from a fresh sweep"));
  rover->standDown(30, "WiFi lost");
  TEST_ASSERT_TRUE(logged("Stood down: WiFi lost", EventLog::WARN));
  rover->command(99, 100, 300, 40);
  TEST_ASSERT_TRUE(logged("Unknown move code 99: stopped", EventLog::WARN));
  // A repeated command is not a mode change: one line, not one per command.
  const uint32_t lines = events->nextSeq();
  rover->command(MOVE_FORWARD, 100, 300, 60);
  rover->command(MOVE_FORWARD, 100, 300, 70);
  TEST_ASSERT_EQUAL_UINT32(lines, events->nextSeq());
}

int main(int, char**) {
  UNITY_BEGIN();
  RUN_TEST(test_command_drives_until_its_deadline);
  RUN_TEST(test_deadline_survives_the_millis_rollover);
  RUN_TEST(test_repeated_command_extends_the_deadline_without_rewriting_motors);
  RUN_TEST(test_speed_is_clamped);
  RUN_TEST(test_long_duration_stops_at_the_deadman_cap);
  RUN_TEST(test_zero_speed_or_duration_releases);
  RUN_TEST(test_negative_speed_or_duration_releases);
  RUN_TEST(test_unknown_codes_stop_the_rover);
  RUN_TEST(test_stop_command_releases);
  RUN_TEST(test_autonomous_mode_explores);
  RUN_TEST(test_a_command_takes_control_from_exploration);
  RUN_TEST(test_stop_takes_control_from_exploration);
  RUN_TEST(test_unknown_code_takes_control_from_exploration);
  RUN_TEST(test_manual_mode_scans_but_never_drives);
  RUN_TEST(test_manual_mode_sweeps_once_then_holds_the_sonar_ahead);
  RUN_TEST(test_exploring_after_looking_ahead_sweeps_first);
  RUN_TEST(test_resume_autonomous_hands_control_back);
  RUN_TEST(test_stop_keeps_the_mode);
  RUN_TEST(test_losing_the_link_stops_exploration);
  RUN_TEST(test_losing_the_link_while_driven_releases_at_once);
  RUN_TEST(test_resume_restarts_a_halted_explorer);
  RUN_TEST(test_resume_while_exploring_changes_nothing);
  RUN_TEST(test_held_move_is_rewritten_periodically);
  RUN_TEST(test_a_lost_stop_is_written_again);
  RUN_TEST(test_a_lost_obstacle_stop_is_written_again);
  RUN_TEST(test_a_lost_stop_is_written_again_without_the_loop);
  RUN_TEST(test_a_stop_is_written_twice_and_no_more);
  RUN_TEST(test_at_rest_once_a_stop_is_written_twice);
  RUN_TEST(test_a_new_move_cancels_the_second_write);
  RUN_TEST(test_status_reports_a_missing_motor_driver);
  RUN_TEST(test_status_reports_what_the_wheels_are_doing);
  RUN_TEST(test_status_has_no_scan_until_every_bearing_is_measured);
  RUN_TEST(test_manual_mode_points_the_sonar_as_set);
  RUN_TEST(test_the_aim_is_clamped);
  RUN_TEST(test_the_sonar_setting_takes_no_control);
  RUN_TEST(test_an_aimed_reading_is_reported_only_while_aiming);
  RUN_TEST(test_the_checks_run_every_step_in_order);
  RUN_TEST(test_checks_without_a_shield_turn_no_wheel);
  RUN_TEST(test_checks_with_a_silent_sonar_warn);
  RUN_TEST(test_anything_that_takes_control_ends_the_checks);
  RUN_TEST(test_the_checks_take_control_from_exploration);
  RUN_TEST(test_unheld_checks_turn_no_wheel);
  RUN_TEST(test_checks_stop_soon_after_the_resends_do);
  RUN_TEST(test_resends_never_start_a_second_run);
  RUN_TEST(test_a_run_during_the_boot_checks_starts_the_whole_checks);
  RUN_TEST(test_the_status_names_the_check_under_way);
  RUN_TEST(test_mode_changes_and_stand_downs_are_logged);
  return UNITY_END();
}

#include <unity.h>

#include "../fakes/FakeHardware.h"
#include "../support/Loop.h"
#include "GamepadSession.h"
#include "Tuning.h"

// The gamepad's rules, on the host: what a held stick, a released stick, a
// silent pad, START and SELECT do to the rover, what a scheme change does to
// a held stick, how a report is taken out of the Bluetooth mailbox, and when
// the player LEDs are rewritten. The PS3 library itself stays in Gamepad.cpp;
// GamepadSession gets the controls the way it would from the mailbox.

namespace {

FakeMotors* motors;
FakeScanner* scanner;
Rover* rover;
kinematics::ControlScheme scheme;
GamepadSession* session;

GamepadReport pad(int lx, int ly, int l2, int r2, uint32_t reportedAt, bool l1 = false, bool r1 = false) {
  GamepadReport report;
  report.controls = {lx, ly, l2, r2, l1, r1};
  report.hasReport = true;
  report.lastReportMs = reportedAt;
  return report;
}

GamepadReport pressSelect(uint32_t now) {
  GamepadReport report = pad(0, 0, 0, 0, now);
  report.selectPressed = true;
  return report;
}

// Feeds a fresh report every 10 ms, as a connected pad would, from `from`
// for `ms`, running the rover alongside. Returns the new time.
uint32_t hold(const GamepadReport& controls, uint32_t from, uint32_t ms) {
  uint32_t now = from;
  advance(now, ms, 10, [&controls](uint32_t t) {
    GamepadReport report = controls;
    report.lastReportMs = t;
    session->update(report, t);
    rover->update(t);
  });
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

// Counted by its effect, not by motor releases: Rover writes a stop that ends
// a move twice, to repair a lost I2C write. Every STOP takes control, so once
// control is handed back a second STOP would show as a rover forced into
// manual.
void test_release_sends_one_stop(void) {
  rover->begin(Rover::MODE_MANUAL, 0);
  uint32_t now = hold(pad(0, -127, 0, 0, 0), 0, 500);
  now = hold(pad(0, 0, 0, 0, 0), now, 20);
  TEST_ASSERT_FALSE(motors->driving);
  rover->command(RESUME_AUTONOMOUS, 0, 0, now);
  hold(pad(0, 0, 0, 0, 0), now, 2000);
  TEST_ASSERT_EQUAL_INT(Rover::MODE_AUTONOMOUS, rover->mode());  // and nothing more
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
  hold(pad(100, -100, 0, 0, 0, true), 10, 100);  // up and right, L1 held
  TEST_ASSERT_TRUE(motors->driving);
  TEST_ASSERT_EQUAL_INT(PIVOT_RIGHT_FORWARD, motors->lastPattern->move);
}

// The scheme is shared, so it can change under a held stick -- from the
// panel, or anyone's panel. That must never turn the move under the
// operator's thumb into a different one: the pad stops, and drives again only
// from a fresh push.
void test_scheme_change_stops_a_held_stick_until_released(void) {
  rover->begin(Rover::MODE_MANUAL, 0);
  const GamepadReport held = pad(-100, 100, 0, 0, 0, false, true);  // down and left, R1 held
  uint32_t now = hold(held, 0, 100);
  TEST_ASSERT_EQUAL_INT(MOVE_DIAGONAL225, motors->lastPattern->move);  // NORMAL: R1 ignored
  const int drivesBefore = motors->driveCalls;

  scheme = kinematics::SCHEME_ADVANCED;
  now = hold(held, now, 1000);  // still held, well past the refresh
  TEST_ASSERT_FALSE(motors->driving);
  TEST_ASSERT_EQUAL_INT(drivesBefore, motors->driveCalls);

  now = hold(pad(0, 0, 0, 0, 0), now, 20);  // released...
  hold(held, now, 20);                       // ...and pushed again
  TEST_ASSERT_TRUE(motors->driving);
  TEST_ASSERT_EQUAL_INT(PIVOT_SIDEWAYS_BACKWARD_LEFT, motors->lastPattern->move);
}

// The pad's own SELECT follows the same rule.
void test_select_mid_hold_stops_until_released(void) {
  rover->begin(Rover::MODE_MANUAL, 0);
  const GamepadReport held = pad(100, -100, 0, 0, 0, true);  // up and right, L1 held
  uint32_t now = hold(held, 0, 100);
  TEST_ASSERT_EQUAL_INT(MOVE_DIAGONAL45, motors->lastPattern->move);
  GamepadReport select = held;
  select.lastReportMs = now;
  select.selectPressed = true;
  session->update(select, now);
  TEST_ASSERT_EQUAL_INT(kinematics::SCHEME_ADVANCED, scheme);
  TEST_ASSERT_FALSE(motors->driving);
  now = hold(held, now + 10, 500);
  TEST_ASSERT_FALSE(motors->driving);
  now = hold(pad(0, 0, 0, 0, 0), now, 20);
  hold(held, now, 20);
  TEST_ASSERT_EQUAL_INT(PIVOT_RIGHT_FORWARD, motors->lastPattern->move);
}

// A scheme change with the pad at rest sends nothing at all: an exploring
// rover keeps exploring.
void test_scheme_change_at_rest_sends_nothing(void) {
  rover->begin(Rover::MODE_AUTONOMOUS, 0);
  uint32_t now = hold(pad(0, 0, 0, 0, 0), 0, 100);
  scheme = kinematics::SCHEME_ADVANCED;
  hold(pad(0, 0, 0, 0, 0), now, 500);
  TEST_ASSERT_EQUAL_INT(Rover::MODE_AUTONOMOUS, rover->mode());
  TEST_ASSERT_EQUAL_INT(0, motors->driveCalls);
}

// --- the Bluetooth mailbox -------------------------------------------------

// START and SELECT are edges: each press is acted on once, however many
// passes the pad's latest report stays in the mailbox.
void test_mailbox_hands_over_each_press_once(void) {
  GamepadReport mailbox = pad(0, -127, 0, 0, 1000);
  mailbox.startPressed = true;
  mailbox.selectPressed = true;
  const GamepadReport first = takeGamepadReport(mailbox, 1000);  // stamped this very ms
  TEST_ASSERT_TRUE(first.hasReport);
  TEST_ASSERT_TRUE(first.startPressed);
  TEST_ASSERT_TRUE(first.selectPressed);
  const GamepadReport second = takeGamepadReport(mailbox, 1010);
  TEST_ASSERT_FALSE(second.startPressed);
  TEST_ASSERT_FALSE(second.selectPressed);
  TEST_ASSERT_TRUE(second.hasReport);  // the report itself stays
  TEST_ASSERT_EQUAL_INT(-127, second.controls.ly);
}

// A pad silent for GAMEPAD_SILENCE_MS is forgotten outright, a press still
// pending in its last report included, and stays forgotten: once the 32-bit
// clock comes back round past its stamp, 49.7 days on, that stamp would read
// as fresh again.
void test_mailbox_forgets_a_silent_pad(void) {
  const uint32_t lastWords = 1000;
  GamepadReport mailbox = pad(0, -127, 0, 0, lastWords);
  TEST_ASSERT_TRUE(takeGamepadReport(mailbox, lastWords + tuning::GAMEPAD_SILENCE_MS - 1).hasReport);

  mailbox.startPressed = true;
  const GamepadReport silent = takeGamepadReport(mailbox, lastWords + tuning::GAMEPAD_SILENCE_MS);
  TEST_ASSERT_FALSE(silent.hasReport);
  TEST_ASSERT_FALSE(silent.startPressed);
  TEST_ASSERT_EQUAL_INT(0, silent.controls.ly);

  const uint32_t wrappedRound = lastWords + 10;  // 2^32 ms later
  TEST_ASSERT_FALSE(takeGamepadReport(mailbox, wrappedRound).hasReport);
}

// loop() reads its `now`, then rover.update() pings the sonar, busy-waiting
// up to ~30 ms while the pad keeps reporting from the other core.
// Gamepad::update reads the clock again under the mailbox's lock, so every
// report it takes landed before that clock; this models it, with a report
// landing mid-ping on every pass. Aged against loop()'s older `now` instead,
// such a report read as 49.7 days old and was wiped: the held stick was
// released and re-driven on every ping, and a START or SELECT in it was lost.
void test_report_landing_mid_ping_keeps_the_stick_held(void) {
  // The hazard itself: a stamp later than the clock it is aged against is
  // silence, because an unsigned age cannot tell it from one 49.7 days old
  // (and a signed one would let a 24.8-day-old stick read as fresh).
  GamepadReport aheadOfLoop = pad(0, -127, 0, 0, 20);
  TEST_ASSERT_FALSE(takeGamepadReport(aheadOfLoop, 0).hasReport);

  rover->begin(Rover::MODE_MANUAL, 0);
  const int releasesBefore = motors->releaseCalls;
  GamepadReport mailbox;
  uint32_t loopNow = 0;
  for (int pass = 0; pass < 100; pass++) {
    rover->update(loopNow);
    mailbox.controls = {0, -127, 0, 0, false, false};
    mailbox.lastReportMs = loopNow + 20;  // during a 25 ms ping
    mailbox.hasReport = true;
    mailbox.startPressed = pass == 99;
    const uint32_t padNow = loopNow + 25;  // the clock under the lock
    session->update(takeGamepadReport(mailbox, padNow), padNow);
    if (pass < 99) {
      TEST_ASSERT_TRUE(motors->driving);
      TEST_ASSERT_EQUAL_INT(releasesBefore, motors->releaseCalls);
    }
    loopNow = padNow + 1;
  }
  TEST_ASSERT_EQUAL_INT(Rover::MODE_AUTONOMOUS, rover->mode());  // the last START got through
}

// --- the player LEDs -------------------------------------------------------

// Any client can flip the scheme as fast as it sends, and each LED write is a
// Bluetooth send from the loop task. Ten flips in 100 ms get one write; the
// LEDs then catch up with the last flip once the limit has passed, and stay.
void test_led_writes_are_rate_limited_and_catch_up(void) {
  TEST_ASSERT_EQUAL_INT(1, session->playerLedToShow(true, 1000));  // NORMAL
  int writes = 0;
  int lastWritten = 0;
  for (uint32_t t = 2000; t < 2100; t += 10) {
    scheme = scheme == kinematics::SCHEME_ADVANCED ? kinematics::SCHEME_NORMAL
                                                   : kinematics::SCHEME_ADVANCED;
    const int led = session->playerLedToShow(true, t);
    if (led != 0) {
      writes++;
      lastWritten = led;
    }
  }
  TEST_ASSERT_EQUAL_INT(1, writes);
  TEST_ASSERT_EQUAL_INT(2, lastWritten);  // the first flip
  TEST_ASSERT_EQUAL_INT(kinematics::SCHEME_NORMAL, scheme);  // where the ten left it

  const uint32_t limitPassed = 2000 + tuning::GAMEPAD_LED_MIN_INTERVAL_MS;
  for (uint32_t t = 2100; t < limitPassed; t += 10) TEST_ASSERT_EQUAL_INT(0, session->playerLedToShow(true, t));
  TEST_ASSERT_EQUAL_INT(1, session->playerLedToShow(true, limitPassed));
  for (uint32_t t = limitPassed + 10; t < limitPassed + 2000; t += 10) {
    TEST_ASSERT_EQUAL_INT(0, session->playerLedToShow(true, t));
  }
}

// A pad that (re)connects is set to player 1 by the library, whatever the
// scheme, and the session sees only silence and then reports again: the LEDs
// are rewritten when it comes back. A pad that is not reporting gets nothing.
void test_led_is_rewritten_for_a_pad_that_reappears(void) {
  scheme = kinematics::SCHEME_ADVANCED;
  TEST_ASSERT_EQUAL_INT(2, session->playerLedToShow(true, 1000));
  TEST_ASSERT_EQUAL_INT(0, session->playerLedToShow(true, 1500));
  scheme = kinematics::SCHEME_NORMAL;
  TEST_ASSERT_EQUAL_INT(0, session->playerLedToShow(false, 2000));  // gone, and changed meanwhile
  scheme = kinematics::SCHEME_ADVANCED;
  TEST_ASSERT_EQUAL_INT(0, session->playerLedToShow(false, 2500));
  TEST_ASSERT_EQUAL_INT(2, session->playerLedToShow(true, 3000));  // back: the same LED again
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
  RUN_TEST(test_scheme_change_stops_a_held_stick_until_released);
  RUN_TEST(test_select_mid_hold_stops_until_released);
  RUN_TEST(test_scheme_change_at_rest_sends_nothing);
  RUN_TEST(test_mailbox_hands_over_each_press_once);
  RUN_TEST(test_mailbox_forgets_a_silent_pad);
  RUN_TEST(test_report_landing_mid_ping_keeps_the_stick_held);
  RUN_TEST(test_led_writes_are_rate_limited_and_catch_up);
  RUN_TEST(test_led_is_rewritten_for_a_pad_that_reappears);
  return UNITY_END();
}

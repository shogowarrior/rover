#include <unity.h>

#include <string>

#include "../fakes/FakeHardware.h"
#include "../support/Loop.h"
#include "EventLog.h"
#include "GamepadSession.h"
#include "Tuning.h"

// The gamepad's rules, on the host: what a held stick, a released stick, a
// silent pad, START, SELECT and Cross do to the rover, what a scheme change does to
// a held stick, how a report is taken out of the Bluetooth mailbox, and when
// the player LEDs are rewritten. The PS3 library itself stays in Gamepad.cpp;
// GamepadSession gets the controls the way it would from the mailbox.

namespace {

FakeMotors* motors;
FakeScanner* scanner;
EventLog* events;
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

// `report` with `button` gone down in it.
GamepadReport with(PadButton button, GamepadReport report) {
  report.pressed |= button;
  return report;
}

GamepadReport pressSelect(uint32_t now) { return with(PAD_SELECT, pad(0, 0, 0, 0, now)); }

GamepadReport withCross(GamepadReport report) { return with(PAD_CROSS, report); }

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

// Runs an exploring rover, the pad resting, from `from` until exploration
// first drives (an open world needs one sweep, about a second). Returns the
// time it did.
uint32_t exploreUntilDriving(uint32_t from) {
  uint32_t now = from;
  const bool drove = advanceUntil(
      now, 5000, 10,
      [](uint32_t t) {
        session->update(pad(0, 0, 0, 0, t), t);
        rover->update(t);
      },
      [] { return motors->driving; });
  TEST_ASSERT_TRUE_MESSAGE(drove, "exploration never drove");
  return now;
}

}  // namespace

void setUp(void) {
  motors = new FakeMotors();
  scanner = new FakeScanner();
  events = new EventLog();
  rover = new Rover(*motors, *scanner, *events);
  scheme = kinematics::SCHEME_NORMAL;
  session = new GamepadSession(*rover, scheme, *events);
}

void tearDown(void) {
  delete session;
  delete rover;
  delete events;
  delete scanner;
  delete motors;
}

// A pad lying on the table must never touch an exploring rover: an idle pad
// that streamed STOPs would force manual mode over and over.
void test_resting_pad_leaves_exploration_alone(void) {
  rover->begin(Rover::MODE_AUTONOMOUS, 0);
  hold(pad(0, 0, 0, 0, 0), 0, 3000);
  TEST_ASSERT_EQUAL_INT(Rover::MODE_AUTONOMOUS, rover->status().mode);
}

// Each command lasts DEFAULT_MOVE_DURATION_MS. Sending only on change, as the
// old callback did, stopped a steadily held stick after 750 ms.
void test_held_stick_keeps_the_rover_moving(void) {
  rover->begin(Rover::MODE_MANUAL, 0);
  hold(pad(0, -127, 0, 0, 0), 0, 3 * tuning::DEFAULT_MOVE_DURATION_MS);
  TEST_ASSERT_TRUE(motors->driving);
  TEST_ASSERT_EQUAL_INT(MOVE_FORWARD, motors->lastPattern->move);
}

// A held stick is re-sent every GAMEPAD_REFRESH_MS, each command asking for
// DEFAULT_MOVE_DURATION_MS and no more: the wheels stop that long after the
// last one the session sent. The other tests keep the session fed or end the
// move with a STOP, so neither number showed.
void test_held_stick_is_resent_at_the_refresh_rate_for_the_default_duration(void) {
  rover->begin(Rover::MODE_MANUAL, 0);
  uint32_t now = 0;
  const uint32_t held = 5 * tuning::GAMEPAD_REFRESH_MS;
  advance(now, held, 10, [](uint32_t t) { session->update(pad(0, -127, 0, 0, t), t); });
  const uint32_t lastSent = held - tuning::GAMEPAD_REFRESH_MS;  // and the four before it
  rover->update(lastSent + tuning::DEFAULT_MOVE_DURATION_MS - 1);
  TEST_ASSERT_TRUE(motors->driving);
  rover->update(lastSent + tuning::DEFAULT_MOVE_DURATION_MS);
  TEST_ASSERT_FALSE(motors->driving);
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
  TEST_ASSERT_EQUAL_INT(Rover::MODE_AUTONOMOUS, rover->status().mode);  // and nothing more
}

// The library never reports a disconnect. Silence is the only sign the pad
// has gone, and what it was driving must stop.
void test_silent_pad_stops_what_it_drove(void) {
  rover->begin(Rover::MODE_MANUAL, 0);
  uint32_t now = hold(pad(0, -127, 0, 0, 0), 0, 500);
  const GamepadReport lastWords = pad(0, -127, 0, 0, now - 10);  // stick still forward
  advance(now, tuning::GAMEPAD_SILENCE_MS + 50, 10, [&lastWords](uint32_t t) { session->update(lastWords, t); });
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
  uint32_t now = 0;
  advance(now, 1000, 10, [&nothing](uint32_t t) { session->update(nothing, t); });
  TEST_ASSERT_EQUAL_INT(Rover::MODE_AUTONOMOUS, rover->status().mode);
}

void test_start_hands_control_back_to_exploration(void) {
  rover->begin(Rover::MODE_MANUAL, 0);
  uint32_t now = hold(pad(0, -127, 0, 0, 0), 0, 300);
  session->update(with(PAD_START, pad(0, 0, 0, 0, now)), now);
  TEST_ASSERT_EQUAL_INT(Rover::MODE_AUTONOMOUS, rover->status().mode);
  hold(pad(0, 0, 0, 0, 0), now + 10, 1000);  // resting afterwards changes nothing
  TEST_ASSERT_EQUAL_INT(Rover::MODE_AUTONOMOUS, rover->status().mode);
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
  TEST_ASSERT_EQUAL_INT(Rover::MODE_AUTONOMOUS, rover->status().mode);
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
  select.pressed = PAD_SELECT;
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
  TEST_ASSERT_EQUAL_INT(Rover::MODE_AUTONOMOUS, rover->status().mode);
  TEST_ASSERT_EQUAL_INT(0, motors->driveCalls);
}

// --- Cross -----------------------------------------------------------------

// Cross is the pad's Stop. Before it, the pad's only stop was letting go of a
// stick, so stopping an exploring rover meant driving it first. Like any
// command it takes control, and the rover stays put afterwards.
void test_cross_stops_an_exploring_rover(void) {
  rover->begin(Rover::MODE_AUTONOMOUS, 0);
  uint32_t now = exploreUntilDriving(0) + 10;
  session->update(withCross(pad(0, 0, 0, 0, now)), now);
  TEST_ASSERT_FALSE(motors->driving);
  TEST_ASSERT_EQUAL_INT(Rover::MODE_MANUAL, rover->status().mode);

  const int drivesBefore = motors->driveCalls;
  hold(pad(0, 0, 0, 0, 0), now + 10, 3000);  // resting afterwards changes nothing
  TEST_ASSERT_FALSE(motors->driving);
  TEST_ASSERT_EQUAL_INT(Rover::MODE_MANUAL, rover->status().mode);
  TEST_ASSERT_EQUAL_INT(drivesBefore, motors->driveCalls);
}

// A thumb still on the stick as Cross goes down must not drive the rover on at
// the next pass, or Cross would do nothing: the stick waits for centre, as
// after a scheme change, and drives again only from a fresh push.
void test_cross_stops_a_held_stick_until_centred(void) {
  rover->begin(Rover::MODE_MANUAL, 0);
  const GamepadReport held = pad(0, -127, 0, 0, 0);  // forward
  uint32_t now = hold(held, 0, 300);
  TEST_ASSERT_TRUE(motors->driving);

  GamepadReport cross = withCross(held);
  cross.lastReportMs = now;
  session->update(cross, now);
  TEST_ASSERT_FALSE(motors->driving);

  const int drivesBefore = motors->driveCalls;
  now = hold(held, now + 10, 1000);  // still held, well past the refresh
  TEST_ASSERT_FALSE(motors->driving);
  TEST_ASSERT_EQUAL_INT(drivesBefore, motors->driveCalls);

  now = hold(pad(0, 0, 0, 0, 0), now, 20);  // centred...
  hold(held, now, 20);                       // ...and pushed again
  TEST_ASSERT_TRUE(motors->driving);
  TEST_ASSERT_EQUAL_INT(MOVE_FORWARD, motors->lastPattern->move);
}

// Unlike letting go, Cross is sent when the pad is driving nothing, as the
// panel's Stop is: something else may be moving the rover. With nothing held
// it leaves the stick free, so the next push drives at once.
void test_cross_at_rest_still_sends_stop(void) {
  rover->begin(Rover::MODE_MANUAL, 0);
  const int releasesBefore = motors->releaseCalls;
  session->update(withCross(pad(0, 0, 0, 0, 0)), 0);
  TEST_ASSERT_EQUAL_INT(releasesBefore + 1, motors->releaseCalls);  // a STOP reached the wheels

  rover->command(MOVE_LEFT, 100, 1000, 10);  // the panel, say, drives
  session->update(withCross(pad(0, 0, 0, 0, 20)), 20);
  TEST_ASSERT_FALSE(motors->driving);

  session->update(pad(0, -127, 0, 0, 30), 30);  // a push straight after
  TEST_ASSERT_TRUE(motors->driving);
  TEST_ASSERT_EQUAL_INT(MOVE_FORWARD, motors->lastPattern->move);
}

// Cross is an edge, like START and SELECT: the mailbox hands a press over
// once, however many passes the pad's latest report stays there. Taken twice,
// it would send a second STOP and take back control handed on since.
void test_cross_is_acted_on_once(void) {
  rover->begin(Rover::MODE_AUTONOMOUS, 0);
  GamepadReport mailbox = withCross(pad(0, 0, 0, 0, 0));
  const GamepadReport first = takeGamepadReport(mailbox, 0);
  TEST_ASSERT_TRUE(first.wasPressed(PAD_CROSS));
  session->update(first, 0);
  TEST_ASSERT_EQUAL_INT(Rover::MODE_MANUAL, rover->status().mode);

  rover->command(RESUME_AUTONOMOUS, 0, 0, 10);  // handed back, from the panel say
  uint32_t now = 10;
  advance(now, 1000, 10, [&mailbox](uint32_t t) {
    mailbox.lastReportMs = t;  // the pad keeps reporting, Cross up
    const GamepadReport report = takeGamepadReport(mailbox, t);
    TEST_ASSERT_FALSE(report.wasPressed(PAD_CROSS));
    session->update(report, t);
    rover->update(t);
  });
  TEST_ASSERT_EQUAL_INT(Rover::MODE_AUTONOMOUS, rover->status().mode);
}

// Cross and START in one report: two buttons at once fail toward stopped.
// Cross wins, and the rover is left stopped in manual, not exploring.
void test_cross_wins_over_start_in_one_report(void) {
  rover->begin(Rover::MODE_AUTONOMOUS, 0);
  uint32_t now = exploreUntilDriving(0) + 10;
  const GamepadReport both = with(PAD_START, withCross(pad(0, 0, 0, 0, now)));
  session->update(both, now);
  TEST_ASSERT_FALSE(motors->driving);
  TEST_ASSERT_EQUAL_INT(Rover::MODE_MANUAL, rover->status().mode);

  const int drivesBefore = motors->driveCalls;
  hold(pad(0, 0, 0, 0, 0), now + 10, 3000);
  TEST_ASSERT_EQUAL_INT(Rover::MODE_MANUAL, rover->status().mode);
  TEST_ASSERT_EQUAL_INT(drivesBefore, motors->driveCalls);
}

// --- the Bluetooth mailbox -------------------------------------------------

// START and SELECT are edges: each press is acted on once, however many
// passes the pad's latest report stays in the mailbox.
void test_mailbox_hands_over_each_press_once(void) {
  GamepadReport mailbox = pad(0, -127, 0, 0, 1000);
  mailbox.pressed = PAD_START | PAD_SELECT | PAD_TRIANGLE | PAD_R3 | PAD_UP | PAD_DOWN;
  const GamepadReport first = takeGamepadReport(mailbox, 1000);  // stamped this very ms
  TEST_ASSERT_TRUE(first.hasReport);
  TEST_ASSERT_TRUE(first.wasPressed(PAD_START));
  TEST_ASSERT_TRUE(first.wasPressed(PAD_SELECT));
  TEST_ASSERT_TRUE(first.wasPressed(PAD_TRIANGLE));
  TEST_ASSERT_TRUE(first.wasPressed(PAD_DOWN));
  TEST_ASSERT_FALSE(first.wasPressed(PAD_CROSS));
  const GamepadReport second = takeGamepadReport(mailbox, 1010);
  TEST_ASSERT_EQUAL_UINT8(0, second.pressed);
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

  mailbox.pressed = PAD_START;
  mailbox.rx = 127;
  const GamepadReport silent = takeGamepadReport(mailbox, lastWords + tuning::GAMEPAD_SILENCE_MS);
  TEST_ASSERT_FALSE(silent.hasReport);
  TEST_ASSERT_FALSE(silent.wasPressed(PAD_START));
  TEST_ASSERT_EQUAL_INT(0, silent.controls.ly);
  TEST_ASSERT_EQUAL_INT(0, silent.rx);

  const uint32_t wrappedRound = lastWords + 10;  // 2^32 ms later
  TEST_ASSERT_FALSE(takeGamepadReport(mailbox, wrappedRound).hasReport);
}

// Gamepad::update reads its clock under the mailbox lock, after loop()'s
// sonar ping; this models a report landing mid-ping on every pass. Aged against
// loop()'s older `now`, such a report read as 49.7 days old and was wiped:
// the held stick released on every ping, and a START or SELECT was lost.
void test_report_landing_mid_ping_keeps_the_stick_held(void) {
  // The hazard itself: a stamp later than its clock reads as silence.
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
    mailbox.pressed = pass == 99 ? PAD_START : 0;
    const uint32_t padNow = loopNow + 25;  // the clock under the lock
    session->update(takeGamepadReport(mailbox, padNow), padNow);
    if (pass < 99) {
      TEST_ASSERT_TRUE(motors->driving);
      TEST_ASSERT_EQUAL_INT(releasesBefore, motors->releaseCalls);
    }
    loopNow = padNow + 1;
  }
  TEST_ASSERT_EQUAL_INT(Rover::MODE_AUTONOMOUS, rover->status().mode);  // the last START got through
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

// --- the spare buttons ------------------------------------------------------

// A pad with only the right stick pushed: rx, -128 (left) to 127 (right).
GamepadReport rightStick(int rx, uint32_t reportedAt) {
  GamepadReport report = pad(0, 0, 0, 0, reportedAt);
  report.rx = rx;
  return report;
}

bool logged(const char* text, EventLog::Level level = EventLog::INFO) {
  for (uint32_t seq = events->oldestSeq(); seq != events->nextSeq(); seq++) {
    const EventLog::Entry* entry = events->from(seq);
    if (entry->level == level && std::string(entry->text).find(text) != std::string::npos) return true;
  }
  return false;
}

// Up and down on the D-pad step the speed a full stick reaches, and a full
// trigger pull half of it, between one step and the motors' limit.
void test_the_d_pad_steps_the_top_speed(void) {
  rover->begin(Rover::MODE_MANUAL, 0);
  uint32_t now = hold(pad(0, -127, 0, 0, 0), 0, 100);
  TEST_ASSERT_EQUAL_UINT8(tuning::GAMEPAD_MAX_SPEED, motors->lastSpeed);
  session->update(with(PAD_UP, pad(0, -127, 0, 0, now)), now);
  now = hold(pad(0, -127, 0, 0, 0), now + 10, 300);
  TEST_ASSERT_EQUAL_UINT8(tuning::GAMEPAD_MAX_SPEED + tuning::GAMEPAD_SPEED_STEP, motors->lastSpeed);
  TEST_ASSERT_TRUE(logged("Pad: top speed 75"));

  for (int i = 0; i < 20; i++) session->update(with(PAD_UP, pad(0, -127, 0, 0, now)), now);
  now = hold(pad(0, -127, 0, 0, 0), now + 10, 300);
  TEST_ASSERT_EQUAL_UINT8(tuning::MOTOR_SPEED_LIMIT, motors->lastSpeed);

  for (int i = 0; i < 20; i++) session->update(with(PAD_DOWN, pad(0, 0, 0, 0, now)), now);
  now = hold(pad(0, 0, 0, 255, 0), now + 10, 300);  // a full pull on R2
  TEST_ASSERT_EQUAL_INT(ROTATE_CLOCKWISE, motors->lastPattern->move);
  TEST_ASSERT_TRUE(motors->lastSpeed > 0);
  TEST_ASSERT_TRUE(motors->lastSpeed <= tuning::GAMEPAD_SPEED_STEP / 2 + 1);
}

// The right stick pans the sonar, faster the further it is pushed, and right
// is to the right: negative angles.
void test_the_right_stick_pans_the_sonar(void) {
  rover->begin(Rover::MODE_MANUAL, 0);
  uint32_t now = hold(rightStick(127, 0), 0, 500);
  Rover::Status status = rover->status();
  TEST_ASSERT_EQUAL_INT(Explorer::SONAR_AIM, status.sonar);
  TEST_ASSERT_INT_WITHIN(5, -tuning::GAMEPAD_PAN_DEG_PER_S / 2, status.aimDeg);
  // Held on, it stops at the limit.
  now = hold(rightStick(127, 0), now, 3000);
  TEST_ASSERT_EQUAL_INT(-tuning::SONAR_AIM_MAX_DEG, rover->status().aimDeg);
  // Let go, it stays where it is, and says where.
  now = hold(rightStick(0, 0), now, 500);
  TEST_ASSERT_EQUAL_INT(-tuning::SONAR_AIM_MAX_DEG, rover->status().aimDeg);
  TEST_ASSERT_TRUE(logged("Pad: the sonar aimed at -80 deg"));
  // Half pushed left, more slowly.
  const int before = rover->status().aimDeg;
  now = hold(rightStick(-74, 0), now, 1000);
  const int moved = rover->status().aimDeg - before;
  TEST_ASSERT_TRUE(moved > 20);
  TEST_ASSERT_TRUE(moved < tuning::GAMEPAD_PAN_DEG_PER_S - 20);
  // Inside the dead zone, nothing.
  const int still = rover->status().aimDeg;
  hold(rightStick(tuning::GAMEPAD_DEADZONE, 0), now, 1000);
  TEST_ASSERT_EQUAL_INT(still, rover->status().aimDeg);
  TEST_ASSERT_EQUAL_INT(0, motors->driveCalls);
}

// From wherever a client aimed it; from straight ahead if it was not aiming.
void test_a_pan_starts_from_the_current_aim(void) {
  rover->begin(Rover::MODE_MANUAL, 0);
  rover->setSonar(Explorer::SONAR_AIM, 30, 0);
  uint32_t now = hold(rightStick(-127, 0), 0, 200);
  TEST_ASSERT_INT_WITHIN(4, 30 + tuning::GAMEPAD_PAN_DEG_PER_S / 5, rover->status().aimDeg);
  now = hold(rightStick(0, 0), now, 100);
  rover->setSonar(Explorer::SONAR_SWEEP, 60, now);
  hold(rightStick(127, 0), now, 200);
  TEST_ASSERT_INT_WITHIN(4, -tuning::GAMEPAD_PAN_DEG_PER_S / 5, rover->status().aimDeg);
}

// R3 (the right stick, pressed) looks ahead and Triangle sweeps; either
// keeps the aim for the next time it aims.
void test_r3_looks_ahead_and_triangle_sweeps(void) {
  rover->begin(Rover::MODE_MANUAL, 0);
  rover->setSonar(Explorer::SONAR_AIM, 40, 0);
  session->update(with(PAD_R3, pad(0, 0, 0, 0, 10)), 10);
  TEST_ASSERT_EQUAL_INT(Explorer::SONAR_FRONT, rover->status().sonar);
  TEST_ASSERT_EQUAL_INT(40, rover->status().aimDeg);
  session->update(with(PAD_TRIANGLE, pad(0, 0, 0, 0, 20)), 20);
  TEST_ASSERT_EQUAL_INT(Explorer::SONAR_SWEEP, rover->status().sonar);
  TEST_ASSERT_EQUAL_INT(40, rover->status().aimDeg);
}

// The sonar and the top speed are settings, like the scheme: none of them
// takes control from an exploring rover.
void test_the_spare_buttons_take_no_control(void) {
  rover->begin(Rover::MODE_AUTONOMOUS, 0);
  uint32_t now = exploreUntilDriving(0) + 10;
  session->update(with(PAD_R3, pad(0, 0, 0, 0, now)), now);
  session->update(with(PAD_UP, pad(0, 0, 0, 0, now + 10)), now + 10);
  session->update(with(PAD_DOWN, pad(0, 0, 0, 0, now + 20)), now + 20);
  now = hold(rightStick(127, 0), now + 30, 500);
  session->update(with(PAD_TRIANGLE, pad(0, 0, 0, 0, now)), now);
  TEST_ASSERT_EQUAL_INT(Rover::MODE_AUTONOMOUS, rover->status().mode);
  hold(pad(0, 0, 0, 0, 0), now + 10, 3000);
  TEST_ASSERT_EQUAL_INT(Rover::MODE_AUTONOMOUS, rover->status().mode);
}

// --- pad control on and off --------------------------------------------------

// Off, the pad drives nothing and changes nothing; Cross still stops the
// rover, so Stop is one press from every controller.
void test_pad_control_off_leaves_only_cross(void) {
  rover->begin(Rover::MODE_MANUAL, 0);
  uint32_t now = hold(pad(0, -127, 0, 0, 0), 0, 300);
  TEST_ASSERT_TRUE(motors->driving);
  const int releases = motors->releaseCalls;
  session->setEnabled(false, now);
  TEST_ASSERT_FALSE(motors->driving);
  TEST_ASSERT_EQUAL_INT(PAD_OFF, session->state());
  TEST_ASSERT_TRUE(logged("Pad control off"));
  const int drives = motors->driveCalls;
  now = hold(pad(0, -127, 0, 0, 0), now + 10, 1000);
  now = hold(rightStick(127, 0), now, 500);
  session->update(with(PAD_SELECT, pad(0, 0, 0, 0, now)), now);
  session->update(with(PAD_UP, pad(0, 0, 0, 0, now + 10)), now + 10);
  session->update(with(PAD_TRIANGLE, pad(0, 0, 0, 0, now + 20)), now + 20);
  session->update(with(PAD_START, pad(0, 0, 0, 0, now + 30)), now + 30);
  TEST_ASSERT_EQUAL_INT(drives, motors->driveCalls);
  TEST_ASSERT_EQUAL_INT(kinematics::SCHEME_NORMAL, scheme);
  TEST_ASSERT_EQUAL_INT(Explorer::SONAR_FRONT, rover->status().sonar);
  TEST_ASSERT_EQUAL_INT(Rover::MODE_MANUAL, rover->status().mode);
  // One STOP when it was turned off, and no stream of them since.
  TEST_ASSERT_TRUE(motors->releaseCalls - releases <= 3);

  rover->command(RESUME_AUTONOMOUS, 0, 0, now + 40);
  session->update(withCross(pad(0, 0, 0, 0, now + 50)), now + 50);
  TEST_ASSERT_EQUAL_INT(Rover::MODE_MANUAL, rover->status().mode);
}

// Turned on again under a held stick, it waits for centre, as after a scheme
// change: nothing drives off under a thumb resting on the stick.
void test_pad_control_on_waits_for_centre(void) {
  rover->begin(Rover::MODE_MANUAL, 0);
  session->setEnabled(false, 0);
  uint32_t now = hold(pad(0, -127, 0, 0, 0), 0, 300);
  session->setEnabled(true, now);
  TEST_ASSERT_TRUE(logged("Pad control on"));
  now = hold(pad(0, -127, 0, 0, 0), now, 1000);
  TEST_ASSERT_EQUAL_INT(0, motors->driveCalls);
  now = hold(pad(0, 0, 0, 0, 0), now, 50);
  hold(pad(0, -127, 0, 0, 0), now, 300);
  TEST_ASSERT_TRUE(motors->driving);
}

void test_pad_state_and_presence_are_reported(void) {
  rover->begin(Rover::MODE_MANUAL, 0);
  TEST_ASSERT_EQUAL_INT(PAD_WAITING, session->state());
  uint32_t now = hold(pad(0, 0, 0, 0, 0), 0, 100);
  TEST_ASSERT_EQUAL_INT(PAD_CONNECTED, session->state());
  TEST_ASSERT_TRUE(logged("Pad connected"));
  // Silent: the last report ages out.
  GamepadReport last = pad(0, 0, 0, 0, now);
  advance(now, tuning::GAMEPAD_SILENCE_MS + 100, 10, [&last](uint32_t t) { session->update(last, t); });
  TEST_ASSERT_EQUAL_INT(PAD_WAITING, session->state());
  TEST_ASSERT_TRUE(logged("Pad silent", EventLog::WARN));
  session->setEnabled(false, now);
  TEST_ASSERT_EQUAL_INT(PAD_OFF, session->state());
}

// LED 4 says pad control is off, rate-limited like the scheme's.
void test_led_four_shows_pad_control_off(void) {
  TEST_ASSERT_EQUAL_INT(1, session->playerLedToShow(true, 1000));
  session->setEnabled(false, 1100);
  TEST_ASSERT_EQUAL_INT(0, session->playerLedToShow(true, 1100));
  TEST_ASSERT_EQUAL_INT(4, session->playerLedToShow(true, 1000 + tuning::GAMEPAD_LED_MIN_INTERVAL_MS));
  session->setEnabled(true, 2000);
  TEST_ASSERT_EQUAL_INT(1, session->playerLedToShow(true, 2000));
}

int main(int, char**) {
  UNITY_BEGIN();
  RUN_TEST(test_resting_pad_leaves_exploration_alone);
  RUN_TEST(test_held_stick_keeps_the_rover_moving);
  RUN_TEST(test_held_stick_is_resent_at_the_refresh_rate_for_the_default_duration);
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
  RUN_TEST(test_cross_stops_an_exploring_rover);
  RUN_TEST(test_cross_stops_a_held_stick_until_centred);
  RUN_TEST(test_cross_at_rest_still_sends_stop);
  RUN_TEST(test_cross_is_acted_on_once);
  RUN_TEST(test_cross_wins_over_start_in_one_report);
  RUN_TEST(test_mailbox_hands_over_each_press_once);
  RUN_TEST(test_mailbox_forgets_a_silent_pad);
  RUN_TEST(test_report_landing_mid_ping_keeps_the_stick_held);
  RUN_TEST(test_led_writes_are_rate_limited_and_catch_up);
  RUN_TEST(test_led_is_rewritten_for_a_pad_that_reappears);
  RUN_TEST(test_the_d_pad_steps_the_top_speed);
  RUN_TEST(test_the_right_stick_pans_the_sonar);
  RUN_TEST(test_a_pan_starts_from_the_current_aim);
  RUN_TEST(test_r3_looks_ahead_and_triangle_sweeps);
  RUN_TEST(test_the_spare_buttons_take_no_control);
  RUN_TEST(test_pad_control_off_leaves_only_cross);
  RUN_TEST(test_pad_control_on_waits_for_centre);
  RUN_TEST(test_pad_state_and_presence_are_reported);
  RUN_TEST(test_led_four_shows_pad_control_off);
  return UNITY_END();
}

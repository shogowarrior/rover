#include <ArduinoJson.h>
#include <unity.h>

#include <string>

#include "../fakes/FakeHardware.h"
#include "../support/Loop.h"
#include "Control.h"
#include "Protocol.h"
#include "Settings.h"
#include "Timing.h"
#include "Tuning.h"

// Who may drive when several controllers send at once (Control.h), and the
// settings every controller shares (Settings.h), on the host. The default
// priority is USB, then PAD, then WIFI.

namespace {

FakeMotors* motors;
FakeScanner* scanner;
EventLog* events;
Settings* settings;
Rover* rover;
Control* control;

const uint32_t HOLD = tuning::CONTROL_HOLD_MS;

// How many lines hold `text`, at `level`, from `source`.
int logged(const char* text, EventLog::Level level = EventLog::INFO, Source source = SOURCE_ROVER) {
  int found = 0;
  for (uint32_t seq = events->oldestSeq(); seq != events->nextSeq(); seq++) {
    const EventLog::Entry* entry = events->from(seq);
    if (entry->level == level && entry->source == source && std::string(entry->text).find(text) != std::string::npos) {
      found++;
    }
  }
  return found;
}

MoveCode driving() { return motors->driving ? motors->lastPattern->move : STOP; }

JsonDocument parsed;
protocol::Message message(const char* json) {
  TEST_ASSERT_FALSE(deserializeJson(parsed, json));
  return protocol::readMessage(parsed.as<JsonVariantConst>());
}

}  // namespace

void setUp(void) {
  motors = new FakeMotors();
  scanner = new FakeScanner();
  events = new EventLog();
  settings = new Settings(*events, kinematics::SCHEME_NORMAL);
  rover = new Rover(*motors, *scanner, *settings, *events);
  control = new Control(*rover, *settings, *events);
  rover->begin(Rover::MODE_MANUAL, 0);
}

void tearDown(void) {
  delete control;
  delete rover;
  delete settings;
  delete events;
  delete scanner;
  delete motors;
}

// --- control ------------------------------------------------------------------

void test_a_first_command_takes_control(void) {
  TEST_ASSERT_EQUAL_INT(SOURCE_ROVER, control->holder(0));
  TEST_ASSERT_TRUE(control->command(SOURCE_WIFI, MOVE_FORWARD, 100, 400, 10));
  TEST_ASSERT_EQUAL_INT(MOVE_FORWARD, driving());
  TEST_ASSERT_EQUAL_INT(SOURCE_WIFI, control->holder(10));
  TEST_ASSERT_EQUAL_INT(1, logged("WIFI has control: MOVE_FORWARD", EventLog::INFO, SOURCE_WIFI));
  // Its own re-sends are not news.
  control->command(SOURCE_WIFI, MOVE_FORWARD, 100, 400, 210);
  control->command(SOURCE_WIFI, MOVE_LEFT, 100, 400, 410);
  TEST_ASSERT_EQUAL_INT(MOVE_LEFT, driving());
  TEST_ASSERT_EQUAL_INT(0, logged("WIFI has control: MOVE_LEFT", EventLog::INFO, SOURCE_WIFI));
}

// Ranked above the holder, a controller takes over at once, and the one it
// took over from is then refused.
void test_a_higher_controller_takes_over_at_once(void) {
  control->command(SOURCE_WIFI, MOVE_FORWARD, 100, 400, 0);
  TEST_ASSERT_TRUE(control->command(SOURCE_PAD, MOVE_RIGHT, 100, 400, 50));
  TEST_ASSERT_EQUAL_INT(MOVE_RIGHT, driving());
  TEST_ASSERT_EQUAL_INT(SOURCE_PAD, control->holder(50));
  TEST_ASSERT_FALSE(control->command(SOURCE_WIFI, MOVE_FORWARD, 100, 400, 100));
  TEST_ASSERT_EQUAL_INT(MOVE_RIGHT, driving());
  TEST_ASSERT_TRUE(control->command(SOURCE_USB, MOVE_BACKWARD, 100, 400, 150));
  TEST_ASSERT_EQUAL_INT(MOVE_BACKWARD, driving());
}

// Ranked below, it is refused for CONTROL_HOLD_MS after the holder's last
// command, and each of the holder's commands starts that again. Nothing it
// sent meanwhile runs later: there is no queue.
void test_a_lower_controller_waits_for_the_hold_to_lapse(void) {
  control->command(SOURCE_PAD, MOVE_FORWARD, 100, 400, 0);
  TEST_ASSERT_FALSE(control->command(SOURCE_WIFI, MOVE_LEFT, 100, 400, 500));
  TEST_ASSERT_FALSE(control->command(SOURCE_WIFI, MOVE_LEFT, 100, 400, HOLD - 1));
  control->command(SOURCE_PAD, MOVE_FORWARD, 100, 400, 900);
  TEST_ASSERT_FALSE(control->command(SOURCE_WIFI, MOVE_LEFT, 100, 400, 900 + HOLD - 1));
  TEST_ASSERT_EQUAL_INT(SOURCE_PAD, control->holder(900 + HOLD - 1));
  TEST_ASSERT_EQUAL_INT(SOURCE_ROVER, control->holder(900 + HOLD));
  TEST_ASSERT_TRUE(control->command(SOURCE_WIFI, MOVE_LEFT, 100, 400, 900 + HOLD));
  TEST_ASSERT_EQUAL_INT(MOVE_LEFT, driving());
  TEST_ASSERT_EQUAL_INT(SOURCE_WIFI, control->holder(900 + HOLD));
  // The pad, ranked above, takes it straight back.
  TEST_ASSERT_TRUE(control->command(SOURCE_PAD, MOVE_FORWARD, 100, 400, 900 + HOLD + 10));
}

// A held stick re-sent every 200 ms keeps control however long it is held.
void test_a_held_stick_keeps_control(void) {
  for (uint32_t t = 0; t < 10000; t += 200) {
    TEST_ASSERT_TRUE(control->command(SOURCE_PAD, MOVE_FORWARD, 100, 400, t));
    TEST_ASSERT_FALSE(control->command(SOURCE_WIFI, MOVE_LEFT, 100, 400, t + 100));
  }
}

// One line a refused controller, until control passes, however often it
// sends; then again.
void test_a_refusal_is_logged_once_until_control_passes(void) {
  control->command(SOURCE_PAD, MOVE_FORWARD, 100, 400, 0);
  for (uint32_t t = 10; t < 500; t += 10) control->command(SOURCE_WIFI, MOVE_LEFT, 100, 400, t);
  TEST_ASSERT_EQUAL_INT(1, logged("Refused MOVE_LEFT: PAD has control", EventLog::WARN, SOURCE_WIFI));
  control->command(SOURCE_WIFI, MOVE_LEFT, 100, 400, 500 + HOLD);  // lapsed: WIFI's now
  control->command(SOURCE_PAD, MOVE_FORWARD, 100, 400, 600 + HOLD);
  control->command(SOURCE_WIFI, MOVE_RIGHT, 100, 400, 700 + HOLD);
  TEST_ASSERT_EQUAL_INT(1, logged("Refused MOVE_RIGHT: PAD has control", EventLog::WARN, SOURCE_WIFI));
  TEST_ASSERT_EQUAL_INT(2, logged("PAD has control", EventLog::INFO, SOURCE_PAD));
}

// Stop is one press from every controller: acted on whoever holds control,
// though it hands that control to no one, so the holder's next command
// drives again, and the log says so.
void test_stop_from_anyone_is_always_acted_on(void) {
  control->command(SOURCE_PAD, MOVE_FORWARD, 100, 400, 0);
  TEST_ASSERT_TRUE(control->command(SOURCE_WIFI, STOP, 0, 0, 100));
  TEST_ASSERT_FALSE(motors->driving);
  TEST_ASSERT_EQUAL_INT(SOURCE_PAD, control->holder(100));
  TEST_ASSERT_EQUAL_INT(1, logged("STOP, though PAD has control and may drive on", EventLog::WARN, SOURCE_WIFI));
  TEST_ASSERT_TRUE(control->command(SOURCE_PAD, MOVE_FORWARD, 100, 400, 200));
  TEST_ASSERT_EQUAL_INT(MOVE_FORWARD, driving());
}

// A client sending STOP after STOP, or a move after a move, under someone
// else's hold is said once a hold, and said again once a fresh hold begins.
void test_refusals_and_stops_from_below_are_said_once_a_hold(void) {
  for (uint32_t t = 0; t < 600; t += 50) {
    control->command(SOURCE_PAD, MOVE_FORWARD, 100, 400, t);
    control->command(SOURCE_WIFI, STOP, 0, 0, t + 10);
    control->command(SOURCE_WIFI, MOVE_LEFT, 100, 400, t + 20);
  }
  TEST_ASSERT_EQUAL_INT(1, logged("STOP, though PAD has control", EventLog::WARN, SOURCE_WIFI));
  TEST_ASSERT_EQUAL_INT(1, logged("Refused MOVE_LEFT: PAD has control", EventLog::WARN, SOURCE_WIFI));
  // The pad's hold lapses, and it takes control afresh.
  const uint32_t later = 600 + HOLD + 100;
  control->command(SOURCE_PAD, MOVE_FORWARD, 100, 400, later);
  control->command(SOURCE_WIFI, STOP, 0, 0, later + 10);
  control->command(SOURCE_WIFI, MOVE_LEFT, 100, 400, later + 20);
  TEST_ASSERT_EQUAL_INT(2, logged("STOP, though PAD has control", EventLog::WARN, SOURCE_WIFI));
  TEST_ASSERT_EQUAL_INT(2, logged("Refused MOVE_LEFT: PAD has control", EventLog::WARN, SOURCE_WIFI));
  TEST_ASSERT_EQUAL_INT(1, logged("PAD has control: MOVE_FORWARD", EventLog::INFO, SOURCE_PAD));
}

// timing::ageOf(): a stamp a little ahead of `now` is age 0, and any other
// is as old as since() says, across millis()'s wrap too.
void test_the_age_of_a_stamp(void) {
  TEST_ASSERT_EQUAL_UINT32(0, timing::ageOf(100000, 100006));
  TEST_ASSERT_EQUAL_UINT32(0, timing::ageOf(100000, 100000 + timing::STAMP_AHEAD_MAX_MS));
  TEST_ASSERT_EQUAL_UINT32(250, timing::ageOf(100250, 100000));
  TEST_ASSERT_EQUAL_UINT32(20, timing::ageOf(10, 0xFFFFFFF6u));
  TEST_ASSERT_EQUAL_UINT32(0, timing::ageOf(0xFFFFFFF6u, 10));
  TEST_ASSERT_EQUAL_UINT32(0xFFFFFFFFu - timing::STAMP_AHEAD_MAX_MS,
                           timing::ageOf(0, timing::STAMP_AHEAD_MAX_MS + 1));
}

// A hold stamped later in the pass than the `now` it is read with (the pad's
// clock, millis() in the WebSocket server) is a hold just taken: read as
// ~49.7 days old, it let a controller ranked below drive under it.
void test_a_hold_stamped_later_in_the_pass_holds(void) {
  TEST_ASSERT_TRUE(control->command(SOURCE_PAD, MOVE_FORWARD, 100, 400, 100006));
  control->update(100000);
  TEST_ASSERT_EQUAL_INT(SOURCE_PAD, control->holder(100000));
  TEST_ASSERT_FALSE(control->command(SOURCE_WIFI, MOVE_LEFT, 100, 400, 100000));
  TEST_ASSERT_EQUAL_INT(MOVE_FORWARD, driving());
}

// A lapsed hold is forgotten, so it never reads as fresh again ~49.7 days
// on: until then, a controller ranked below would be refused for a second.
void test_a_lapsed_hold_is_forgotten(void) {
  control->command(SOURCE_PAD, MOVE_FORWARD, 100, 400, 0);
  control->update(HOLD);
  // 2^32 + 500 ms after the pad's command: millis() has wrapped.
  TEST_ASSERT_EQUAL_INT(SOURCE_ROVER, control->holder(500));
  TEST_ASSERT_TRUE(control->command(SOURCE_WIFI, MOVE_LEFT, 100, 400, 500));
  TEST_ASSERT_EQUAL_INT(MOVE_LEFT, driving());
}

// STOP takes an exploring rover over, from any controller, as before.
void test_stop_takes_over_from_exploring(void) {
  rover->begin(Rover::MODE_AUTONOMOUS, 0);
  TEST_ASSERT_EQUAL_INT(SOURCE_ROVER, control->holder(0));
  TEST_ASSERT_TRUE(control->command(SOURCE_WIFI, STOP, 0, 0, 10));
  TEST_ASSERT_EQUAL_INT(Rover::MODE_MANUAL, rover->status().mode);
}

// Exploring and the checks are commands like any other: a controller that
// may not drive may not start them.
void test_autonomous_and_checks_wait_for_control_too(void) {
  control->command(SOURCE_PAD, MOVE_FORWARD, 100, 400, 0);
  TEST_ASSERT_FALSE(control->command(SOURCE_WIFI, RESUME_AUTONOMOUS, 0, 0, 100));
  TEST_ASSERT_EQUAL_INT(Rover::MODE_MANUAL, rover->status().mode);
  TEST_ASSERT_FALSE(control->command(SOURCE_WIFI, RUN_CHECKS, 0, 0, 200));
  TEST_ASSERT_NULL(rover->status().check);
  TEST_ASSERT_EQUAL_INT(MOVE_FORWARD, driving());
  TEST_ASSERT_TRUE(control->command(SOURCE_USB, RESUME_AUTONOMOUS, 0, 0, 300));
  TEST_ASSERT_EQUAL_INT(Rover::MODE_AUTONOMOUS, rover->status().mode);
}

// Checks that a STOP from a controller ranked above theirs ended stay
// ended while their controller re-sends, refused or not: the re-sends once
// stopped renewing the hold while refused, it lapsed with the stopper's,
// and the next one accepted started the whole run again.
void test_a_stop_from_above_ends_the_checks_for_good(void) {
  uint32_t heldAt = 0;
  control->command(SOURCE_WIFI, RUN_CHECKS, 0, 0, 0);
  TEST_ASSERT_EQUAL_STRING("sonar L", rover->status().check);
  const int calls = motors->driveCalls;
  uint32_t now = 0;
  advance(now, 5000, 5, [&](uint32_t t) {
    if (t == 100) control->command(SOURCE_PAD, STOP, 0, 0, t);  // Cross
    if (t - heldAt >= 200) {
      heldAt = t;
      control->command(SOURCE_WIFI, RUN_CHECKS, 0, 0, t);
    }
    rover->update(t);
    control->update(t);
    if (t >= 100) TEST_ASSERT_NULL(rover->status().check);
  });
  TEST_ASSERT_EQUAL_INT(calls, motors->driveCalls);
  TEST_ASSERT_EQUAL_INT(1, logged("Refused RUN_CHECKS: PAD has control", EventLog::WARN, SOURCE_WIFI));

  // Once the re-sends stop for CHECK_HOLD_MS, the next starts a run.
  advance(now, tuning::CHECK_HOLD_MS, 5, [](uint32_t t) {
    rover->update(t);
    control->update(t);
  });
  control->command(SOURCE_WIFI, RUN_CHECKS, 0, 0, now);
  TEST_ASSERT_EQUAL_STRING("sonar L", rover->status().check);
}

// The explorer is no controller: exploring holds no control, and any
// controller's command takes over from it.
void test_exploring_holds_no_control(void) {
  rover->begin(Rover::MODE_AUTONOMOUS, 0);
  uint32_t now = 0;
  advanceUntil(now, 5000, 5, [](uint32_t t) { rover->update(t); }, [] { return motors->driving; });
  TEST_ASSERT_TRUE(motors->driving);
  TEST_ASSERT_EQUAL_INT(SOURCE_ROVER, control->holder(now));
  TEST_ASSERT_TRUE(control->command(SOURCE_WIFI, MOVE_LEFT, 100, 400, now));
  TEST_ASSERT_EQUAL_INT(Rover::MODE_MANUAL, rover->status().mode);
}

void test_the_priority_setting_reorders_the_controllers(void) {
  const Source order[] = {SOURCE_WIFI, SOURCE_PAD, SOURCE_USB};
  TEST_ASSERT_TRUE(settings->setPriority(order, SOURCE_WIFI, 0));
  control->command(SOURCE_USB, MOVE_FORWARD, 100, 400, 0);
  TEST_ASSERT_TRUE(control->command(SOURCE_WIFI, MOVE_LEFT, 100, 400, 10));
  TEST_ASSERT_FALSE(control->command(SOURCE_USB, MOVE_FORWARD, 100, 400, 20));
  TEST_ASSERT_FALSE(control->command(SOURCE_PAD, MOVE_FORWARD, 100, 400, 30));
  TEST_ASSERT_EQUAL_INT(MOVE_LEFT, driving());
}

// Losing a controller's link stops the rover only while its motion is that
// controller's.
void test_losing_the_driver_stops_only_its_own_motion(void) {
  control->command(SOURCE_WIFI, MOVE_FORWARD, 100, 400, 0);
  control->lost(SOURCE_WIFI, 50);
  TEST_ASSERT_FALSE(motors->driving);
  TEST_ASSERT_EQUAL_INT(1, logged("WIFI, the driver, is gone: stopped", EventLog::WARN, SOURCE_WIFI));

  control->command(SOURCE_WIFI, MOVE_FORWARD, 100, 400, 100);
  control->command(SOURCE_PAD, MOVE_RIGHT, 100, 400, 150);
  control->lost(SOURCE_WIFI, 200);
  TEST_ASSERT_EQUAL_INT(MOVE_RIGHT, driving());
  // A refused controller drove nothing, and its going stops nothing.
  control->command(SOURCE_WIFI, MOVE_LEFT, 100, 400, 250);
  control->lost(SOURCE_WIFI, 260);
  TEST_ASSERT_EQUAL_INT(MOVE_RIGHT, driving());
}

// The rover itself is no controller and sends no commands.
void test_the_rover_is_no_controller(void) {
  TEST_ASSERT_FALSE(control->command(SOURCE_ROVER, MOVE_FORWARD, 100, 400, 0));
  TEST_ASSERT_FALSE(motors->driving);
}

// --- one format from every controller -----------------------------------------

// The same message does the same from every controller: apply() is what the
// WebSocket link and the serial console both call, the pad's commands the
// same rules by command().
void test_messages_are_routed_by_kind(void) {
  TEST_ASSERT_EQUAL_INT(Control::ACCEPTED,
                        control->apply(SOURCE_USB, message("{\"move\":1,\"speed\":100,\"duration\":400}"), 0));
  TEST_ASSERT_EQUAL_INT(MOVE_FORWARD, driving());
  TEST_ASSERT_EQUAL_INT(Control::REFUSED,
                        control->apply(SOURCE_WIFI, message("{\"move\":4,\"speed\":100,\"duration\":400}"), 10));
  TEST_ASSERT_EQUAL_INT(Control::SETTING,
                        control->apply(SOURCE_WIFI, message("{\"settings\":{\"sonar\":\"SWEEP\"}}"), 20));
  TEST_ASSERT_EQUAL_INT(Explorer::SONAR_SWEEP, settings->sonar());
  TEST_ASSERT_EQUAL_INT(Control::IGNORED, control->apply(SOURCE_USB, message("{\"scheme\":\"TURBO\"}"), 30));
  TEST_ASSERT_EQUAL_INT(Control::UPDATE, control->apply(SOURCE_USB, message("{\"ota\":\"cancel\"}"), 40));
  // A malformed command is a STOP, as ever, and so always acted on: from
  // below USB's hold it takes no control, which the caller is told.
  TEST_ASSERT_EQUAL_INT(Control::STOPPED, control->apply(SOURCE_WIFI, message("{}"), 50));
  TEST_ASSERT_FALSE(motors->driving);
  TEST_ASSERT_EQUAL_INT(SOURCE_USB, control->holder(50));
  TEST_ASSERT_EQUAL_INT(Control::ACCEPTED, control->apply(SOURCE_USB, message("{}"), 60));
}

// A setting is never refused, and takes no control.
void test_settings_are_never_refused(void) {
  control->command(SOURCE_PAD, MOVE_FORWARD, 100, 400, 0);
  control->apply(SOURCE_WIFI, message("{\"settings\":{\"scheme\":\"ADVANCED\",\"pad\":\"OFF\"}}"), 10);
  TEST_ASSERT_EQUAL_INT(kinematics::SCHEME_ADVANCED, settings->scheme());
  TEST_ASSERT_FALSE(settings->padOn());
  TEST_ASSERT_EQUAL_INT(SOURCE_PAD, control->holder(10));
  TEST_ASSERT_EQUAL_INT(MOVE_FORWARD, driving());
}

// --- settings -------------------------------------------------------------------

void test_settings_start_from_the_defaults(void) {
  TEST_ASSERT_EQUAL_INT(kinematics::SCHEME_NORMAL, settings->scheme());
  TEST_ASSERT_EQUAL_INT(Explorer::SONAR_FRONT, settings->sonar());
  TEST_ASSERT_EQUAL_INT(0, settings->aimDeg());
  TEST_ASSERT_TRUE(settings->padOn());
  TEST_ASSERT_FALSE(settings->checksAtBoot());
  TEST_ASSERT_EQUAL_INT(SOURCE_USB, settings->priority(0));
  TEST_ASSERT_EQUAL_INT(SOURCE_PAD, settings->priority(1));
  TEST_ASSERT_EQUAL_INT(SOURCE_WIFI, settings->priority(2));
  TEST_ASSERT_EQUAL_INT(CONTROLLER_COUNT, settings->rankOf(SOURCE_ROVER));
}

// Each change, as its controller's line; the aim alone is not logged, since
// the pad's stick moves it every pass while it pans.
void test_each_change_is_logged_as_its_controllers(void) {
  settings->setScheme(kinematics::SCHEME_ADVANCED, SOURCE_PAD, 0);
  settings->setSonar(Explorer::SONAR_SWEEP, SOURCE_WIFI, 0);
  settings->setPad(false, SOURCE_USB, 0);
  settings->setChecksAtBoot(true, SOURCE_WIFI, 0);
  const Source order[] = {SOURCE_PAD, SOURCE_WIFI, SOURCE_USB};
  settings->setPriority(order, SOURCE_WIFI, 0);
  TEST_ASSERT_EQUAL_INT(1, logged("Scheme: Advanced", EventLog::INFO, SOURCE_PAD));
  TEST_ASSERT_EQUAL_INT(1, logged("Sonar: sweeps in manual mode", EventLog::INFO, SOURCE_WIFI));
  TEST_ASSERT_EQUAL_INT(1, logged("Pad control off", EventLog::INFO, SOURCE_USB));
  TEST_ASSERT_EQUAL_INT(1, logged("Checks at boot: on", EventLog::INFO, SOURCE_WIFI));
  TEST_ASSERT_EQUAL_INT(1, logged("Priority: PAD, then WIFI, then USB", EventLog::INFO, SOURCE_WIFI));
  const uint32_t lines = events->nextSeq();
  const uint32_t version = settings->version();
  settings->setAim(25, SOURCE_PAD, 0);
  TEST_ASSERT_EQUAL_UINT32(lines, events->nextSeq());
  TEST_ASSERT_EQUAL_UINT32(version + 1, settings->version());
  // The same value again is no change.
  settings->setScheme(kinematics::SCHEME_ADVANCED, SOURCE_PAD, 0);
  settings->setAim(25, SOURCE_PAD, 0);
  TEST_ASSERT_EQUAL_UINT32(version + 1, settings->version());
  TEST_ASSERT_EQUAL_UINT32(lines, events->nextSeq());
}

void test_the_aim_is_clamped(void) {
  settings->setAim(200, SOURCE_WIFI, 0);
  TEST_ASSERT_EQUAL_INT(tuning::SONAR_AIM_MAX_DEG, settings->aimDeg());
  settings->setAim(-200, SOURCE_WIFI, 0);
  TEST_ASSERT_EQUAL_INT(-tuning::SONAR_AIM_MAX_DEG, settings->aimDeg());
}

// A priority that leaves a controller out, or names one twice, would leave
// it with no rank: refused whole, and said so.
void test_a_priority_must_name_each_controller_once(void) {
  const Source twice[] = {SOURCE_USB, SOURCE_USB, SOURCE_PAD};
  const Source rover[] = {SOURCE_USB, SOURCE_PAD, SOURCE_ROVER};
  TEST_ASSERT_FALSE(settings->setPriority(twice, SOURCE_WIFI, 0));
  TEST_ASSERT_FALSE(settings->setPriority(rover, SOURCE_WIFI, 0));
  TEST_ASSERT_EQUAL_INT(SOURCE_USB, settings->priority(0));
  TEST_ASSERT_EQUAL_INT(SOURCE_PAD, settings->priority(1));
  TEST_ASSERT_EQUAL_INT(SOURCE_WIFI, settings->priority(2));
  control->apply(SOURCE_WIFI, message("{\"settings\":{\"priority\":[\"USB\",\"USB\",\"PAD\"],\"sonar\":\"SWEEP\"}}"), 0);
  TEST_ASSERT_EQUAL_INT(1, logged("Priority: ignored", EventLog::WARN, SOURCE_WIFI));
  TEST_ASSERT_EQUAL_INT(Explorer::SONAR_SWEEP, settings->sonar());  // the rest still applies
}

// Written to flash only once the settings have been still for
// SETTINGS_SAVE_DELAY_MS and the rover is at rest; then not again until
// the next change.
void test_the_settings_are_saved_when_still_and_at_rest(void) {
  TEST_ASSERT_FALSE(settings->saveDue(100000, true));  // nothing changed
  settings->setSonar(Explorer::SONAR_AIM, SOURCE_PAD, 1000);
  settings->setAim(10, SOURCE_PAD, 1500);
  const uint32_t still = 1500 + tuning::SETTINGS_SAVE_DELAY_MS;
  TEST_ASSERT_FALSE(settings->saveDue(still - 1, true));
  TEST_ASSERT_FALSE(settings->saveDue(still, false));  // moving
  TEST_ASSERT_TRUE(settings->saveDue(still, true));
  settings->saved();
  TEST_ASSERT_FALSE(settings->saveDue(still + 100000, true));
  settings->setAim(20, SOURCE_PAD, still + 100000);
  TEST_ASSERT_TRUE(settings->saveDue(still + 100000 + tuning::SETTINGS_SAVE_DELAY_MS, true));
}

// A change stamped later in the pass than the `now` main.cpp asks with is a
// change just made: read as ~49.7 days old, the aim the pad pans was written
// to flash on most passes.
void test_a_change_stamped_later_in_the_pass_is_not_still(void) {
  settings->setAim(30, SOURCE_PAD, 100006);
  TEST_ASSERT_FALSE(settings->saveDue(100000, true));
  TEST_ASSERT_FALSE(settings->saveDue(100006 + tuning::SETTINGS_SAVE_DELAY_MS - 1, true));
  TEST_ASSERT_TRUE(settings->saveDue(100006 + tuning::SETTINGS_SAVE_DELAY_MS, true));
}

int main(int, char**) {
  UNITY_BEGIN();
  // control
  RUN_TEST(test_a_first_command_takes_control);
  RUN_TEST(test_a_higher_controller_takes_over_at_once);
  RUN_TEST(test_a_lower_controller_waits_for_the_hold_to_lapse);
  RUN_TEST(test_a_held_stick_keeps_control);
  RUN_TEST(test_a_refusal_is_logged_once_until_control_passes);
  RUN_TEST(test_stop_from_anyone_is_always_acted_on);
  RUN_TEST(test_refusals_and_stops_from_below_are_said_once_a_hold);
  RUN_TEST(test_the_age_of_a_stamp);
  RUN_TEST(test_a_hold_stamped_later_in_the_pass_holds);
  RUN_TEST(test_a_lapsed_hold_is_forgotten);
  RUN_TEST(test_stop_takes_over_from_exploring);
  RUN_TEST(test_autonomous_and_checks_wait_for_control_too);
  RUN_TEST(test_a_stop_from_above_ends_the_checks_for_good);
  RUN_TEST(test_exploring_holds_no_control);
  RUN_TEST(test_the_priority_setting_reorders_the_controllers);
  RUN_TEST(test_losing_the_driver_stops_only_its_own_motion);
  RUN_TEST(test_the_rover_is_no_controller);
  // one format
  RUN_TEST(test_messages_are_routed_by_kind);
  RUN_TEST(test_settings_are_never_refused);
  // settings
  RUN_TEST(test_settings_start_from_the_defaults);
  RUN_TEST(test_each_change_is_logged_as_its_controllers);
  RUN_TEST(test_the_aim_is_clamped);
  RUN_TEST(test_a_priority_must_name_each_controller_once);
  RUN_TEST(test_the_settings_are_saved_when_still_and_at_rest);
  RUN_TEST(test_a_change_stamped_later_in_the_pass_is_not_still);
  return UNITY_END();
}

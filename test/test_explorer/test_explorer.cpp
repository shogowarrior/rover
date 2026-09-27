#include <unity.h>

#include <functional>
#include <vector>

#include "../fakes/FakeHardware.h"
#include "Explorer.h"

// Autonomy, tested against a scripted world. FakeScanner holds a distance for
// every servo angle; with the scanner as mounted, bearing +70 (left) is servo
// 20, the front is 90, and bearing -70 (right) is 160.
//
// The world does not move by itself. Tests that need the rover's motion to
// change what it sees mutate it from `onMotion`.

void setUp(void) {}
void tearDown(void) {}

namespace {

const int LEFT_DEG = 20;
const int FRONT_LEFT_DEG = 55;
const int FRONT_DEG = 90;
const int FRONT_RIGHT_DEG = 125;
const int RIGHT_DEG = 160;

// Steps the explorer the way Rover does: every 5 ms, applying each requested
// motion as a deadline, so `motorsIdle` goes true when the motion ends.
struct Harness {
  FakeScanner scanner;
  Explorer explorer;
  uint32_t now = 0;
  bool moving = false;
  uint32_t busyUntil = 0;
  std::vector<Explorer::Motion> motions;
  std::vector<uint32_t> motionTimes;
  std::function<void(const Explorer::Motion&)> onMotion;

  explicit Harness(const ExploreParams& params = ExploreParams()) : explorer(scanner, params) {
    scanner.clock = &now;
    explorer.reset(now);
  }

  void run(uint32_t ms) {
    const uint32_t end = now + ms;
    while (static_cast<int32_t>(now - end) < 0) {
      if (moving && static_cast<int32_t>(now - busyUntil) >= 0) moving = false;
      const Explorer::Motion motion = explorer.update(now, !moving);
      if (motion.requested) {
        motions.push_back(motion);
        motionTimes.push_back(now);
        moving = motion.move != STOP && motion.durationMs > 0;
        busyUntil = now + static_cast<uint32_t>(motion.durationMs);
        if (onMotion) onMotion(motion);
      }
      now += 5;
    }
  }

  int count(MoveCode move) const {
    int n = 0;
    for (const Explorer::Motion& m : motions) {
      if (m.move == move) n++;
    }
    return n;
  }

  int rotations() const { return count(ROTATE_CLOCKWISE) + count(ROTATE_COUNTERCLOCKWISE); }

  // The first motion that is not a STOP, or STOP if there is none.
  MoveCode firstMotion() const {
    for (const Explorer::Motion& m : motions) {
      if (m.move != STOP) return m.move;
    }
    return STOP;
  }

  // How many times `move` was requested before the first MOVE_FORWARD.
  int countBeforeFirstForward(MoveCode move) const {
    int n = 0;
    for (const Explorer::Motion& m : motions) {
      if (m.move == MOVE_FORWARD) break;
      if (m.move == move) n++;
    }
    return n;
  }
};

bool isRotation(MoveCode move) { return move == ROTATE_CLOCKWISE || move == ROTATE_COUNTERCLOCKWISE; }

}  // namespace

// --- sweeping ----------------------------------------------------------------

void test_first_sweep_measures_every_bearing_before_moving(void) {
  Harness h;
  h.run(3000);
  TEST_ASSERT_TRUE(h.scanner.pingAngles.size() >= 5);
  const int expected[5] = {LEFT_DEG, FRONT_LEFT_DEG, FRONT_DEG, FRONT_RIGHT_DEG, RIGHT_DEG};
  for (int i = 0; i < 5; i++) TEST_ASSERT_EQUAL_INT(expected[i], h.scanner.pingAngles[i]);
  TEST_ASSERT_TRUE(h.explorer.hasScan());

  // Nothing but STOP is requested before the fifth reading.
  const uint32_t fifthPing = h.scanner.pingTimes[4];
  for (size_t i = 0; i < h.motions.size(); i++) {
    if (h.motionTimes[i] < fifthPing) TEST_ASSERT_EQUAL_INT(STOP, h.motions[i].move);
  }
}

// Sweeping back and forth means the servo never swings the whole arc between
// the end of one sweep and the start of the next.
void test_consecutive_sweeps_alternate_direction(void) {
  Harness h;
  for (int i = 0; i < 400; i++) {
    h.explorer.survey(h.now);
    h.now += 5;
  }
  TEST_ASSERT_TRUE(h.scanner.pingAngles.size() >= 10);
  const int expected[10] = {20, 55, 90, 125, 160, 160, 125, 90, 55, 20};
  for (int i = 0; i < 10; i++) TEST_ASSERT_EQUAL_INT(expected[i], h.scanner.pingAngles[i]);
}

// A fixed 250 ms settle was too short for the 140-degree swing that started
// every old scan cycle, so its first reading was taken mid-swing.
void test_servo_settles_in_proportion_to_its_travel(void) {
  Harness h;
  h.run(5000);
  const ExploreParams params;
  size_t aim = 0;
  for (size_t ping = 0; ping < h.scanner.pingTimes.size(); ping++) {
    // Within one step the explorer pings, then aims for the next reading, so
    // an aim stamped with the same millisecond as a ping came after it.
    while (aim + 1 < h.scanner.aimTimes.size() && h.scanner.aimTimes[aim + 1] < h.scanner.pingTimes[ping]) aim++;
    const int from = aim == 0 ? -1 : h.scanner.aims[aim - 1];
    const int travel = from < 0 ? 180 : abs(h.scanner.aims[aim] - from);
    const uint32_t settle = params.servoBaseMs + static_cast<uint32_t>(params.servoMsPerDeg * travel);
    TEST_ASSERT_TRUE(h.scanner.pingTimes[ping] - h.scanner.aimTimes[aim] >= settle);
  }
}

void test_pings_are_spaced_for_the_echo_to_die_away(void) {
  Harness h;
  h.run(8000);
  for (size_t i = 1; i < h.scanner.pingTimes.size(); i++) {
    TEST_ASSERT_TRUE(h.scanner.pingTimes[i] - h.scanner.pingTimes[i - 1] >= 70);
  }
}

// --- cruising ----------------------------------------------------------------

void test_open_space_cruises_forward_on_a_short_lease(void) {
  Harness h;
  h.run(3000);
  TEST_ASSERT_EQUAL_INT(MOVE_FORWARD, h.firstMotion());
  for (const Explorer::Motion& m : h.motions) {
    if (m.move == MOVE_FORWARD) TEST_ASSERT_EQUAL_INT(ExploreParams().cruiseLeaseMs, m.durationMs);
  }
}

// The old code drove a blind 750 ms hop after every scan. Now anything that
// appears in the rover's path ends the cruise at the next look.
void test_obstacle_appearing_mid_cruise_stops_the_rover(void) {
  Harness h;
  uint32_t appearedAt = 0;
  h.onMotion = [&](const Explorer::Motion& m) {
    if (m.move == MOVE_FORWARD && appearedAt == 0) {
      appearedAt = h.now;
      h.scanner.setArc(60, 120, 20.0f);
    }
  };
  h.run(4000);
  TEST_ASSERT_TRUE(appearedAt > 0);
  bool stopped = false;
  for (size_t i = 0; i < h.motions.size(); i++) {
    if (h.motionTimes[i] > appearedAt && h.motions[i].move == STOP) {
      TEST_ASSERT_TRUE(h.motionTimes[i] - appearedAt <= 600);
      stopped = true;
      break;
    }
  }
  TEST_ASSERT_TRUE(stopped);
}

// Hysteresis: a cruise continues through readings between STOP and GO.
void test_cruise_continues_between_the_stop_and_go_thresholds(void) {
  Harness h;
  bool closed = false;
  h.onMotion = [&](const Explorer::Motion& m) {
    if (m.move == MOVE_FORWARD && !closed) {
      closed = true;
      h.scanner.setArc(60, 120, 32.0f);  // under GO (40), over STOP (25)
    }
  };
  h.run(2000);
  TEST_ASSERT_EQUAL_INT(Explorer::CRUISE, h.explorer.phase());
}

// A 40 cm corridor: walls 20 cm to each side read ~21 cm at the +-70 degree
// bearings. Testing the ray instead of the path made the old code reverse out
// of every passage narrower than ~56 cm, forever.
void test_corridor_is_entered_not_backed_out_of(void) {
  Harness h;
  h.scanner.setArc(0, 40, 21.3f);     // left wall
  h.scanner.setArc(41, 69, 34.9f);    // left wall seen at 35 degrees
  h.scanner.setArc(111, 139, 34.9f);  // right wall seen at 35 degrees
  h.scanner.setArc(140, 180, 21.3f);  // right wall
  h.run(3000);
  TEST_ASSERT_EQUAL_INT(MOVE_FORWARD, h.firstMotion());
  TEST_ASSERT_EQUAL_INT(0, h.countBeforeFirstForward(MOVE_BACKWARD));
}

// An obstacle does not vanish as the rover closes on it: a near echo turning
// into silence is a deflection off an angled surface, not open space.
void test_vanishing_near_echo_ends_the_cruise(void) {
  Harness h;
  h.scanner.setArc(60, 120, 50.0f);
  bool vanished = false;
  h.onMotion = [&](const Explorer::Motion& m) {
    if (m.move == MOVE_FORWARD && !vanished) {
      vanished = true;
      h.scanner.setArc(60, 120, -1.0f);
    }
  };
  h.run(1500);
  TEST_ASSERT_TRUE(vanished);
  TEST_ASSERT_NOT_EQUAL(Explorer::CRUISE, h.explorer.phase());
}

// A front reading that stops shrinking while driving forward: wheels held by
// something below the beam. The old code pushed against it indefinitely.
void test_stuck_below_the_beam_backs_off_and_turns_away(void) {
  Harness h;
  h.scanner.setArc(60, 120, 150.0f);  // a far wall that never gets closer
  h.run(6000);
  int firstBackward = -1;
  for (size_t i = 0; i < h.motions.size(); i++) {
    if (h.motions[i].move == MOVE_BACKWARD) {
      firstBackward = static_cast<int>(i);
      break;
    }
  }
  TEST_ASSERT_TRUE(firstBackward > 0);
  TEST_ASSERT_TRUE(h.motions[firstBackward].durationMs <= ExploreParams().backoffMaxMs);

  int turnSteps = 0;
  for (size_t i = firstBackward + 1; i < h.motions.size() && h.motions[i].move != MOVE_FORWARD; i++) {
    if (isRotation(h.motions[i].move)) turnSteps++;
  }
  TEST_ASSERT_TRUE(turnSteps >= ExploreParams().stuckTurnSteps);
}

// --- turning -----------------------------------------------------------------

// The livelock this replaces: chooseExploreMove answered a wall ahead with
// "reverse", then "forward" once it was past SAFE_DISTANCE, forever, turning
// zero degrees. Now it turns until the way is clear, then drives on.
void test_wall_ahead_turns_until_clear_then_drives_on(void) {
  Harness h;
  h.scanner.setArc(60, 120, 30.0f);
  int turns = 0;
  h.onMotion = [&](const Explorer::Motion& m) {
    if (isRotation(m.move) && ++turns == 3) h.scanner.setAll(200.0f);  // turned away from the wall
  };
  h.run(15000);
  TEST_ASSERT_TRUE(isRotation(h.firstMotion()));
  // Nothing driven yet, so nothing to reverse over.
  TEST_ASSERT_EQUAL_INT(0, h.countBeforeFirstForward(MOVE_BACKWARD));
  TEST_ASSERT_TRUE(h.count(MOVE_FORWARD) > 0);
}

void test_turns_toward_the_more_open_side(void) {
  Harness left;
  left.scanner.setArc(60, 120, 30.0f);
  left.scanner.setArc(121, 180, 25.0f);  // right side close
  left.run(3000);
  TEST_ASSERT_EQUAL_INT(ROTATE_COUNTERCLOCKWISE, left.firstMotion());

  Harness right;
  right.scanner.setArc(60, 120, 30.0f);
  right.scanner.setArc(0, 59, 25.0f);  // left side close
  right.run(3000);
  TEST_ASSERT_EQUAL_INT(ROTATE_CLOCKWISE, right.firstMotion());
}

// Re-choosing the direction on every look makes a rover dither in a corner:
// left looks better, then right, then left. It keeps the direction it chose.
void test_turn_direction_is_kept_until_the_way_is_clear(void) {
  Harness h;
  h.scanner.setArc(60, 120, 30.0f);
  h.scanner.setArc(121, 180, 25.0f);  // right close: commits to turning left
  int turns = 0;
  h.onMotion = [&](const Explorer::Motion& m) {
    if (!isRotation(m.move)) return;
    turns++;
    if (turns == 1) {
      h.scanner.setArc(0, 59, 25.0f);  // now the left looks worse...
      h.scanner.setArc(121, 180, 200.0f);
    }
    if (turns == 5) h.scanner.setAll(200.0f);
  };
  h.run(15000);
  for (const Explorer::Motion& m : h.motions) {
    if (isRotation(m.move)) TEST_ASSERT_EQUAL_INT(ROTATE_COUNTERCLOCKWISE, m.move);
  }
  TEST_ASSERT_TRUE(h.count(MOVE_FORWARD) > 0);
}

// Rotating in place swings the corners out; with a wall too close on one side
// the mecanum wheels strafe away from it first.
void test_flank_too_close_to_rotate_strafes_away_first(void) {
  Harness h;
  h.scanner.setArc(60, 120, 30.0f);
  h.scanner.setArc(0, 30, 12.0f);  // left wall ~11 cm to the side
  h.run(3000);
  TEST_ASSERT_EQUAL_INT(MOVE_RIGHT, h.firstMotion());
}

// Whether MOVE_LEFT carries the rover toward what the scanner calls left is
// unverified wiring. If a sidestep brings the flank it left closer, the next
// sidestep goes the other way instead of pinning the rover to the wall.
void test_sidestep_that_went_the_wrong_way_flips_direction(void) {
  Harness h;
  h.scanner.setArc(60, 120, 30.0f);
  h.scanner.setArc(0, 30, 12.0f);     // left wall close: sidestep right
  h.scanner.setArc(150, 180, 80.0f);  // right side open, but echoing
  int sidesteps = 0;
  h.onMotion = [&](const Explorer::Motion& m) {
    if (m.move != MOVE_LEFT && m.move != MOVE_RIGHT) return;
    if (++sidesteps == 1) {
      // The "right" strafe actually carried it left: closer to the left
      // wall, further from the right.
      h.scanner.setArc(0, 30, 9.0f);
      h.scanner.setArc(150, 180, 84.0f);
    }
  };
  h.run(6000);
  std::vector<MoveCode> strafes;
  for (const Explorer::Motion& m : h.motions) {
    if (m.move == MOVE_LEFT || m.move == MOVE_RIGHT) strafes.push_back(m.move);
  }
  TEST_ASSERT_TRUE(strafes.size() >= 2);
  TEST_ASSERT_EQUAL_INT(MOVE_RIGHT, strafes[0]);
  TEST_ASSERT_EQUAL_INT(MOVE_LEFT, strafes[1]);
}

// A pinned rover moves neither flank. That must not look like a mirrored mapping.
void test_pinned_sidestep_does_not_flip_direction(void) {
  Harness h;
  h.scanner.setArc(60, 120, 30.0f);
  h.scanner.setArc(0, 30, 12.0f);
  h.scanner.setArc(150, 180, 80.0f);
  h.run(6000);
  for (const Explorer::Motion& m : h.motions) {
    if (m.move == MOVE_LEFT) TEST_FAIL_MESSAGE("flipped without evidence");
  }
}

// Getting stuck repeatedly at the same wide, low obstacle must turn further
// each time, in the same direction. Resetting on every stuck made the rover
// ping-pong in front of it.
void test_repeated_stucks_turn_further_the_same_way(void) {
  Harness h;
  h.scanner.setArc(60, 120, 150.0f);  // never gets closer: stuck every cruise
  // Three escapes of 4, 8 and 12 steps fit inside the 30-step circle; the
  // fourth would pass it and halt the rover, after which a retry may start
  // afresh in either direction.
  h.run(16000);
  std::vector<int> escapeTurns;
  MoveCode direction = STOP;
  int turnSteps = 0;
  bool afterBackoff = false;
  for (const Explorer::Motion& m : h.motions) {
    if (m.move == MOVE_BACKWARD) {
      afterBackoff = true;
      turnSteps = 0;
    } else if (afterBackoff && isRotation(m.move)) {
      if (direction == STOP) direction = m.move;
      TEST_ASSERT_EQUAL_INT(direction, m.move);
      turnSteps++;
    } else if (afterBackoff && m.move == MOVE_FORWARD) {
      escapeTurns.push_back(turnSteps);
      afterBackoff = false;
    }
  }
  TEST_ASSERT_TRUE(escapeTurns.size() >= 2);
  TEST_ASSERT_TRUE(escapeTurns[1] > escapeTurns[0]);
}

// --- reversing ---------------------------------------------------------------

// Nothing watches behind the rover. It reverses only over ground it has just
// driven forward across, and only a little.
void test_reverses_only_over_ground_just_driven(void) {
  Harness fresh;
  fresh.scanner.setArc(60, 120, 5.0f);
  fresh.run(3000);
  TEST_ASSERT_EQUAL_INT(0, fresh.count(MOVE_BACKWARD));

  Harness driven;
  uint32_t forwardAt = 0;
  driven.onMotion = [&](const Explorer::Motion& m) {
    if (m.move == MOVE_FORWARD && forwardAt == 0) forwardAt = driven.now;
  };
  driven.run(3000);
  TEST_ASSERT_TRUE(forwardAt > 0);
  driven.scanner.setArc(60, 120, 5.0f);  // something right in front
  driven.run(3000);
  TEST_ASSERT_TRUE(driven.count(MOVE_BACKWARD) > 0);
  for (const Explorer::Motion& m : driven.motions) {
    if (m.move == MOVE_BACKWARD) TEST_ASSERT_TRUE(m.durationMs <= ExploreParams().backoffMaxMs);
  }
}

// --- halting -----------------------------------------------------------------

void test_boxed_in_halts_and_never_drives_blind(void) {
  Harness h;
  h.scanner.setAll(10.0f);
  h.run(60000);
  TEST_ASSERT_EQUAL_INT(Explorer::HALTED, h.explorer.phase());
  TEST_ASSERT_EQUAL_STRING("boxed in", h.explorer.haltReason());
  TEST_ASSERT_EQUAL_INT(0, h.count(MOVE_FORWARD));
  TEST_ASSERT_EQUAL_INT(0, h.count(MOVE_BACKWARD));
  // One full circle of turning, then it waits for the way to open rather
  // than spinning again every retry.
  TEST_ASSERT_EQUAL_INT(ExploreParams().maxTurnSteps, h.rotations());
}

void test_halted_rover_resumes_when_the_way_opens(void) {
  Harness h;
  h.scanner.setAll(10.0f);
  h.run(30000);
  TEST_ASSERT_EQUAL_INT(Explorer::HALTED, h.explorer.phase());
  h.scanner.setAll(200.0f);
  h.run(10000);
  TEST_ASSERT_TRUE(h.count(MOVE_FORWARD) > 0);
}

// A dead or unplugged sensor returns -1 everywhere, which reads as open space.
// The old code drove forward into the first wall; now it halts.
void test_silent_sensor_halts(void) {
  Harness h;
  h.scanner.setAll(-1.0f);
  h.run(20000);
  TEST_ASSERT_EQUAL_INT(Explorer::HALTED, h.explorer.phase());
  TEST_ASSERT_EQUAL_STRING("sensor silent", h.explorer.haltReason());
  const size_t forwardsSoFar = h.count(MOVE_FORWARD);
  h.run(20000);
  TEST_ASSERT_EQUAL_INT(forwardsSoFar, h.count(MOVE_FORWARD));  // and stays halted
}

void test_phase_names(void) {
  Harness h;
  TEST_ASSERT_EQUAL_STRING("SWEEP", h.explorer.phaseName());
  TEST_ASSERT_NULL(h.explorer.haltReason());
  const char* phaseWhenDriving = nullptr;
  h.onMotion = [&](const Explorer::Motion& m) {
    if (m.move == MOVE_FORWARD && phaseWhenDriving == nullptr) phaseWhenDriving = h.explorer.phaseName();
  };
  h.run(3000);
  TEST_ASSERT_EQUAL_STRING("CRUISE", phaseWhenDriving);
}

int main(int, char**) {
  UNITY_BEGIN();
  RUN_TEST(test_first_sweep_measures_every_bearing_before_moving);
  RUN_TEST(test_consecutive_sweeps_alternate_direction);
  RUN_TEST(test_servo_settles_in_proportion_to_its_travel);
  RUN_TEST(test_pings_are_spaced_for_the_echo_to_die_away);
  RUN_TEST(test_open_space_cruises_forward_on_a_short_lease);
  RUN_TEST(test_obstacle_appearing_mid_cruise_stops_the_rover);
  RUN_TEST(test_cruise_continues_between_the_stop_and_go_thresholds);
  RUN_TEST(test_corridor_is_entered_not_backed_out_of);
  RUN_TEST(test_vanishing_near_echo_ends_the_cruise);
  RUN_TEST(test_stuck_below_the_beam_backs_off_and_turns_away);
  RUN_TEST(test_wall_ahead_turns_until_clear_then_drives_on);
  RUN_TEST(test_turns_toward_the_more_open_side);
  RUN_TEST(test_turn_direction_is_kept_until_the_way_is_clear);
  RUN_TEST(test_flank_too_close_to_rotate_strafes_away_first);
  RUN_TEST(test_sidestep_that_went_the_wrong_way_flips_direction);
  RUN_TEST(test_pinned_sidestep_does_not_flip_direction);
  RUN_TEST(test_repeated_stucks_turn_further_the_same_way);
  RUN_TEST(test_reverses_only_over_ground_just_driven);
  RUN_TEST(test_boxed_in_halts_and_never_drives_blind);
  RUN_TEST(test_halted_rover_resumes_when_the_way_opens);
  RUN_TEST(test_silent_sensor_halts);
  RUN_TEST(test_phase_names);
  return UNITY_END();
}

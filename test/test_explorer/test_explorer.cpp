#include <unity.h>

#include <functional>
#include <vector>

#include "../fakes/FakeHardware.h"
#include "../support/Loop.h"
#include "Explorer.h"
#include "Timing.h"

// Autonomy, tested against a scripted world. FakeScanner holds a distance for
// every servo angle; with the scanner as mounted, bearing +70 (left) is servo
// 20, the front is 90, and bearing -70 (right) is 160.
//
// The world does not move by itself unless a test asks it to close in while
// the rover drives forward (Harness::closing()); tests that need other
// changes mutate it from `onMotion`.

void setUp(void) {}
void tearDown(void) {}

namespace {

const int LEFT_DEG = 20;
const int FRONT_LEFT_DEG = 55;
const int FRONT_DEG = 90;
const int FRONT_RIGHT_DEG = 125;
const int RIGHT_DEG = 160;

bool isRotation(MoveCode move) { return move == ROTATE_CLOCKWISE || move == ROTATE_COUNTERCLOCKWISE; }

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

  // Optional motion model (closing()): while the rover drives forward, what
  // the sonar sees between closeFromDeg and closeToDeg (servo degrees; the
  // path ahead unless the test says otherwise) closes in at closingCmPerS --
  // for the first closeForMs of each forward run only, after which it stops
  // changing, as if the wheels were held.
  float closingCmPerS = 0;
  uint32_t closeForMs = 0xFFFFFFFFu;
  int closeFromDeg = 60;
  int closeToDeg = 120;
  uint32_t forwardRunMs = 0;  // how long the current forward run has lasted
  MoveCode lastMove = STOP;

  explicit Harness(const ExploreParams& params = ExploreParams()) : explorer(scanner, params) {
    scanner.clock = &now;
    explorer.reset(now);
  }

  void run(uint32_t ms) {
    advance(now, ms, 5, [this](uint32_t) { step(); });
  }

  // One pass of the loop, at `now`.
  void step() {
    if (moving && timing::reached(now, busyUntil)) moving = false;
    if (moving && lastMove == MOVE_FORWARD) {
      if (forwardRunMs < closeForMs) closeIn(closingCmPerS * 0.005f);
      forwardRunMs += 5;
    }
    const Explorer::Motion motion = explorer.update(now, !moving);
    if (motion.requested) {
      motions.push_back(motion);
      motionTimes.push_back(now);
      moving = motion.move != STOP && motion.durationMs > 0;
      busyUntil = now + static_cast<uint32_t>(motion.durationMs);
      if (motion.move != MOVE_FORWARD) forwardRunMs = 0;
      lastMove = motion.move;
      if (onMotion) onMotion(motion);
    }
  }

  // The world closes in at `cmPerS` while the rover drives forward: the rover
  // is really getting somewhere. From fromDeg to toDeg, when they are given.
  void closing(float cmPerS) { closingCmPerS = cmPerS; }
  void closing(float cmPerS, int fromDeg, int toDeg) {
    closing(cmPerS);
    closeFromDeg = fromDeg;
    closeToDeg = toDeg;
  }

  void closeIn(float cm) {
    for (int deg = closeFromDeg; deg <= closeToDeg; deg++) {
      if (scanner.range[deg] > 1.0f) scanner.range[deg] -= cm;
    }
  }

  // ...and opens out again as reversing motion `m` carries it back.
  void recede(const Explorer::Motion& m) { closeIn(-closingCmPerS * m.durationMs / 1000.0f); }

  // Index of the first motion at or after `from` whose move satisfies
  // `is(move)`, or -1.
  template <typename Is>
  int indexWhere(Is is, size_t from = 0) const {
    for (size_t i = from; i < motions.size(); i++) {
      if (is(motions[i].move)) return static_cast<int>(i);
    }
    return -1;
  }

  // Index of the first requested `move` at or after `from`, or -1.
  int indexOf(MoveCode move, size_t from = 0) const {
    return indexWhere([move](MoveCode m) { return m == move; }, from);
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
    const int i = indexWhere([](MoveCode m) { return m != STOP; });
    return i < 0 ? STOP : motions[i].move;
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

  // Rotation steps from the end of the first cruise to the start of the
  // next, or -1 if the rover never drove on.
  int rotationsBetweenCruises() const {
    const int firstForward = indexOf(MOVE_FORWARD);
    if (firstForward < 0) return -1;
    size_t i = firstForward;
    while (i < motions.size() && motions[i].move == MOVE_FORWARD) i++;  // the first cruise
    int rotations = 0;
    for (; i < motions.size() && motions[i].move != MOVE_FORWARD; i++) {
      if (isRotation(motions[i].move)) rotations++;
    }
    return i < motions.size() ? rotations : -1;
  }

  // The strafes, in order.
  std::vector<MoveCode> strafes() const {
    std::vector<MoveCode> result;
    for (const Explorer::Motion& m : motions) {
      if (m.move == MOVE_LEFT || m.move == MOVE_RIGHT) result.push_back(m.move);
    }
    return result;
  }
};

// Nothing reverses from motion `from` until the rover next drives forward.
void assertNoReverseUntilForward(const Harness& h, size_t from) {
  for (size_t i = from; i < h.motions.size() && h.motions[i].move != MOVE_FORWARD; i++) {
    TEST_ASSERT_NOT_EQUAL(MOVE_BACKWARD, h.motions[i].move);
  }
}

// Out of a dead end: from the end of the first cruise to the first rotation,
// which comes after motion `notBefore` too, the rover never drives forward
// and reverses for exactly as long as that cruise drove in.
void assertReversedAllItDrove(const Harness& h, int notBefore = -1) {
  const int firstForward = h.indexOf(MOVE_FORWARD);
  TEST_ASSERT_TRUE(firstForward >= 0);
  const int cruiseEnd = h.indexOf(STOP, firstForward);
  TEST_ASSERT_TRUE(cruiseEnd > firstForward);
  const uint32_t drove = h.motionTimes[cruiseEnd] - h.motionTimes[firstForward];

  const int firstRotation = h.indexWhere(isRotation);
  TEST_ASSERT_TRUE(firstRotation > cruiseEnd);
  TEST_ASSERT_TRUE(firstRotation > notBefore);
  uint32_t reversed = 0;
  for (int i = cruiseEnd; i < firstRotation; i++) {
    TEST_ASSERT_NOT_EQUAL(MOVE_FORWARD, h.motions[i].move);
    if (h.motions[i].move == MOVE_BACKWARD) reversed += static_cast<uint32_t>(h.motions[i].durationMs);
  }
  TEST_ASSERT_EQUAL_UINT32(drove, reversed);
}

// Every backoff, strafe and rotation step runs its whole course: nothing else
// is asked for until its time is up. A backoff cut short no longer makes the
// room the turn after it needs. Forward is left out: a cruise renews its
// lease early on purpose.
void assertMovesRunTheirCourse(const Harness& h) {
  for (size_t i = 0; i + 1 < h.motions.size(); i++) {
    const Explorer::Motion& m = h.motions[i];
    if (m.move == MOVE_FORWARD || m.move == STOP) continue;
    TEST_ASSERT_TRUE_MESSAGE(h.motionTimes[i + 1] - h.motionTimes[i] >= static_cast<uint32_t>(m.durationMs),
                             moveName(m.move));
  }
}

// Blocked ahead at `frontCm`, with a wall ~11 cm to the left, too close to
// rotate beside (so it sidesteps right), and the right side open but echoing.
void blockedBesideLeftWall(FakeScanner& scanner, float frontCm = 30.0f) {
  scanner.setArc(60, 120, frontCm);
  scanner.setArc(0, 30, 12.0f);
  scanner.setArc(150, 180, 80.0f);
}

// A corridor 26 cm wide: walls 13 cm to each side, seen at 13 / sin(angle)
// from every bearing that can see them (70 and 35 degrees in a sweep, 25 in
// the weave). Outside the 12 cm path, so the rover drives along it, but
// inside the 16 cm the corners need to rotate. The far end, servo 70 to 110,
// is left for the test to set.
void narrowCorridor(FakeScanner& scanner) {
  scanner.setArc(0, 40, 13.8f);     // 70 degrees left
  scanner.setArc(41, 60, 22.7f);    // 35
  scanner.setArc(61, 69, 30.8f);    // 25
  scanner.setArc(111, 119, 30.8f);  // and the same to the right
  scanner.setArc(120, 139, 22.7f);
  scanner.setArc(140, 180, 13.8f);
}

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
  advance(h.now, 2000, 5, [&h](uint32_t now) { h.explorer.survey(now); });
  TEST_ASSERT_TRUE(h.scanner.pingAngles.size() >= 10);
  const int expected[10] = {LEFT_DEG, FRONT_LEFT_DEG, FRONT_DEG, FRONT_RIGHT_DEG, RIGHT_DEG,
                            RIGHT_DEG, FRONT_RIGHT_DEG, FRONT_DEG, FRONT_LEFT_DEG, LEFT_DEG};
  for (int i = 0; i < 10; i++) TEST_ASSERT_EQUAL_INT(expected[i], h.scanner.pingAngles[i]);
}

// A fixed 250 ms settle was too short for a 140-degree swing, so the first
// reading after one was taken mid-swing.
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
    const int travel = from < 0 ? hardware::SERVO_MAX_DEG : abs(h.scanner.aims[aim] - from);
    const uint32_t settle = params.servoBaseMs + static_cast<uint32_t>(params.servoMsPerDeg * travel);
    TEST_ASSERT_TRUE(h.scanner.pingTimes[ping] - h.scanner.aimTimes[aim] >= settle);
  }
}

void test_pings_are_spaced_for_the_echo_to_die_away(void) {
  const ExploreParams params;
  TEST_ASSERT_TRUE(params.pingIntervalMs >= 60);  // the HC-SR04's own floor
  Harness h;
  h.run(8000);
  for (size_t i = 1; i < h.scanner.pingTimes.size(); i++) {
    TEST_ASSERT_TRUE(h.scanner.pingTimes[i] - h.scanner.pingTimes[i - 1] >= static_cast<uint32_t>(params.pingIntervalMs));
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
  const ExploreParams params;
  Harness h;
  bool closed = false;
  h.onMotion = [&](const Explorer::Motion& m) {
    if (m.move == MOVE_FORWARD && !closed) {
      closed = true;
      h.scanner.setArc(60, 120, (params.stopCm + params.goCm) / 2);
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

// ...and the converse: the path is the chassis width plus a margin, wherever
// a bearing sees into it, not just the front ray. Something at the 35-degree
// bearings that is inside it blocks a cruise as surely as a wall ahead, and
// the rover turns away from it.
void test_obstacle_in_the_path_at_a_diagonal_blocks_the_cruise(void) {
  // 18 cm at 35 degrees is 10 cm to the side: inside the margin. 12 cm is
  // 7 cm to the side: inside the chassis itself.
  const float distances[2] = {18.0f, 12.0f};
  for (float cm : distances) {
    Harness left;
    left.scanner.setArc(50, 60, cm);  // front-left
    left.run(3000);
    TEST_ASSERT_EQUAL_INT(ROTATE_CLOCKWISE, left.firstMotion());

    Harness right;
    right.scanner.setArc(120, 130, cm);  // front-right
    right.run(3000);
    TEST_ASSERT_EQUAL_INT(ROTATE_COUNTERCLOCKWISE, right.firstMotion());
  }
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
  h.run(3000);
  TEST_ASSERT_TRUE(vanished);
  // The motion after the first forward is the STOP that ends the cruise, not
  // a lease renewal, and it comes well before the cruise cap could.
  const int first = h.indexOf(MOVE_FORWARD);
  TEST_ASSERT_TRUE(first >= 0);
  TEST_ASSERT_EQUAL_INT(STOP, h.motions[first + 1].move);
  TEST_ASSERT_TRUE(h.motionTimes[first + 1] - h.motionTimes[first] < static_cast<uint32_t>(ExploreParams().suspectWindowMs));
}

// A front reading that stops shrinking while driving forward: wheels held by
// something below the beam. The old code pushed against it indefinitely.
void test_stuck_below_the_beam_backs_off_and_turns_away(void) {
  Harness h;
  h.scanner.setArc(60, 120, 150.0f);  // a far wall...
  h.closing(25.0f);                   // ...that gets closer for a while,
  h.closeForMs = 600;                 // until the wheels are held
  h.run(6000);
  const int firstBackward = h.indexOf(MOVE_BACKWARD);
  TEST_ASSERT_TRUE(firstBackward > 0);
  TEST_ASSERT_TRUE(h.motions[firstBackward].durationMs <= ExploreParams().backoffMaxMs);

  int turnSteps = 0;
  for (size_t i = firstBackward + 1; i < h.motions.size() && h.motions[i].move != MOVE_FORWARD; i++) {
    if (isRotation(h.motions[i].move)) turnSteps++;
  }
  TEST_ASSERT_TRUE(turnSteps >= ExploreParams().stuckTurnSteps);
}

// A chair leg leaving the cone makes the front reading jump to the wall behind
// it. That is progress, not a stuck rover: counting any reading that failed to
// shrink as "stuck" sent the rover into false escapes all over a furnished room.
void test_front_reading_that_grows_is_not_stuck(void) {
  Harness h;
  h.scanner.setArc(60, 120, 80.0f);  // a leg ahead
  h.closing(25.0f);
  bool passed = false;
  h.onMotion = [&](const Explorer::Motion& m) {
    if (m.move == MOVE_FORWARD && !passed && h.forwardRunMs >= 600) {
      passed = true;
      h.scanner.setArc(60, 120, 250.0f);  // the leg leaves the cone: the wall behind
    }
  };
  // Up to the cruise cap and before the wander that follows it, nothing but
  // cruising: no escape backoff, no escape turn.
  h.run(3400);
  TEST_ASSERT_TRUE(passed);
  TEST_ASSERT_EQUAL_INT(0, h.count(MOVE_BACKWARD));
  TEST_ASSERT_EQUAL_INT(0, h.rotations());
}

// A sensor that dies mid-cruise hears nothing at every look. It must not keep
// renewing the lease until the cruise cap: silentCruiseLooks silent looks in
// a row end the cruise, so only the ones before the last renew it. Counted,
// not timed: a time limit loose enough for the weave's servo moves let the
// rover drive blind for twice as many looks.
void test_sensor_dying_mid_cruise_stops_within_a_weave(void) {
  Harness h;
  int renewals = -1;  // the forward that starts the cruise renews nothing
  h.onMotion = [&](const Explorer::Motion& m) {
    if (m.move != MOVE_FORWARD) return;
    if (renewals < 0) h.scanner.setAll(-1.0f);  // dies as the cruise starts
    renewals++;
  };
  h.run(30000);
  TEST_ASSERT_EQUAL_INT(ExploreParams().silentCruiseLooks - 1, renewals);
  TEST_ASSERT_EQUAL_STRING("sensor silent", h.explorer.haltReason());
}

// --- turning -----------------------------------------------------------------

// Answering a wall ahead with reverse, then forward once past the threshold,
// livelocked: zero degrees turned, for ever. Now it turns until the way is
// clear, then drives on.
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
  assertMovesRunTheirCourse(h);
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
      // The front clears, so the turn ends and a fresh sweep decides again,
      // with the path still blocked at front-right and the left now looking
      // worse than the right.
      h.scanner.setAll(200.0f);
      h.scanner.setArc(0, 69, 25.0f);
      h.scanner.setArc(111, 139, 18.0f);
    }
    if (turns == 4) h.scanner.setAll(200.0f);
  };
  h.run(15000);
  TEST_ASSERT_TRUE(h.count(MOVE_FORWARD) > 0);
  TEST_ASSERT_EQUAL_INT(0, h.countBeforeFirstForward(ROTATE_CLOCKWISE));
}

// A long enough cruise forgets the committed direction: the corner it was
// turning out of is behind the rover.
void test_long_cruise_forgets_the_turn_direction(void) {
  const ExploreParams params;
  Harness h;
  h.scanner.setArc(60, 120, 30.0f);
  h.scanner.setArc(121, 180, 25.0f);  // right close: commits to the left
  h.closing(10.0f);
  int stage = 0;
  h.onMotion = [&](const Explorer::Motion& m) {
    if (stage == 0 && isRotation(m.move)) {
      stage = 1;
      h.scanner.setAll(200.0f);  // clear: cruise
    } else if (stage == 1 && m.move == MOVE_FORWARD &&
               h.forwardRunMs >= static_cast<uint32_t>(params.commitReleaseMs + 200)) {
      stage = 2;  // after a long cruise, blocked with the left side closer
      h.scanner.setArc(60, 120, 30.0f);
      h.scanner.setArc(0, 59, 25.0f);
    }
  };
  h.run(10000);
  TEST_ASSERT_EQUAL_INT(2, stage);
  const int turnAfter = h.indexWhere(isRotation, h.indexOf(MOVE_FORWARD));
  TEST_ASSERT_TRUE(turnAfter > 0);
  TEST_ASSERT_EQUAL_INT(ROTATE_CLOCKWISE, h.motions[turnAfter].move);
}

// Getting stuck repeatedly at the same wide, low obstacle must turn further
// each time, in the same direction. Resetting on every stuck made the rover
// ping-pong in front of it.
void test_repeated_stucks_turn_further_the_same_way(void) {
  // The longest escape alone must fit inside a full circle of turning, or
  // every escape at the cap would end halted "boxed in".
  const ExploreParams params;
  TEST_ASSERT_TRUE(params.stuckTurnSteps * params.maxStuckMultiplier <= params.maxTurnSteps);

  Harness h;
  h.scanner.setArc(60, 120, 150.0f);  // held after a short drive, every cruise
  h.closing(25.0f);
  h.closeForMs = 600;
  // Three escapes, of one, two and three times stuckTurnSteps, fit inside the
  // maxTurnSteps circle together; a fourth would pass it and halt the rover,
  // after which a retry may start afresh in either direction.
  h.run(20000);
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

// The weave looks at +-25 degrees, which a sweep does not measure. When it is
// what stopped the cruise, the rover turns one step away before driving on,
// instead of hopping straight back into it.
void test_side_stop_turns_one_step_away(void) {
  struct Case {
    int fromDeg, toDeg;  // in the path at one weave angle only
    MoveCode away;
  };
  const Case cases[2] = {
      {62, 68, ROTATE_CLOCKWISE},          // +25: on the left
      {112, 118, ROTATE_COUNTERCLOCKWISE}, // -25: on the right
  };
  for (const Case& c : cases) {
    Harness h;
    h.scanner.setArc(c.fromDeg, c.toDeg, 20.0f);
    h.run(6000);
    const int firstForward = h.indexOf(MOVE_FORWARD);
    TEST_ASSERT_TRUE(firstForward >= 0);
    // The weave look ended the cruise, not the stuck check: the front never
    // changes in this world, and the escape that follows a stuck turns
    // whichever way the tie-breaker says, which can match by chance.
    const int stop = h.indexOf(STOP, firstForward);
    TEST_ASSERT_TRUE(stop > firstForward);
    TEST_ASSERT_TRUE(h.motionTimes[stop] - h.motionTimes[firstForward] < static_cast<uint32_t>(ExploreParams().stuckWindowMs));
    const int next = h.indexWhere([](MoveCode m) { return m != MOVE_FORWARD && m != STOP; }, firstForward);
    TEST_ASSERT_TRUE(next > 0);
    TEST_ASSERT_EQUAL_INT(c.away, h.motions[next].move);
  }
}

// How a cruise ended speaks for the decision right after it, and no later
// one. A side stop kept past the wander that a silent sweep makes turned the
// rover one step more, away from where the obstacle had been before the
// wander changed the heading.
void test_how_a_cruise_ended_counts_for_one_decision_only(void) {
  Harness h;
  h.scanner.setArc(62, 68, 20.0f);  // ends the cruise at the +25 look
  int stage = 0;
  h.onMotion = [&](const Explorer::Motion& m) {
    if (stage == 0 && m.move == MOVE_FORWARD) {
      stage = 1;
    } else if (stage == 1 && m.move == STOP) {
      stage = 2;
      h.scanner.setAll(-1.0f);  // the sweep after the cruise hears nothing
    } else if (stage == 2 && isRotation(m.move)) {
      stage = 3;
      h.scanner.setAll(200.0f);  // and after that the way is open
    }
  };
  h.run(8000);
  TEST_ASSERT_EQUAL_INT(3, stage);
  // From the first cruise to the next: the wander's steps and no more.
  const int rotations = h.rotationsBetweenCruises();
  TEST_ASSERT_TRUE_MESSAGE(rotations >= 0, "never drove on");
  TEST_ASSERT_EQUAL_INT(ExploreParams().wanderSteps, rotations);
}

// A cruise that nothing stopped ends at the cap, and the rover then turns a
// couple of steps before driving on: coverage, and a bound on pushing against
// something the sonar cannot see.
void test_capped_cruise_is_followed_by_a_short_wander(void) {
  Harness h;
  h.closing(10.0f);
  h.run(8000);
  const int rotations = h.rotationsBetweenCruises();
  TEST_ASSERT_TRUE_MESSAGE(rotations >= 0, "never drove on");
  TEST_ASSERT_EQUAL_INT(ExploreParams().wanderSteps, rotations);
}

// In a corridor too narrow to rotate in, the optional turns (the wander after
// a long cruise) are skipped: rotating would swing a corner into a wall.
void test_no_optional_rotation_where_there_is_no_room(void) {
  Harness h;
  narrowCorridor(h.scanner);
  h.closing(10.0f, 70, 110);  // a far end that slowly gets closer
  h.run(8000);
  TEST_ASSERT_TRUE(h.count(MOVE_FORWARD) > 0);
  TEST_ASSERT_EQUAL_INT(0, h.rotations());
}

// --- sidestepping ------------------------------------------------------------

// Rotating in place swings the corners out; with a wall too close on one side
// the mecanum wheels strafe away from it first.
void test_flank_too_close_to_rotate_strafes_away_first(void) {
  Harness h;
  h.scanner.setArc(60, 120, 30.0f);
  h.scanner.setArc(0, 30, 12.0f);  // left wall ~11 cm to the side
  h.run(3000);
  TEST_ASSERT_EQUAL_INT(MOVE_RIGHT, h.firstMotion());
}

// Converging on a wall with the way ahead clear: step away from it.
void test_converging_on_a_wall_steps_away_from_it(void) {
  Harness h;
  h.scanner.setArc(0, 30, 12.0f);  // left wall ~11 cm to the side, front clear
  h.run(3000);
  TEST_ASSERT_EQUAL_INT(MOVE_RIGHT, h.firstMotion());
}

// Whether MOVE_LEFT carries the rover toward what the scanner calls left is
// unverified wiring. If a sidestep brings the flank it left closer, the next
// sidestep goes the other way instead of pinning the rover to the wall.
void test_sidestep_that_went_the_wrong_way_flips_direction(void) {
  Harness h;
  blockedBesideLeftWall(h.scanner);
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
  const std::vector<MoveCode> strafes = h.strafes();
  TEST_ASSERT_TRUE(strafes.size() >= 2);
  TEST_ASSERT_EQUAL_INT(MOVE_RIGHT, strafes[0]);
  TEST_ASSERT_EQUAL_INT(MOVE_LEFT, strafes[1]);
  assertMovesRunTheirCourse(h);
}

// A pinned rover moves neither flank. That must not look like a mirrored mapping.
void test_pinned_sidestep_does_not_flip_direction(void) {
  Harness h;
  blockedBesideLeftWall(h.scanner);
  h.run(6000);
  for (const Explorer::Motion& m : h.motions) {
    if (m.move == MOVE_LEFT) TEST_FAIL_MESSAGE("flipped without evidence");
  }
  // Capped, and at least two, so a flip would have shown; then turning takes over.
  TEST_ASSERT_EQUAL_INT(ExploreParams().maxSidesteps, h.count(MOVE_RIGHT));
  TEST_ASSERT_TRUE(h.rotations() > 0);
}

// Nor is one flank on its own evidence: a strafe that barely moved, plus a
// little noise on the near wall, would otherwise send a correctly wired
// rover's next sidestep into that wall. It takes both flanks moving the
// wrong way.
void test_one_flank_moving_does_not_flip_direction(void) {
  Harness h;
  blockedBesideLeftWall(h.scanner);
  int sidesteps = 0;
  h.onMotion = [&](const Explorer::Motion& m) {
    if ((m.move == MOVE_LEFT || m.move == MOVE_RIGHT) && ++sidesteps == 1) {
      h.scanner.setArc(0, 30, 10.5f);  // the near wall 1.4 cm closer, the far one unmoved
    }
  };
  h.run(6000);
  const std::vector<MoveCode> strafes = h.strafes();
  TEST_ASSERT_EQUAL_INT(ExploreParams().maxSidesteps, static_cast<int>(strafes.size()));
  for (size_t i = 0; i < strafes.size(); i++) TEST_ASSERT_EQUAL_INT(MOVE_RIGHT, strafes[i]);
}

// Two sidesteps, each the wrong way, whichever way round: wiring that cannot
// be trusted to strafe at all. Sidestepping stays off, even after a cruise,
// which otherwise allows two more.
void test_second_contradiction_switches_sidestepping_off(void) {
  Harness h;
  blockedBesideLeftWall(h.scanner);
  int sidesteps = 0;
  int stage = 0;
  h.onMotion = [&](const Explorer::Motion& m) {
    if (m.move == MOVE_LEFT || m.move == MOVE_RIGHT) {
      // Each strafe carries the rover toward the wall it meant to leave.
      if (++sidesteps == 1) {
        h.scanner.setArc(0, 30, 9.0f);
        h.scanner.setArc(150, 180, 84.0f);
      } else if (sidesteps == 2) {
        h.scanner.setArc(0, 30, 6.0f);
        h.scanner.setArc(150, 180, 88.0f);
      }
    } else if (stage == 0 && sidesteps == 2 && isRotation(m.move)) {
      stage = 1;
      h.scanner.setAll(200.0f);  // turned clear: a cruise follows
    } else if (stage == 1 && m.move == MOVE_FORWARD) {
      stage = 2;  // and ends blocked beside a wall again
      blockedBesideLeftWall(h.scanner, 20.0f);
    }
  };
  h.run(15000);
  TEST_ASSERT_EQUAL_INT(2, stage);
  TEST_ASSERT_EQUAL_INT(2, sidesteps);
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
  driven.closing(25.0f);  // really driving: the far wall gets closer
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

// Reversing is only ever over ground just driven. A turn changes the heading,
// so the ground behind is no longer that ground.
void test_no_reverse_after_a_turn(void) {
  Harness h;
  h.closing(25.0f);
  int stage = 0;
  size_t sweepIndex = 0;
  h.onMotion = [&](const Explorer::Motion& m) {
    if (stage == 0 && m.move == MOVE_FORWARD && h.forwardRunMs >= 500) {
      stage = 1;
      h.scanner.setArc(60, 120, 30.0f);  // blocked: turn
    } else if (stage == 1 && isRotation(m.move)) {
      stage = 2;
      h.scanner.setAll(200.0f);  // one step clears it, so the turn ends...
    } else if (stage == 2 && m.move == STOP) {
      stage = 3;  // ...and the sweep that follows finds something right in front
      sweepIndex = h.motions.size();
      h.scanner.setArc(60, 120, 5.0f);
    }
  };
  h.run(12000);
  TEST_ASSERT_EQUAL_INT(3, stage);
  assertNoReverseUntilForward(h, sweepIndex);
}

// ...and so does a sidestep.
void test_no_reverse_after_a_sidestep(void) {
  Harness h;
  h.closing(25.0f);
  int stage = 0;
  size_t stepIndex = 0;
  h.onMotion = [&](const Explorer::Motion& m) {
    if (stage == 0 && m.move == MOVE_FORWARD && h.forwardRunMs >= 500) {
      stage = 1;
      h.scanner.setArc(60, 120, 30.0f);  // blocked...
      h.scanner.setArc(0, 30, 12.0f);    // ...with a wall too close to rotate beside
    } else if (stage == 1 && (m.move == MOVE_LEFT || m.move == MOVE_RIGHT)) {
      stage = 2;
      stepIndex = h.motions.size();
      h.scanner.setArc(60, 120, 5.0f);
    }
  };
  h.run(12000);
  TEST_ASSERT_EQUAL_INT(2, stage);
  assertNoReverseUntilForward(h, stepIndex);
}

// Held from the first moment of a cruise, the rover drove no ground at all,
// so there is nothing it may reverse over: it only turns away.
void test_held_from_the_start_does_not_reverse(void) {
  Harness h;
  h.scanner.setArc(60, 120, 150.0f);  // a far wall that never gets closer
  h.run(8000);
  TEST_ASSERT_TRUE(h.rotations() >= ExploreParams().stuckTurnSteps);  // it did get stuck
  TEST_ASSERT_EQUAL_INT(0, h.count(MOVE_BACKWARD));
}

// A fresh stretch of exploring -- after manual driving, a stand-down or a
// resume -- knows nothing of the ground behind it: the rover may have been
// driven anywhere since. reset() forgets the ground the last stretch drove.
void test_reset_forgets_the_ground_behind(void) {
  Harness h;
  h.closing(25.0f);  // really driving: the far wall gets closer
  size_t resetIndex = 0;
  h.onMotion = [&](const Explorer::Motion& m) {
    if (resetIndex == 0 && m.move == STOP && h.indexOf(MOVE_FORWARD) >= 0) {
      // A cruise has just ended, with ground behind it to reverse over.
      // Exploring starts over, facing something right in front.
      resetIndex = h.motions.size();
      h.explorer.reset(h.now);
      h.scanner.setArc(60, 120, 5.0f);
    }
  };
  h.run(6000);
  TEST_ASSERT_TRUE(resetIndex > 0);
  for (size_t i = resetIndex; i < h.motions.size(); i++) {
    TEST_ASSERT_NOT_EQUAL(MOVE_BACKWARD, h.motions[i].move);
  }
}

// A dead end in a passage too narrow to rotate in. Turning there swung the
// corners into the walls and ended halted "boxed in", where the rover could
// have reversed out. It backs out the way it came, sweeping after each step,
// and turns only once the flanks have room -- and as soon as they do, since
// nothing watches behind it. It does not drive back in when the way ahead
// starts to look clear again. An end found right in front, closer than the
// rover may rotate at, is the same dead end: one short backoff and a turn
// would still swing the corners into the walls.
void test_dead_end_too_narrow_to_rotate_in_is_backed_out_of(void) {
  const bool foundRightInFront[2] = {false, true};
  for (bool rightInFront : foundRightInFront) {
    Harness h;
    narrowCorridor(h.scanner);
    h.scanner.setArc(70, 110, rightInFront ? 200.0f : 60.0f);  // the far end
    h.closing(25.0f, 70, 110);  // getting closer while driving forward
    bool appeared = false;
    int backoffs = 0;
    bool roomy = false;
    int rotationsWithoutRoom = 0;
    int backoffsWithRoom = 0;
    h.onMotion = [&](const Explorer::Motion& m) {
      if (m.move == MOVE_FORWARD && rightInFront && !appeared && h.forwardRunMs >= 1000) {
        appeared = true;
        h.scanner.setArc(70, 110, 5.0f);  // under minTurnClearCm
      } else if (m.move == MOVE_BACKWARD) {
        if (roomy) backoffsWithRoom++;
        h.recede(m);  // and farther while reversing
        if (++backoffs == 3) {
          roomy = true;  // out of the passage: room on both sides
          h.scanner.setArc(0, 69, 200.0f);
          h.scanner.setArc(111, 180, 200.0f);
        }
      } else if (isRotation(m.move)) {
        if (!roomy) rotationsWithoutRoom++;
        h.scanner.setAll(200.0f);  // turned away from the passage
      }
    };
    h.run(15000);
    if (rightInFront) TEST_ASSERT_TRUE(appeared);
    // The first move after the cruise into the dead end is a reverse.
    const int firstBackward = h.indexOf(MOVE_BACKWARD);
    TEST_ASSERT_TRUE(firstBackward > 0);
    int lastForward = -1;
    for (int i = 0; i < firstBackward; i++) {
      if (h.motions[i].move == MOVE_FORWARD) lastForward = i;
    }
    TEST_ASSERT_TRUE(lastForward >= 0);
    for (int i = lastForward + 1; i < firstBackward; i++) TEST_ASSERT_EQUAL_INT(STOP, h.motions[i].move);

    TEST_ASSERT_EQUAL_INT(0, rotationsWithoutRoom);
    TEST_ASSERT_TRUE(roomy);
    TEST_ASSERT_EQUAL_INT(0, backoffsWithRoom);  // reversing stopped once there was room
    // Then it turns, without having driven back in first.
    const int firstRotation = h.indexWhere(isRotation, firstBackward);
    TEST_ASSERT_TRUE(firstRotation > firstBackward);
    for (int i = firstBackward; i < firstRotation; i++) TEST_ASSERT_NOT_EQUAL(MOVE_FORWARD, h.motions[i].move);
  }
}

// With no room anywhere on the way back, it reverses over all the ground it
// drove into the dead end, and no further, before turning anyway.
void test_backing_out_of_a_dead_end_stops_where_the_drive_began(void) {
  Harness h;
  narrowCorridor(h.scanner);
  h.scanner.setArc(70, 110, 60.0f);  // the dead end
  h.closing(25.0f, 70, 110);
  h.onMotion = [&](const Explorer::Motion& m) {
    if (m.move == MOVE_BACKWARD) h.recede(m);
  };
  h.run(10000);
  assertReversedAllItDrove(h);
  assertMovesRunTheirCourse(h);
}

// A sweep that hears nothing while the rover backs out of a dead end says
// nothing about the way out. It used to set off the silent sweep's wander
// turn, in the passage just measured too narrow to rotate in, and that turn
// threw away the ground left to reverse over, so the rover went on turning
// there. Reversing on it would be motion justified by silence alone. So the
// rover stands and looks again: one bad sweep only pauses the backing out,
// and a sensor that has died for good halts it where it stands.
void test_silent_sweep_while_backing_out_looks_again_in_place(void) {
  const bool sensorDiesForGood[2] = {false, true};
  for (bool diesForGood : sensorDiesForGood) {
    Harness h;
    narrowCorridor(h.scanner);
    h.scanner.setArc(70, 110, 60.0f);  // the dead end
    h.closing(25.0f, 70, 110);
    int backoffs = 0;
    int silentFrom = -1;  // the motion that started the silent sweep
    bool restored = false;
    FakeScanner::World world;
    h.onMotion = [&](const Explorer::Motion& m) {
      if (silentFrom >= 0 && !diesForGood && !restored) {
        restored = true;  // the sweep after the silent one hears the passage again
        h.scanner.range = world;
      }
      if (m.move == MOVE_BACKWARD) {
        backoffs++;
        h.recede(m);
      } else if (m.move == STOP && backoffs == 1 && silentFrom < 0) {
        // The sweep after the first step back hears nothing at any bearing.
        silentFrom = static_cast<int>(h.motions.size()) - 1;
        world = h.scanner.range;
        h.scanner.setAll(-1.0f);
      }
    };
    h.run(15000);
    TEST_ASSERT_TRUE(silentFrom > 0);

    if (diesForGood) {
      // Not a turn, a reverse or a step forward on silence: it halts where it is.
      for (size_t i = silentFrom; i < h.motions.size(); i++) TEST_ASSERT_EQUAL_INT(STOP, h.motions[i].move);
      TEST_ASSERT_EQUAL_INT(Explorer::HALTED, h.explorer.phase());
      TEST_ASSERT_EQUAL_STRING("sensor silent", h.explorer.haltReason());
      continue;
    }

    // The silent sweep cost nothing: it still reverses over all the ground it
    // drove in by, and only then turns, as with no silence at all.
    TEST_ASSERT_TRUE(restored);
    assertReversedAllItDrove(h, silentFrom);
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

// Every drive means the last avoidance turn found a way out. Counting turn
// steps across short cruises added up to a false "boxed in" in a busy room.
void test_short_cruises_never_add_up_to_boxed_in(void) {
  Harness h;
  h.closing(25.0f);
  int turnsSinceBlock = 0;
  bool blocked = false;
  bool everHalted = false;
  h.onMotion = [&](const Explorer::Motion& m) {
    if (h.explorer.phase() == Explorer::HALTED) everHalted = true;
    if (m.move == MOVE_FORWARD && !blocked && h.forwardRunMs >= 900) {
      blocked = true;  // something appears ~0.9 s into every cruise
      turnsSinceBlock = 0;
      h.scanner.setArc(60, 120, 20.0f);
    } else if (isRotation(m.move) && blocked && ++turnsSinceBlock == 3) {
      blocked = false;  // three steps of turning clear it
      h.scanner.setAll(200.0f);
    }
  };
  h.run(60000);
  TEST_ASSERT_FALSE(everHalted);
  TEST_ASSERT_TRUE(h.count(MOVE_FORWARD) > 30);
}

// A dead or unplugged sensor returns -1 everywhere, which reads as open space.
// The old code drove forward into the first wall; now it never drives forward
// on silence, only turns in place to look again, and then halts.
void test_silent_sensor_halts_without_ever_driving_forward(void) {
  Harness h;
  h.scanner.setAll(-1.0f);
  h.run(40000);
  TEST_ASSERT_EQUAL_INT(Explorer::HALTED, h.explorer.phase());
  TEST_ASSERT_EQUAL_STRING("sensor silent", h.explorer.haltReason());
  TEST_ASSERT_EQUAL_INT(0, h.count(MOVE_FORWARD));
  TEST_ASSERT_EQUAL_INT(0, h.count(MOVE_BACKWARD));
  TEST_ASSERT_EQUAL_INT(0, h.count(MOVE_LEFT) + h.count(MOVE_RIGHT));
}

// One silent sweep is not a fault -- a big room can be out of range -- but it
// is not a reason to drive either. Once an echo comes back, exploring resumes.
void test_echo_after_silence_resumes_exploring(void) {
  Harness h;
  h.scanner.setAll(-1.0f);
  bool heard = false;
  h.onMotion = [&](const Explorer::Motion& m) {
    if (isRotation(m.move) && !heard) {
      heard = true;
      h.scanner.setAll(200.0f);  // turned toward a wall in range
    }
  };
  h.run(10000);
  TEST_ASSERT_TRUE(heard);
  TEST_ASSERT_TRUE(h.count(MOVE_FORWARD) > 0);
  TEST_ASSERT_NOT_EQUAL(Explorer::HALTED, h.explorer.phase());
}

// Only silent sweeps in a row add up to "sensor silent". In a big room every
// other sweep may hear nothing; counting those across the sweeps between that
// did hear something would halt a working rover.
void test_a_sweep_that_hears_an_echo_resets_the_silent_count(void) {
  Harness h;
  h.scanner.setAll(-1.0f);
  h.closing(25.0f, 0, hardware::SERVO_MAX_DEG);  // really driving, so no cruise reads as stuck
  bool silent = true;
  int flips = 0;
  bool everHalted = false;
  h.onMotion = [&](const Explorer::Motion& m) {
    if (h.explorer.phase() == Explorer::HALTED) everHalted = true;
    if (m.move != STOP) return;
    // Every sweep starts with a STOP: each hears the opposite of the last.
    silent = !silent;
    flips++;
    h.scanner.setAll(silent ? -1.0f : 200.0f);
  };
  h.run(60000);
  TEST_ASSERT_TRUE(flips >= 2 * ExploreParams().silentSweepsToHalt);
  TEST_ASSERT_FALSE(everHalted);
}

// --- telemetry ---------------------------------------------------------------

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
  // sweeping
  RUN_TEST(test_first_sweep_measures_every_bearing_before_moving);
  RUN_TEST(test_consecutive_sweeps_alternate_direction);
  RUN_TEST(test_servo_settles_in_proportion_to_its_travel);
  RUN_TEST(test_pings_are_spaced_for_the_echo_to_die_away);
  // cruising
  RUN_TEST(test_open_space_cruises_forward_on_a_short_lease);
  RUN_TEST(test_obstacle_appearing_mid_cruise_stops_the_rover);
  RUN_TEST(test_cruise_continues_between_the_stop_and_go_thresholds);
  RUN_TEST(test_corridor_is_entered_not_backed_out_of);
  RUN_TEST(test_obstacle_in_the_path_at_a_diagonal_blocks_the_cruise);
  RUN_TEST(test_vanishing_near_echo_ends_the_cruise);
  RUN_TEST(test_stuck_below_the_beam_backs_off_and_turns_away);
  RUN_TEST(test_front_reading_that_grows_is_not_stuck);
  RUN_TEST(test_sensor_dying_mid_cruise_stops_within_a_weave);
  // turning
  RUN_TEST(test_wall_ahead_turns_until_clear_then_drives_on);
  RUN_TEST(test_turns_toward_the_more_open_side);
  RUN_TEST(test_turn_direction_is_kept_until_the_way_is_clear);
  RUN_TEST(test_long_cruise_forgets_the_turn_direction);
  RUN_TEST(test_repeated_stucks_turn_further_the_same_way);
  RUN_TEST(test_side_stop_turns_one_step_away);
  RUN_TEST(test_how_a_cruise_ended_counts_for_one_decision_only);
  RUN_TEST(test_capped_cruise_is_followed_by_a_short_wander);
  RUN_TEST(test_no_optional_rotation_where_there_is_no_room);
  // sidestepping
  RUN_TEST(test_flank_too_close_to_rotate_strafes_away_first);
  RUN_TEST(test_converging_on_a_wall_steps_away_from_it);
  RUN_TEST(test_sidestep_that_went_the_wrong_way_flips_direction);
  RUN_TEST(test_pinned_sidestep_does_not_flip_direction);
  RUN_TEST(test_one_flank_moving_does_not_flip_direction);
  RUN_TEST(test_second_contradiction_switches_sidestepping_off);
  // reversing
  RUN_TEST(test_reverses_only_over_ground_just_driven);
  RUN_TEST(test_no_reverse_after_a_turn);
  RUN_TEST(test_no_reverse_after_a_sidestep);
  RUN_TEST(test_held_from_the_start_does_not_reverse);
  RUN_TEST(test_reset_forgets_the_ground_behind);
  RUN_TEST(test_dead_end_too_narrow_to_rotate_in_is_backed_out_of);
  RUN_TEST(test_backing_out_of_a_dead_end_stops_where_the_drive_began);
  RUN_TEST(test_silent_sweep_while_backing_out_looks_again_in_place);
  // halting
  RUN_TEST(test_boxed_in_halts_and_never_drives_blind);
  RUN_TEST(test_halted_rover_resumes_when_the_way_opens);
  RUN_TEST(test_short_cruises_never_add_up_to_boxed_in);
  RUN_TEST(test_silent_sensor_halts_without_ever_driving_forward);
  RUN_TEST(test_echo_after_silence_resumes_exploring);
  RUN_TEST(test_a_sweep_that_hears_an_echo_resets_the_silent_count);
  // telemetry
  RUN_TEST(test_phase_names);
  return UNITY_END();
}

#include "Explorer.h"

#include <math.h>
#include <stdio.h>
#include <stdlib.h>

#include "Kinematics.h"
#include "Timing.h"

using timing::elapsed;
using timing::reached;
using timing::since;

namespace {

const char* const HALT_BOXED_IN = "boxed in";
const char* const HALT_SENSOR_SILENT = "sensor silent";

bool isEcho(float cm) { return cm < kinematics::DISTANCE_FAR_CM; }

float radians(int degrees) { return degrees * kinematics::PI_F / 180.0f; }

// How far to the side of the rover a reading `cm` away at `angleDeg` lies.
float lateralOf(int angleDeg, float cm) { return fabsf(cm * sinf(radians(angleDeg))); }

Explorer::Motion motion(MoveCode move, int durationMs) {
  Explorer::Motion m;
  m.requested = true;
  m.move = move;
  m.durationMs = durationMs;
  return m;
}

Explorer::Motion stopMotion() { return motion(STOP, 0); }

Explorer::Motion noMotion() { return Explorer::Motion(); }

}  // namespace

Explorer::Explorer(RangeScanner& scanner, EventLog& log, const ExploreParams& params)
    : scanner(scanner), log(log), params(params) {
  for (int i = 0; i < BEARING_COUNT; i++) {
    scan.cm[i] = kinematics::DISTANCE_FAR_CM;
    scan.measured[i] = false;
  }
}

void Explorer::reset(uint32_t now) {
  episode = Episode();
  startSweep(now);
}

Explorer::Motion Explorer::update(uint32_t now, bool motorsIdle) {
  switch (currentPhase) {
    case SWEEP:
      return stepSweep(now, true);
    case CRUISE:
      return stepCruise(now);
    case TURN:
      return stepTurn(now, motorsIdle);
    case BACKOFF: {
      if (!motionDone(now, motorsIdle)) return noMotion();
      // Backing out of a dead end: look again before every further step.
      if (episode.backingOut) return startSweep(now);
      const int steps = episode.escapeSteps;  // used up by this one turn
      episode.escapeSteps = 0;
      return startTurn(now, episode.committedDirection, steps, true, "after backing off");
    }
    case SIDESTEP:
      return motionDone(now, motorsIdle) ? startSweep(now) : noMotion();
    case HALTED:
      return reached(now, phaseUntil) ? retryAfterHalt(now) : noMotion();
    case LOOK:  // manual mode's; reset() leaves it before exploring
      return startSweep(now);
  }
  return noMotion();
}

void Explorer::survey(uint32_t now, SonarMode mode, int aimDeg) {
  if (mode != SONAR_SWEEP && hasScan()) {
    lookAt(now, mode == SONAR_FRONT ? 0 : aimDeg);
    return;
  }
  // From a held look too: its ping was not at the sweep's next bearing.
  if (currentPhase != SWEEP) startSweep(now);
  stepSweep(now, false);
}

const char* Explorer::phaseName() const {
  switch (currentPhase) {
    case SWEEP: return "SWEEP";
    case CRUISE: return "CRUISE";
    case TURN: return "TURN";
    case BACKOFF: return "BACKOFF";
    case SIDESTEP: return "SIDESTEP";
    case HALTED: return "HALTED";
    case LOOK: return "LOOK";
  }
  return "UNKNOWN";
}

bool Explorer::hasScan() const {
  for (int i = 0; i < BEARING_COUNT; i++) {
    if (!scan.measured[i]) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Sweeping and deciding
// ---------------------------------------------------------------------------

Explorer::Motion Explorer::startSweep(uint32_t now) {
  currentPhase = SWEEP;
  // Back and forth rather than always left to right: the servo never has to
  // swing across the whole arc before the first reading of a sweep.
  scan.leftToRight = !scan.leftToRight;
  scan.step = 0;
  scan.heardEcho = false;
  aim(now, angleOf(sweepBearing(0)));
  return stopMotion();
}

Explorer::Motion Explorer::stepSweep(uint32_t now, bool decideWhenDone) {
  if (!readyToPing(now)) return noMotion();

  record(sweepBearing(scan.step), ping(now));
  if (++scan.step < BEARING_COUNT) {
    aim(now, angleOf(sweepBearing(scan.step)));
    return noMotion();
  }

  episode.silentSweeps = scan.heardEcho ? 0 : episode.silentSweeps + 1;
  if (!decideWhenDone) {
    startSweep(now);
    return noMotion();
  }
  return decide(now);
}

Explorer::Motion Explorer::decide(uint32_t now) {
  if (episode.sidestep.pending) checkSidestepWentAway(now);

  // How the last cruise ended is good for this one decision, whichever way
  // it goes. Left set past a turn, it described a heading the rover no
  // longer has: a side stop kept through a silent sweep's wander turned the
  // rover one more step away from where the obstacle used to be.
  const int sideStop = episode.sideStopDeg;
  const bool cappedCruise = episode.cruiseEndedByCap;
  episode.sideStopDeg = 0;
  episode.cruiseEndedByCap = false;
  logSweep(now);

  // A working sonar hears something in a room -- a wall, a chair, the floor
  // at an angle. Hearing nothing sweep after sweep is what a disconnected or
  // dead sensor looks like, and every no-echo reads as open space.
  if (episode.silentSweeps >= params.silentSweepsToHalt) return halt(now, HALT_SENSOR_SILENT);

  // A sweep that heard nothing at all says nothing about the way ahead, so
  // it is never grounds to drive forward. Turn a little in place and look
  // again; a working sensor soon finds a wall, and a dead one halts above.
  // Backing out of a dead end, the rover is where it may not turn: that
  // wander swung the corners into the walls, and the turn dropped the ground
  // left to reverse over, so it went on turning there. Reversing on silence
  // would be motion justified by an absent echo alone. So it stands and
  // looks again, still backing out; the count above halts a dead sensor.
  if (!scan.heardEcho) {
    log.add(now, EventLog::WARN, "No echo at any bearing (%d sweeps in a row)", episode.silentSweeps);
    if (episode.backingOut) return startSweep(now);
    return startTurn(now, wanderDirection(), params.wanderSteps, false, "to look again");
  }

  // Still backing out of a dead end (the blocked path, below). This comes
  // before the path check: backed off far enough, the way back in looks
  // clear again, and driving back in would shuttle the rover in and out of
  // the dead end for ever.
  if (episode.backingOut) {
    if (!roomToRotate() && episode.reverseBudgetMs > 0) return startBackoff(now, "backing out of a dead end");
    episode.backingOut = false;
    return turnOrSidestep(now, commitTurnDirection(), 0, true, "out of the dead end");
  }

  if (!pathBlocked(params.goCm)) {
    episode.waitForClearPath = false;
    // The small turns below are optional, so they are skipped where rotating
    // would swing a corner into a wall: in a corridor the rover drives on.
    if (roomToRotate()) {
      if (sideStop != 0) {
        // The last cruise ended on something the weave saw off to one side,
        // at an angle this sweep does not measure. Turn one step away from it
        // rather than drive straight back into it.
        return turnOrSidestep(now, sideStop > 0 ? -1 : +1, 1, false, "away from what ended the cruise");
      }
      if (cappedCruise && params.wanderSteps > 0) {
        // Nothing stopped the last cruise. Turn a little anyway: it spreads
        // coverage, and bounds how long the rover can push against something
        // the sonar cannot see.
        return turnOrSidestep(now, wanderDirection(), params.wanderSteps, false, "to wander");
      }
      const int veer = veerDirection();
      if (veer != 0) return turnOrSidestep(now, veer, 1, false, "away from a near flank");
    }
    episode.sidesteps = 0;
    return startCruise(now);
  }

  // After turning a full circle without finding a way out, only a path that
  // opens by itself resumes exploring; the rover does not spin again.
  if (episode.waitForClearPath) return halt(now, HALT_BOXED_IN);
  if (!roomToRotate() && episode.reverseBudgetMs > 0) {
    // A dead end in a passage too narrow to rotate in. Turning here swung the
    // corners into the walls this sweep had just measured, and then halted
    // boxed in where the rover could have reversed out. Back out the way it
    // came instead, a step at a time with a sweep after each, until the
    // flanks have room. Only when that ground runs out does it turn anyway.
    // This comes before the too-close backoff below, which reverses only once
    // and then turns.
    episode.backingOut = true;
    return startBackoff(now, "a dead end too narrow to turn in");
  }
  // Committed before the backoff: the turn after it reads the direction.
  const int direction = commitTurnDirection();
  if (scan.cm[FRONT] < params.minTurnClearCm && episode.reverseBudgetMs > 0) {
    return startBackoff(now, "too close to turn");
  }
  return turnOrSidestep(now, direction, 0, true, "the path is blocked");
}

// ---------------------------------------------------------------------------
// Cruising
// ---------------------------------------------------------------------------

Explorer::Motion Explorer::startCruise(uint32_t now) {
  log.add(now, EventLog::INFO, "Cruise: the path is clear");
  currentPhase = CRUISE;
  cruise = Cruise();
  cruise.start = now;
  aim(now, 0);

  const float front = scan.cm[FRONT];
  if (isEcho(front)) {
    cruise.sawFront(front, now);
    cruise.restartStuckWindow(front, now);
  }
  return motion(MOVE_FORWARD, params.cruiseLeaseMs);
}

Explorer::Motion Explorer::stepCruise(uint32_t now) {
  if (elapsed(now, cruise.start, params.cruiseMaxMs)) {
    episode.cruiseEndedByCap = true;
    log.add(now, EventLog::INFO, "Cruise ended: its %d ms are up", params.cruiseMaxMs);
    return endCruise(now);
  }
  if (!readyToPing(now)) return noMotion();

  const int angle = sonar.lookDeg;
  const float cm = kinematics::normalizeDistance(ping(now));

  // Looks that hear nothing at all never renew the lease for long: a sensor
  // that dies mid-cruise stops the rover within one weave, and the silent
  // sweeps that follow halt it.
  cruise.silentLooks = isEcho(cm) ? 0 : cruise.silentLooks + 1;
  if (cruise.silentLooks >= params.silentCruiseLooks) {
    log.add(now, EventLog::WARN, "Cruise ended: %d looks in a row heard no echo", cruise.silentLooks);
    return endCruise(now);
  }

  if (angle == 0) {
    scan.cm[FRONT] = cm;
    // An obstacle does not vanish as the rover closes on it. A near echo
    // that turns into silence was deflected away, not left behind.
    if (!isEcho(cm) && echoVanished(now)) {
      log.add(now, EventLog::INFO, "Cruise ended: the near echo ahead vanished (deflected)");
      return endCruise(now);
    }
    if (isEcho(cm)) {
      if (notChanging(cm, now)) return escapeStuck(now);
      cruise.sawFront(cm, now);
    }
  }

  if (inPath(angle, cm, params.stopCm)) {
    episode.sideStopDeg = angle;
    log.add(now, EventLog::INFO, "Cruise ended: %.0f cm in the path at %d deg", cm, angle);
    return endCruise(now);
  }

  const int weave[4] = {0, params.weaveDeg, 0, -params.weaveDeg};
  cruise.weaveStep = (cruise.weaveStep + 1) % 4;
  aim(now, weave[cruise.weaveStep]);
  return motion(MOVE_FORWARD, params.cruiseLeaseMs);  // a clear look renews the lease
}

// The rover drove: remember how far, for reversing, then look again.
Explorer::Motion Explorer::endCruise(uint32_t now) {
  const uint32_t ran = since(now, cruise.start);
  episode.reverseBudgetMs += static_cast<int32_t>(ran);
  // Any drive means the last avoidance turn found a way out: the full-circle
  // count starts over. Only a long one forgets the turn direction too.
  episode.turnStepsCommitted = 0;
  if (ran >= static_cast<uint32_t>(params.commitReleaseMs)) {
    episode.committedDirection = 0;
    episode.consecutiveStucks = 0;
  }
  return startSweep(now);
}

Explorer::Motion Explorer::escapeStuck(uint32_t now) {
  // The sonar says clear but nothing ahead is changing: something below the
  // beam is holding the rover. Back off and turn well clear, further each
  // time in a row. Not endCruise(): time spent pushing against something is
  // not open floor, so it must not release the turn direction or reset the
  // counts -- that made the rover ping-pong at a wide low obstacle. Only the
  // driving before the stuck window counts as ground to reverse over.
  log.add(now, EventLog::WARN, "Stuck: the front echo has not changed by %.0f cm in %d ms",
          params.stuckProgressCm, params.stuckWindowMs);
  episode.reverseBudgetMs += static_cast<int32_t>(since(cruise.stuckReferenceAt, cruise.start));
  if (episode.consecutiveStucks < params.maxStuckMultiplier) episode.consecutiveStucks++;
  episode.escapeSteps = params.stuckTurnSteps * episode.consecutiveStucks;
  if (episode.committedDirection == 0) episode.committedDirection = alternateDirection();
  return startBackoff(now, "stuck");
}

// ---------------------------------------------------------------------------
// Turning, backing off, sidestepping, halting
// ---------------------------------------------------------------------------

Explorer::Motion Explorer::turnOrSidestep(uint32_t now, int direction, int minSteps,
                                          bool untilClear, const char* why) {
  const int away = sidestepDirection();
  if (away != 0) return startSidestep(now, away);
  return startTurn(now, direction, minSteps, untilClear, why);
}

Explorer::Motion Explorer::startTurn(uint32_t now, int direction, int minSteps, bool untilClear,
                                     const char* why) {
  const char* side = direction > 0 ? "left" : "right";
  if (untilClear) {
    log.add(now, EventLog::INFO, "Turn %s until the front is clear: %s", side, why);
  } else {
    log.add(now, EventLog::INFO, "Turn %s %d step%s: %s", side, minSteps, minSteps == 1 ? "" : "s", why);
  }
  currentPhase = TURN;
  turn = Turn();
  turn.direction = direction;
  turn.minSteps = minSteps;
  turn.untilClear = untilClear;
  episode.reverseBudgetMs = 0;  // the heading changes: the ground behind is unknown
  return rotateStep(now);
}

Explorer::Motion Explorer::rotateStep(uint32_t now) {
  if (turn.untilClear && ++episode.turnStepsCommitted > params.maxTurnSteps) {
    episode.waitForClearPath = true;
    return halt(now, HALT_BOXED_IN);
  }
  turn.steps++;
  turn.clearLooks = 0;
  turn.stage = ROTATING;
  phaseUntil = now + params.turnStepMs;
  aim(now, 0);
  return motion(turn.direction > 0 ? ROTATE_COUNTERCLOCKWISE : ROTATE_CLOCKWISE, params.turnStepMs);
}

Explorer::Motion Explorer::stepTurn(uint32_t now, bool motorsIdle) {
  if (turn.stage == ROTATING) {
    if (motionDone(now, motorsIdle)) {
      turn.stage = SETTLING;
      phaseUntil = now + params.turnSettleMs;
    }
    return noMotion();
  }
  if (turn.stage == SETTLING) {
    if (!reached(now, phaseUntil)) return noMotion();
    turn.stage = LOOKING;
  }
  if (!readyToPing(now)) return noMotion();

  const float front = kinematics::normalizeDistance(ping(now));
  scan.cm[FRONT] = front;

  if (turn.steps < turn.minSteps) return rotateStep(now);
  if (!turn.untilClear) return startSweep(now);
  if (front <= params.goCm) return rotateStep(now);
  // Clear ahead. Look once more to be sure, then sweep the whole way ahead
  // before moving: the front beam alone misses what is off to either side.
  if (++turn.clearLooks < 2) return noMotion();
  return startSweep(now);
}

bool Explorer::motionDone(uint32_t now, bool motorsIdle) const {
  return motorsIdle && reached(now, phaseUntil);
}

Explorer::Motion Explorer::startBackoff(uint32_t now, const char* why) {
  // Nothing watches behind the rover, so it only ever reverses over ground it
  // has just driven forward across, and never far.
  const int32_t budget = episode.reverseBudgetMs;
  const int32_t ms = budget < params.backoffMaxMs ? budget : params.backoffMaxMs;
  episode.reverseBudgetMs -= ms;
  if (ms > 0) {
    log.add(now, EventLog::INFO, "Reverse %ld ms: %s", static_cast<long>(ms), why);
  } else {
    log.add(now, EventLog::INFO, "No ground behind to reverse over: %s", why);
  }
  currentPhase = BACKOFF;
  phaseUntil = now + static_cast<uint32_t>(ms);
  return ms > 0 ? motion(MOVE_BACKWARD, static_cast<int>(ms)) : stopMotion();
}

Explorer::Motion Explorer::startSidestep(uint32_t now, int direction) {
  currentPhase = SIDESTEP;
  phaseUntil = now + params.sidestepMs;
  episode.sidesteps++;
  episode.reverseBudgetMs = 0;

  SidestepCheck& check = episode.sidestep;
  check.from = direction > 0 ? RIGHT : LEFT;
  log.add(now, EventLog::INFO, "Sidestep away from the %s flank: too close to turn beside",
          check.from == RIGHT ? "right" : "left");
  check.fromBefore = lateralCm(check.from);
  check.otherBefore = lateralCm(check.from == LEFT ? RIGHT : LEFT);
  check.pending = true;

  return motion(direction * strafeSign > 0 ? MOVE_LEFT : MOVE_RIGHT, params.sidestepMs);
}

void Explorer::checkSidestepWentAway(uint32_t now) {
  SidestepCheck& check = episode.sidestep;
  check.pending = false;
  const Bearing other = check.from == LEFT ? RIGHT : LEFT;
  // Only real echoes say anything about where the rover went.
  if (!isEcho(scan.cm[check.from]) || !isEcho(scan.cm[other])) return;

  const float fromChange = lateralCm(check.from) - check.fromBefore;
  const float otherChange = lateralCm(other) - check.otherBefore;
  // Both flanks moved the wrong way. A rover pinned against the wall moves
  // neither, so being stuck is never mistaken for a mirrored mapping.
  if (fromChange < -1.0f && otherChange > 1.0f) {
    if (++strafeContradictions == 1) {
      strafeSign = -strafeSign;
      log.add(now, EventLog::WARN, "The sidestep went the wrong way: strafing the other way from now");
    } else if (strafeContradictions == 2) {
      log.add(now, EventLog::WARN, "The sidestep went the wrong way again: no more sidesteps");
    }
  }
}

Explorer::Motion Explorer::halt(uint32_t now, const char* reason) {
  log.add(now, EventLog::WARN, "Halted: %s; trying again in %d s", reason, params.haltRetryMs / 1000);
  currentPhase = HALTED;
  episode.haltWhy = reason;
  phaseUntil = now + params.haltRetryMs;
  aim(now, 0);
  return stopMotion();
}

Explorer::Motion Explorer::retryAfterHalt(uint32_t now) {
  log.add(now, EventLog::INFO, "Trying again after the halt");
  episode.committedDirection = 0;
  episode.turnStepsCommitted = 0;
  return startSweep(now);
}

// ---------------------------------------------------------------------------
// Looking and measuring
// ---------------------------------------------------------------------------

void Explorer::aim(uint32_t now, int angleDeg) {
  const int target = kinematics::clampInt(hardware::SERVO_CENTRE_DEG + params.servoDegPerBearing * angleDeg, 0,
                                          hardware::SERVO_MAX_DEG);

  // Settle time grows with how far the servo swings; the first aim assumes
  // the worst case because nothing is known about where it points.
  const int travel = sonar.servoDeg < 0 ? hardware::SERVO_MAX_DEG : abs(target - sonar.servoDeg);
  if (target != sonar.servoDeg) {
    scanner.aim(target);
    sonar.servoDeg = target;
  }
  sonar.readyAt = now + params.servoBaseMs + static_cast<uint32_t>(params.servoMsPerDeg * travel);
  sonar.lookDeg = angleDeg;
}

// survey()'s Front and Aim: the sonar held at one angle, pinging as often as
// it may. Moved, it settles first, as for any aim.
void Explorer::lookAt(uint32_t now, int angleDeg) {
  if (currentPhase != LOOK || sonar.lookDeg != angleDeg) {
    currentPhase = LOOK;
    aim(now, angleDeg);
  }
  if (!readyToPing(now)) return;
  const float raw = ping(now);
  Bearing bearing;
  if (bearingAt(angleDeg, bearing)) record(bearing, raw);
}

bool Explorer::readyToPing(uint32_t now) const {
  if (!reached(now, sonar.readyAt)) return false;
  return !sonar.hasPinged || elapsed(now, sonar.lastPingAt, params.pingIntervalMs);
}

float Explorer::ping(uint32_t now) {
  const float raw = scanner.measureCm();
  sonar.lastPingAt = now;
  sonar.hasPinged = true;
  look.valid = true;
  look.angleDeg = sonar.lookDeg;
  look.cm = kinematics::normalizeDistance(raw);
  pings++;
  if (raw < 0.0f) silentPings++;
  return raw;
}

void Explorer::record(Bearing bearing, float rawCm) {
  scan.cm[bearing] = kinematics::normalizeDistance(rawCm);
  scan.measured[bearing] = true;
  if (rawCm >= 0.0f) scan.heardEcho = true;
}

Explorer::Bearing Explorer::sweepBearing(int step) const {
  return static_cast<Bearing>(scan.leftToRight ? step : BEARING_COUNT - 1 - step);
}

int Explorer::angleOf(Bearing bearing) const {
  switch (bearing) {
    case LEFT: return params.sweepOuterDeg;
    case FRONT_LEFT: return params.sweepInnerDeg;
    case FRONT: return 0;
    case FRONT_RIGHT: return -params.sweepInnerDeg;
    case RIGHT: return -params.sweepOuterDeg;
    case BEARING_COUNT: break;
  }
  return 0;
}

bool Explorer::bearingAt(int angleDeg, Bearing& bearing) const {
  for (int i = 0; i < BEARING_COUNT; i++) {
    if (angleOf(static_cast<Bearing>(i)) != angleDeg) continue;
    bearing = static_cast<Bearing>(i);
    return true;
  }
  return false;
}

// The readings a decision is made on, left to right: "-" for no echo.
void Explorer::logSweep(uint32_t now) {
  char cm[BEARING_COUNT][8];
  for (int i = 0; i < BEARING_COUNT; i++) {
    if (isEcho(scan.cm[i])) {
      snprintf(cm[i], sizeof(cm[i]), "%.0f", scan.cm[i]);
    } else {
      snprintf(cm[i], sizeof(cm[i]), "-");
    }
  }
  log.add(now, EventLog::INFO, "Sweep (cm): L %s, FL %s, F %s, FR %s, R %s", cm[LEFT], cm[FRONT_LEFT],
          cm[FRONT], cm[FRONT_RIGHT], cm[RIGHT]);
}

// ---------------------------------------------------------------------------
// Reading the scan
// ---------------------------------------------------------------------------

// Is a return at this angle inside the rover's forward path, and nearer than
// the limit? Testing the path rather than the ray is what lets the rover
// enter a corridor whose walls are close at the sides but not in its way.
bool Explorer::inPath(int angleDeg, float cm, float limitCm) const {
  const float forward = cm * cosf(radians(angleDeg));
  const float lateral = lateralOf(angleDeg, cm);
  return lateral <= params.halfWidthCm + params.pathMarginCm && forward <= limitCm;
}

bool Explorer::pathBlocked(float limitCm) const {
  return scan.cm[FRONT] <= limitCm ||
         inPath(angleOf(FRONT_LEFT), scan.cm[FRONT_LEFT], limitCm) ||
         inPath(angleOf(FRONT_RIGHT), scan.cm[FRONT_RIGHT], limitCm);
}

float Explorer::lateralCm(Bearing bearing) const {
  return lateralOf(angleOf(bearing), scan.cm[bearing]);
}

// Room to rotate in place: both flanks clear of the corners' swing, or one
// tight flank a sidestep can clear first.
bool Explorer::roomToRotate() const {
  const bool flanksClear = lateralCm(LEFT) >= params.rotateClearanceCm &&
                           lateralCm(RIGHT) >= params.rotateClearanceCm;
  return flanksClear || sidestepDirection() != 0;
}

// The side to turn to until the rover drives clear: chosen once and then kept,
// so the rover does not dither between sides in a corner. A long cruise or a
// halt's retry forgets it.
int Explorer::commitTurnDirection() {
  if (episode.committedDirection == 0) episode.committedDirection = chooseTurnDirection();
  return episode.committedDirection;
}

// +1 to turn left, -1 to turn right: whichever side has more open space.
// Distances are capped so one far reading cannot outvote a nearer wall.
int Explorer::chooseTurnDirection() {
  const float cap = params.turnCompareCapCm;
  const float left = fminf(scan.cm[LEFT], cap) + fminf(scan.cm[FRONT_LEFT], cap);
  const float right = fminf(scan.cm[RIGHT], cap) + fminf(scan.cm[FRONT_RIGHT], cap);
  if (fabsf(left - right) < params.turnTieCm) return alternateDirection();
  return left > right ? +1 : -1;
}

// Front clear but converging on a wall at one side: step away from it. A flank
// this close is too close to rotate beside, so in practice this is a sidestep
// (turnOrSidestep), taken only when the other side has room for it.
int Explorer::veerDirection() const {
  const float close = params.halfWidthCm + params.sideMarginCm;
  const bool closeLeft = lateralCm(LEFT) <= close;
  const bool closeRight = lateralCm(RIGHT) <= close;
  if (closeLeft == closeRight) return 0;
  return closeLeft ? -1 : +1;
}

// A flank too close to rotate beside, with room on the other side: strafe
// away first (+1 left, -1 right). Mecanum wheels can; a tank-steer rover could not.
int Explorer::sidestepDirection() const {
  if (episode.sidesteps >= params.maxSidesteps || strafeContradictions >= 2) return 0;
  const bool tightLeft = lateralCm(LEFT) < params.rotateClearanceCm;
  const bool tightRight = lateralCm(RIGHT) < params.rotateClearanceCm;
  if (tightLeft == tightRight) return 0;
  const float otherSide = tightLeft ? lateralCm(RIGHT) : lateralCm(LEFT);
  if (otherSide < params.rotateClearanceCm + params.sidestepRoomMarginCm) return 0;
  return tightLeft ? -1 : +1;
}

bool Explorer::echoVanished(uint32_t now) const {
  return cruise.lastFrontEchoCm >= 0.0f && cruise.lastFrontEchoCm < params.suspectNearCm &&
         !elapsed(now, cruise.lastFrontEchoAt, params.suspectWindowMs);
}

// Stuck: a front echo that has not changed, either way, over a whole window
// of driving. Closing is progress; so is a reading that grew because the beam
// moved on to something farther (a chair leg passing out of the cone). Only
// a reading that stays put means the wheels are held.
bool Explorer::notChanging(float frontCm, uint32_t now) {
  if (cruise.hasStuckReference) {
    if (!elapsed(now, cruise.stuckReferenceAt, params.stuckWindowMs)) return false;
    // Stuck: keep the reference, whose time escapeStuck() needs.
    if (fabsf(cruise.stuckReferenceCm - frontCm) < params.stuckProgressCm) return true;
  }
  cruise.restartStuckWindow(frontCm, now);
  return false;
}

int Explorer::alternateDirection() {
  preferLeft = !preferLeft;
  return preferLeft ? +1 : -1;
}

// Deterministic pseudo-random left or right, so the host tests can replay it.
int Explorer::wanderDirection() {
  wanderSeed = wanderSeed * 1103515245u + 12345u;
  return (wanderSeed >> 16) & 1 ? +1 : -1;
}

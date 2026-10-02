#include "Explorer.h"

#include <math.h>
#include <stdlib.h>

#include "Kinematics.h"
#include "Timing.h"

using timing::reached;
using timing::since;

namespace {

const char* const HALT_BOXED_IN = "boxed in";
const char* const HALT_SENSOR_SILENT = "sensor silent";

bool isEcho(float cm) { return cm < kinematics::DISTANCE_FAR_CM; }

float radians(int degrees) { return degrees * kinematics::PI_F / 180.0f; }

// True once `ms` (an ExploreParams duration) has passed since `start`.
bool lasted(uint32_t now, uint32_t start, int ms) { return since(now, start) >= static_cast<uint32_t>(ms); }

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

Explorer::Explorer(RangeScanner& scanner, const ExploreParams& params)
    : scanner(scanner), params(params) {
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
      if (!motorsIdle || !reached(now, phaseUntil)) return noMotion();
      const int steps = episode.escapeSteps;  // used up by this one turn
      episode.escapeSteps = 0;
      return startTurn(now, episode.committedDirection, steps, true);
    }
    case SIDESTEP:
      if (!motorsIdle || !reached(now, phaseUntil)) return noMotion();
      return startSweep(now);
    case HALTED:
      return reached(now, phaseUntil) ? retryAfterHalt(now) : noMotion();
  }
  return noMotion();
}

void Explorer::survey(uint32_t now) {
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
  if (episode.sidestep.pending) checkSidestepWentAway();

  // How the last cruise ended is good for this one decision, whichever way
  // it goes. Left set past a turn, it described a heading the rover no
  // longer has: a side stop kept through a silent sweep's wander turned the
  // rover one more step away from where the obstacle used to be.
  const int sideStop = episode.sideStopDeg;
  const bool cappedCruise = episode.cruiseEndedByCap;
  episode.sideStopDeg = 0;
  episode.cruiseEndedByCap = false;

  // A working sonar hears something in a room -- a wall, a chair, the floor
  // at an angle. Hearing nothing sweep after sweep is what a disconnected or
  // dead sensor looks like, and every no-echo reads as open space.
  if (episode.silentSweeps >= params.silentSweepsToHalt) return halt(now, HALT_SENSOR_SILENT);

  // A sweep that heard nothing at all says nothing about the way ahead, so
  // it is never grounds to drive forward. Turn a little in place and look
  // again; a working sensor soon finds a wall, and a dead one halts above.
  if (!scan.heardEcho) return startTurn(now, wanderDirection(), params.wanderSteps, false);

  if (!pathBlocked(params.goCm)) {
    episode.waitForClearPath = false;
    // The small turns below are optional, so they are skipped where rotating
    // would swing a corner into a wall: in a corridor the rover drives on.
    if (roomToRotate()) {
      if (sideStop != 0) {
        // The last cruise ended on something the weave saw off to one side,
        // at an angle this sweep does not measure. Turn one step away from it
        // rather than drive straight back into it.
        return turnOrSidestep(now, sideStop > 0 ? -1 : +1, 1, false);
      }
      if (cappedCruise && params.wanderSteps > 0) {
        // Nothing stopped the last cruise. Turn a little anyway: it spreads
        // coverage, and bounds how long the rover can push against something
        // the sonar cannot see.
        return turnOrSidestep(now, wanderDirection(), params.wanderSteps, false);
      }
      const int veer = veerDirection();
      if (veer != 0) return turnOrSidestep(now, veer, 1, false);
    }
    episode.sidesteps = 0;
    return startCruise(now);
  }

  // After turning a full circle without finding a way out, only a path that
  // opens by itself resumes exploring; the rover does not spin again.
  if (episode.waitForClearPath) return halt(now, HALT_BOXED_IN);
  if (episode.committedDirection == 0) episode.committedDirection = chooseTurnDirection();
  if (scan.cm[FRONT] < params.minTurnClearCm && episode.reverseBudgetMs > 0) return startBackoff(now);
  return turnOrSidestep(now, episode.committedDirection, 0, true);
}

// ---------------------------------------------------------------------------
// Cruising
// ---------------------------------------------------------------------------

Explorer::Motion Explorer::startCruise(uint32_t now) {
  currentPhase = CRUISE;
  cruise = Cruise();
  cruise.start = now;
  aim(now, 0);

  const float front = scan.cm[FRONT];
  if (isEcho(front)) {
    cruise.lastFrontEchoCm = front;
    cruise.lastFrontEchoAt = now;
    cruise.hasStuckReference = true;
    cruise.stuckReferenceCm = front;
    cruise.stuckReferenceAt = now;
  }
  return motion(MOVE_FORWARD, params.cruiseLeaseMs);
}

Explorer::Motion Explorer::stepCruise(uint32_t now) {
  if (lasted(now, cruise.start, params.cruiseMaxMs)) {
    episode.cruiseEndedByCap = true;
    return endCruise(now);
  }
  if (!readyToPing(now)) return noMotion();

  const int angle = sonar.lookDeg;
  const float raw = ping(now);
  const float cm = kinematics::normalizeDistance(raw);

  // Looks that hear nothing at all never renew the lease for long: a sensor
  // that dies mid-cruise stops the rover within one weave, and the silent
  // sweeps that follow halt it.
  cruise.silentLooks = isEcho(cm) ? 0 : cruise.silentLooks + 1;
  if (cruise.silentLooks >= params.silentCruiseLooks) return endCruise(now);

  if (angle == 0) {
    scan.cm[FRONT] = cm;
    // An obstacle does not vanish as the rover closes on it. A near echo
    // that turns into silence was deflected away, not left behind.
    if (!isEcho(cm) && echoVanished(now)) return endCruise(now);
    if (isEcho(cm)) {
      if (notChanging(cm, now)) return escapeStuck(now);
      cruise.lastFrontEchoCm = cm;
      cruise.lastFrontEchoAt = now;
    }
  }

  if (inPath(angle, cm, params.stopCm)) {
    episode.sideStopDeg = angle;
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
  episode.reverseBudgetMs += static_cast<int32_t>(since(cruise.stuckReferenceAt, cruise.start));
  if (episode.consecutiveStucks < params.maxStuckMultiplier) episode.consecutiveStucks++;
  episode.escapeSteps = params.stuckTurnSteps * episode.consecutiveStucks;
  if (episode.committedDirection == 0) episode.committedDirection = alternateDirection();
  return startBackoff(now);
}

// ---------------------------------------------------------------------------
// Turning, backing off, sidestepping, halting
// ---------------------------------------------------------------------------

Explorer::Motion Explorer::turnOrSidestep(uint32_t now, int direction, int minSteps,
                                          bool untilClear) {
  const int away = sidestepDirection();
  if (away != 0) return startSidestep(now, away);
  return startTurn(now, direction, minSteps, untilClear);
}

Explorer::Motion Explorer::startTurn(uint32_t now, int direction, int minSteps, bool untilClear) {
  currentPhase = TURN;
  turn = Turn();
  turn.direction = direction != 0 ? direction : alternateDirection();
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
    if (motorsIdle && reached(now, phaseUntil)) {
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

Explorer::Motion Explorer::startBackoff(uint32_t now) {
  // Nothing watches behind the rover, so it only ever reverses over ground it
  // has just driven forward across, and never far.
  const int32_t budget = episode.reverseBudgetMs;
  const int32_t ms = budget < params.backoffMaxMs ? budget : params.backoffMaxMs;
  episode.reverseBudgetMs -= ms;
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
  check.fromBefore = lateralCm(check.from);
  check.otherBefore = lateralCm(check.from == LEFT ? RIGHT : LEFT);
  check.pending = true;

  return motion(direction * strafeSign > 0 ? MOVE_LEFT : MOVE_RIGHT, params.sidestepMs);
}

void Explorer::checkSidestepWentAway() {
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
    if (++strafeContradictions == 1) strafeSign = -strafeSign;
  }
}

Explorer::Motion Explorer::halt(uint32_t now, const char* reason) {
  currentPhase = HALTED;
  episode.haltWhy = reason;
  phaseUntil = now + params.haltRetryMs;
  aim(now, 0);
  return stopMotion();
}

Explorer::Motion Explorer::retryAfterHalt(uint32_t now) {
  episode.committedDirection = 0;
  episode.turnStepsCommitted = 0;
  return startSweep(now);
}

// ---------------------------------------------------------------------------
// Looking and measuring
// ---------------------------------------------------------------------------

void Explorer::aim(uint32_t now, int angleDeg) {
  int target = 90 + params.servoDegPerBearing * angleDeg;
  if (target < 0) target = 0;
  if (target > 180) target = 180;

  // Settle time grows with how far the servo swings; the first aim assumes
  // the worst case because nothing is known about where it points.
  const int travel = sonar.servoDeg < 0 ? 180 : abs(target - sonar.servoDeg);
  if (target != sonar.servoDeg) {
    scanner.aim(target);
    sonar.servoDeg = target;
  }
  sonar.readyAt = now + params.servoBaseMs + static_cast<uint32_t>(params.servoMsPerDeg * travel);
  sonar.lookDeg = angleDeg;
}

bool Explorer::readyToPing(uint32_t now) const {
  if (!reached(now, sonar.readyAt)) return false;
  return !sonar.hasPinged || lasted(now, sonar.lastPingAt, params.pingIntervalMs);
}

float Explorer::ping(uint32_t now) {
  const float raw = scanner.measureCm();
  sonar.lastPingAt = now;
  sonar.hasPinged = true;
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

// The rover-frame angle each sweep bearing measures, degrees, positive left.
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

// ---------------------------------------------------------------------------
// Reading the scan
// ---------------------------------------------------------------------------

// Is a return at this angle inside the rover's forward path, and nearer than
// the limit? Testing the path rather than the ray is what lets the rover
// enter a corridor whose walls are close at the sides but not in its way.
bool Explorer::inPath(int angleDeg, float cm, float limitCm) const {
  const float forward = cm * cosf(radians(angleDeg));
  const float lateral = fabsf(cm * sinf(radians(angleDeg)));
  return lateral <= params.halfWidthCm + params.pathMarginCm && forward <= limitCm;
}

bool Explorer::pathBlocked(float limitCm) const {
  return scan.cm[FRONT] <= limitCm ||
         inPath(angleOf(FRONT_LEFT), scan.cm[FRONT_LEFT], limitCm) ||
         inPath(angleOf(FRONT_RIGHT), scan.cm[FRONT_RIGHT], limitCm);
}

float Explorer::lateralCm(Bearing bearing) const {
  return fabsf(scan.cm[bearing] * sinf(radians(angleOf(bearing))));
}

// Room to rotate in place: both flanks clear of the corners' swing, or one
// tight flank a sidestep can clear first.
bool Explorer::roomToRotate() const {
  const bool flanksClear = lateralCm(LEFT) >= params.rotateClearanceCm &&
                           lateralCm(RIGHT) >= params.rotateClearanceCm;
  return flanksClear || sidestepDirection() != 0;
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
         !lasted(now, cruise.lastFrontEchoAt, params.suspectWindowMs);
}

// Stuck: a front echo that has not changed, either way, over a whole window
// of driving. Closing is progress; so is a reading that grew because the beam
// moved on to something farther (a chair leg passing out of the cone). Only
// a reading that stays put means the wheels are held.
bool Explorer::notChanging(float frontCm, uint32_t now) {
  if (!cruise.hasStuckReference) {
    cruise.hasStuckReference = true;
    cruise.stuckReferenceCm = frontCm;
    cruise.stuckReferenceAt = now;
    return false;
  }
  if (!lasted(now, cruise.stuckReferenceAt, params.stuckWindowMs)) return false;
  // Stuck: keep the reference, whose time escapeStuck() needs.
  if (fabsf(cruise.stuckReferenceCm - frontCm) < params.stuckProgressCm) return true;
  cruise.stuckReferenceCm = frontCm;
  cruise.stuckReferenceAt = now;
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

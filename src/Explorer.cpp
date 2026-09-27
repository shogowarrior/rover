#include "Explorer.h"

#include <math.h>
#include <stdlib.h>

#include "Kinematics.h"

namespace {

constexpr float PI_F = 3.14159265358979323846f;

const char* const HALT_BOXED_IN = "boxed in";
const char* const HALT_SENSOR_SILENT = "sensor silent";

// Wrap-safe time arithmetic for 32-bit millisecond clocks.
bool reached(uint32_t now, uint32_t deadline) { return static_cast<int32_t>(now - deadline) >= 0; }
int32_t elapsed(uint32_t now, uint32_t since) { return static_cast<int32_t>(now - since); }

bool isEcho(float cm) { return cm < kinematics::DISTANCE_FAR_CM; }

float radians(int degrees) { return degrees * PI_F / 180.0f; }

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
    scanCm[i] = kinematics::DISTANCE_FAR_CM;
    measured[i] = false;
  }
}

void Explorer::reset(uint32_t now) {
  committedDirection = 0;
  turnStepsCommitted = 0;
  escapeSteps = 0;
  consecutiveStucks = 0;
  sidesteps = 0;
  silentSweeps = 0;
  reverseBudgetMs = 0;
  cruiseEndedByCap = false;
  waitForClearPath = false;
  sidestepPending = false;
  haltWhy = nullptr;
  // strafeSign is kept: it describes the wiring, which a mode change does
  // not alter.
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
    case BACKOFF:
      if (!motorsIdle || !reached(now, phaseUntil)) return noMotion();
      return startTurn(now, committedDirection, takeEscapeSteps(), true);
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
    if (!measured[i]) return false;
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
  sweepLeftToRight = !sweepLeftToRight;
  sweepStep = 0;
  sweepHeardEcho = false;
  aim(now, bearingDeg(sweepBearing(0)));
  return stopMotion();
}

Explorer::Motion Explorer::stepSweep(uint32_t now, bool decideWhenDone) {
  if (!readyToPing(now)) return noMotion();

  record(sweepBearing(sweepStep), ping(now));
  if (++sweepStep < BEARING_COUNT) {
    aim(now, bearingDeg(sweepBearing(sweepStep)));
    return noMotion();
  }

  silentSweeps = sweepHeardEcho ? 0 : silentSweeps + 1;
  if (!decideWhenDone) {
    startSweep(now);
    return noMotion();
  }
  return decide(now);
}

Explorer::Motion Explorer::decide(uint32_t now) {
  if (sidestepPending) checkSidestepWentAway();

  // A working sonar hears something in a room -- a wall, a chair, the floor
  // at an angle. Hearing nothing sweep after sweep is what a disconnected or
  // dead sensor looks like, and every no-echo reads as open space.
  if (silentSweeps >= params.silentSweepsToHalt) return halt(now, HALT_SENSOR_SILENT);

  // A sweep that heard nothing at all says nothing about the way ahead, so
  // it is never grounds to drive forward. Turn a little in place and look
  // again; a working sensor soon finds a wall, and a dead one halts above.
  if (!sweepHeardEcho) {
    cruiseEndedByCap = false;
    return startTurn(now, wanderDirection(), params.wanderSteps, false);
  }

  if (!pathBlocked(params.goCm)) {
    waitForClearPath = false;
    if (cruiseEndedByCap && params.wanderSteps > 0) {
      // Nothing stopped the last cruise. Turn a little anyway: it spreads
      // coverage, and bounds how long the rover can push against something
      // the sonar cannot see.
      cruiseEndedByCap = false;
      return turnOrSidestep(now, wanderDirection(), params.wanderSteps, false);
    }
    const int veer = veerDirection();
    if (veer != 0) return turnOrSidestep(now, veer, 1, false);
    sidesteps = 0;
    return startCruise(now);
  }

  cruiseEndedByCap = false;
  // After turning a full circle without finding a way out, only a path that
  // opens by itself resumes exploring; the rover does not spin again.
  if (waitForClearPath) return halt(now, HALT_BOXED_IN);
  if (committedDirection == 0) committedDirection = chooseTurnDirection();
  if (scanCm[FRONT] < params.minTurnClearCm && reverseBudgetMs > 0) return startBackoff(now);
  return turnOrSidestep(now, committedDirection, takeEscapeSteps(), true);
}

// ---------------------------------------------------------------------------
// Cruising
// ---------------------------------------------------------------------------

Explorer::Motion Explorer::startCruise(uint32_t now) {
  currentPhase = CRUISE;
  cruiseStart = now;
  weaveStep = 0;
  aim(now, 0);

  const float front = scanCm[FRONT];
  lastFrontEchoCm = isEcho(front) ? front : -1;
  lastFrontEchoAt = now;
  hasStuckReference = isEcho(front);
  stuckReferenceCm = front;
  stuckReferenceAt = now;

  return motion(MOVE_FORWARD, params.cruiseLeaseMs);
}

Explorer::Motion Explorer::stepCruise(uint32_t now) {
  if (elapsed(now, cruiseStart) >= params.cruiseMaxMs) {
    cruiseEndedByCap = true;
    finishCruise(now);
    return startSweep(now);
  }
  if (!readyToPing(now)) return noMotion();

  const int bearing = lookBearing;
  const float raw = ping(now);
  const float cm = kinematics::normalizeDistance(raw);

  if (bearing == 0) {
    scanCm[FRONT] = cm;
    // An obstacle does not vanish as the rover closes on it. A near echo
    // that turns into silence was deflected away, not left behind.
    if (!isEcho(cm) && echoVanished(now)) {
      finishCruise(now);
      return startSweep(now);
    }
    if (isEcho(cm)) {
      if (notClosing(cm, now)) return escapeStuck(now);
      lastFrontEchoCm = cm;
      lastFrontEchoAt = now;
    }
  }

  if (inPath(bearing, cm, params.stopCm)) {
    finishCruise(now);
    return startSweep(now);
  }

  const int weave[4] = {0, params.weaveDeg, 0, -params.weaveDeg};
  weaveStep = (weaveStep + 1) % 4;
  aim(now, weave[weaveStep]);
  return motion(MOVE_FORWARD, params.cruiseLeaseMs);  // a clear look renews the lease
}

void Explorer::finishCruise(uint32_t now) {
  const int32_t ran = elapsed(now, cruiseStart);
  reverseBudgetMs += ran;
  if (ran >= params.commitReleaseMs) {
    // A real stretch of open floor: the corner is behind the rover now.
    committedDirection = 0;
    turnStepsCommitted = 0;
    consecutiveStucks = 0;
  }
}

Explorer::Motion Explorer::escapeStuck(uint32_t now) {
  // The sonar says clear but the rover is not getting closer: something
  // below the beam is holding it. Back off and turn well clear, further each
  // time in a row. Not finishCruise(): time spent pushing against something
  // is not open floor, so it must not release the turn direction or reset
  // the count -- that made the rover ping-pong at a wide low obstacle.
  reverseBudgetMs += elapsed(now, cruiseStart);
  if (consecutiveStucks < 4) consecutiveStucks++;
  escapeSteps = params.stuckTurnSteps * consecutiveStucks;
  if (committedDirection == 0) committedDirection = alternateDirection();
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
  turnDirection = direction != 0 ? direction : alternateDirection();
  stepsThisTurn = 0;
  minTurnSteps = minSteps;
  turnUntilClear = untilClear;
  reverseBudgetMs = 0;  // the heading changes: the ground behind is unknown
  return rotateStep(now);
}

Explorer::Motion Explorer::rotateStep(uint32_t now) {
  if (turnUntilClear && ++turnStepsCommitted > params.maxTurnSteps) {
    waitForClearPath = true;
    return halt(now, HALT_BOXED_IN);
  }
  stepsThisTurn++;
  clearLooks = 0;
  turnStage = ROTATING;
  phaseUntil = now + params.turnStepMs;
  aim(now, 0);
  return motion(turnDirection > 0 ? ROTATE_COUNTERCLOCKWISE : ROTATE_CLOCKWISE,
                params.turnStepMs);
}

Explorer::Motion Explorer::stepTurn(uint32_t now, bool motorsIdle) {
  if (turnStage == ROTATING) {
    if (motorsIdle && reached(now, phaseUntil)) {
      turnStage = SETTLING;
      phaseUntil = now + params.turnSettleMs;
    }
    return noMotion();
  }
  if (turnStage == SETTLING) {
    if (!reached(now, phaseUntil)) return noMotion();
    turnStage = LOOKING;
  }
  if (!readyToPing(now)) return noMotion();

  const float front = kinematics::normalizeDistance(ping(now));
  scanCm[FRONT] = front;

  if (stepsThisTurn < minTurnSteps) return rotateStep(now);
  if (!turnUntilClear) return startSweep(now);
  if (front <= params.goCm) return rotateStep(now);
  // Clear ahead. Look once more to be sure, then sweep the whole way ahead
  // before moving: the front beam alone misses what is off to either side.
  if (++clearLooks < 2) return noMotion();
  return startSweep(now);
}

Explorer::Motion Explorer::startBackoff(uint32_t now) {
  // Nothing watches behind the rover, so it only ever reverses over ground it
  // has just driven forward across, and never far.
  const int32_t ms = reverseBudgetMs < params.backoffMaxMs ? reverseBudgetMs : params.backoffMaxMs;
  reverseBudgetMs -= ms;
  currentPhase = BACKOFF;
  phaseUntil = now + static_cast<uint32_t>(ms);
  return ms > 0 ? motion(MOVE_BACKWARD, static_cast<int>(ms)) : stopMotion();
}

Explorer::Motion Explorer::startSidestep(uint32_t now, int direction) {
  currentPhase = SIDESTEP;
  phaseUntil = now + params.sidestepMs;
  sidesteps++;
  reverseBudgetMs = 0;

  sidestepFrom = direction > 0 ? RIGHT : LEFT;
  sidestepFromBefore = lateralCm(sidestepFrom);
  sidestepOtherBefore = lateralCm(sidestepFrom == LEFT ? RIGHT : LEFT);
  sidestepPending = true;

  return motion(direction * strafeSign > 0 ? MOVE_LEFT : MOVE_RIGHT, params.sidestepMs);
}

void Explorer::checkSidestepWentAway() {
  sidestepPending = false;
  const Bearing other = sidestepFrom == LEFT ? RIGHT : LEFT;
  // Only real echoes say anything about where the rover went.
  if (!isEcho(scanCm[sidestepFrom]) || !isEcho(scanCm[other])) return;

  const float fromChange = lateralCm(sidestepFrom) - sidestepFromBefore;
  const float otherChange = lateralCm(other) - sidestepOtherBefore;
  // Both flanks moved the wrong way. A rover pinned against the wall moves
  // neither, so being stuck is never mistaken for a mirrored mapping.
  if (fromChange < -1.0f && otherChange > 1.0f) {
    if (++strafeContradictions == 1) {
      strafeSign = -strafeSign;
    }
  }
}

Explorer::Motion Explorer::halt(uint32_t now, const char* reason) {
  currentPhase = HALTED;
  haltWhy = reason;
  phaseUntil = now + params.haltRetryMs;
  aim(now, 0);
  return stopMotion();
}

Explorer::Motion Explorer::retryAfterHalt(uint32_t now) {
  committedDirection = 0;
  turnStepsCommitted = 0;
  return startSweep(now);
}

// ---------------------------------------------------------------------------
// Looking and measuring
// ---------------------------------------------------------------------------

void Explorer::aim(uint32_t now, int bearing) {
  int deg = 90 + params.servoDegPerBearing * bearing;
  if (deg < 0) deg = 0;
  if (deg > 180) deg = 180;

  // Settle time grows with how far the servo swings; the first aim assumes
  // the worst case because nothing is known about where it points.
  const int travel = servoDeg < 0 ? 180 : abs(deg - servoDeg);
  if (deg != servoDeg) {
    scanner.aim(deg);
    servoDeg = deg;
  }
  servoReadyAt = now + params.servoBaseMs + static_cast<uint32_t>(params.servoMsPerDeg * travel);
  lookBearing = bearing;
}

bool Explorer::readyToPing(uint32_t now) const {
  if (!reached(now, servoReadyAt)) return false;
  return !hasPinged || elapsed(now, lastPingAt) >= params.pingIntervalMs;
}

float Explorer::ping(uint32_t now) {
  const float raw = scanner.measureCm();
  lastPingAt = now;
  hasPinged = true;
  return raw;
}

void Explorer::record(Bearing bearing, float rawCm) {
  scanCm[bearing] = kinematics::normalizeDistance(rawCm);
  measured[bearing] = true;
  if (rawCm >= 0.0f) sweepHeardEcho = true;
}

Explorer::Bearing Explorer::sweepBearing(int step) const {
  return static_cast<Bearing>(sweepLeftToRight ? step : BEARING_COUNT - 1 - step);
}

int Explorer::bearingDeg(Bearing bearing) const {
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

// Is a return at this bearing inside the rover's forward path, and nearer
// than the limit? Testing the path rather than the ray is what lets the rover
// enter a corridor whose walls are close at the sides but not in its way.
bool Explorer::inPath(int bearing, float cm, float limitCm) const {
  const float forward = cm * cosf(radians(bearing));
  const float lateral = fabsf(cm * sinf(radians(bearing)));
  return lateral <= params.halfWidthCm + params.pathMarginCm && forward <= limitCm;
}

bool Explorer::pathBlocked(float limitCm) const {
  return scanCm[FRONT] <= limitCm ||
         inPath(bearingDeg(FRONT_LEFT), scanCm[FRONT_LEFT], limitCm) ||
         inPath(bearingDeg(FRONT_RIGHT), scanCm[FRONT_RIGHT], limitCm);
}

float Explorer::lateralCm(Bearing bearing) const {
  return fabsf(scanCm[bearing] * sinf(radians(bearingDeg(bearing))));
}

// +1 to turn left, -1 to turn right: whichever side has more open space.
// Distances are capped so one far reading cannot outvote a nearer wall.
int Explorer::chooseTurnDirection() {
  const float cap = 150.0f;
  const float left = fminf(scanCm[LEFT], cap) + fminf(scanCm[FRONT_LEFT], cap);
  const float right = fminf(scanCm[RIGHT], cap) + fminf(scanCm[FRONT_RIGHT], cap);
  if (fabsf(left - right) < 5.0f) return alternateDirection();
  return left > right ? +1 : -1;
}

// Front clear but converging on a wall at one side: one small turn away.
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
  if (sidesteps >= params.maxSidesteps || strafeContradictions >= 2) return 0;
  const bool tightLeft = lateralCm(LEFT) < params.rotateClearanceCm;
  const bool tightRight = lateralCm(RIGHT) < params.rotateClearanceCm;
  if (tightLeft == tightRight) return 0;
  const float otherSide = tightLeft ? lateralCm(RIGHT) : lateralCm(LEFT);
  if (otherSide < params.rotateClearanceCm + 5.0f) return 0;
  return tightLeft ? -1 : +1;
}

bool Explorer::echoVanished(uint32_t now) const {
  return lastFrontEchoCm >= 0.0f && lastFrontEchoCm < params.suspectNearCm &&
         elapsed(now, lastFrontEchoAt) < params.suspectWindowMs;
}

bool Explorer::notClosing(float frontCm, uint32_t now) {
  if (!hasStuckReference) {
    hasStuckReference = true;
    stuckReferenceCm = frontCm;
    stuckReferenceAt = now;
    return false;
  }
  if (elapsed(now, stuckReferenceAt) < params.stuckWindowMs) return false;
  const bool stuck = stuckReferenceCm - frontCm < params.stuckProgressCm;
  stuckReferenceCm = frontCm;
  stuckReferenceAt = now;
  return stuck;
}

// The minimum length of the next avoidance turn, used up by that turn.
int Explorer::takeEscapeSteps() {
  const int steps = escapeSteps;
  escapeSteps = 0;
  return steps;
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

#ifndef EXPLORER_H
#define EXPLORER_H

#include <stdint.h>

#include "Hardware.h"
#include "MoveCodes.h"
#include "Tuning.h"

// Autonomous exploration: where to look, when to measure, and which way to go.
//
// Pure logic, like Kinematics: no Arduino calls, time arrives as `now`, the
// sonar is reached through the RangeScanner interface, and motion leaves as a
// request that Rover carries out (clamped, released by deadline, and only in
// autonomous mode). Host-tested in test/test_explorer.
//
// The behaviour in brief:
//   SWEEP     Stand still and measure five bearings (left, front-left, front,
//             front-right, right), sweeping back and forth.
//   CRUISE    If the way ahead is clear, drive forward on a short lease that
//             only a clear ping renews, while the servo keeps looking ahead
//             and slightly to each side. Anything in the rover's path, an echo
//             that vanishes as the rover closes on it, a front reading that
//             stops changing (wheels stuck below the beam), or a run of looks
//             that hear nothing at all ends the cruise.
//   TURN      If the way is blocked, rotate toward the more open side in short
//             steps, measuring after each, and keep turning that way until the
//             front is clear. Committing to one direction is what stops the
//             rover dithering in corners.
//   BACKOFF   Reverse a little first if the front is too close to rotate, but
//             only over ground just driven forward: nothing watches behind.
//             At a dead end too narrow to rotate in, back out the way it came
//             a step at a time, sweeping after each, until the flanks have
//             room or that ground runs out, and only then turn.
//   SIDESTEP  Strafe away from a flank that is too close to rotate beside.
//   HALTED    Stop and retry every few seconds when a full circle of turning
//             finds no way out, or three sweeps in a row hear nothing at all
//             (the signature of a dead sensor). A sweep that heard nothing is
//             never grounds to drive forward: the rover only turns in place
//             to look again -- or, backing out of a dead end where it may not
//             turn, stands still to look again.

struct ExploreParams {
  // Distances are measured from the sensor. Hysteresis on the rover's path:
  // a cruise stops when anything in the path is within stopCm and starts
  // only when the path is clear beyond goCm, so a reading hovering near one
  // threshold cannot flip the rover between cruising and turning. The path
  // is the chassis width plus pathMarginCm, wherever a bearing sees into it.
  float stopCm = tuning::EXPLORE_STOP_CM;
  float goCm = tuning::EXPLORE_GO_CM;
  float minTurnClearCm = 8;      // closer than this ahead: back off before rotating
  float halfWidthCm = 8;         // half the 160 mm chassis
  float pathMarginCm = 4;        // clearance kept each side of the rover's path
  float sideMarginCm = 4;        // a flank within halfWidth + this: veer away
  float rotateClearanceCm = 16;  // rotating in place swings the corners ~15 cm out

  // Sweep angles are 0, +-inner and +-outer degrees from straight ahead
  // (positive is the rover's left). Cruise looks at 0, +weave, 0, -weave.
  // The panel's scan fan (extras/joystick) and drive.py's labels are drawn at
  // the sweep angles; tools/check_protocol.py checks those copies.
  int sweepOuterDeg = 70;
  int sweepInnerDeg = 35;
  int weaveDeg = 25;
  // servo degrees = 90 + servoDegPerBearing x angle. -1 means servo 20
  // points left and 160 right, as the scanner is mounted today. If a hand at
  // the rover's left moves "distanceRight" on the panel, make this +1.
  int servoDegPerBearing = -1;
  // These three are copied by the panel's simulator (SimSonar.TIMING in
  // extras/joystick/js/sim.js), so its preview's readings lag as the rover's
  // do; test/sim.test.js checks the copy.
  int servoBaseMs = 60;          // settle after a servo move: base + perDeg x travel
  float servoMsPerDeg = 2.5f;    // an SG90 needs ~1.7 unloaded; margin for load and sag
  int pingIntervalMs = 70;       // HC-SR04: at least 60 ms between pings

  int cruiseLeaseMs = 400;       // forward runs this long unless a clear ping renews it
  int cruiseMaxMs = 2500;        // then stop and sweep anyway, and wander a little
  int silentCruiseLooks = 4;     // looks in a row with no echo (one weave) end a cruise
  int wanderSteps = 2;           // turn steps after a cruise ends that way
  int turnStepMs = 200;          // one rotation step; its angle is never assumed
  int turnSettleMs = 120;        // let the chassis stop before measuring
  int maxTurnSteps = 30;         // more than a full circle at any plausible rate
  float turnCompareCapCm = 150;  // choosing a side: farther reads as this, so one
                                 //   far echo cannot outvote a nearer wall
  float turnTieCm = 5;           // sides within this of each other: alternate
  int commitReleaseMs = 1500;    // a cruise this long forgets the turn direction
  int backoffMaxMs = 300;
  int sidestepMs = 250;
  int maxSidesteps = 2;          // in a row, without a cruise between
  float sidestepRoomMarginCm = 5;  // the other flank must clear rotateClearanceCm by this
  int stuckWindowMs = 1000;      // a front echo that has not changed by
  float stuckProgressCm = 3;     //   this much in this long means stuck
  int stuckTurnSteps = 4;        // minimum escape turn, times consecutive stucks...
  int maxStuckMultiplier = 4;    //   counted up to this. Keep the product within
                                 //   maxTurnSteps, or one escape halts boxed in
  float suspectNearCm = 60;      // an echo this close that vanishes within
  int suspectWindowMs = 1000;    //   this long is a deflection, not open space
  int silentSweepsToHalt = 3;    // sweeps in a row with no echo at all
  int haltRetryMs = 5000;
};

class Explorer {
 public:
  enum Phase { SWEEP, CRUISE, TURN, BACKOFF, SIDESTEP, HALTED };

  // The five sweep bearings, left to right.
  enum Bearing { LEFT, FRONT_LEFT, FRONT, FRONT_RIGHT, RIGHT, BEARING_COUNT };

  // What the explorer wants the wheels to do. Nothing when !requested.
  struct Motion {
    bool requested = false;
    MoveCode move = STOP;
    int durationMs = 0;
  };

  explicit Explorer(RangeScanner& scanner, const ExploreParams& params = ExploreParams());

  // Start over from a fresh sweep, forgetting everything this stretch of
  // exploring had learned (turn commitments, counters, a halt).
  void reset(uint32_t now);

  // One non-blocking step of exploration. `motorsIdle` is true once the last
  // requested motion has ended.
  Motion update(uint32_t now, bool motorsIdle);

  // Keep sweeping and measuring without ever asking to move. Manual mode runs
  // this so the telemetry stays live while a person drives.
  void survey(uint32_t now);

  Phase phase() const { return currentPhase; }
  const char* phaseName() const;
  const char* haltReason() const { return currentPhase == HALTED ? episode.haltWhy : nullptr; }

  // True once every bearing has been measured at least once.
  bool hasScan() const;
  // Latest distance at a bearing, normalised (no echo = DISTANCE_FAR_CM).
  float distanceCm(Bearing bearing) const { return scan.cm[bearing]; }

 private:
  enum TurnStage { ROTATING, SETTLING, LOOKING };

  // Where the servo points and when the sonar may next ping. Describes the
  // hardware, so it survives reset().
  struct Sonar {
    int servoDeg = -1;  // last commanded, -1 until the first aim
    int lookDeg = 0;    // rover-frame angle the next ping measures
    uint32_t readyAt = 0;
    uint32_t lastPingAt = 0;
    bool hasPinged = false;
  };

  // The latest reading at each bearing. Survives reset(), so the telemetry
  // never goes blank on a mode change.
  struct Scan {
    float cm[BEARING_COUNT];
    bool measured[BEARING_COUNT];
    int step = 0;
    bool leftToRight = false;  // flipped before every sweep
    bool heardEcho = false;    // anything at all, this sweep
  };

  // A sidestep awaiting its check by the next sweep.
  struct SidestepCheck {
    bool pending = false;
    Bearing from = LEFT;  // the tight flank it stepped away from
    float fromBefore = 0;
    float otherBefore = 0;
  };

  // What one stretch of exploring has learned. reset() replaces it whole.
  struct Episode {
    int committedDirection = 0;  // 0 none, +1 left (counter-clockwise), -1 right
    int turnStepsCommitted = 0;  // avoidance steps since the rover last drove
    int escapeSteps = 0;         // minimum turn after a stuck backoff
    int consecutiveStucks = 0;
    int sidesteps = 0;           // in a row, without a cruise between
    int silentSweeps = 0;        // in a row
    int32_t reverseBudgetMs = 0; // forward driving since the heading last changed
    bool backingOut = false;     // reversing out of a dead end too narrow to rotate in
    // How the last cruise ended. decide() reads both once and clears them.
    bool cruiseEndedByCap = false;
    int sideStopDeg = 0;         // weave angle whose echo ended the last cruise, 0 if none
    bool waitForClearPath = false;
    const char* haltWhy = nullptr;
    SidestepCheck sidestep;
  };

  // One cruise. startCruise() replaces it whole.
  struct Cruise {
    uint32_t start = 0;
    int weaveStep = 0;
    int silentLooks = 0;
    float lastFrontEchoCm = -1;  // -1: none yet
    uint32_t lastFrontEchoAt = 0;
    bool hasStuckReference = false;
    float stuckReferenceCm = 0;
    uint32_t stuckReferenceAt = 0;

    void sawFront(float cm, uint32_t now) {
      lastFrontEchoCm = cm;
      lastFrontEchoAt = now;
    }
    // The stuck window starts over from this front reading.
    void restartStuckWindow(float cm, uint32_t now) {
      hasStuckReference = true;
      stuckReferenceCm = cm;
      stuckReferenceAt = now;
    }
  };

  // One turn. startTurn() replaces it whole.
  struct Turn {
    TurnStage stage = ROTATING;
    int direction = 0;  // +1 counter-clockwise (left), -1 clockwise (right)
    int steps = 0;
    int minSteps = 0;
    bool untilClear = false;
    int clearLooks = 0;
  };

  // Phase transitions. Each returns the motion that goes with entering it.
  Motion startSweep(uint32_t now);
  Motion decide(uint32_t now);
  Motion startCruise(uint32_t now);
  // `direction` is +1 (left, counter-clockwise) or -1 (right), never 0.
  Motion startTurn(uint32_t now, int direction, int minSteps, bool untilClear);
  Motion turnOrSidestep(uint32_t now, int direction, int minSteps, bool untilClear);
  Motion startSidestep(uint32_t now, int direction);
  Motion startBackoff(uint32_t now);
  Motion escapeStuck(uint32_t now);
  Motion halt(uint32_t now, const char* reason);
  Motion retryAfterHalt(uint32_t now);
  Motion rotateStep(uint32_t now);
  Motion endCruise(uint32_t now);

  // Per-phase steps.
  Motion stepSweep(uint32_t now, bool decideWhenDone);
  Motion stepCruise(uint32_t now);
  Motion stepTurn(uint32_t now, bool motorsIdle);
  // A backoff, a sidestep or a rotation step is over: the wheels have stopped
  // and its time is up.
  bool motionDone(uint32_t now, bool motorsIdle) const;

  // Looking and measuring.
  void aim(uint32_t now, int angleDeg);
  bool readyToPing(uint32_t now) const;
  float ping(uint32_t now);
  void record(Bearing bearing, float rawCm);
  Bearing sweepBearing(int step) const;
  int angleOf(Bearing bearing) const;

  // Reading the scan.
  bool inPath(int angleDeg, float cm, float limitCm) const;
  bool pathBlocked(float limitCm) const;
  float lateralCm(Bearing bearing) const;
  bool roomToRotate() const;
  int commitTurnDirection();
  int chooseTurnDirection();
  int veerDirection() const;
  int sidestepDirection() const;
  void checkSidestepWentAway();
  bool echoVanished(uint32_t now) const;
  bool notChanging(float frontCm, uint32_t now);
  int alternateDirection();
  int wanderDirection();

  RangeScanner& scanner;
  const ExploreParams params;

  Phase currentPhase = SWEEP;
  uint32_t phaseUntil = 0;

  Sonar sonar;
  Scan scan;
  Episode episode;
  Cruise cruise;
  Turn turn;

  // Learned about the robot itself, so kept across reset(). Whether MOVE_LEFT
  // carries the rover toward what the scanner calls left depends on how the
  // servo and the wheels are wired, neither of which is verified, and
  // strafing the wrong way pins the rover against the very wall it meant to
  // leave. So each sidestep is checked by the next sweep: if the flank it
  // stepped away from came closer and the other side opened up, strafeSign
  // flips. A second contradiction switches sidestepping off.
  int strafeSign = +1;
  int strafeContradictions = 0;
  bool preferLeft = true;  // tie-breaker, alternates
  uint32_t wanderSeed = 1;
};

#endif

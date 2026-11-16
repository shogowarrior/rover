#include "SelfTest.h"

#include "Kinematics.h"
#include "Timing.h"
#include "Tuning.h"

namespace {

const int PINGS_PER_BEARING = 3;

struct SonarStep {
  Explorer::Bearing bearing;
  const char* name;   // telemetry's "check"
  const char* where;  // in the log's line
};

const SonarStep SONAR_STEPS[] = {
    {Explorer::LEFT, "sonar L", "left"},
    {Explorer::FRONT_LEFT, "sonar FL", "front-left"},
    {Explorer::FRONT, "sonar F", "ahead"},
    {Explorer::FRONT_RIGHT, "sonar FR", "front-right"},
    {Explorer::RIGHT, "sonar R", "right"},
};
const int SONAR_STEP_COUNT = sizeof(SONAR_STEPS) / sizeof(SONAR_STEPS[0]);

struct DriveStep {
  const char* name;  // telemetry's "check"
  MoveCode move;     // STOP: `wheel` alone, forward
  Wheel wheel;
  int speed;
  const char* say;   // the log's line as it starts
};

const DriveStep DRIVE_STEPS[] = {
    {"wheel FL", STOP, WHEEL_FRONT_LEFT, tuning::CHECK_SPEED, "Front-left wheel alone, forward: is it that wheel, turning forward?"},
    {"wheel FR", STOP, WHEEL_FRONT_RIGHT, tuning::CHECK_SPEED, "Front-right wheel alone, forward: is it that wheel, turning forward?"},
    {"wheel RR", STOP, WHEEL_REAR_RIGHT, tuning::CHECK_SPEED, "Rear-right wheel alone, forward: is it that wheel, turning forward?"},
    {"wheel RL", STOP, WHEEL_REAR_LEFT, tuning::CHECK_SPEED, "Rear-left wheel alone, forward: is it that wheel, turning forward?"},
    {"forward slow", MOVE_FORWARD, WHEEL_COUNT, tuning::EXPLORE_SPEED, "All four forward at the explore speed: do all four turn?"},
    {"forward", MOVE_FORWARD, WHEEL_COUNT, tuning::CHECK_SPEED, "All four forward"},
    {"strafe right", MOVE_RIGHT, WHEEL_COUNT, tuning::CHECK_SPEED, "Strafe right: compare each wheel with docs/mecanum.md"},
    {"rotate cw", ROTATE_CLOCKWISE, WHEEL_COUNT, tuning::CHECK_SPEED, "Rotate clockwise: compare each wheel with docs/mecanum.md"},
};
const int STEP_COUNT = SONAR_STEP_COUNT + sizeof(DRIVE_STEPS) / sizeof(DRIVE_STEPS[0]);

}  // namespace

void SelfTest::start(uint32_t now, bool motorsReady, bool wheels) {
  this->motorsReady = motorsReady;
  this->wheels = wheels;
  sonarSamples = 0;
  sonarHeard = 0;
  log.add(now, EventLog::INFO,
          wheels ? "Checks: the sonar at each bearing, then each wheel and four moves"
                 : "Checks: the sonar at each bearing; no wheel turns");
  if (motorsReady) {
    log.add(now, EventLog::INFO, "Motor shield: answered at boot");
  } else {
    log.add(now, EventLog::WARN, "Motor shield: did not answer at boot, so no wheel will turn");
  }
  step = -1;
  next(now);
}

bool SelfTest::press(uint32_t now, bool motorsReady) {
  if (held(now)) {
    pressedAt = now;  // held: the run goes on, or has ended and stays ended
    return false;
  }
  cancel(now, "started again");
  pressed = true;
  pressedAt = now;
  start(now, motorsReady, true);
  return true;
}

// The hold stays: a STOP from anyone ends the run, and its controller's
// re-sends, still coming, must not start it again. They did once, and the
// panel, which lets go of the checks only when a frame shows them over,
// mostly missed the 200 ms gap and held the new run: the wheels turned again.
void SelfTest::cancel(uint32_t now, const char* why) {
  if (!running()) return;
  step = -1;
  log.add(now, EventLog::INFO, "Checks stopped: %s", why);
}

const char* SelfTest::stepName() const {
  if (!running()) return nullptr;
  return step < SONAR_STEP_COUNT ? SONAR_STEPS[step].name : DRIVE_STEPS[step - SONAR_STEP_COUNT].name;
}

bool SelfTest::held(uint32_t now) const {
  return pressed && timing::ageOf(now, pressedAt) < tuning::CHECK_HOLD_MS;
}

SelfTest::Action SelfTest::update(uint32_t now, bool motorsIdle) {
  if (!held(now)) pressed = false;  // forgotten, so never fresh again ~49.7 days on
  if (!running()) return Action();
  return step < SONAR_STEP_COUNT ? stepSonar(now) : stepDrive(now, motorsIdle);
}

// Counts only pings made at this step's bearing since it began: the first
// pass takes Explorer's count as it stands, and a ping still aimed at the
// previous bearing is not this one's.
SelfTest::Action SelfTest::stepSonar(uint32_t now) {
  const SonarStep& sonar = SONAR_STEPS[step];
  const int angle = explorer.angleOf(sonar.bearing);
  const Explorer::Look& look = explorer.lastLook();
  const uint32_t pings = explorer.pingCount();
  if (primed && pings != seenPings && look.valid && look.angleDeg == angle) {
    samples++;
    if (look.cm < kinematics::DISTANCE_FAR_CM) {
      if (heard == 0 || look.cm < nearestCm) nearestCm = look.cm;
      heard++;
    }
  }
  primed = true;
  seenPings = pings;

  Action action;
  action.look = true;
  action.lookDeg = angle;
  if (samples < PINGS_PER_BEARING) return action;

  if (heard > 0) {
    log.add(now, EventLog::INFO, "Sonar %s: %d of %d pings heard an echo, the nearest %.0f cm", sonar.where,
            heard, samples, nearestCm);
  } else {
    log.add(now, EventLog::WARN, "Sonar %s: none of %d pings heard an echo", sonar.where, samples);
  }
  sonarSamples += samples;
  sonarHeard += heard;
  next(now);
  return action;
}

SelfTest::Action SelfTest::stepDrive(uint32_t now, bool motorsIdle) {
  const DriveStep& drive = DRIVE_STEPS[step - SONAR_STEP_COUNT];
  Action action;
  if (!sent) {
    // Every wheel stands still here: no step turns one unless held.
    if (!held(now)) {
      step = -1;
      log.add(now, EventLog::WARN, "Checks stopped: no RUN_CHECKS for %u ms, so no wheel turns",
              static_cast<unsigned>(tuning::CHECK_HOLD_MS));
      return action;
    }
    sent = true;
    log.add(now, EventLog::INFO, "%s", drive.say);
    action.drive = drive.move == STOP ? &wheelAlone(drive.wheel) : findMovePattern(drive.move);
    action.speed = drive.speed;
    action.durationMs = tuning::CHECK_DRIVE_MS;
    return action;
  }
  if (!motorsIdle) return action;
  if (!resting) {
    resting = true;
    restUntil = now + tuning::CHECK_REST_MS;
  }
  if (timing::reached(now, restUntil)) next(now);
  return action;
}

// On to the next step, or the end: the wheels' steps only with a shield
// that answered.
void SelfTest::next(uint32_t now) {
  step++;
  primed = false;
  samples = 0;
  heard = 0;
  sent = false;
  resting = false;
  if (step == SONAR_STEP_COUNT && !wheels) {
    finish(now);
  } else if (step == SONAR_STEP_COUNT && !motorsReady) {
    log.add(now, EventLog::WARN, "Wheels not checked: the motor shield did not answer");
    finish(now);
  } else if (step == STEP_COUNT) {
    finish(now);
  }
}

void SelfTest::finish(uint32_t now) {
  step = -1;
  const EventLog::Level level = motorsReady && sonarHeard > 0 ? EventLog::INFO : EventLog::WARN;
  log.add(now, level, "Checks done: motor shield %s; the sonar heard %d of %d pings",
          motorsReady ? "answered" : "missing", sonarHeard, sonarSamples);
}

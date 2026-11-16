#include "Rover.h"

#include "Kinematics.h"
#include "MovePatterns.h"
#include "Timing.h"
#include "Tuning.h"

using timing::elapsed;
using timing::reached;

Rover::Rover(Motors& motors, RangeScanner& scanner, const Settings& settings, EventLog& log)
    : motors(motors), settings(settings), log(log), explorer(scanner, log), selfTest(explorer, log) {}

void Rover::begin(Mode initialMode, uint32_t now) { restart(initialMode, now); }

void Rover::update(uint32_t now) {
  if (moving && reached(now, moveDeadline)) release(now);
  servicePendingRelease(now);

  // In either mode, so that a lapsed hold on the checks is forgotten. They
  // run only in manual mode (every way into exploring ends them), so
  // exploring gets nothing from it.
  const SelfTest::Action check = selfTest.update(now, !moving);
  if (currentMode == MODE_AUTONOMOUS) {
    const Explorer::Motion motion = explorer.update(now, !moving);
    if (motion.requested) drive(motion.move, tuning::EXPLORE_SPEED, motion.durationMs, now);
    return;
  }
  if (check.look) {
    explorer.survey(now, Explorer::SONAR_AIM, check.lookDeg);
  } else {
    explorer.survey(now, settings.sonar(), settings.aimDeg());
  }
  if (check.drive != nullptr) drive(*check.drive, check.speed, check.durationMs, now);
}

void Rover::command(int move, int speed, int durationMs, uint32_t now) {
  // RUN_CHECKS starts the checks, from still wheels, or, re-sent, holds
  // them (SelfTest.h).
  if (move == RUN_CHECKS) {
    setMode(MODE_MANUAL, now, "Manual: a command took control");
    if (selfTest.press(now, motors.ready())) release(now);
    return;
  }
  // Any other command ends the checks: STOP above all.
  selfTest.cancel(now, "a command took control");
  // The one command that gives control back. On a halted explorer it starts
  // over: the operator is saying the way is open now.
  if (move == RESUME_AUTONOMOUS) {
    if (currentMode == MODE_AUTONOMOUS) {
      if (explorer.phase() == Explorer::HALTED) {
        log.add(now, EventLog::INFO, "Exploring again, from a fresh sweep");
        restart(MODE_AUTONOMOUS, now);
      }
      return;
    }
    setMode(MODE_AUTONOMOUS, now, "Autonomous: exploring from a fresh sweep");
    return;
  }

  setMode(MODE_MANUAL, now, "Manual: a command took control");
  if (!isMoveCode(move)) {
    // An instruction we cannot read, from a client we do not control.
    // Stopping is the only safe interpretation.
    log.add(now, EventLog::WARN, "Unknown move code %d: stopped", move);
    release(now);
    return;
  }
  drive(static_cast<MoveCode>(move), speed, durationMs, now);
}

void Rover::checksRefused(uint32_t now) { selfTest.renew(now); }

void Rover::stop(uint32_t now) {
  selfTest.cancel(now, "the driver disconnected");
  release(now);
}

void Rover::standDown(uint32_t now, const char* why) {
  log.add(now, EventLog::WARN, "Stood down: %s", why);
  selfTest.cancel(now, why);
  release(now);
  setMode(MODE_MANUAL, now, nullptr);
}

void Rover::checkWithoutWheels(uint32_t now) {
  if (currentMode != MODE_MANUAL) return;
  selfTest.start(now, motors.ready(), false);
}

void Rover::servicePendingRelease(uint32_t now) {
  if (!releasePending || !elapsed(now, releasedAt, tuning::MOTOR_REFRESH_MS)) return;
  releasePending = false;
  motors.release();
}

Rover::Status Rover::status() const {
  Status status;
  const bool exploring = currentMode == MODE_AUTONOMOUS;
  status.mode = currentMode;
  status.move = moving ? currentPattern->move : STOP;
  status.moving = moving;
  status.phase = exploring ? explorer.phaseName() : nullptr;
  status.haltReason = exploring ? explorer.haltReason() : nullptr;
  status.hasScan = explorer.hasScan();
  for (int i = 0; i < Explorer::BEARING_COUNT; i++) {
    status.scanCm[i] = explorer.distanceCm(static_cast<Explorer::Bearing>(i));
  }
  status.motorsReady = motors.ready();
  status.sonar = settings.sonar();
  status.aimDeg = settings.aimDeg();
  const Explorer::Look& look = explorer.lastLook();
  // Only while it aims there: a sweep, exploring's or manual's, also
  // passes through whatever angle aimDeg holds.
  status.hasAimCm =
      !exploring && status.sonar == Explorer::SONAR_AIM && look.valid && look.angleDeg == status.aimDeg;
  status.aimCm = look.cm;
  status.check = selfTest.stepName();
  status.pings = explorer.pingCount();
  status.silentPings = explorer.silentPingCount();
  return status;
}

void Rover::restart(Mode mode, uint32_t now) {
  currentMode = mode;
  release(now);
  explorer.reset(now);
}

void Rover::setMode(Mode mode, uint32_t now, const char* why) {
  if (mode == currentMode) return;
  if (why != nullptr) log.add(now, EventLog::INFO, "%s", why);
  restart(mode, now);
}

void Rover::drive(MoveCode move, int speed, int durationMs, uint32_t now) {
  const MovePattern* pattern = findMovePattern(move);
  if (pattern == nullptr || move == STOP) {
    release(now);
    return;
  }
  drive(*pattern, speed, durationMs, now);
}

// Every source reaches the motors here, so every input is clamped here: a
// command's move, exploration's, and the checks' wheels.
void Rover::drive(const MovePattern& pattern, int speed, int durationMs, uint32_t now) {
  speed = kinematics::clampSpeed(speed);
  durationMs = kinematics::clampDuration(durationMs);
  if (speed == 0 || durationMs == 0) {
    release(now);
    return;
  }

  // Clients hold a move by repeating it (the panel every 200 ms, exploration
  // on every clear ping). The wheels are already doing it, so usually only
  // the deadline moves: rewriting all four motors is ~7 ms of I2C each time.
  // Every MOTOR_REFRESH_MS the pattern is written again anyway, so a write the
  // bus lost -- the library does not report one -- is repaired while the
  // rover moves.
  const bool alreadyDoingIt = moving && &pattern == currentPattern && speed == currentSpeed &&
                              !elapsed(now, lastMotorWriteAt, tuning::MOTOR_REFRESH_MS);
  if (!alreadyDoingIt) {
    motors.drive(pattern, static_cast<uint8_t>(speed));
    lastMotorWriteAt = now;
  }

  currentPattern = &pattern;
  currentSpeed = speed;
  moving = true;
  // The wheels are driving again: a stop's second write still pending would
  // now end this move early.
  releasePending = false;
  moveDeadline = now + static_cast<uint32_t>(durationMs);
}

// Always writes: stopping is never skipped. A move repairs a lost write by
// rewriting itself every MOTOR_REFRESH_MS, but a stop has no next command to
// repair it. When the release burst was lost, the wheels drove on with
// telemetry saying STOP: past the deadman, and into the obstacle a cruise had
// stopped for. So a release that ends motion is written once more,
// MOTOR_REFRESH_MS later, by servicePendingRelease(). Once, not forever: an
// idle rover costs no I2C.
void Rover::release(uint32_t now) {
  motors.release();
  if (moving) {
    releasePending = true;
    releasedAt = now;
  }
  moving = false;
}

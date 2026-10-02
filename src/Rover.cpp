#include "Rover.h"

#include "Kinematics.h"
#include "MovePatterns.h"
#include "Timing.h"
#include "Tuning.h"

using timing::elapsed;
using timing::reached;

Rover::Rover(Motors& motors, RangeScanner& scanner) : motors(motors), explorer(scanner) {}

void Rover::begin(Mode initialMode, uint32_t now) { restart(initialMode, now); }

void Rover::update(uint32_t now) {
  if (moving && reached(now, moveDeadline)) release(now);
  servicePendingRelease(now);

  if (currentMode == MODE_AUTONOMOUS) {
    const Explorer::Motion motion = explorer.update(now, !moving);
    if (motion.requested) drive(motion.move, tuning::EXPLORE_SPEED, motion.durationMs, now);
  } else {
    explorer.survey(now);
  }
}

void Rover::command(int move, int speed, int durationMs, uint32_t now) {
  // The only command that gives control back. setMode() stops the motors and
  // restarts exploration from a fresh sweep, not from whatever the rover last
  // saw before a human took over. Already exploring, it restarts an explorer
  // that halted: the operator is saying the way is open now.
  if (move == RESUME_AUTONOMOUS) {
    if (currentMode == MODE_AUTONOMOUS) {
      if (explorer.phase() == Explorer::HALTED) restart(MODE_AUTONOMOUS, now);
      return;
    }
    setMode(MODE_AUTONOMOUS, now);
    return;
  }

  setMode(MODE_MANUAL, now);
  if (!isMoveCode(move)) {
    // An instruction we cannot read, from a client we do not control.
    // Stopping is the only safe interpretation.
    release(now);
    return;
  }
  drive(static_cast<MoveCode>(move), speed, durationMs, now);
}

void Rover::stop(uint32_t now) { release(now); }

void Rover::standDown(uint32_t now) {
  release(now);
  setMode(MODE_MANUAL, now);
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
  status.move = moving ? currentMove : STOP;
  status.moving = moving;
  status.phase = exploring ? explorer.phaseName() : nullptr;
  status.haltReason = exploring ? explorer.haltReason() : nullptr;
  status.hasScan = explorer.hasScan();
  for (int i = 0; i < Explorer::BEARING_COUNT; i++) {
    status.scanCm[i] = explorer.distanceCm(static_cast<Explorer::Bearing>(i));
  }
  status.motorsReady = motors.ready();
  return status;
}

void Rover::restart(Mode mode, uint32_t now) {
  currentMode = mode;
  release(now);
  explorer.reset(now);
}

void Rover::setMode(Mode mode, uint32_t now) {
  if (mode != currentMode) restart(mode, now);
}

// The single path to the motors: energise the wheels and record when they
// must stop. Clamping here covers every source at once.
void Rover::drive(MoveCode move, int speed, int durationMs, uint32_t now) {
  speed = kinematics::clampSpeed(speed);
  durationMs = kinematics::clampDuration(durationMs);

  const MovePattern* pattern = findMovePattern(move);
  if (pattern == nullptr || move == STOP || speed == 0 || durationMs == 0) {
    release(now);
    return;
  }

  // Clients hold a move by repeating it (the panel every 200 ms, exploration
  // on every clear ping). The wheels are already doing it, so usually only
  // the deadline moves: rewriting all four motors is ~7 ms of I2C each time.
  // Every MOTOR_REFRESH_MS the pattern is written again anyway, so a write the
  // bus lost -- the library does not report one -- is repaired while the
  // rover moves. release() above always writes: stopping is never skipped.
  const bool alreadyDoingIt = moving && move == currentMove && speed == currentSpeed &&
                              !elapsed(now, lastMotorWriteAt, tuning::MOTOR_REFRESH_MS);
  if (!alreadyDoingIt) {
    motors.drive(*pattern, static_cast<uint8_t>(speed));
    lastMotorWriteAt = now;
  }

  currentMove = move;
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
  currentMove = STOP;
}

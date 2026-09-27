#include "Rover.h"

#include "Kinematics.h"
#include "MovePatterns.h"
#include "Tuning.h"

namespace {

// Wrap-safe: millis() rolls over every ~49.7 days.
bool reached(uint32_t now, uint32_t deadline) { return static_cast<int32_t>(now - deadline) >= 0; }

}  // namespace

Rover::Rover(Motors& motors, RangeScanner& scanner) : motors(motors), explorer(scanner) {}

void Rover::begin(Mode initialMode, uint32_t now) {
  currentMode = initialMode;
  release();
  explorer.reset(now);
}

void Rover::update(uint32_t now) {
  if (moving && reached(now, moveDeadline)) release();

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
  // saw before a human took over.
  if (move == RESUME_AUTONOMOUS) {
    setMode(MODE_AUTONOMOUS, now);
    return;
  }

  setMode(MODE_MANUAL, now);
  if (!isMoveCode(move)) {
    // An instruction we cannot read, from a client we do not control.
    // Stopping is the only safe interpretation.
    release();
    return;
  }
  drive(static_cast<MoveCode>(move), speed, durationMs, now);
}

void Rover::stop() { release(); }

void Rover::onLinkLost(uint32_t now) {
  release();
  setMode(MODE_MANUAL, now);
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
  return status;
}

void Rover::setMode(Mode mode, uint32_t now) {
  if (mode == currentMode) return;
  currentMode = mode;
  release();
  explorer.reset(now);
}

// The single path to the motors: energise the wheels and record when they
// must stop. Clamping here covers every source at once.
void Rover::drive(MoveCode move, int speed, int durationMs, uint32_t now) {
  speed = kinematics::clampSpeed(speed);
  durationMs = kinematics::clampDuration(durationMs);

  const MovePattern* pattern = findMovePattern(move);
  if (pattern == nullptr || move == STOP || speed == 0 || durationMs == 0) {
    release();
    return;
  }

  motors.drive(*pattern, static_cast<uint8_t>(speed));
  currentMove = move;
  moving = true;
  moveDeadline = now + static_cast<uint32_t>(durationMs);
}

void Rover::release() {
  motors.release();
  moving = false;
  currentMove = STOP;
}

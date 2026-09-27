#include "DriveTrain.h"

#include "Pins.h"

namespace {

static_assert(sizeof(pins::MOTOR_TERMINAL) == WHEEL_COUNT, "one motor terminal per wheel");

// A single probe can miss while the wheels are still running from before a
// reset (motor noise, or a bus the reset cut off mid-transaction).
constexpr int PROBE_ATTEMPTS = 3;
constexpr uint32_t PROBE_RETRY_MS = 10;

uint8_t shieldCommand(WheelDirection direction) {
  switch (direction) {
    case WHEEL_FORWARD: return FORWARD;
    case WHEEL_BACKWARD: return BACKWARD;
    case WHEEL_FREE: return RELEASE;
  }
  return RELEASE;
}

}  // namespace

// setup() only, so the short retry delay is harmless.
bool DriveTrain::begin() {
  for (int attempt = 0; attempt < PROBE_ATTEMPTS && !shieldReady; attempt++) {
    if (attempt > 0) delay(PROBE_RETRY_MS);
    shieldReady = shield.begin();
  }

  // Bound whatever the probe said: getMotor() does no I2C, and the release
  // below is the first thing that stops wheels the shield kept driving
  // through the reset. It must be tried even if the probe missed.
  for (int i = 0; i < WHEEL_COUNT; i++) {
    motors[i] = shield.getMotor(pins::MOTOR_TERMINAL[i]);
  }
  release();

  if (!shieldReady) Serial.println("Motor shield not found on I2C (0x60); motors disabled.");
  return shieldReady;
}

void DriveTrain::drive(const MovePattern& pattern, uint8_t speed) {
  if (!shieldReady) return;
  for (int i = 0; i < WHEEL_COUNT; i++) {
    const WheelDirection direction = pattern.wheels[i];
    motors[i]->setSpeed(direction == WHEEL_FREE ? 0 : speed);
    motors[i]->run(shieldCommand(direction));
  }
}

void DriveTrain::release() {
  for (int i = 0; i < WHEEL_COUNT; i++) {
    if (motors[i] == nullptr) continue;  // only before begin()
    motors[i]->setSpeed(0);
    motors[i]->run(RELEASE);
  }
}

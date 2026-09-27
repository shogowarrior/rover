#include "DriveTrain.h"

#include "Pins.h"

namespace {

uint8_t shieldCommand(WheelDirection direction) {
  switch (direction) {
    case WHEEL_FORWARD: return FORWARD;
    case WHEEL_BACKWARD: return BACKWARD;
    case WHEEL_FREE: return RELEASE;
  }
  return RELEASE;
}

}  // namespace

bool DriveTrain::begin() {
  if (!shield.begin()) {
    Serial.println("Motor shield not found on I2C (0x60); motors disabled.");
    return false;
  }
  for (int i = 0; i < WHEEL_COUNT; i++) {
    motors[i] = shield.getMotor(pins::MOTOR_TERMINAL[i]);
  }
  release();
  return true;
}

void DriveTrain::drive(const MovePattern& pattern, uint8_t speed) {
  for (int i = 0; i < WHEEL_COUNT; i++) {
    if (motors[i] == nullptr) continue;
    const WheelDirection direction = pattern.wheels[i];
    motors[i]->setSpeed(direction == WHEEL_FREE ? 0 : speed);
    motors[i]->run(shieldCommand(direction));
  }
}

void DriveTrain::release() {
  for (int i = 0; i < WHEEL_COUNT; i++) {
    if (motors[i] == nullptr) continue;
    motors[i]->setSpeed(0);
    motors[i]->run(RELEASE);
  }
}

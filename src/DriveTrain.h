#ifndef DRIVE_TRAIN_H
#define DRIVE_TRAIN_H

#include <Adafruit_MotorShield.h>

#include "Hardware.h"

// The four wheel motors on the Adafruit Motor Shield V2.
class DriveTrain : public Motors {
 public:
  // Find the shield and release all four wheels. Returns false when it does
  // not answer on I2C; drive() then does nothing, telemetry reports
  // "motorsReady": false, and release() still tries, because the shield's
  // PWM chip keeps driving the wheels through an ESP32 reset.
  bool begin();

  void drive(const MovePattern& pattern, uint8_t speed) override;
  void release() override;
  bool ready() const override { return shieldReady; }

 private:
  Adafruit_MotorShield shield;
  Adafruit_DCMotor* motors[WHEEL_COUNT] = {};
  bool shieldReady = false;
};

#endif

#ifndef DRIVE_TRAIN_H
#define DRIVE_TRAIN_H

#include <Adafruit_MotorShield.h>

#include "Hardware.h"

// The four wheel motors on the Adafruit Motor Shield V2.
class DriveTrain : public Motors {
 public:
  // Returns false, and leaves every motor call a no-op, when the shield does
  // not answer on I2C -- instead of failing silently while telemetry reports
  // the rover moving.
  bool begin();

  void drive(const MovePattern& pattern, uint8_t speed) override;
  void release() override;

 private:
  Adafruit_MotorShield shield;
  Adafruit_DCMotor* motors[WHEEL_COUNT] = {};
};

#endif

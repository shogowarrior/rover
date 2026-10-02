#ifndef HARDWARE_H
#define HARDWARE_H

#include <stdint.h>

#include "MovePatterns.h"

// The two pieces of hardware the rover's logic drives, as small interfaces.
//
// DriveTrain and Scanner implement them on the board; the host tests implement
// them with fakes, which is what lets Rover and Explorer -- mode arbitration,
// move deadlines, the whole of autonomy -- be tested off the robot. main.cpp
// allocates every object statically and passes references, so there is no
// heap and no ownership through these interfaces (hence the protected,
// non-virtual destructors).

class Motors {
 public:
  // Set all four wheels to `pattern` at `speed` (0..255).
  virtual void drive(const MovePattern& pattern, uint8_t speed) = 0;
  // Let all four wheels free-wheel.
  virtual void release() = 0;
  // False when the motor driver did not answer at boot, so drive() does
  // nothing. Reported in telemetry.
  virtual bool ready() const = 0;

 protected:
  ~Motors() {}
};

// The scanner's servo turns 0..SERVO_MAX_DEG and looks straight ahead at
// SERVO_CENTRE_DEG.
constexpr int SERVO_CENTRE_DEG = 90;
constexpr int SERVO_MAX_DEG = 180;

class RangeScanner {
 public:
  // Point the sonar: servo degrees, 0..SERVO_MAX_DEG.
  virtual void aim(int servoDeg) = 0;
  // Raw distance in cm from the aimed sonar; negative means no echo came back.
  // Busy-waits for the echo, up to ~30 ms.
  virtual float measureCm() = 0;

 protected:
  ~RangeScanner() {}
};

#endif

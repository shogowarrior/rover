#ifndef FAKE_HARDWARE_H
#define FAKE_HARDWARE_H

// Test doubles for the interfaces in src/Hardware.h, shared by the host test
// suites (`#include "../fakes/FakeHardware.h"`). Not a suite itself: PlatformIO
// only treats test/test_* directories as suites.

#include <vector>

#include "Hardware.h"
#include "MovePatterns.h"

class FakeMotors final : public Motors {
 public:
  void drive(const MovePattern& pattern, uint8_t speed) override {
    lastPattern = &pattern;
    lastSpeed = speed;
    driving = true;
    driveCalls++;
  }

  void release() override {
    releaseCalls++;
    if (releasesToLose > 0) {
      releasesToLose--;
      return;  // lost on the bus: the wheels drive on
    }
    driving = false;
  }

  bool ready() const override { return isReady; }

  bool isReady = true;
  // The next this many release() calls never reach the shield. The Adafruit
  // library discards the I2C result, so the firmware is never told.
  int releasesToLose = 0;

  const MovePattern* lastPattern = nullptr;
  uint8_t lastSpeed = 0;
  bool driving = false;
  int driveCalls = 0;
  int releaseCalls = 0;
};

// A world seen through the servo: a distance for every servo angle, which a
// test sets directly. Negative means no echo, as the real library reports.
class FakeScanner final : public RangeScanner {
 public:
  FakeScanner() { setAll(200.0f); }

  void aim(int servoDeg) override {
    servo = servoDeg;
    aims.push_back(servoDeg);
    aimTimes.push_back(clock != nullptr ? *clock : 0);
  }

  float measureCm() override {
    pings++;
    pingAngles.push_back(servo);
    pingTimes.push_back(clock != nullptr ? *clock : 0);
    return range[servo];
  }

  void setAll(float cm) { setArc(0, SERVO_MAX_DEG, cm); }

  // Everything from `fromDeg` to `toDeg` inclusive.
  void setArc(int fromDeg, int toDeg, float cm) {
    for (int deg = fromDeg; deg <= toDeg; deg++) range[deg] = cm;
  }

  int servo = SERVO_CENTRE_DEG;
  int pings = 0;
  float range[SERVO_MAX_DEG + 1];
  const uint32_t* clock = nullptr;  // optional: stamps aims and pings
  std::vector<int> aims;
  std::vector<uint32_t> aimTimes;
  std::vector<int> pingAngles;
  std::vector<uint32_t> pingTimes;
};

#endif

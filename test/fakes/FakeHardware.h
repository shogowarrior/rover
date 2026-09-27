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
    driving = false;
    releaseCalls++;
  }

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

  void setAll(float cm) {
    for (int deg = 0; deg <= 180; deg++) range[deg] = cm;
  }

  // Everything from `fromDeg` to `toDeg` inclusive.
  void setArc(int fromDeg, int toDeg, float cm) {
    for (int deg = fromDeg; deg <= toDeg; deg++) range[deg] = cm;
  }

  int servo = 90;
  int pings = 0;
  float range[181];
  const uint32_t* clock = nullptr;  // optional: stamps aims and pings
  std::vector<int> aims;
  std::vector<uint32_t> aimTimes;
  std::vector<int> pingAngles;
  std::vector<uint32_t> pingTimes;
};

#endif

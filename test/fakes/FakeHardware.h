#ifndef FAKE_HARDWARE_H
#define FAKE_HARDWARE_H

// Test doubles for the interfaces in src/Hardware.h. test/fakes and
// test/support hold headers the host test suites share
// (`#include "../fakes/FakeHardware.h"`); neither is a suite, because
// PlatformIO only treats test/test_* directories as suites.

#include <stdio.h>

#include <array>
#include <string>
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

  void setAll(float cm) { range.fill(cm); }

  // Everything from `fromDeg` to `toDeg` inclusive.
  void setArc(int fromDeg, int toDeg, float cm) {
    for (int deg = fromDeg; deg <= toDeg; deg++) range[deg] = cm;
  }

  // `range`'s type, so a test can save the whole world and restore it.
  typedef std::array<float, hardware::SERVO_MAX_DEG + 1> World;

  int servo = hardware::SERVO_CENTRE_DEG;
  int pings = 0;
  World range;
  const uint32_t* clock = nullptr;  // optional: stamps aims and pings
  std::vector<int> aims;
  std::vector<uint32_t> aimTimes;
  std::vector<int> pingAngles;
  std::vector<uint32_t> pingTimes;
};

// The slot as a byte vector, which a test can set to refuse each step as
// Update can. Its digest is not MD5 but stands in for it: deterministic, so a
// test computes the answer a client would send through digest(), and every
// text it was asked to digest is kept, so a test sees what was hashed.
class FakeFirmwareSlot final : public FirmwareSlot {
 public:
  bool begin(uint32_t size, const char* md5Hex) override {
    beginCalls++;
    if (refuseBegin) return false;
    open = true;
    begunSize = size;
    begunMd5 = md5Hex;
    image.clear();
    return true;
  }

  bool write(const uint8_t* data, size_t length) override {
    if (!open || refuseWrite) return false;
    image.insert(image.end(), data, data + length);
    return true;
  }

  bool finish() override {
    if (!open || refuseFinish) return false;
    open = false;
    finished = true;
    return true;
  }

  void abort() override {
    abortCalls++;
    open = false;
  }

  const char* error() const override { return "the fake slot refused"; }

  void md5Hex(const char* text, hardware::Hex32& out) override {
    digested.push_back(text);
    digest(text, out);
  }

  void randomHex(hardware::Hex32& out) override { snprintf(out, sizeof(out), "%032x", ++nonces); }

  const char* running() const override { return "00112233445566778899aabbccddeeff"; }

  // FNV-1a from two starting points, as 32 lowercase hex digits.
  static void digest(const char* text, hardware::Hex32& out) {
    unsigned long long halves[2] = {14695981039346656037ULL, 1099511628211ULL};
    for (unsigned long long& half : halves) {
      for (const char* c = text; *c != '\0'; c++) half = (half ^ static_cast<unsigned char>(*c)) * 1099511628211ULL;
    }
    snprintf(out, sizeof(out), "%016llx%016llx", halves[0], halves[1]);
  }

  bool refuseBegin = false;
  bool refuseWrite = false;
  bool refuseFinish = false;

  bool open = false;  // begun, and neither finished nor aborted
  bool finished = false;
  int beginCalls = 0;
  int abortCalls = 0;
  uint32_t begunSize = 0;
  std::string begunMd5;
  std::vector<uint8_t> image;
  std::vector<std::string> digested;
  unsigned nonces = 0;
};

#endif

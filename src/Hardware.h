#ifndef HARDWARE_H
#define HARDWARE_H

#include <stddef.h>
#include <stdint.h>

#include "MovePatterns.h"

// The hardware the rover's logic drives, as small interfaces.
//
// DriveTrain, Scanner and FlashSlot implement them on the board; the host
// tests implement them with fakes, which is what lets Rover, Explorer and
// FirmwareUpdate -- mode arbitration, move deadlines, the whole of autonomy,
// the rules of a firmware update -- be tested off the robot. main.cpp
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

namespace hardware {

// The scanner's servo turns 0..SERVO_MAX_DEG and looks straight ahead at
// SERVO_CENTRE_DEG.
constexpr int SERVO_CENTRE_DEG = 90;
constexpr int SERVO_MAX_DEG = 180;

}  // namespace hardware

class RangeScanner {
 public:
  // Point the sonar: servo degrees, 0..hardware::SERVO_MAX_DEG.
  virtual void aim(int servoDeg) = 0;
  // Raw distance in cm from the aimed sonar; negative means no echo came back.
  // Busy-waits for the echo, up to ~30 ms.
  virtual float measureCm() = 0;

 protected:
  ~RangeScanner() {}
};

namespace hardware {

// An MD5 digest or a nonce: 32 lowercase hex digits and the terminator.
typedef char Hex32[33];

}  // namespace hardware

// Where a firmware update is written: the OTA app slot that is not running
// (partition.csv has two), and the digests its handshake needs.
class FirmwareSlot {
 public:
  // Start an image of `size` bytes whose MD5 is `md5Hex`, 32 lowercase hex
  // digits. False when the slot cannot take it: error() says why.
  virtual bool begin(uint32_t size, const char* md5Hex) = 0;
  // Append the image's next bytes. False when the flash refused them.
  virtual bool write(const uint8_t* data, size_t length) = 0;
  // Once every byte has been written: check the image against its MD5 and
  // make it the one that boots next. False when it is not fit to boot.
  virtual bool finish() = 0;
  // Abandon the image begun; the running firmware stays the one that boots.
  virtual void abort() = 0;
  // Why begin(), write() or finish() last failed, as a short phrase.
  virtual const char* error() const = 0;
  virtual void md5Hex(const char* text, hardware::Hex32& out) = 0;
  // A nonce no client could predict.
  virtual void randomHex(hardware::Hex32& out) = 0;
  // The running image's MD5.
  virtual const char* running() const = 0;

 protected:
  ~FirmwareSlot() {}
};

#endif

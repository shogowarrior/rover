#ifndef FLASH_SLOT_H
#define FLASH_SLOT_H

#include <stddef.h>
#include <stdint.h>

#include "Hardware.h"

// FirmwareSlot on arduino-esp32's Update, which writes the OTA app slot that
// is not running, with MD5Builder for the digests and the hardware RNG for
// nonces. Update holds the first 16 bytes back until finish(), so a partial
// image never boots, and refuses to begin while ArduinoOTA's upload runs:
// the two update paths cannot overlap.
class FlashSlot final : public FirmwareSlot {
 public:
  // setup() only: digests the running image for running(), reading all of
  // it twice (ESP.getSketchMD5()), far longer than a pass of loop() may take.
  void begin();

  bool begin(uint32_t size, const char* md5Hex) override;
  bool write(const uint8_t* data, size_t length) override;
  bool finish() override;
  void abort() override;
  const char* error() const override;
  void md5Hex(const char* text, hardware::Hex32& out) override;
  void randomHex(hardware::Hex32& out) override;
  const char* running() const override { return runningMd5; }

 private:
  hardware::Hex32 runningMd5 = {};
};

#endif

#include "FlashSlot.h"

#include <Arduino.h>
#include <MD5Builder.h>
#include <Update.h>
#include <esp_random.h>

void FlashSlot::begin() { snprintf(runningMd5, sizeof(runningMd5), "%s", ESP.getSketchMD5().c_str()); }

bool FlashSlot::begin(uint32_t size, const char* md5Hex) {
  if (!Update.begin(size)) return false;
  Update.setMD5(md5Hex);  // finish() fails unless the image has this MD5
  return true;
}

bool FlashSlot::write(const uint8_t* data, size_t length) {
  // Update::write() takes a mutable buffer but only copies from it.
  return Update.write(const_cast<uint8_t*>(data), length) == length;
}

// Without evenIfRemaining, end() also refuses an image short of its size.
bool FlashSlot::finish() { return Update.end(); }

void FlashSlot::abort() { Update.abort(); }

const char* FlashSlot::error() const {
  // Update::begin() refuses a second update, or a buffer it could not
  // allocate, without recording an error.
  return Update.hasError() ? Update.errorString() : "The flash could not start an update.";
}

void FlashSlot::md5Hex(const char* text, hardware::Hex32& out) {
  MD5Builder md5;
  md5.begin();
  md5.add(text);
  md5.calculate();
  md5.getChars(out);
}

// Truly random only while WiFi or Bluetooth runs, which it does whenever a
// client can ask for a nonce.
void FlashSlot::randomHex(hardware::Hex32& out) {
  for (int word = 0; word < 4; word++) {
    snprintf(out + 8 * word, sizeof(out) - 8 * word, "%08x", static_cast<unsigned>(esp_random()));
  }
}

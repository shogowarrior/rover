#ifndef SETTINGS_STORE_H
#define SETTINGS_STORE_H

#include <stddef.h>

// The settings' copy in flash, so they last from boot to boot: one JSON
// document, {"settings": {...}} as clients are sent it (Protocol.h), in the
// NVS partition through arduino-esp32's Preferences. NVS levels its own
// wear, and main.cpp writes only once the settings have been still for a
// while and the rover is at rest (Settings::saveDue()), since a write can
// hold the loop while flash is erased.
//
// A copy that does not read back as settings (none yet, from a build
// without this, or damaged) leaves the defaults: Protocol ignores what it
// does not know, field by field.
class SettingsStore {
 public:
  // The copy into `out`, terminated. False when there is none, or it does
  // not fit.
  bool load(char* out, size_t capacity);
  // Replace the copy. False when the write failed; the next change tries
  // again.
  bool save(const char* json, size_t length);
};

#endif

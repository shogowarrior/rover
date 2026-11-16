#include "SettingsStore.h"

#include <Preferences.h>

namespace {

// partition.csv's "nvs" partition; NVS keys are at most 15 characters.
constexpr char NAMESPACE[] = "rover";
constexpr char KEY[] = "settings";

}  // namespace

bool SettingsStore::load(char* out, size_t capacity) {
  Preferences preferences;
  if (!preferences.begin(NAMESPACE, true)) return false;  // read-only: none written yet
  const size_t length = preferences.getBytesLength(KEY);
  const bool fits = length > 0 && length < capacity;
  if (fits) {
    preferences.getBytes(KEY, out, length);
    out[length] = '\0';
  }
  preferences.end();
  return fits;
}

bool SettingsStore::save(const char* json, size_t length) {
  Preferences preferences;
  if (!preferences.begin(NAMESPACE, false)) return false;
  const bool written = preferences.putBytes(KEY, json, length) == length;
  preferences.end();
  return written;
}

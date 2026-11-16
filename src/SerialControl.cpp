#include "SerialControl.h"

#include <Arduino.h>
#include <ArduinoJson.h>

void SerialControl::update(uint32_t now) {
  for (int i = 0; i < READ_MAX_BYTES && Serial.available() > 0; i++) {
    const int byte = Serial.read();
    if (byte < 0) break;
    if (byte == '\n' || byte == '\r') {
      if (overlong) {
        log.add(now, EventLog::WARN, SOURCE_USB, "USB: ignored a line over %u bytes",
                static_cast<unsigned>(protocol::COMMAND_MAX_BYTES));
      } else if (length > 0) {
        onLine(now);
      }
      length = 0;
      overlong = false;
      continue;
    }
    if (overlong) continue;
    if (length == protocol::COMMAND_MAX_BYTES) {
      overlong = true;
      continue;
    }
    line[length++] = static_cast<char>(byte);
  }
}

void SerialControl::onLine(uint32_t now) {
  JsonDocument input;
  if (deserializeJson(input, line, length)) {
    log.add(now, EventLog::WARN, SOURCE_USB, "USB: ignored a line that is not JSON");
    return;
  }
  const protocol::Message message = protocol::readMessage(input.as<JsonVariantConst>());
  switch (control.apply(SOURCE_USB, message, now)) {
    case Control::ACCEPTED:  // Control logs control passing to USB
    case Control::REFUSED:   // and a refusal
    case Control::SETTING:   // Settings logs the change
      break;
    case Control::IGNORED:
      log.add(now, EventLog::WARN, SOURCE_USB, "USB: ignored a setting with a value it does not know");
      break;
    case Control::UPDATE:
      log.add(now, EventLog::WARN, SOURCE_USB, "USB: firmware updates go over WiFi, not the cable");
      break;
  }
}

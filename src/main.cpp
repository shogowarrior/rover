#include <Arduino.h>
#include <esp_system.h>

#include "Control.h"
#include "DriveTrain.h"
#include "EventLog.h"
#include "Features.h"
#include "FirmwareUpdate.h"
#include "FlashSlot.h"
#include "Gamepad.h"
#include "Network.h"
#include "Protocol.h"
#include "RemoteControl.h"
#include "Rover.h"
#include "Scanner.h"
#include "SerialControl.h"
#include "Settings.h"
#include "SettingsStore.h"
#include "Tuning.h"

// The whole object graph, in one place. Everything is allocated statically and
// wired by reference. The only other global is the gamepad's callback mailbox
// in Gamepad.cpp, which Ps3.attach()'s plain function pointer forces.
namespace {

// What the rover did and why. Numbered from a random start each boot, so a
// client never takes this boot's lines for an earlier one's (EventLog.h).
EventLog eventLog(esp_random());
// Every setting, one copy for every controller, so the gamepad, the panel
// and the serial console agree; kept in flash by settingsStore.
Settings settings(eventLog, features::DEFAULT_CONTROL_SCHEME);
SettingsStore settingsStore;
DriveTrain driveTrain;
Scanner scanner;
Rover rover(driveTrain, scanner, settings, eventLog);
// Every command, from every controller, goes through here to the rover.
Control control(rover, settings, eventLog);
FlashSlot flashSlot;
FirmwareUpdate firmwareUpdate(rover, flashSlot, features::LINK_UPDATE_NEEDS_PASSWORD);
Gamepad gamepad(control, settings, eventLog);
SerialControl serialControl(control, eventLog);
RemoteControl remote(rover, control, settings, firmwareUpdate, gamepad, eventLog);
Network network(rover, remote, firmwareUpdate, eventLog);

// Only a power-on may explore, and only with AUTONOMOUS_AT_POWER_ON
// (Features.h says why).
Rover::Mode startupMode(esp_reset_reason_t reason) {
  return features::AUTONOMOUS_AT_POWER_ON && reason == ESP_RST_POWERON ? Rover::MODE_AUTONOMOUS
                                                                       : Rover::MODE_MANUAL;
}

const char* resetName(esp_reset_reason_t reason) {
  switch (reason) {
    case ESP_RST_POWERON:
      return "power-on or EN";
    case ESP_RST_SW:
      return "restart";
    case ESP_RST_PANIC:
      return "crash";
    case ESP_RST_INT_WDT:
    case ESP_RST_TASK_WDT:
    case ESP_RST_WDT:
      return "watchdog";
    case ESP_RST_BROWNOUT:
      return "brownout";
    case ESP_RST_DEEPSLEEP:
      return "deep sleep";
    default:
      return "unknown";
  }
}

// Log lines the serial console has missed since it last had room.
uint32_t echoSkipped = 0;

// The serial console's copy of each log line, as it is added, with whose
// line it is. Writing waits once the TX buffer is full, and loop() must not
// wait (AGENTS.md, Invariants): a line with no room is left off the console
// (clients still get it), and the next line that has room says how many
// were.
void echoToSerial(const EventLog::Entry& entry) {
  char line[EventLog::TEXT_MAX + 32];
  const int written = snprintf(line, sizeof(line), "[%lu.%03lu] %-5s %s%s\n",
                               static_cast<unsigned long>(entry.atMs / 1000),
                               static_cast<unsigned long>(entry.atMs % 1000), sourceName(entry.source),
                               entry.level == EventLog::WARN ? "WARN " : "", entry.text);
  if (written <= 0) return;
  const size_t length = written < static_cast<int>(sizeof(line)) ? static_cast<size_t>(written) : sizeof(line) - 1;
  const size_t notice = echoSkipped > 0 ? 40 : 0;  // "(N log lines not echoed)"
  if (static_cast<size_t>(Serial.availableForWrite()) < length + notice) {
    echoSkipped++;
    return;
  }
  if (echoSkipped > 0) {
    Serial.printf("(%lu log lines not echoed)\n", static_cast<unsigned long>(echoSkipped));
    echoSkipped = 0;
  }
  Serial.write(reinterpret_cast<const uint8_t*>(line), length);
}

// The settings as the last boot left them, if there are any. Before
// anything reads them: the gamepad's scheme, the sonar's mode.
void loadSettings(uint32_t now) {
  char text[protocol::SETTINGS_MAX_BYTES];
  if (!settingsStore.load(text, sizeof(text))) {
    eventLog.add(now, EventLog::INFO, "Settings: the defaults (none in flash)");
    settings.saved();
    return;
  }
  JsonDocument doc;
  const bool parsed = !deserializeJson(doc, text);
  const protocol::Message message = protocol::readMessage(doc.as<JsonVariantConst>());
  if (!parsed || message.kind != protocol::Message::SETTINGS) {
    eventLog.add(now, EventLog::WARN, "Settings: the copy in flash does not read; the defaults");
  } else {
    eventLog.add(now, EventLog::INFO, "Settings: from flash");
    settings.apply(message.settings, SOURCE_ROVER, now);
  }
  settings.saved();
}

// Write the settings to flash once they have been still for a while and the
// rover is at rest (Settings::saveDue() says why).
void saveSettings(uint32_t now) {
  if (!settings.saveDue(now, rover.atRest())) return;
  char text[protocol::SETTINGS_MAX_BYTES];
  const size_t length = protocol::writeSettings(settings, text, sizeof(text));
  if (length > 0 && settingsStore.save(text, length)) {
    eventLog.add(now, EventLog::INFO, "Settings: saved");
  } else {
    eventLog.add(now, EventLog::WARN, "Settings: not saved; the next change tries again");
  }
  settings.saved();
}

}  // namespace

void setup() {
  // Room for a burst of log lines: echoToSerial() leaves a line off the
  // console rather than wait for room.
  Serial.setTxBufferSize(1024);
  Serial.begin(tuning::SERIAL_BAUD);
  // First: it releases wheels the shield kept driving through a reset.
  driveTrain.begin();
  eventLog.echoTo(echoToSerial);
  const esp_reset_reason_t reason = esp_reset_reason();
  const Rover::Mode mode = startupMode(reason);
  eventLog.add(millis(), EventLog::INFO, "Boot after a %s reset, in %s", resetName(reason),
               mode == Rover::MODE_AUTONOMOUS ? "autonomous mode: exploring" : "manual mode");
  if (!driveTrain.ready()) {
    eventLog.add(millis(), EventLog::WARN, "Motor shield: no answer on I2C at 0x60; no wheel will turn");
  }
  loadSettings(millis());
  scanner.begin();
  rover.begin(mode, millis());
  if (settings.checksAtBoot()) rover.checkWithoutWheels(millis());
  // Before WiFi: pairing rewrites the board's MAC address.
  if (features::GAMEPAD) gamepad.begin(features::PS3_HOST_MAC);
  flashSlot.begin();  // reads the whole running image, which loop() could not afford
  network.begin();

  // The backstop for a blocked loop: a pass over 5 s resets the board, and
  // the wheels run on until driveTrain.begin() releases them (AGENTS.md,
  // Invariants).
  enableLoopWDT();
}

// Nothing here may block: that starves the WebSocket server and ArduinoOTA,
// STOP commands included.
void loop() {
  const uint32_t now = millis();
  rover.update(now);  // move deadlines first, then one step of exploration
  gamepad.update();   // reads its own clock: a pad report can be newer than `now`
  serialControl.update(now);
  network.update(now);
  saveSettings(now);
}

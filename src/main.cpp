#include <Arduino.h>
#include <esp_system.h>

#include "DriveTrain.h"
#include "EventLog.h"
#include "Features.h"
#include "FirmwareUpdate.h"
#include "FlashSlot.h"
#include "Gamepad.h"
#include "Network.h"
#include "RemoteControl.h"
#include "Rover.h"
#include "Scanner.h"
#include "Tuning.h"

// The whole object graph, in one place. Everything is allocated statically and
// wired by reference. The only other global is the gamepad's callback mailbox
// in Gamepad.cpp, which Ps3.attach()'s plain function pointer forces.
namespace {

// What the rover did and why. Numbered from a random start each boot, so a
// client never takes this boot's lines for an earlier one's (EventLog.h).
EventLog eventLog(esp_random());
DriveTrain driveTrain;
Scanner scanner;
Rover rover(driveTrain, scanner, eventLog);
// One control scheme for every controller, so the gamepad and the panel agree.
kinematics::ControlScheme controlScheme = features::DEFAULT_CONTROL_SCHEME;
FlashSlot flashSlot;
FirmwareUpdate firmwareUpdate(rover, flashSlot, features::LINK_UPDATE_NEEDS_PASSWORD);
Gamepad gamepad(rover, controlScheme, eventLog);
RemoteControl remote(rover, controlScheme, firmwareUpdate, gamepad, eventLog);
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

// The serial console's copy of each log line, as it is added.
void echoToSerial(const EventLog::Entry& entry) {
  Serial.printf("[%lu.%03lu] %s%s\n", static_cast<unsigned long>(entry.atMs / 1000),
                static_cast<unsigned long>(entry.atMs % 1000), entry.level == EventLog::WARN ? "WARN " : "",
                entry.text);
}

}  // namespace

void setup() {
  // Room for a burst of log lines: printing waits once the buffer is full.
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
  scanner.begin();
  rover.begin(mode, millis());
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
  network.update(now);
}

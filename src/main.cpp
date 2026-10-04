#include <Arduino.h>
#include <esp_system.h>

#include "DriveTrain.h"
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

DriveTrain driveTrain;
Scanner scanner;
Rover rover(driveTrain, scanner);
// One control scheme for every controller, so the gamepad and the panel agree.
kinematics::ControlScheme controlScheme = features::DEFAULT_CONTROL_SCHEME;
FlashSlot flashSlot;
FirmwareUpdate firmwareUpdate(rover, flashSlot);
RemoteControl remote(rover, controlScheme, firmwareUpdate);
Network network(rover, remote, firmwareUpdate);
Gamepad gamepad(rover, controlScheme);

// Only a power-on explores (Features.h, AUTONOMOUS_AT_POWER_ON, says why).
Rover::Mode startupMode() {
  const bool poweredOn = esp_reset_reason() == ESP_RST_POWERON;
  return features::AUTONOMOUS_AT_POWER_ON && poweredOn ? Rover::MODE_AUTONOMOUS
                                                       : Rover::MODE_MANUAL;
}

}  // namespace

void setup() {
  Serial.begin(tuning::SERIAL_BAUD);
  driveTrain.begin();
  scanner.begin();
  rover.begin(startupMode(), millis());
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

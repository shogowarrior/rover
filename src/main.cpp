#include <Arduino.h>
#include <esp_system.h>

#include "DriveTrain.h"
#include "Features.h"
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
RemoteControl remote(rover);
Network network(rover, remote);
Gamepad gamepad(rover);

// Exploring straight after power-on is the point of the rover. Any other
// reset -- an OTA flash, a crash, the watchdog, a brownout from a stalled
// motor -- comes up in manual, so a rover nobody has told to move stays put.
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
  network.begin();

  // From here on nothing may block. The watchdog resets the board if one pass
  // of loop() ever takes longer than 5 s; the rebooted setup() releases the
  // motors in driveTrain.begin(). The shield's PWM chip is not reset with the
  // ESP32, so the wheels run on through the reboot (about half a second).
  enableLoopWDT();
}

// Nothing in this loop may block. Every call here has to return promptly:
// stalling starves the WebSocket server and ArduinoOTA, which means commands
// (including stop commands) stop arriving and the board can no longer be
// recovered over the air.
void loop() {
  const uint32_t now = millis();
  rover.update(now);  // move deadlines first, then one step of exploration
  gamepad.update(now);
  network.update(now);
}

#include "Service.h"
#include "common.h"

Rover rover;
Controller controller;
Service service;

void setup() {
  Serial.begin(HW_SERIAL_SPEED);
  rover.initRover();
  // controller.attach();  // enable to drive from a paired PS3 gamepad
  service.start();
}

// Nothing in this loop may block. Every call here has to return promptly:
// stalling starves the WebSocket server and ArduinoOTA, which means commands
// (including stop commands) stop arriving and the board can no longer be
// recovered over the air.
void loop() {
  rover.update();   // enforce move deadlines and the manual deadman first
  rover.explore();  // no-op unless the rover is in autonomous mode
  service.handle();
}

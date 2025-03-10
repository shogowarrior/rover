#include "common.h"
#include "Service.h"

Rover rover;
Controller controller;
Service Service;

void setup() {
  Serial.begin(HW_SERIAL_SPEED);
  // rover.initRover();
  // controller.attach();
  // Service.start();
}

void loop() {
  Service.handle();
}

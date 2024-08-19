#include "MecanumRobot.h"
#include "common.h"
#include "Service.h"

MecanumRobot robot;
Controller controller;
Service Service;

void setup() {
  Serial.begin(HW_SERIAL_SPEED);
  robot.initRobot();
  controller.attach();
  Service.start();
}

void loop() {
  Service.handle();
}

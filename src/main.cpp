#include "MecanumRobot.h"
#include "common.h"
#include "server.h"

MecanumRobot robot;
Controller controller;

void setup() {
  Serial.begin(HW_SERIAL_SPEED);
  robot.initRobot();
  controller.attachController();
  serverStart();
}

void loop() {
  serverHandler();
}

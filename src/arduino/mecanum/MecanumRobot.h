#ifndef MECANUM_ROBOT_H
#define MECANUM_ROBOT_H

#include <Adafruit_MotorShield.h>
#include <ArduinoJson.h>
#include <SPI.h>

#include "common/commands.h"

class MecanumRobot {
  // Define the MotorParams struct
  struct MotorParams {
    Adafruit_DCMotor *motor;
    int direction;
    uint8_t speed;
  };

 public:
  void initRobot();
  void testRobot();

  // Using declaration for member function pointer
  using Move = void (MecanumRobot::*)(int, int);

  void runMotor(MotorParams motorParam);
  void runMotors(MotorParams motorParams[]);
  void moveForward(int speed, int duration);
  void moveBackward(int speed, int duration);
  void moveRight(int speed, int duration);
  void moveLeft(int speed, int duration);
  void rotateClockwise(int speed, int duration);
  void rotateCounterClockwise(int speed, int duration);
  void moveDiagonal45(int speed, int duration);
  void moveDiagonal135(int speed, int duration);
  void moveDiagonal225(int speed, int duration);
  void moveDiagonal315(int speed, int duration);
  void pivotRightForward(int speed, int duration);
  void pivotRightBackward(int speed, int duration);
  void pivotLeftForward(int speed, int duration);
  void pivotLeftBackward(int speed, int duration);
  void pivotSidewaysForwardRight(int speed, int duration);
  void pivotSidewaysForwardLeft(int speed, int duration);
  void pivotSidewaysBackwardRight(int speed, int duration);
  void pivotSidewaysBackwardLeft(int speed, int duration);
  void setMotorsSpeed(int speed);
  void stop();
  void unknownCommand();
  void executeCommand(JsonDocument doc);

  // Test related methods
  void testMove(Move move);
};

#endif

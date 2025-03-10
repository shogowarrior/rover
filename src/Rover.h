#ifndef ROVER_H
#define ROVER_H

#pragma once

#include <Adafruit_MotorShield.h>
#include <ArduinoJson.h>
#include <SPI.h>

class Rover {
 private:
  Adafruit_MotorShield AFMS = Adafruit_MotorShield();

  Adafruit_DCMotor *frontLeft;
  Adafruit_DCMotor *frontRight;
  Adafruit_DCMotor *rearLeft;
  Adafruit_DCMotor *rearRight;

  // Define the MotorParams struct
  struct MotorParams {
    Adafruit_DCMotor *motor;
    int direction;
    int speed;
    int duration;
  };

  MotorParams* motorParams;

  static void motorTask(void *param);
  static void runMotor(MotorParams *motorParam);
  
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
  void stop();
  void unknownMove();

 public:
  void initRover();
  void testRover();

  String getData();
  float getTemperature();
  float getDistance();
  void executeMove(JsonDocument doc);

  // Test related methods
  using Move = void (Rover::*)(int, int);
  void testMove(Move move);
};

#endif

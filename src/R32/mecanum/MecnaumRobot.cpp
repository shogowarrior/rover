#include "MecanumRobot.h"

Adafruit_MotorShield AFMS = Adafruit_MotorShield();

Adafruit_DCMotor *frontLeft;
Adafruit_DCMotor *frontRight;
Adafruit_DCMotor *rearLeft;
Adafruit_DCMotor *rearRight;

void MecanumRobot::initRobot() {
  AFMS.begin();
  rearLeft = AFMS.getMotor(MOTOR2_A);
  rearRight = AFMS.getMotor(MOTOR1_A);
  frontRight = AFMS.getMotor(MOTOR1_B);
  frontLeft = AFMS.getMotor(MOTOR2_B);
}

// Run a motor
void MecanumRobot::runMotor(MotorParams motorParam) {
  motorParam.motor->setSpeed(motorParam.speed);
  motorParam.motor->run(motorParam.direction);
}

void MecanumRobot::runMotors(MotorParams motorParams[]) {
  int numMotors = 4;
  for (int i = 0; i < numMotors; i++) {
    runMotor(motorParams[i]);
  }
}

void MecanumRobot::stop() {
  MotorParams motorParams[] = {
      {frontLeft, RELEASE, 0},
      {frontRight, RELEASE, 0},
      {rearRight, RELEASE, 0},
      {rearLeft, RELEASE, 0}};
  runMotors(motorParams);
}

void MecanumRobot::moveForward(int speed, int duration) {
  MotorParams motorParams[] = {
      {frontLeft, FORWARD, (uint8_t)speed},
      {frontRight, FORWARD, (uint8_t)speed},
      {rearRight, FORWARD, (uint8_t)speed},
      {rearLeft, FORWARD, (uint8_t)speed}};
  runMotors(motorParams);
}

void MecanumRobot::moveBackward(int speed, int duration) {
  MotorParams motorParams[] = {
      {frontLeft, BACKWARD, (uint8_t)speed},
      {frontRight, BACKWARD, (uint8_t)speed},
      {rearRight, BACKWARD, (uint8_t)speed},
      {rearLeft, BACKWARD, (uint8_t)speed}};
  runMotors(motorParams);
}

void MecanumRobot::moveLeft(int speed, int duration) {
  MotorParams motorParams[] = {
      {frontLeft, BACKWARD, (uint8_t)speed},
      {frontRight, FORWARD, (uint8_t)speed},
      {rearRight, BACKWARD, (uint8_t)speed},
      {rearLeft, FORWARD, (uint8_t)speed}};
  runMotors(motorParams);
}

void MecanumRobot::moveRight(int speed, int duration) {
  MotorParams motorParams[] = {
      {frontLeft, FORWARD, (uint8_t)speed},
      {frontRight, BACKWARD, (uint8_t)speed},
      {rearRight, FORWARD, (uint8_t)speed},
      {rearLeft, BACKWARD, (uint8_t)speed}};
  runMotors(motorParams);
}

void MecanumRobot::rotateClockwise(int speed, int duration) {
  MotorParams motorParams[] = {
      {frontLeft, BACKWARD, (uint8_t)speed},
      {frontRight, FORWARD, (uint8_t)speed},
      {rearRight, FORWARD, (uint8_t)speed},
      {rearLeft, BACKWARD, (uint8_t)speed}};
  runMotors(motorParams);
}

void MecanumRobot::rotateCounterClockwise(int speed, int duration) {
  MotorParams motorParams[] = {
      {frontLeft, FORWARD, (uint8_t)speed},
      {frontRight, BACKWARD, (uint8_t)speed},
      {rearRight, BACKWARD, (uint8_t)speed},
      {rearLeft, FORWARD, (uint8_t)speed}};
  runMotors(motorParams);
}

void MecanumRobot::moveDiagonal45(int speed, int duration) {
  MotorParams motorParams[] = {
      {frontLeft, FORWARD, (uint8_t)speed},
      {frontRight, RELEASE, 0},
      {rearRight, FORWARD, (uint8_t)speed},
      {rearLeft, RELEASE, 0}};
  runMotors(motorParams);
}

void MecanumRobot::moveDiagonal135(int speed, int duration) {
  MotorParams motorParams[] = {
      {frontLeft, RELEASE, 0},
      {frontRight, FORWARD, (uint8_t)speed},
      {rearRight, RELEASE, 0},
      {rearLeft, FORWARD, (uint8_t)speed}};
  runMotors(motorParams);
}

void MecanumRobot::moveDiagonal225(int speed, int duration) {
  MotorParams motorParams[] = {
      {frontLeft, BACKWARD, (uint8_t)speed},
      {frontRight, RELEASE, 0},
      {rearRight, BACKWARD, (uint8_t)speed},
      {rearLeft, RELEASE, 0}};
  runMotors(motorParams);
}

void MecanumRobot::moveDiagonal315(int speed, int duration) {
  MotorParams motorParams[] = {
      {frontLeft, RELEASE, 0},
      {frontRight, BACKWARD, (uint8_t)speed},
      {rearRight, RELEASE, 0},
      {rearLeft, BACKWARD, (uint8_t)speed}};
  runMotors(motorParams);
}

void MecanumRobot::pivotRightForward(int speed, int duration) {
  MotorParams motorParams[] = {
      {frontLeft, RELEASE, 0},
      {frontRight, BACKWARD, (uint8_t)speed},
      {rearRight, BACKWARD, (uint8_t)speed},
      {rearLeft, RELEASE, 0}};
  runMotors(motorParams);
}

void MecanumRobot::pivotRightBackward(int speed, int duration) {
  MotorParams motorParams[] = {
      {frontLeft, RELEASE, 0},
      {frontRight, FORWARD, (uint8_t)speed},
      {rearRight, FORWARD, (uint8_t)speed},
      {rearLeft, RELEASE, 0}};
  runMotors(motorParams);
}

void MecanumRobot::pivotLeftForward(int speed, int duration) {
  MotorParams motorParams[] = {
      {frontLeft, BACKWARD, (uint8_t)speed},
      {frontRight, RELEASE, 0},
      {rearRight, RELEASE, 0},
      {rearLeft, BACKWARD, (uint8_t)speed}};
  runMotors(motorParams);
}

void MecanumRobot::pivotLeftBackward(int speed, int duration) {
  MotorParams motorParams[] = {
      {frontLeft, FORWARD, (uint8_t)speed},
      {frontRight, RELEASE, 0},
      {rearRight, RELEASE, 0},
      {rearLeft, FORWARD, (uint8_t)speed}};
  runMotors(motorParams);
}

void MecanumRobot::pivotSidewaysForwardRight(int speed, int duration) {
  MotorParams motorParams[] = {
      {frontLeft, FORWARD, (uint8_t)speed},
      {frontRight, BACKWARD, (uint8_t)speed},
      {rearRight, RELEASE, 0},
      {rearLeft, RELEASE, 0}};
  runMotors(motorParams);
}

void MecanumRobot::pivotSidewaysForwardLeft(int speed, int duration) {
  MotorParams motorParams[] = {
      {frontLeft, RELEASE, 0},
      {frontRight, RELEASE, 0},
      {rearRight, BACKWARD, (uint8_t)speed},
      {rearLeft, FORWARD, (uint8_t)speed}};
  runMotors(motorParams);
}

void MecanumRobot::pivotSidewaysBackwardRight(int speed, int duration) {
  MotorParams motorParams[] = {
      {frontLeft, RELEASE, 0},
      {frontRight, FORWARD, (uint8_t)speed},
      {rearRight, RELEASE, 0},
      {rearLeft, BACKWARD, (uint8_t)speed}};
  runMotors(motorParams);
}

void MecanumRobot::pivotSidewaysBackwardLeft(int speed, int duration) {
  MotorParams motorParams[] = {
      {frontLeft, FORWARD, (uint8_t)speed},
      {frontRight, RELEASE, 0},
      {rearRight, BACKWARD, (uint8_t)speed},
      {rearLeft, RELEASE, 0}};
  runMotors(motorParams);
}

void MecanumRobot::unknownCommand() {
  // Handle unknown command
}

void MecanumRobot::executeCommand(JsonDocument doc) {
  int command = doc["command"].as<int>();
  int speed = doc["speed"].as<int>();
  int duration = 100;

  switch (command) {
    case MOVE_FORWARD:
      moveForward(speed, duration);
      break;
    case MOVE_BACKWARD:
      moveBackward(speed, duration);
      break;
    case MOVE_RIGHT:
      moveRight(speed, duration);
      break;
    case MOVE_LEFT:
      moveLeft(speed, duration);
      break;
    case MOVE_DIAGONAL45:
      moveDiagonal45(speed, duration);
      break;
    case MOVE_DIAGONAL135:
      moveDiagonal135(speed, duration);
      break;
    case MOVE_DIAGONAL225:
      moveDiagonal225(speed, duration);
      break;
    case MOVE_DIAGONAL315:
      moveDiagonal315(speed, duration);
      break;
    case PIVOT_RIGHT_FORWARD:
      pivotRightForward(speed, duration);
      break;
    case PIVOT_RIGHT_BACKWARD:
      pivotRightBackward(speed, duration);
      break;
    case PIVOT_LEFT_FORWARD:
      pivotLeftForward(speed, duration);
      break;
    case PIVOT_LEFT_BACKWARD:
      pivotLeftBackward(speed, duration);
      break;
    case PIVOT_SIDEWAYS_FORWARD_RIGHT:
      pivotSidewaysForwardRight(speed, duration);
      break;
    case PIVOT_SIDEWAYS_FORWARD_LEFT:
      pivotSidewaysForwardLeft(speed, duration);
      break;
    case PIVOT_SIDEWAYS_BACKWARD_RIGHT:
      pivotSidewaysBackwardRight(speed, duration);
      break;
    case PIVOT_SIDEWAYS_BACKWARD_LEFT:
      pivotSidewaysBackwardLeft(speed, duration);
      break;
    case STOP:
      stop();
      break;
    case ROTATE_CLOCKWISE:
      rotateClockwise(speed, duration);
      break;
    case ROTATE_COUNTERCLOCKWISE:
      rotateCounterClockwise(speed, duration);
      break;
    default:
      unknownCommand();
      break;
  }
}



void MecanumRobot::testMove(Move move) {
  (this->*move)(DEFAULT_SPEED, DEFAULT_TIME);
}

// Test Wheels
void MecanumRobot::testRobot() {
  testMove(&MecanumRobot::moveForward);
  testMove(&MecanumRobot::moveBackward);
  testMove(&MecanumRobot::moveRight);
  testMove(&MecanumRobot::moveLeft);
  testMove(&MecanumRobot::rotateClockwise);
  testMove(&MecanumRobot::rotateCounterClockwise);
  // testMove(&MecanumRobot::moveDiagonal45);
  // testMove(&MecanumRobot::moveDiagonal135);
  // testMove(&MecanumRobot::moveDiagonal225);
  // testMove(&MecanumRobot::moveDiagonal315);
  // testMove(&MecanumRobot::pivotRightForward);
  // testMove(&MecanumRobot::pivotRightBackward);
  // testMove(&MecanumRobot::pivotLeftForward);
  // testMove(&MecanumRobot::pivotLeftBackward);
  // testMove(&MecanumRobot::pivotSidewaysForwardRight);
  // testMove(&MecanumRobot::pivotSidewaysForwardLeft);
  // testMove(&MecanumRobot::pivotSidewaysBackwardRight);
  // testMove(&MecanumRobot::pivotSidewaysBackwardLeft);
}
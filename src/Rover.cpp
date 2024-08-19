#include "common.h"

Ultrasonic sonar(12, 13);

void Rover::initRover() {
  AFMS.begin();
  rearLeft = AFMS.getMotor(MOTOR2_A);
  rearRight = AFMS.getMotor(MOTOR1_A);
  frontRight = AFMS.getMotor(MOTOR1_B);
  frontLeft = AFMS.getMotor(MOTOR2_B);
  sonar.setTimeout(SONAR_TIMEOUT);
}

// Run a motor
void Rover::runMotor(MotorParams motorParam) {
  motorParam.motor->setSpeed(motorParam.speed);
  motorParam.motor->run(motorParam.direction);
}

void Rover::runMotors(MotorParams motorParams[]) {
  int numMotors = 4;
  for (int i = 0; i < numMotors; i++) {
    runMotor(motorParams[i]);
  }
}

void Rover::stop() {
  MotorParams motorParams[] = {
      {frontLeft, RELEASE, 0},
      {frontRight, RELEASE, 0},
      {rearRight, RELEASE, 0},
      {rearLeft, RELEASE, 0}};
  runMotors(motorParams);
}

void Rover::moveForward(int speed, int duration) {
  MotorParams motorParams[] = {
      {frontLeft, FORWARD, (uint8_t)speed},
      {frontRight, FORWARD, (uint8_t)speed},
      {rearRight, FORWARD, (uint8_t)speed},
      {rearLeft, FORWARD, (uint8_t)speed}};
  runMotors(motorParams);
}

void Rover::moveBackward(int speed, int duration) {
  MotorParams motorParams[] = {
      {frontLeft, BACKWARD, (uint8_t)speed},
      {frontRight, BACKWARD, (uint8_t)speed},
      {rearRight, BACKWARD, (uint8_t)speed},
      {rearLeft, BACKWARD, (uint8_t)speed}};
  runMotors(motorParams);
}

void Rover::moveLeft(int speed, int duration) {
  MotorParams motorParams[] = {
      {frontLeft, BACKWARD, (uint8_t)speed},
      {frontRight, FORWARD, (uint8_t)speed},
      {rearRight, BACKWARD, (uint8_t)speed},
      {rearLeft, FORWARD, (uint8_t)speed}};
  runMotors(motorParams);
}

void Rover::moveRight(int speed, int duration) {
  MotorParams motorParams[] = {
      {frontLeft, FORWARD, (uint8_t)speed},
      {frontRight, BACKWARD, (uint8_t)speed},
      {rearRight, FORWARD, (uint8_t)speed},
      {rearLeft, BACKWARD, (uint8_t)speed}};
  runMotors(motorParams);
}

void Rover::rotateClockwise(int speed, int duration) {
  MotorParams motorParams[] = {
      {frontLeft, BACKWARD, (uint8_t)speed},
      {frontRight, FORWARD, (uint8_t)speed},
      {rearRight, FORWARD, (uint8_t)speed},
      {rearLeft, BACKWARD, (uint8_t)speed}};
  runMotors(motorParams);
}

void Rover::rotateCounterClockwise(int speed, int duration) {
  MotorParams motorParams[] = {
      {frontLeft, FORWARD, (uint8_t)speed},
      {frontRight, BACKWARD, (uint8_t)speed},
      {rearRight, BACKWARD, (uint8_t)speed},
      {rearLeft, FORWARD, (uint8_t)speed}};
  runMotors(motorParams);
}

void Rover::moveDiagonal45(int speed, int duration) {
  MotorParams motorParams[] = {
      {frontLeft, FORWARD, (uint8_t)speed},
      {frontRight, RELEASE, 0},
      {rearRight, FORWARD, (uint8_t)speed},
      {rearLeft, RELEASE, 0}};
  runMotors(motorParams);
}

void Rover::moveDiagonal135(int speed, int duration) {
  MotorParams motorParams[] = {
      {frontLeft, RELEASE, 0},
      {frontRight, FORWARD, (uint8_t)speed},
      {rearRight, RELEASE, 0},
      {rearLeft, FORWARD, (uint8_t)speed}};
  runMotors(motorParams);
}

void Rover::moveDiagonal225(int speed, int duration) {
  MotorParams motorParams[] = {
      {frontLeft, BACKWARD, (uint8_t)speed},
      {frontRight, RELEASE, 0},
      {rearRight, BACKWARD, (uint8_t)speed},
      {rearLeft, RELEASE, 0}};
  runMotors(motorParams);
}

void Rover::moveDiagonal315(int speed, int duration) {
  MotorParams motorParams[] = {
      {frontLeft, RELEASE, 0},
      {frontRight, BACKWARD, (uint8_t)speed},
      {rearRight, RELEASE, 0},
      {rearLeft, BACKWARD, (uint8_t)speed}};
  runMotors(motorParams);
}

void Rover::pivotRightForward(int speed, int duration) {
  MotorParams motorParams[] = {
      {frontLeft, RELEASE, 0},
      {frontRight, BACKWARD, (uint8_t)speed},
      {rearRight, BACKWARD, (uint8_t)speed},
      {rearLeft, RELEASE, 0}};
  runMotors(motorParams);
}

void Rover::pivotRightBackward(int speed, int duration) {
  MotorParams motorParams[] = {
      {frontLeft, RELEASE, 0},
      {frontRight, FORWARD, (uint8_t)speed},
      {rearRight, FORWARD, (uint8_t)speed},
      {rearLeft, RELEASE, 0}};
  runMotors(motorParams);
}

void Rover::pivotLeftForward(int speed, int duration) {
  MotorParams motorParams[] = {
      {frontLeft, BACKWARD, (uint8_t)speed},
      {frontRight, RELEASE, 0},
      {rearRight, RELEASE, 0},
      {rearLeft, BACKWARD, (uint8_t)speed}};
  runMotors(motorParams);
}

void Rover::pivotLeftBackward(int speed, int duration) {
  MotorParams motorParams[] = {
      {frontLeft, FORWARD, (uint8_t)speed},
      {frontRight, RELEASE, 0},
      {rearRight, RELEASE, 0},
      {rearLeft, FORWARD, (uint8_t)speed}};
  runMotors(motorParams);
}

void Rover::pivotSidewaysForwardRight(int speed, int duration) {
  MotorParams motorParams[] = {
      {frontLeft, FORWARD, (uint8_t)speed},
      {frontRight, BACKWARD, (uint8_t)speed},
      {rearRight, RELEASE, 0},
      {rearLeft, RELEASE, 0}};
  runMotors(motorParams);
}

void Rover::pivotSidewaysForwardLeft(int speed, int duration) {
  MotorParams motorParams[] = {
      {frontLeft, RELEASE, 0},
      {frontRight, RELEASE, 0},
      {rearRight, BACKWARD, (uint8_t)speed},
      {rearLeft, FORWARD, (uint8_t)speed}};
  runMotors(motorParams);
}

void Rover::pivotSidewaysBackwardRight(int speed, int duration) {
  MotorParams motorParams[] = {
      {frontLeft, RELEASE, 0},
      {frontRight, FORWARD, (uint8_t)speed},
      {rearRight, RELEASE, 0},
      {rearLeft, BACKWARD, (uint8_t)speed}};
  runMotors(motorParams);
}

void Rover::pivotSidewaysBackwardLeft(int speed, int duration) {
  MotorParams motorParams[] = {
      {frontLeft, FORWARD, (uint8_t)speed},
      {frontRight, RELEASE, 0},
      {rearRight, BACKWARD, (uint8_t)speed},
      {rearLeft, RELEASE, 0}};
  runMotors(motorParams);
}

void Rover::unknownMove() {
  // Handle unknown command
}

void Rover::executeMove(JsonDocument doc) {
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
      unknownMove();
      break;
  }
}

float Rover::getTemperature() {
  int tempRaw = (int)temperatureRead();
  return (tempRaw / 2.0) + 25.0; // Adjust calibration
}

unsigned int Rover::getDistance() {
  return sonar.read();
}

String Rover::getData() {
  JsonDocument doc;
  doc["distance"] = getDistance();
  doc["temperature"] = getTemperature();
  String jsonStr;
  serializeJson(doc, jsonStr);
  return jsonStr;
}

// void Rover::testMove(Move move) {
//   (this->*move)(DEFAULT_SPEED, DEFAULT_TIME);
// }

// // Test Wheels
// void Rover::testRobot() {
//   testMove(&Rover::moveForward);
//   testMove(&Rover::moveBackward);
//   testMove(&Rover::moveRight);
//   testMove(&Rover::moveLeft);
//   testMove(&Rover::rotateClockwise);
//   testMove(&Rover::rotateCounterClockwise);
//   testMove(&Rover::moveDiagonal45);
//   testMove(&Rover::moveDiagonal135);
//   testMove(&Rover::moveDiagonal225);
//   testMove(&Rover::moveDiagonal315);
//   testMove(&Rover::pivotRightForward);
//   testMove(&Rover::pivotRightBackward);
//   testMove(&Rover::pivotLeftForward);
//   testMove(&Rover::pivotLeftBackward);
//   testMove(&Rover::pivotSidewaysForwardRight);
//   testMove(&Rover::pivotSidewaysForwardLeft);
//   testMove(&Rover::pivotSidewaysBackwardRight);
//   testMove(&Rover::pivotSidewaysBackwardLeft);
// }
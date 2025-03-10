#include "common.h"

void testMotor(Adafruit_DCMotor *motor) {
  motor->fullOn();
  motor->run(FORWARD);
  delay(1000);
  motor->fullOff();
}

void Rover::initRover() {
  AFMS.begin();
  rearLeft = AFMS.getMotor(MOTOR1_B);
  frontRight = AFMS.getMotor(MOTOR2_A);
  rearRight = AFMS.getMotor(MOTOR2_B);
  frontLeft = AFMS.getMotor(MOTOR1_A);
  motorParams = new MotorParams[4];

  // Setup Sonar
  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);
}

// run single motor
void Rover::runMotor(MotorParams *motorParam) {
  motorParam->motor->setSpeed(motorParam->speed);
  motorParam->motor->run(motorParam->direction);
}

// motor task
void Rover::motorTask(void *param) {
  MotorParams *motorParam = (MotorParams *)param;
  motorParam->motor->setSpeed(motorParam->speed);
  motorParam->motor->run(motorParam->direction);
  vTaskDelay(motorParam->duration / portTICK_PERIOD_MS);

  motorParam->motor->setSpeed(0);
  motorParam->motor->run(RELEASE);
  vTaskDelete(NULL);
}

void Rover::runMotors(MotorParams motorParams[]) {
  int numMotors = 4;
  for (int i = 0; i < numMotors; i++) {
    Serial.printf("SPEED1 : %u", motorParams[i].speed);
    Serial.println();
    xTaskCreate(motorTask, "motorTask", 8192, (void *)&motorParams[i], 1, NULL);
  }
}

void Rover::stop() {
  motorParams[0] = {frontLeft, RELEASE, 0},
  motorParams[1] = {frontRight, RELEASE, 0},
  motorParams[2] = {rearRight, RELEASE, 0},
  motorParams[3] = {rearLeft, RELEASE, 0};
  runMotors(motorParams);
}

void Rover::moveForward(int speed, int duration) {
  motorParams[0] = {frontLeft, FORWARD, speed, duration};
  motorParams[1] = {frontRight, FORWARD, speed, duration};
  motorParams[2] = {rearRight, FORWARD, speed, duration};
  motorParams[3] = {rearLeft, FORWARD, speed, duration};
  runMotors(motorParams);
}

void Rover::moveBackward(int speed, int duration) {
  motorParams[0] = {frontLeft, BACKWARD, speed, duration},
  motorParams[1] = {frontRight, BACKWARD, speed, duration},
  motorParams[2] = {rearRight, BACKWARD, speed, duration},
  motorParams[3] = {rearLeft, BACKWARD, speed, duration};
  runMotors(motorParams);
}

void Rover::moveLeft(int speed, int duration) {
  motorParams[0] = {frontLeft, BACKWARD, speed, duration},
  motorParams[1] = {frontRight, FORWARD, speed, duration},
  motorParams[2] = {rearRight, BACKWARD, speed, duration},
  motorParams[3] = {rearLeft, FORWARD, speed, duration};
  runMotors(motorParams);
}

void Rover::moveRight(int speed, int duration) {
  motorParams[0] = {frontLeft, FORWARD, speed, duration},
  motorParams[1] = {frontRight, BACKWARD, speed, duration},
  motorParams[2] = {rearRight, FORWARD, speed, duration},
  motorParams[3] = {rearLeft, BACKWARD, speed, duration};
  runMotors(motorParams);
}

void Rover::rotateClockwise(int speed, int duration) {
  motorParams[0] = {frontLeft, FORWARD, speed, duration},
  motorParams[1] = {frontRight, BACKWARD, speed, duration},
  motorParams[2] = {rearRight, BACKWARD, speed, duration},
  motorParams[3] = {rearLeft, FORWARD, speed, duration};
  runMotors(motorParams);
}

void Rover::rotateCounterClockwise(int speed, int duration) {
  motorParams[0] = {frontLeft, BACKWARD, speed, duration},
  motorParams[1] = {frontRight, FORWARD, speed, duration},
  motorParams[2] = {rearRight, FORWARD, speed, duration},
  motorParams[3] = {rearLeft, BACKWARD, speed, duration};
  runMotors(motorParams);
}

void Rover::moveDiagonal45(int speed, int duration) {
  motorParams[0] = {frontLeft, FORWARD, speed, duration},
  motorParams[1] = {frontRight, RELEASE, 0},
  motorParams[2] = {rearRight, FORWARD, speed, duration},
  motorParams[3] = {rearLeft, RELEASE, 0};
  runMotors(motorParams);
}

void Rover::moveDiagonal135(int speed, int duration) {
  motorParams[0] = {frontLeft, RELEASE, 0},
  motorParams[1] = {frontRight, FORWARD, speed, duration},
  motorParams[2] = {rearRight, RELEASE, 0},
  motorParams[3] = {rearLeft, FORWARD, speed, duration};
  runMotors(motorParams);
}

void Rover::moveDiagonal225(int speed, int duration) {
  motorParams[0] = {frontLeft, BACKWARD, speed, duration},
  motorParams[1] = {frontRight, RELEASE, 0},
  motorParams[2] = {rearRight, BACKWARD, speed, duration},
  motorParams[3] = {rearLeft, RELEASE, 0};
  runMotors(motorParams);
}

void Rover::moveDiagonal315(int speed, int duration) {
  motorParams[0] = {frontLeft, RELEASE, 0},
  motorParams[1] = {frontRight, BACKWARD, speed, duration},
  motorParams[2] = {rearRight, RELEASE, 0},
  motorParams[3] = {rearLeft, BACKWARD, speed, duration};
  runMotors(motorParams);
}

void Rover::pivotRightForward(int speed, int duration) {
  motorParams[0] = {frontLeft, RELEASE, 0},
  motorParams[1] = {frontRight, BACKWARD, speed, duration},
  motorParams[2] = {rearRight, BACKWARD, speed, duration},
  motorParams[3] = {rearLeft, RELEASE, 0};
  runMotors(motorParams);
}

void Rover::pivotRightBackward(int speed, int duration) {
  motorParams[0] = {frontLeft, RELEASE, 0},
  motorParams[1] = {frontRight, FORWARD, speed, duration},
  motorParams[2] = {rearRight, FORWARD, speed, duration},
  motorParams[3] = {rearLeft, RELEASE, 0};
  runMotors(motorParams);
}

void Rover::pivotLeftForward(int speed, int duration) {
  motorParams[0] = {frontLeft, BACKWARD, speed, duration},
  motorParams[1] = {frontRight, RELEASE, 0},
  motorParams[2] = {rearRight, RELEASE, 0},
  motorParams[3] = {rearLeft, BACKWARD, speed, duration};
  runMotors(motorParams);
}

void Rover::pivotLeftBackward(int speed, int duration) {
  motorParams[0] = {frontLeft, FORWARD, speed, duration},
  motorParams[1] = {frontRight, RELEASE, 0},
  motorParams[2] = {rearRight, RELEASE, 0},
  motorParams[3] = {rearLeft, FORWARD, speed, duration};
  runMotors(motorParams);
}

void Rover::pivotSidewaysForwardRight(int speed, int duration) {
  motorParams[0] = {frontLeft, FORWARD, speed, duration},
  motorParams[1] = {frontRight, BACKWARD, speed, duration},
  motorParams[2] = {rearRight, RELEASE, 0},
  motorParams[3] = {rearLeft, RELEASE, 0};
  runMotors(motorParams);
}

void Rover::pivotSidewaysForwardLeft(int speed, int duration) {
  motorParams[0] = {frontLeft, RELEASE, 0},
  motorParams[1] = {frontRight, RELEASE, 0},
  motorParams[2] = {rearRight, BACKWARD, speed, duration},
  motorParams[3] = {rearLeft, FORWARD, speed, duration};
  runMotors(motorParams);
}

void Rover::pivotSidewaysBackwardRight(int speed, int duration) {
  motorParams[0] = {frontLeft, RELEASE, 0},
  motorParams[1] = {frontRight, FORWARD, speed, duration},
  motorParams[2] = {rearRight, RELEASE, 0},
  motorParams[3] = {rearLeft, BACKWARD, speed, duration};
  runMotors(motorParams);
}

void Rover::pivotSidewaysBackwardLeft(int speed, int duration) {
  motorParams[0] = {frontLeft, FORWARD, speed, duration},
  motorParams[1] = {frontRight, RELEASE, 0},
  motorParams[2] = {rearRight, BACKWARD, speed, duration},
  motorParams[3] = {rearLeft, RELEASE, 0};
  runMotors(motorParams);
}

void Rover::unknownMove() {
  // Handle unknown command
}

void Rover::executeMove(JsonDocument input) {
  int move = input["move"].as<int>();
  int speed = input["speed"].as<int>();
  int duration = input["duration"].as<int>();

  switch (move) {
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
  int temp = (int)temperatureRead();
  return (temp / 2.0) + 25.0;  // Adjust calibration
}

float Rover::getDistance() {
  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(2);
  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);

  long duration = pulseIn(ECHO_PIN, HIGH);
  float distance = (duration / 2.0) * _CM;
  return distance;
}

float Rover::getLastMove() {
  if 
}

String Rover::getData() {
  JsonDocument doc;
  doc["distance"] = getDistance();
  doc["temperature"] = getTemperature();
  doc["move"] = getLastMove();

  String jsonStr;
  serializeJson(doc, jsonStr);
  return jsonStr;
}

// void Rover::testMove(Move move) {
//   (this->*move)(MOTOR_SPEED, DEFAULT_TIME);
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
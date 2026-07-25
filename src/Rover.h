#ifndef ROVER_H
#define ROVER_H

#include <Adafruit_MotorShield.h>
#include <ArduinoJson.h>
#include <ESP32Servo.h>
#include <HCSR04.h>

#include "Kinematics.h"

#define SERVO_PIN 27
#define TRIG_PIN_1 14

// KNOWN HAZARD, NOT YET FIXED -- fixing it means rewiring the robot.
//
// GPIO12 is the ESP32's MTDI strapping pin, exposed as the innocuous-looking
// D8 on the D1 R32 silkscreen. If it is held high at reset the chip switches
// its flash regulator to 1.8 V and the board does not boot. An ultrasonic echo
// line sits high mid-pulse, so this shows up as an intermittent boot failure
// that reads like a flaky power supply.
//
// The fix is to move this echo line to GPIO34 (A3), which is input-only and
// has no strapping role. That requires moving the wire on the board, so it is
// the operator's call, not a code change to make unilaterally. Run /pin-audit
// when you decide to do it.
#define ECHO_PIN_1 12

#define TRIG_PIN_2 18
#define ECHO_PIN_2 19

class Rover {
 public:
  // Autonomous exploration and remote control both want to drive the motors.
  // Only one may. Without this arbitration `explore()` overwrites every
  // incoming command a few milliseconds after it lands, which made the entire
  // WebSocket control path inert.
  enum Mode { MODE_AUTONOMOUS, MODE_MANUAL };

  Rover()
      : rotatingSensor(TRIG_PIN_1, ECHO_PIN_1),
        bottomSensor(TRIG_PIN_2, ECHO_PIN_2) {}

  void initRover();

  // Called every loop. Releases the motors when the current move's deadline
  // passes and when a manual client goes quiet. Nothing else stops them.
  void update();

  // One non-blocking step of autonomous exploration. Returns immediately
  // unless the mode is MODE_AUTONOMOUS.
  void explore();

  // Apply a command from an untrusted source. Speed and duration are clamped
  // here, at the boundary, rather than at each call site. Both entry points
  // switch the rover into MODE_MANUAL and refresh the deadman timer.
  void executeMove(JsonVariantConst json);
  void command(MoveCode move, int speed, int durationMs);

  void stop();

  void setMode(Mode mode);
  Mode mode() const { return currentMode; }

  String getData();
  float getTemperature();

 private:
  static const int MOTOR_COUNT = 4;
  static const int SCAN_POINTS = 3;

  // Where the scanner servo points, and which reading each angle produces.
  // Index 0 is the rover's left. Verify against the servo's mounting before
  // trusting the left/right telemetry.
  static const int SCAN_LEFT = 0;
  static const int SCAN_FRONT = 1;
  static const int SCAN_RIGHT = 2;

  enum ScanState {
    SCAN_AIM,      // point the servo at the next angle
    SCAN_SETTLE,   // wait for it to arrive, then measure
    SCAN_DRIVING,  // a move is in flight; wait it out before rescanning
  };

  UltraSonicDistanceSensor rotatingSensor;
  UltraSonicDistanceSensor bottomSensor;
  Adafruit_MotorShield AFMS;

  // Index order is fixed and matches the pattern table in Rover.cpp:
  // 0 front-left, 1 front-right, 2 rear-right, 3 rear-left.
  Adafruit_DCMotor *motors[MOTOR_COUNT];
  Servo servo;
  JsonDocument doc;

  Mode currentMode = MODE_AUTONOMOUS;

  // 0 means "motors idle". Any other value is a millis() timestamp at which
  // update() releases them.
  unsigned long moveDeadline = 0;
  unsigned long lastCommandMs = 0;

  ScanState scanState = SCAN_AIM;
  int scanIndex = 0;
  unsigned long scanTimer = 0;
  float distances[SCAN_POINTS];

  bool isMoving() const { return moveDeadline != 0; }
  void applyMove(MoveCode move, int speed, int durationMs);
  void releaseMotors();
  float readDistance(UltraSonicDistanceSensor &sensor);
};

#endif

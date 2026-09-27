#include "Scanner.h"

#include "Pins.h"

Scanner::Scanner()
    : scanSensor(pins::SCAN_TRIG, pins::SCAN_ECHO),
      bottomSensor(pins::BOTTOM_TRIG, pins::BOTTOM_ECHO) {}

void Scanner::begin() {
  servo.attach(pins::SERVO);
  servo.write(90);
}

void Scanner::aim(int servoDeg) { servo.write(servoDeg); }

float Scanner::measureCm() { return scanSensor.measureDistanceCm(); }

float Scanner::measureBottomCm() { return bottomSensor.measureDistanceCm(); }

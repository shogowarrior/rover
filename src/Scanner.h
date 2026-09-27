#ifndef SCANNER_H
#define SCANNER_H

#include <ESP32Servo.h>
#include <HCSR04.h>

#include "Hardware.h"

// The servo-mounted HC-SR04 that Explorer looks through, and the rover's
// second HC-SR04.
//
// Both sensors are constructed with the rover -- the library sets their pin
// modes in its constructor, which keeps the second sensor's TRIG line driven
// low even though nothing reads it.
class Scanner : public RangeScanner {
 public:
  Scanner();

  void begin();

  void aim(int servoDeg) override;

  // Busy-waits for the echo: up to ~29 ms at the library's 400 cm range. This
  // is the only routine busy-wait on the loop (a WebSocket handshake and an
  // OTA upload block longer; see AGENTS.md).
  float measureCm() override;

  // The second HC-SR04. Wired and powered, but where it points is
  // undocumented, so nothing calls this yet. Once its mounting is confirmed,
  // Explorer can schedule it -- one ping in flight at a time across both
  // sensors, or they hear each other.
  float measureBottomCm();

 private:
  UltraSonicDistanceSensor scanSensor;
  UltraSonicDistanceSensor bottomSensor;
  Servo servo;
};

#endif

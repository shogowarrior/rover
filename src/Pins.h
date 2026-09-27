#ifndef PINS_H
#define PINS_H

#include <stdint.h>

// Every GPIO and motor-terminal assignment, in one place.
//
// A value here is a HARDWARE CHANGE: it describes where a wire is soldered.
// Changing one without rewiring the robot breaks it, so never change one
// unprompted -- report it and let the operator decide. Run /pin-audit when
// touching pins or adding a peripheral.
//
// Numbers are ESP32 GPIOs, not the Wemos D1 R32's UNO-style silkscreen labels;
// the two differ (D8 on the silkscreen is GPIO12). The motor shield uses I2C
// on the Wire defaults, SDA GPIO21 and SCL GPIO22.

namespace pins {

// Scanner: an HC-SR04 on a servo, on the top deck.
constexpr uint8_t SERVO = 27;
constexpr uint8_t SCAN_TRIG = 14;

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
// the operator's call, not a code change to make unilaterally.
constexpr uint8_t SCAN_ECHO = 12;

// A second HC-SR04. Wired and powered, but where it points is undocumented,
// so nothing reads it yet (see Scanner::measureBottomCm).
constexpr uint8_t BOTTOM_TRIG = 18;
constexpr uint8_t BOTTOM_ECHO = 19;

// Adafruit Motor Shield V2 terminal (M1..M4) driving each wheel, indexed in
// the Wheel order of MovePatterns.h: front-left, front-right, rear-right,
// rear-left. These are the values the firmware has always used -- it spelled
// them MOTOR1_A, MOTOR2_A, MOTOR2_B, MOTOR1_B, which are AFMotor V1 latch-bit
// macros that happen to equal 2, 1, 4, 3.
//
// docs/Readme.md's terminal table disagrees (it puts M4 front-left). One of
// the two is wrong; docs/bench-checklist.md says how to find out which.
constexpr uint8_t MOTOR_TERMINAL[4] = {2, 1, 4, 3};

}  // namespace pins

#endif

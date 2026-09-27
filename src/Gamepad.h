#ifndef GAMEPAD_H
#define GAMEPAD_H

#include <stdint.h>

#include "Kinematics.h"
#include "Rover.h"

// PS3 gamepad input, compiled in only when ROVER_ENABLE_GAMEPAD is set (see
// Features.h). Without it, begin() and update() do nothing.
//
// The left stick translates in all eight directions, L2 and R2 rotate left
// and right, and START hands control back to autonomous exploration.
//
// The PS3 library reports on its Bluetooth task (core 0), while the rest of
// the firmware runs on the loop task (core 1). Its callback therefore only
// copies the controls into a small locked mailbox; update(), on the loop task,
// is the only thing that talks to the rover. That keeps the motor state and
// the four-wheel I2C writes single-threaded.
class Gamepad {
 public:
  explicit Gamepad(Rover& rover);

  // Pair with the controller. `hostMac` is the address stored in the pad.
  void begin(const char* hostMac);

  // Call every loop. Forwards the controls to the rover: a held stick is
  // re-sent every tuning::GAMEPAD_REFRESH_MS so the rover keeps moving, a
  // release sends one STOP, and a pad that goes silent stops what it drove.
  void update(uint32_t now);

 private:
  Rover& rover;
  bool started = false;
  bool driving = false;  // the last thing sent was a motion
  kinematics::DriveRequest lastSent = {STOP, 0};
  uint32_t lastSentMs = 0;
};

#endif

#ifndef GAMEPAD_H
#define GAMEPAD_H

#include <stdint.h>

#include "GamepadSession.h"
#include "Rover.h"

// PS3 gamepad input, compiled in only when ROVER_ENABLE_GAMEPAD is set (see
// Features.h). Without it, begin() and update() do nothing.
//
// The left stick translates in all eight directions, L2 rotates left
// (counter-clockwise) and R2 right, and START hands control back to
// autonomous exploration. SELECT toggles the control scheme; under ADVANCED,
// holding L1 makes the stick pivot and R1 pivot sideways (see
// kinematics::ControlScheme). The player LEDs show the scheme: 1 for NORMAL,
// 2 for ADVANCED. GamepadSession holds those rules; this class only carries
// the controls across from the Bluetooth task and lights the LED.
//
// The PS3 library reports on its Bluetooth task (core 0), while the rest of
// the firmware runs on the loop task (core 1). Its callback therefore only
// copies the controls into a small locked mailbox; update(), on the loop task,
// is the only thing that talks to the rover. That keeps the motor state and
// the four-wheel I2C writes single-threaded.
class Gamepad {
 public:
  Gamepad(Rover& rover, kinematics::ControlScheme& scheme);

  // Pair with the controller. `hostMac` is the address stored in the pad.
  void begin(const char* hostMac);

  // Call every loop: hands the latest controls to the session.
  void update(uint32_t now);

 private:
  void showScheme(bool padPresent);

  kinematics::ControlScheme& scheme;
  GamepadSession session;
  bool started = false;
  // The scheme the pad's LEDs show; -1 when unknown (no pad, or a new one).
  int shownScheme = -1;
};

#endif

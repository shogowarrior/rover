#ifndef GAMEPAD_H
#define GAMEPAD_H

#include "GamepadSession.h"
#include "Rover.h"

// PS3 gamepad input, compiled in only when ROVER_ENABLE_GAMEPAD is set (see
// Features.h). Without it, begin() and update() do nothing.
//
// GamepadSession holds the pad's rules; this class only carries the controls
// across from the Bluetooth task and sends the player LED it is given. The
// library calls back on core 0, so the callback only fills a locked mailbox,
// and update(), on the loop task, is all that reaches the rover (AGENTS.md,
// Invariants).
class Gamepad {
 public:
  Gamepad(Rover& rover, kinematics::ControlScheme& scheme);

  // Pair with the controller. `hostMac` is the address stored in the pad.
  void begin(const char* hostMac);

  // Call every loop. Reads its own clock under the mailbox's lock, not
  // loop()'s `now` (Gamepad.cpp says why).
  void update();

 private:
  GamepadSession session;
  bool started = false;
};

#endif

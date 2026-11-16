#ifndef GAMEPAD_H
#define GAMEPAD_H

#include "EventLog.h"
#include "GamepadSession.h"
#include "Rover.h"

// PS3 gamepad input, compiled in only when ROVER_ENABLE_GAMEPAD is set (see
// Features.h). Without it, begin() and update() do nothing, and state() is
// PAD_ABSENT.
//
// GamepadSession holds the pad's rules; this class only carries the controls
// across from the Bluetooth task and sends the player LED it is given. The
// library calls back on core 0, so the callback only fills a locked mailbox,
// and update(), on the loop task, is all that reaches the rover (AGENTS.md,
// Invariants).
class Gamepad {
 public:
  Gamepad(Rover& rover, kinematics::ControlScheme& scheme, EventLog& log);

  // Pair with the controller. `hostMac` is the address stored in the pad.
  void begin(const char* hostMac);

  // Call every loop. Reads its own clock under the mailbox's lock, not
  // loop()'s `now` (Gamepad.cpp says why).
  void update();

  // Pad control on or off, from a client (GamepadSession::setEnabled()).
  // Ignored, and logged, by a build without the pad.
  void setEnabled(bool on, uint32_t now);
  PadState state() const;

 private:
  GamepadSession session;
  EventLog& log;
  bool started = false;
};

#endif

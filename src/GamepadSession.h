#ifndef GAMEPAD_SESSION_H
#define GAMEPAD_SESSION_H

#include <stdint.h>

#include "Kinematics.h"
#include "Rover.h"

// What the gamepad's latest report said, as the Bluetooth callback left it.
struct GamepadReport {
  kinematics::GamepadState controls = {0, 0, 0, 0, false, false};
  bool hasReport = false;      // anything received since pairing
  uint32_t lastReportMs = 0;   // when the latest report arrived
  bool startPressed = false;   // START went down since the last update
  bool selectPressed = false;  // SELECT went down since the last update
};

// Turns gamepad reports into rover commands. Pure, like Rover: the PS3
// library stays in Gamepad, and this is host-tested (test/test_gamepad).
//
// The rules it keeps:
//   * A held stick is re-sent every tuning::GAMEPAD_REFRESH_MS, so the rover
//     keeps moving; a new speed in the same direction at most every
//     GAMEPAD_SPEED_CHANGE_MS; a new direction at once.
//   * Releasing sends one STOP, never a stream: a resting pad must not keep
//     forcing manual mode while the rover explores.
//   * A pad silent for GAMEPAD_SILENCE_MS is gone (the library never reports
//     a disconnect), and whatever it was driving stops.
//   * START hands control back to autonomous exploration.
//   * SELECT toggles the rover's control scheme (kinematics::ControlScheme),
//     the one the panel shows too. It sends no command of its own: a held
//     stick just carries on under the new scheme.
class GamepadSession {
 public:
  GamepadSession(Rover& rover, kinematics::ControlScheme& scheme);

  void update(const GamepadReport& report, uint32_t now);

 private:
  Rover& rover;
  kinematics::ControlScheme& scheme;
  bool driving = false;  // the last thing sent was a motion
  kinematics::DriveRequest lastSent = {STOP, 0};
  uint32_t lastSentMs = 0;
};

#endif

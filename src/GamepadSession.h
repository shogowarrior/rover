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

// The loop's side of the Bluetooth mailbox: this pass's report, taken out of
// `mailbox`, which must be locked. Read `now` under that same lock, so that no
// stamp in the mailbox is later than it (Gamepad::update says why).
//   * A pad silent for GAMEPAD_SILENCE_MS is forgotten outright, so its last
//     stick position can never read as fresh again, however long the silence.
//   * START and SELECT are edges: the copy carries them and the mailbox drops
//     them, so each press is acted on once.
GamepadReport takeGamepadReport(GamepadReport& mailbox, uint32_t now);

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
//     the one the panel shows too.
//   * A scheme change never redirects a held stick. Whatever the pad was
//     driving stops, and the stick must come back to centre before it drives
//     again. The scheme is shared, so without this a toggle on anyone's panel
//     would turn the diagonal under this operator's thumb into a pivot.
class GamepadSession {
 public:
  GamepadSession(Rover& rover, kinematics::ControlScheme& scheme);

  // `report` is what takeGamepadReport() returned for this same `now`, so its
  // stamp is never later than `now`. A later stamp would read as 49.7 days
  // old: timing::since() cannot tell one from a stamp that ancient, and must
  // not, or a pad silent for 24.8 days would read as fresh.
  void update(const GamepadReport& report, uint32_t now);

 private:
  Rover& rover;
  kinematics::ControlScheme& scheme;
  kinematics::ControlScheme schemeInUse;  // what the pad last drove under
  bool driving = false;                   // the last thing sent was a motion
  bool awaitingRelease = false;           // stopped by a scheme change
  kinematics::DriveRequest lastSent = {STOP, 0};
  uint32_t lastSentMs = 0;
};

#endif

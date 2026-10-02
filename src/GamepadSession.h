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

  // Whether a report arrived less than GAMEPAD_SILENCE_MS before `now`. The
  // age is unsigned, so a pad silent that long never reads as fresh again.
  bool freshAt(uint32_t now) const;
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
//   * The pad's player LEDs show the scheme, rewritten at most every
//     GAMEPAD_LED_MIN_INTERVAL_MS.
class GamepadSession {
 public:
  GamepadSession(Rover& rover, kinematics::ControlScheme& scheme);

  // `report` is what takeGamepadReport() returned for this same `now`, so its
  // stamp is never later than `now`. A later stamp would read as 49.7 days
  // old: timing::since() cannot tell one from a stamp that ancient, and must
  // not, or a pad silent for 24.8 days would read as fresh.
  void update(const GamepadReport& report, uint32_t now);

  // The player LED to light, 1 for NORMAL or 2 for ADVANCED, or 0 to leave
  // the LEDs alone. Call after update(), with whether a report is in hand
  // (report.hasReport), and send a non-zero answer at once: it counts as
  // shown.
  //   * Only a change is sent: after SELECT, after a panel changes the scheme,
  //     and to a pad that has just (re)appeared, which the library sets to
  //     player 1 on connecting. A pad that is not reporting gets nothing: the
  //     library sends without checking.
  //   * At most one send per GAMEPAD_LED_MIN_INTERVAL_MS, however fast clients
  //     flip the scheme; the LEDs then catch up with the last one. Each send
  //     is a Bluetooth write from the loop task.
  int playerLedToShow(bool padPresent, uint32_t now);

 private:
  // Whether the last thing sent was a motion. Read off lastSent rather than
  // kept beside it, so no branch can update one and forget the other.
  bool driving() const { return lastSent.move != STOP; }
  // Stop what the pad is driving, if anything, and forget it.
  void stopDriving(uint32_t now);

  Rover& rover;
  kinematics::ControlScheme& scheme;
  kinematics::ControlScheme schemeInUse;  // what the pad last drove under
  bool awaitingRelease = false;           // stopped by a scheme change
  kinematics::DriveRequest lastSent = {STOP, 0};
  uint32_t lastSentMs = 0;
  int shownLed = 0;  // what the pad's LEDs show; 0 when unknown (no pad, or a new one)
  uint32_t lastLedWriteMs = 0;
};

#endif

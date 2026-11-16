#ifndef GAMEPAD_SESSION_H
#define GAMEPAD_SESSION_H

#include <stdint.h>

#include "Control.h"
#include "EventLog.h"
#include "Kinematics.h"
#include "Settings.h"
#include "Tuning.h"

// The pad's buttons that GamepadSession acts on as presses, one bit each in
// GamepadReport::pressed.
enum PadButton : uint8_t {
  PAD_START = 1 << 0,     // autonomous
  PAD_SELECT = 1 << 1,    // the control scheme
  PAD_CROSS = 1 << 2,     // Stop
  PAD_TRIANGLE = 1 << 3,  // the sonar sweeps
  PAD_R3 = 1 << 4,        // the sonar looks ahead (the right stick, pressed)
  PAD_UP = 1 << 5,        // the D-pad: top speed up...
  PAD_DOWN = 1 << 6,      // ...and down
};

// The pad as telemetry reports it ("pad"). ABSENT is a build without the
// gamepad (Features.h), which sends no "pad" at all.
enum PadState { PAD_ABSENT, PAD_OFF, PAD_WAITING, PAD_CONNECTED };

// What the gamepad's latest report said, as the Bluetooth callback left it.
struct GamepadReport {
  kinematics::GamepadState controls = {0, 0, 0, 0, false, false};
  int rx = 0;                  // the right stick, -128 (left) to 127 (right)
  bool hasReport = false;      // anything received since pairing
  uint32_t lastReportMs = 0;   // when the latest report arrived
  uint8_t pressed = 0;         // PadButtons that went down since the last update

  bool wasPressed(PadButton button) const { return (pressed & button) != 0; }

  // Whether a report arrived less than GAMEPAD_SILENCE_MS before `now`. The
  // age is unsigned, so a report 24.8 days old is not fresh, as a signed age
  // would make it. It reads fresh again only once the clock wraps, 49.7 days
  // on, which is why takeGamepadReport() forgets a silent pad outright.
  bool freshAt(uint32_t now) const;
};

// The loop's side of the Bluetooth mailbox: this pass's report, taken out of
// `mailbox`, which must be locked. Read `now` under that same lock, so that no
// stamp in the mailbox is later than it (Gamepad::update says why).
//   * A pad silent for GAMEPAD_SILENCE_MS is forgotten outright, so its last
//     stick position can never read as fresh again, however long the silence.
//   * Presses are edges: the copy carries them and the mailbox drops them,
//     so each press is acted on once.
GamepadReport takeGamepadReport(GamepadReport& mailbox, uint32_t now);

// Turns gamepad reports into rover commands, sent through Control as the
// PAD controller's, and changes of setting. Pure, like Rover: the PS3
// library stays in Gamepad, and this is host-tested (test/test_gamepad).
//
// The rules it keeps:
//   * A held stick is re-sent every tuning::GAMEPAD_REFRESH_MS, so the rover
//     keeps moving; a new speed in the same direction at most every
//     GAMEPAD_SPEED_CHANGE_MS; a new direction at once.
//   * Releasing sends one STOP, never a stream: a resting pad must not keep
//     forcing manual mode while the rover explores.
//   * A command Control refuses (another controller holds control, ranked
//     above the pad) drives nothing, so letting go of it sends no STOP; the
//     pad asks again each pass, and drives once that hold lapses.
//   * A pad silent for GAMEPAD_SILENCE_MS is gone (the library never reports
//     a disconnect), and whatever it was driving stops.
//   * START hands control back to autonomous exploration.
//   * Cross stops the rover, whatever it is doing, as the panel's Stop does:
//     sent even when the pad is driving nothing, because it is how the pad
//     stops an exploring rover without driving it first. A stick or trigger
//     held through it must come back to centre before it drives again, or the
//     next pass would re-drive it and Cross would do nothing under a thumb
//     resting on the stick. Pressed with START in the same report, Cross wins.
//   * SELECT toggles the rover's control scheme (Settings::scheme()), the
//     one the panel shows too.
//   * A scheme change never redirects a held stick. Whatever the pad was
//     driving stops, and the stick must come back to centre before it drives
//     again. The scheme is shared, so without this a toggle on anyone's panel
//     would turn the diagonal under this operator's thumb into a pivot.
//   * The D-pad's up and down step the top speed, which the stick reaches at
//     full deflection and a trigger at a full pull, by GAMEPAD_SPEED_STEP.
//     It goes back to GAMEPAD_MAX_SPEED when the pad goes silent or is
//     turned off or on, so a pad picked up again never starts fast.
//   * The sonar's buttons are configuration, like the panel's (Settings::
//     setSonar()): they take no control. The right stick pans the sonar,
//     faster the further it is pushed, from where it is aimed (straight ahead
//     unless it already aims); R3 points it ahead, Triangle sweeps.
//   * Pad control can be turned off (Settings::setPad(), by any controller): the pad
//     then drives nothing and changes nothing, but Cross still stops the
//     rover, so Stop is one press from every controller. Turned off or on,
//     whatever the pad drove stops, and a stick held through it waits for
//     centre.
//   * The pad's player LEDs show the scheme, LED 4 that pad control is off,
//     rewritten at most every GAMEPAD_LED_MIN_INTERVAL_MS.
//   * Its connecting, going silent, and each press it acts on go in the
//     EventLog.
class GamepadSession {
 public:
  GamepadSession(Control& control, Settings& settings, EventLog& log);

  // `report` is what takeGamepadReport() returned for this same `now`, so its
  // stamp is never later than `now` (Gamepad::update says why).
  void update(const GamepadReport& report, uint32_t now);

  // The player LED to light, 1 for NORMAL, 2 for ADVANCED or 4 for pad
  // control off, or 0 to leave the LEDs alone. Call after update(), with whether a report is in hand
  // (report.hasReport), and send a non-zero answer at once: it counts as
  // shown.
  //   * Only a change is sent: after SELECT, after a panel changes the scheme
  //     or turns pad control off or on, and to a pad that has just
  //     (re)appeared, which the library sets to player 1 on connecting. A pad that is not reporting gets nothing: the
  //     library sends without checking.
  //   * At most one send per GAMEPAD_LED_MIN_INTERVAL_MS, however fast clients
  //     flip the scheme; the LEDs then catch up with the last one. Each send
  //     is a Bluetooth write from the loop task.
  int playerLedToShow(bool padPresent, uint32_t now);

  // OFF, WAITING (on, no pad reporting) or CONNECTED, as of the last update().
  PadState state() const;

 private:
  // Whether the last thing sent was a motion. Read off lastSent rather than
  // kept beside it, so no branch can update one and forget the other.
  bool driving() const { return lastSent.move != STOP; }
  // Stop what the pad is driving, if anything, and forget it.
  void stopDriving(uint32_t now);
  void notePresence(bool present, uint32_t now);
  // Back to GAMEPAD_MAX_SPEED: the pad gone, or turned off or on.
  void resetTopSpeed(uint32_t now);
  void stepTopSpeed(const GamepadReport& report, uint32_t now);
  void aimSonar(const GamepadReport& report, bool fresh, uint32_t now);

  Control& control;
  Settings& settings;
  EventLog& log;
  kinematics::ControlScheme schemeInUse;  // what the pad last drove under
  bool padInUse;                          // pad control as the last update() found it
  bool present = false;                   // reporting, as of the last update
  bool awaitingRelease = false;           // stopped by a scheme change, Cross, or a toggle
  kinematics::DriveRequest lastSent = {STOP, 0};
  uint32_t lastSentMs = 0;
  int topSpeed = tuning::GAMEPAD_MAX_SPEED;
  bool panning = false;  // the right stick is out of its dead zone
  float panDeg = 0;      // where the pan has the sonar, positive left
  uint32_t lastPanMs = 0;
  int shownLed = 0;  // what the pad's LEDs show; 0 when unknown (no pad, or a new one)
  uint32_t lastLedWriteMs = 0;
};

#endif

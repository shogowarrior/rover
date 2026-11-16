#ifndef CONTROL_H
#define CONTROL_H

#include <stdint.h>

#include "EventLog.h"
#include "Rover.h"
#include "Settings.h"
#include "Source.h"

namespace protocol {
struct Message;
}

// Who may drive the rover when more than one controller is sending: the
// serial console (USB), the gamepad (PAD) and the WebSocket clients (WIFI).
// Every command from every controller comes through here, in one format,
// and on to Rover::command(). Pure core, host-tested in test/test_control.
//
// There is no queue. A command is acted on the moment it arrives, or
// refused; nothing waits to run later, so the rover is only ever doing what
// someone asked of it just now, and a burst from one controller can never
// delay another's STOP. The rules:
//   * A controller that drove the rover holds control for
//     tuning::CONTROL_HOLD_MS after its last command. Within that, a
//     controller ranked above it in Settings' priority takes over at once,
//     and one ranked below is refused. Once it lapses, whoever sends next
//     takes control. A controller's own commands always reach the rover.
//   * STOP from anyone is always acted on, ranked or not: Stop is one press
//     from every controller. It does not take control from a higher-ranked
//     controller still driving, whose next command (the next re-send of a
//     held stick, 200 ms on) moves the rover again, and the log says so.
//   * RESUME_AUTONOMOUS and RUN_CHECKS are commands like any other: a
//     controller that may not drive may not start exploring or the checks.
//   * Exploring, the checks and the rover's own stand-downs are no
//     controller's: any accepted command takes over from them, as before.
//   * Settings are not commands, and are never refused (Settings.h).
// Control passing to another controller, a command refused (once a
// controller, until control passes), and a STOP from below the holder go in
// the EventLog, each as its controller's.
class Control {
 public:
  // What became of a message (apply()).
  enum Outcome {
    ACCEPTED,  // a command the rover acted on
    REFUSED,   // a command another controller's hold refused
    SETTING,   // a change of setting, applied
    IGNORED,   // something with a value the rover does not know
    UPDATE,    // part of a firmware update: the caller's (RemoteControl)
  };

  Control(Rover& rover, Settings& settings, EventLog& log);

  // A command from `from` (USB, PAD or WIFI), straight off the wire: Rover
  // validates `move`. Returns whether the rover acted on it.
  bool command(Source from, int move, int speed, int durationMs, uint32_t now);

  // A message read off the wire (protocol::readMessage()) from `from`: a
  // command goes through command(), a change of setting to Settings.
  Outcome apply(Source from, const protocol::Message& message, uint32_t now);

  // `from`'s link went: its driving WebSocket client disconnected. If the
  // rover's motion is that controller's, it stops (Rover::stop()), and
  // exploring carries on. A controller that was refused, or that another
  // has since taken over from, stops nothing.
  void lost(Source from, uint32_t now);

  // The controller holding control now, or SOURCE_ROVER when none does.
  Source holder(uint32_t now) const;

 private:
  Rover& rover;
  Settings& settings;
  EventLog& log;
  Source held = SOURCE_ROVER;        // the last controller to take control...
  uint32_t heldAt = 0;               // ...and when it last sent a command
  Source driver = SOURCE_ROVER;      // whose command the rover acted on last
  Source lastHolder = SOURCE_ROVER;  // for the log: control passing on
  bool refusalNoted[CONTROLLER_COUNT] = {false, false, false};
};

#endif

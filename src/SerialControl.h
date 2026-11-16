#ifndef SERIAL_CONTROL_H
#define SERIAL_CONTROL_H

#include <stddef.h>
#include <stdint.h>

#include "Control.h"
#include "EventLog.h"
#include "Protocol.h"

// Commands and settings over the USB cable: the serial console takes the
// same JSON messages a WebSocket client sends, one to a line, and hands each
// to Control as the USB controller's. So
//   {"move": 1, "speed": 120, "duration": 400}
//   {"settings": {"sonar": "SWEEP"}}
// typed into a serial monitor, or written by a script, drive the rover and
// change its settings as the panel would. What the rover says back is the
// EventLog, which main.cpp echoes on the same console.
//
// A firmware update is the WebSocket link's alone, and a line that is not a
// message we know is logged and ignored. A line longer than
// protocol::COMMAND_MAX_BYTES is dropped whole, as the link drops a long
// frame. The cable has no disconnect to notice, so the 1.5 s duration cap
// is its deadman: a script repeats a held move, as the panel does.
//
// Non-blocking: update() reads only what has already arrived, and at most
// READ_MAX_BYTES of it a pass.
class SerialControl {
 public:
  SerialControl(Control& control, EventLog& log) : control(control), log(log) {}

  // Call every loop.
  void update(uint32_t now);

  static constexpr int READ_MAX_BYTES = 128;

 private:
  void onLine(uint32_t now);

  Control& control;
  EventLog& log;
  char line[protocol::COMMAND_MAX_BYTES + 1];
  size_t length = 0;
  bool overlong = false;  // the line being read outgrew `line`: drop it whole
};

#endif

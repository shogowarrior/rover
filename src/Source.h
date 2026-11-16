#ifndef SOURCE_H
#define SOURCE_H

#include <stdint.h>

// Where a command, a change of setting or a log line came from. The first
// three send commands, in one format (Protocol.h), and Control ranks them by
// Settings' priority; the rover itself (the explorer, the checks, the links
// coming and going, the boot) sends none and is outranked by all three.
enum Source : uint8_t {
  SOURCE_USB,    // the serial console, a line of JSON at a time (SerialControl)
  SOURCE_PAD,    // the PS3 gamepad (GamepadSession)
  SOURCE_WIFI,   // a WebSocket client: the panel, drive.py (RemoteControl)
  SOURCE_ROVER,  // the rover itself
};

// The sources that send commands: USB, PAD and WIFI.
constexpr int CONTROLLER_COUNT = 3;
constexpr int SOURCE_COUNT = 4;

// "USB", "PAD", "WIFI" or "ROVER", as the wire says them: a log line's "src",
// telemetry's "control" and the priority setting. SOURCES in
// extras/joystick/js/protocol.js copies them, and tools/check_protocol.py
// checks.
inline const char* sourceName(Source source) {
  switch (source) {
    case SOURCE_USB:
      return "USB";
    case SOURCE_PAD:
      return "PAD";
    case SOURCE_WIFI:
      return "WIFI";
    case SOURCE_ROVER:
    default:
      return "ROVER";
  }
}

#endif

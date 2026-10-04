#ifndef TUNING_H
#define TUNING_H

#include <stdint.h>

// Behaviour constants shared by the firmware and the host tests, so this file
// stays free of Arduino dependencies. Pins live in Pins.h, optional features in
// Features.h, and the finer autonomy thresholds in ExploreParams (Explorer.h).
//
// Values mirrored by a client are checked by tools/check_protocol.py; the
// comment on each one names the copy.

namespace tuning {

// --- Motors ----------------------------------------------------------------

// Highest PWM duty any source may request (Adafruit_DCMotor::setSpeed takes
// 0..255). Duty is a fraction of the pack voltage: the TT motors on this rover
// are rated 3-6 V and the 3S pack gives up to 12.6 V, so 255 drives them at
// about twice their rating. About 120 keeps them in spec. It stays at 255
// until the operator decides; see docs/ROADMAP.md. MOTOR_SPEED_LIMIT in
// extras/joystick/js/protocol.js is the panel's copy, which its simulator
// clamps a preview to: change both, or tools/check_protocol.py fails.
constexpr int MOTOR_SPEED_LIMIT = 255;

// Longest one external command may drive before the motors are released.
// Clients re-send well inside this (the panel every 200 ms), so this is the
// deadman: a client that crashes or loses its link stops the rover within
// this window, whatever duration it asked for. SimTarget.COMMAND_DURATION_MAX_MS
// in extras/joystick/js/sim.js is the panel's simulator's copy, which
// extras/joystick/test/sim.test.js checks.
constexpr int COMMAND_DURATION_MAX_MS = 1500;

// A held move is rewritten to the motors at least this often, even though the
// wheels are already doing it, to repair a lost I2C write. Well above the
// panel's 200 ms repeat, so most repeats cost no bus traffic. A release that
// ends motion is written once more, this long after, for the same reason.
constexpr uint32_t MOTOR_REFRESH_MS = 500;

// Duration of a command that names none: WebSocket JSON without "duration",
// and every gamepad command.
constexpr int DEFAULT_MOVE_DURATION_MS = 750;

// PWM duty autonomous exploration drives at.
constexpr int EXPLORE_SPEED = 64;

// --- Autonomy thresholds a client displays ---------------------------------

// Exploration stops a cruise when something in the rover's path is this close
// (sensor frame), and only starts one when the path is clear beyond GO. The
// panel colours its scan fan with the same two numbers (STOP_CM / GO_CM in
// extras/joystick/js/protocol.js).
constexpr float EXPLORE_STOP_CM = 25.0f;
constexpr float EXPLORE_GO_CM = 40.0f;

// --- Gamepad ---------------------------------------------------------------

constexpr int GAMEPAD_MAX_SPEED = 50;  // stick fully deflected; a full trigger pull gets half
// Of the stick's +-127. The triggers' 0..255 share it: 8% of a pull.
constexpr int GAMEPAD_DEADZONE = 20;
// A held stick is re-sent this often, well inside DEFAULT_MOVE_DURATION_MS,
// so the rover keeps moving until the stick is released. REPEAT_MS in the
// panel's js/protocol.js.
constexpr uint32_t GAMEPAD_REFRESH_MS = 200;
// The pad reports continuously while connected. This long without a report
// means it is gone, and whatever it was driving stops.
constexpr uint32_t GAMEPAD_SILENCE_MS = 500;
// A new speed in the same direction is sent at most this often (a new
// direction goes at once); each costs a four-motor rewrite. STICK_SEND_MS in
// extras/joystick/js/protocol.js is the panel's copy of the same rule.
constexpr uint32_t GAMEPAD_SPEED_CHANGE_MS = 100;
// The pad's player LEDs, which show the control scheme, are rewritten at most
// this often. Each write is a Bluetooth send from the loop task, and the
// scheme can be flipped by any WebSocket client as fast as it can send.
constexpr uint32_t GAMEPAD_LED_MIN_INTERVAL_MS = 250;

// --- Network ---------------------------------------------------------------

constexpr uint32_t SERIAL_BAUD = 115200;
constexpr uint16_t WEBSOCKET_PORT = 81;  // PORT in the panel's js/protocol.js, DEFAULT_PORT in drive.py
constexpr uint32_t TELEMETRY_INTERVAL_MS = 500;  // TELEMETRY_MS in the panel's js/protocol.js
constexpr int WIFI_CONNECT_ATTEMPTS = 40;      // x WIFI_RETRY_DELAY_MS, setup() only
constexpr uint32_t WIFI_RETRY_DELAY_MS = 250;
constexpr uint32_t WIFI_RECONNECT_INTERVAL_MS = 10000;

// --- Firmware updates over the link (FirmwareUpdate.h) ---------------------

// An update waiting on its client, for the password's answer or the next
// chunk, fails this long after the rover's last reply, and the half-written
// slot is let go. The panel answers at once, so this is a panel that has
// gone. The clock starts before the write the reply follows, so a flash
// erase (up to ~2 s) comes out of it.
constexpr uint32_t OTA_SILENCE_MS = 5000;
// "done" goes out this long before the restart, so it leaves before the reset.
constexpr uint32_t OTA_RESTART_DELAY_MS = 500;
// A new image, from either update path, is kept once loop() has run it this
// long online; a reset before then boots the previous one (Network.cpp).
// Neither update path runs meanwhile.
constexpr uint32_t IMAGE_TRIAL_MS = 30000;

}  // namespace tuning

#endif

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
// until the operator decides; see docs/ROADMAP.md.
constexpr int MOTOR_SPEED_LIMIT = 255;

// Longest one external command may drive before the motors are released.
// Clients re-send well inside this (the panel every 200 ms), so this is the
// deadman: a client that crashes or loses its link stops the rover within
// this window, whatever duration it asked for.
constexpr int COMMAND_DURATION_MAX_MS = 1500;

// Duration of a command that names none: WebSocket JSON without "duration",
// and every gamepad command.
constexpr int DEFAULT_MOVE_DURATION_MS = 750;

// PWM duty autonomous exploration drives at.
constexpr int EXPLORE_SPEED = 64;

// --- Autonomy thresholds a client displays ---------------------------------

// Exploration stops a cruise when something in the rover's path is this close
// (sensor frame), and only starts one when the path is clear beyond GO. The
// panel colours its scan fan with the same two numbers (STOP_CM / GO_CM in
// extras/joystick/control.js).
constexpr float EXPLORE_STOP_CM = 25.0f;
constexpr float EXPLORE_GO_CM = 40.0f;

// --- Gamepad ---------------------------------------------------------------

constexpr int GAMEPAD_MAX_SPEED = 50;  // stick fully deflected
constexpr int GAMEPAD_DEADZONE = 20;   // of the stick's +-127
// A held stick is re-sent this often, well inside DEFAULT_MOVE_DURATION_MS,
// so the rover keeps moving until the stick is released.
constexpr uint32_t GAMEPAD_REFRESH_MS = 200;
// The pad reports continuously while connected. This long without a report
// means it is gone, and whatever it was driving stops.
constexpr uint32_t GAMEPAD_SILENCE_MS = 500;

// --- Network ---------------------------------------------------------------

constexpr uint32_t SERIAL_BAUD = 115200;
constexpr uint16_t WEBSOCKET_PORT = 81;  // PORT in control.js, DEFAULT_PORT in drive.py and ws.py
constexpr uint32_t TELEMETRY_INTERVAL_MS = 500;
constexpr int WIFI_CONNECT_ATTEMPTS = 40;      // x WIFI_RETRY_DELAY_MS, setup() only
constexpr uint32_t WIFI_RETRY_DELAY_MS = 250;
constexpr uint32_t WIFI_RECONNECT_INTERVAL_MS = 10000;

}  // namespace tuning

#endif

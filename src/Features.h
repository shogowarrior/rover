#ifndef FEATURES_H
#define FEATURES_H

#include "Kinematics.h"

// Optional parts of the firmware, switched here instead of by commenting code
// out. Every path keeps compiling in CI whichever way these are set.

// PS3 gamepad over Bluetooth. Off by default: the Bluetooth stack costs about
// 40 KB of RAM, shares the radio with WiFi (adding command latency), and
// pairing changes the board's MAC address (see PS3_HOST_MAC). Build the
// car_wire_gamepad environment, or pass -DROVER_ENABLE_GAMEPAD=1, to use it.
// car_ota has no gamepad variant: on a rover with a pad, set the default below
// to 1, or an OTA update removes the pad (and restores the board's own MAC).
#ifndef ROVER_ENABLE_GAMEPAD
#define ROVER_ENABLE_GAMEPAD 0
#endif

namespace features {

constexpr bool GAMEPAD = ROVER_ENABLE_GAMEPAD != 0;

// The Bluetooth address the controller was paired to -- the HOST address
// stored inside the pad (set with SixaxisPairTool or sixaxispairer), not the
// pad's own. Ps3.begin() makes the ESP32 adopt it by rewriting the chip's base
// MAC, which also changes the WiFi MAC unless this is the board's own address;
// DHCP reservations and MAC filters then see a different device.
constexpr char PS3_HOST_MAC[] = "94:b9:7e:c7:af:12";

// Whether to start exploring as soon as the rover is switched on. Off, as the
// owner asked (docs/features.md, F9): every boot comes up in manual mode, the
// wheels still and the sonar as its setting says (Front by default: one
// sweep, then held straight ahead), until a client's Autonomous (or the pad's
// START) sends it exploring. Exploring at power-on looked like a rover that
// "scans, tries to move, stops, repeats" before anyone had asked it to move.
// On, a power-on explores, and the ESP32 reports an EN reset -- the button, a
// USB upload, often the serial monitor opening -- as a power-on, so those
// would explore too. Any other reset -- an OTA flash, a crash, the watchdog,
// a brownout -- comes up in manual mode either way, so an OTA-flashed or
// recovering rover never drives off on its own.
constexpr bool AUTONOMOUS_AT_POWER_ON = false;

// The control scheme while flash holds no settings, for the gamepad and the
// panel alike: NORMAL (eight-way stick and rotate) or ADVANCED (adds the
// eight pivots; see kinematics::ControlScheme). PS3 SELECT and the panel's
// toggle change it, and the change is saved to flash with the other settings
// (3 s after the last change, with the rover at rest), so it lasts across
// resets: the setting in flash wins over this.
constexpr kinematics::ControlScheme DEFAULT_CONTROL_SCHEME = kinematics::SCHEME_NORMAL;

// Updates over the WebSocket link (the panel's Options, Firmware) need an OTA
// password, which config.example.h shows how to set; a rover without one
// refuses them. The link must take a page opened from a file, whose Origin
// is "null", and a web page can send "null" too, from a sandboxed frame:
// the Origin check (protocol::originAllowed()) keeps ordinary web pages out,
// but only the password keeps a determined one from replacing the firmware.
// ArduinoOTA (car_ota) is not affected: no web page can reach it. Set this
// false only for a network, and a browser, you trust entirely.
constexpr bool LINK_UPDATE_NEEDS_PASSWORD = true;

}  // namespace features

#endif

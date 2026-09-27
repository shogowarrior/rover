#ifndef FEATURES_H
#define FEATURES_H

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

// Start exploring as soon as the rover is switched on. The ESP32 reports an EN
// reset -- the button, a USB upload, often the serial monitor opening -- as a
// power-on, so those explore too: flash over USB with the rover on a stand.
// Any other reset -- an OTA flash, a crash, the watchdog, a brownout -- comes
// up in manual mode, so an OTA-flashed or recovering rover never drives off
// on its own. A client's "Autonomous" button resumes exploring.
constexpr bool AUTONOMOUS_AT_POWER_ON = true;

}  // namespace features

#endif

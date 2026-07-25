#ifndef COMMON_H
#define COMMON_H

#include "Controller.h"
#include "MoveCodes.h"
#include "Rover.h"

// Globals
extern Rover rover;
extern Controller controller;

// Serial constants
#define HW_SERIAL_SPEED 115200L
#define WS_INTERVAL 500L

// Speeds. These two are independent ceilings on two independent control
// paths, not a max and a default of the same quantity -- an earlier naming
// (MAX_SPEED / DEFAULT_SPEED) implied the second had to be below the first,
// which it never was.
#define CONTROLLER_MAX_SPEED 50  // ceiling applied to gamepad stick input
#define EXPLORE_SPEED 64         // speed autonomous exploration drives at

#define MOVE_DURATION 750

// Sensor constants
#define SERVO_SETTLE_MS 250  // time for the scanner servo to reach a new angle
#define SAFE_DISTANCE 30

// If a manual command is not refreshed within this window, release the motors.
// A client that vanishes mid-move must not leave the rover driving.
#define MANUAL_COMMAND_TIMEOUT_MS 1500

// WiFi
#define WIFI_CONNECT_ATTEMPTS 40    // x WIFI_RETRY_DELAY_MS before giving up
#define WIFI_RETRY_DELAY_MS 250
#define WIFI_RECONNECT_INTERVAL_MS 10000

// PS3 controller
#define PS3_MAC_ADDRESS "94:b9:7e:c7:af:12"
#define DEADZONE_THRESHOLD 20

#endif

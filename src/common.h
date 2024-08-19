#ifndef COMMON_H
#define COMMON_H

#pragma once

#include "Rover.h"
#include "Controller.h"

extern Rover rover;
extern Controller controller;
extern unsigned long startMillis;

// PS3 mac address
#define MAC_ADDRESS "94:b9:7e:c7:af:12"
#define DEADZONE_THRESHOLD 20

// Common constants
#define HW_SERIAL_SPEED 115200L
#define SW_SERIAL_SPEED 9600L

// Sonar
#define TRIG_PIN 12
#define ECHO_PIN 12
#define SONAR_TIMEOUT 40000UL

// Define commands
#define STOP 0
#define MOVE_FORWARD 1
#define MOVE_BACKWARD 2
#define MOVE_RIGHT 3
#define MOVE_LEFT 4
#define MOVE_DIAGONAL45 5
#define MOVE_DIAGONAL135 6
#define MOVE_DIAGONAL225 7
#define MOVE_DIAGONAL315 8
#define PIVOT_RIGHT_FORWARD 9
#define PIVOT_RIGHT_BACKWARD 10
#define PIVOT_LEFT_FORWARD 11
#define PIVOT_LEFT_BACKWARD 12
#define PIVOT_SIDEWAYS_FORWARD_RIGHT 13
#define PIVOT_SIDEWAYS_FORWARD_LEFT 14
#define PIVOT_SIDEWAYS_BACKWARD_RIGHT 15
#define PIVOT_SIDEWAYS_BACKWARD_LEFT 16
#define ROTATE_CLOCKWISE 17
#define ROTATE_COUNTERCLOCKWISE 18

#define LIMIT_SPEED 50 
#define REPORT_INTERVAL 1000L

// // Test move constants
// #define DEFAULT_SPEED 150
// #define DEFAULT_TIME 500

// // Arduino Software UART pins
// #define SW_UART_TX_PIN 10
// #define SW_UART_RX_PIN 11


#endif

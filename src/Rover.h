#ifndef ROVER_H
#define ROVER_H

#include <stdint.h>

#include "Explorer.h"
#include "Hardware.h"
#include "MoveCodes.h"

// The rover's brain: who is in control, what the wheels are doing, and when
// they must stop.
//
// Pure logic, like Explorer: the motors and the sonar are reached through the
// interfaces in Hardware.h and time arrives as `now`, so every invariant this
// class enforces is tested on the host (test/test_rover):
//
//   * Motors are released by deadline. drive() records when a move ends and
//     update() releases the motors once it passes. Nothing waits.
//   * External input is clamped here, in drive(), the one path every source
//     (WebSocket, gamepad, Explorer) reaches the motors through. Durations are
//     capped at tuning::COMMAND_DURATION_MAX_MS, which makes that cap the
//     deadman: a client that stops sending stops the rover within it.
//   * Autonomous and manual never both drive. Any command takes control
//     (MODE_MANUAL); only RESUME_AUTONOMOUS gives it back.
class Rover {
 public:
  enum Mode { MODE_AUTONOMOUS, MODE_MANUAL };

  // A snapshot for telemetry.
  struct Status {
    Mode mode;
    MoveCode move;           // what the wheels are doing now; STOP when idle
    bool moving;
    const char* phase;       // exploration phase in autonomous mode, else nullptr
    const char* haltReason;  // why exploration is halted, else nullptr
    bool hasScan;            // false until every bearing has been measured
    float scanCm[Explorer::BEARING_COUNT];
  };

  Rover(Motors& motors, RangeScanner& scanner);

  void begin(Mode initialMode, uint32_t now);

  // Call every loop: releases the motors when the current move's deadline
  // passes, then runs one non-blocking step of exploration (autonomous) or
  // of scanning only (manual).
  void update(uint32_t now);

  // A command from any external source, straight off the wire: `move` is the
  // raw integer and is validated here. Switches to MODE_MANUAL, except for
  // RESUME_AUTONOMOUS, which switches back. An unknown code stops the rover.
  void command(int move, int speed, int durationMs, uint32_t now);

  // Release the motors, keeping the mode: a client disconnected or an OTA
  // flash is starting. In autonomous mode exploration carries on.
  void stop();

  // The network link is gone, so no STOP can arrive any more: release the
  // motors and drop to manual. RESUME_AUTONOMOUS restores exploration once a
  // client can reach the rover again.
  void onLinkLost(uint32_t now);

  Mode mode() const { return currentMode; }
  Status status() const;

 private:
  void setMode(Mode mode, uint32_t now);
  void drive(MoveCode move, int speed, int durationMs, uint32_t now);
  void release();

  Motors& motors;
  Explorer explorer;

  Mode currentMode = MODE_AUTONOMOUS;
  MoveCode currentMove = STOP;
  bool moving = false;
  uint32_t moveDeadline = 0;  // meaningful only while moving
};

#endif

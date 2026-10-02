#ifndef ROVER_H
#define ROVER_H

#include <stdint.h>

#include "Explorer.h"
#include "Hardware.h"
#include "MoveCodes.h"

// Mode arbitration, move deadlines and the one clamped path to the motors.
// Pure core (AGENTS.md, Architecture), host-tested in test/test_rover. It
// enforces four of AGENTS.md's Invariants: release by deadline (a lost stop is
// written again; see release()), clamping in drive(), the duration cap as the
// deadman, and autonomous and manual never both driving.
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
    bool motorsReady;        // false when the motor driver did not answer at boot
  };

  Rover(Motors& motors, RangeScanner& scanner);

  void begin(Mode initialMode, uint32_t now);

  // Call every loop: releases the motors when the current move's deadline
  // passes, then runs one non-blocking step of exploration (autonomous) or
  // of scanning only (manual).
  void update(uint32_t now);

  // A command from any external source, straight off the wire: `move` is the
  // raw integer and is validated here. Switches to MODE_MANUAL, except for
  // RESUME_AUTONOMOUS, which switches back -- or, already exploring, restarts
  // a halted explorer. An unknown code stops the rover.
  void command(int move, int speed, int durationMs, uint32_t now);

  // Release the motors, keeping the mode: the client driving the rover
  // disconnected. In autonomous mode exploration carries on.
  void stop(uint32_t now);

  // Release the motors and drop to manual: no STOP could reach the rover any
  // more (the WiFi link dropped), or its firmware is being replaced (an OTA
  // flash started, which leaves it still whether the upload succeeds or not).
  // RESUME_AUTONOMOUS restores exploration once a client can reach it again.
  void standDown(uint32_t now);

  // Make a stop's pending second write once it is due (see release()), and
  // nothing else: no exploring, no sonar, no new motion. update() calls it
  // every loop, and Network from the OTA progress callback (Network.cpp says
  // why).
  void servicePendingRelease(uint32_t now);

  Status status() const;

 private:
  // Start over in `mode`: the wheels released, and exploration from a fresh
  // sweep.
  void restart(Mode mode, uint32_t now);
  void setMode(Mode mode, uint32_t now);
  void drive(MoveCode move, int speed, int durationMs, uint32_t now);
  void release(uint32_t now);

  Motors& motors;
  Explorer explorer;

  Mode currentMode = MODE_AUTONOMOUS;
  MoveCode currentMove = STOP;
  int currentSpeed = 0;
  bool moving = false;
  uint32_t moveDeadline = 0;     // meaningful only while moving
  uint32_t lastMotorWriteAt = 0; // meaningful only while moving

  // The second write of a stop (see release()). Only ever set while idle:
  // drive() clears it, so it can never stop a newer move.
  bool releasePending = false;
  uint32_t releasedAt = 0;  // meaningful only while releasePending
};

#endif

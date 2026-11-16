#ifndef SELF_TEST_H
#define SELF_TEST_H

#include <stddef.h>
#include <stdint.h>

#include "EventLog.h"
#include "Explorer.h"
#include "MovePatterns.h"

// The rover's checks, run when a controller sends RUN_CHECKS, or at boot
// without the wheels' steps when Settings::checksAtBoot() says so: what a
// bench check would find, run by the rover itself, each result a line in the
// EventLog.
// Pure core, owned and stepped by Rover, host-tested in test/test_rover.
//
// In order:
//   1. the motor shield: whether it answered at boot;
//   2. the sonar: three pings at each of the sweep's five bearings, aimed and
//      paced by Explorer as any look is, and how many heard an echo;
//   3. each wheel alone, forward, so the operator sees which wheel each motor
//      terminal drives and which way (docs/bench-checklist.md, section 1);
//   4. all four forward at the explore speed, which may be too weak to turn
//      them, then at tuning::CHECK_SPEED, then a strafe right and a rotation
//      clockwise, to compare with docs/mecanum.md.
// 3 and 4 turn the wheels, and the moves drive the rover forward and
// sideways, so it belongs on its stand: the panel asks first, and they are
// skipped when the shield did not answer. Every drive is short, through
// Rover::drive's clamp like any other, and the checks end at once on any
// other command, a stand-down, or the driver's disconnect (Rover).
//
// RUN_CHECKS is held like a move, so the 1.5 s deadman's rule holds here
// too: a controller that stops sending stops the wheels. The first
// RUN_CHECKS of a stream starts the checks; each one within
// tuning::CHECK_HOLD_MS of the one before holds them and never starts
// another run, so re-sends that cross the run's end, or a STOP's, are
// harmless: a run ended stays ended until the re-sends stop for
// CHECK_HOLD_MS. That holds for a STOP from a controller ranked above the
// one holding the checks too, whose hold then refuses the re-sends: a
// refused one still renews the hold (renew()). The sonar steps run either way, but a wheel step starts
// only while the checks are held: otherwise they stop there, saying why. A
// single RUN_CHECKS typed into the serial console checks the shield and the
// sonar, then stops.
class SelfTest {
 public:
  // What this pass of the checks wants of Rover.
  struct Action {
    bool look = false;  // hold the sonar at lookDeg; otherwise the operator's sonar mode
    int lookDeg = 0;
    const MovePattern* drive = nullptr;  // drive this, once, at speed for durationMs
    int speed = 0;
    int durationMs = 0;
  };

  SelfTest(const Explorer& explorer, EventLog& log) : explorer(explorer), log(log) {}

  // `wheels` false runs steps 1 and 2 alone: nothing turns but the servo.
  void start(uint32_t now, bool motorsReady, bool wheels);
  // A RUN_CHECKS: starts the checks with their wheels' steps, or holds them
  // when it comes within CHECK_HOLD_MS of the one before. Returns whether it
  // started a run.
  bool press(uint32_t now, bool motorsReady);
  // End the checks early, saying why. Says nothing when none are running.
  // The hold stays: a RUN_CHECKS within CHECK_HOLD_MS of the last still
  // starts nothing.
  void cancel(uint32_t now, const char* why);
  // A RUN_CHECKS refused by Control, under a controller ranked above the one
  // re-sending it: it extends a live hold on checks that are not running, so
  // that a STOP from above ends them for good too, and never holds a run.
  void renew(uint32_t now);
  bool running() const { return step >= 0; }
  // The step under way, in a few words, for telemetry's "check"; nullptr
  // when none is running. At most STEP_NAME_MAX characters, which
  // test_longest_telemetry_fits counts on.
  const char* stepName() const;
  static constexpr size_t STEP_NAME_MAX = 16;

  // One step of the checks. `motorsIdle` is true once the last drive has
  // ended. Reads Explorer's latest ping, which Rover's survey() makes after
  // this, in the same pass, so a ping is seen one pass after it is made.
  // Call every loop, running or not, in either mode: it forgets a lapsed
  // hold.
  Action update(uint32_t now, bool motorsIdle);

 private:
  // A RUN_CHECKS came within CHECK_HOLD_MS. `now` may be earlier than it,
  // in the same pass (timing::ageOf()).
  bool held(uint32_t now) const;
  Action stepSonar(uint32_t now);
  Action stepDrive(uint32_t now, bool motorsIdle);
  void next(uint32_t now);
  void finish(uint32_t now);

  const Explorer& explorer;
  EventLog& log;

  int step = -1;  // -1 while no checks run
  bool motorsReady = false;
  bool wheels = false;
  // RUN_CHECKS: whether a stream of them is under way, and the latest.
  bool pressed = false;
  uint32_t pressedAt = 0;
  // The sonar step: pings counted at its bearing, and those that heard.
  bool primed = false;  // seenPings holds Explorer's count from this step
  uint32_t seenPings = 0;
  int samples = 0;
  int heard = 0;
  float nearestCm = 0;
  int sonarSamples = 0;  // every step's, for the summary
  int sonarHeard = 0;
  // The drive step: sent, then resting once the wheels have stopped.
  bool sent = false;
  bool resting = false;
  uint32_t restUntil = 0;
};

#endif

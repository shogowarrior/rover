#ifndef SELF_TEST_H
#define SELF_TEST_H

#include <stddef.h>
#include <stdint.h>

#include "EventLog.h"
#include "Explorer.h"
#include "MovePatterns.h"

// The rover's checks, run when a client sends RUN_CHECKS: what a bench check
// would find, run by the rover itself, each result a line in the EventLog.
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
// 3 and 4 turn the wheels, so the rover belongs on its stand: the panel asks
// first, and they are skipped when the shield did not answer. Every drive is
// short, through Rover::drive's clamp like any other, and the checks end at
// once on any command, a stand-down, or the driver's disconnect (Rover).
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

  void start(uint32_t now, bool motorsReady);
  // End the checks early, saying why. Does nothing when none are running.
  void cancel(uint32_t now, const char* why);
  bool running() const { return step >= 0; }
  // The step under way, in a few words, for telemetry's "check"; nullptr
  // when none is running. At most STEP_NAME_MAX characters, which
  // test_longest_telemetry_fits counts on.
  const char* stepName() const;
  static constexpr size_t STEP_NAME_MAX = 16;

  // One step of the checks. `motorsIdle` is true once the last drive has
  // ended. Reads Explorer's latest ping, which Rover's survey() makes after
  // this, in the same pass, so a ping is seen one pass after it is made.
  Action update(uint32_t now, bool motorsIdle);

 private:
  Action stepSonar(uint32_t now);
  Action stepDrive(uint32_t now, bool motorsIdle);
  void next(uint32_t now);
  void finish(uint32_t now);

  const Explorer& explorer;
  EventLog& log;

  int step = -1;  // -1 while no checks run
  bool motorsReady = false;
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

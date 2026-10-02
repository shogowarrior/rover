#ifndef TEST_SUPPORT_LOOP_H
#define TEST_SUPPORT_LOOP_H

// Time in the host tests, stepped the way loop() steps it, and compared
// through the firmware's own timing::reached(), so the stepping is wrap-safe
// as the firmware is.

#include <stdint.h>

#include "Timing.h"

// Calls tick(now) every `step` ms, advancing `now`, until done() holds after
// a tick (leaving `now` at that tick) or `ms` have passed. Says whether
// done() held.
template <typename Tick, typename Done>
bool advanceUntil(uint32_t& now, uint32_t ms, uint32_t step, Tick tick, Done done) {
  const uint32_t end = now + ms;
  while (!timing::reached(now, end)) {
    tick(now);
    if (done()) return true;
    now += step;
  }
  return false;
}

// As advanceUntil(), for the whole `ms`.
template <typename Tick>
void advance(uint32_t& now, uint32_t ms, uint32_t step, Tick tick) {
  advanceUntil(now, ms, step, tick, [] { return false; });
}

#endif

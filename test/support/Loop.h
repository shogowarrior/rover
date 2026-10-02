#ifndef TEST_SUPPORT_LOOP_H
#define TEST_SUPPORT_LOOP_H

// Time in the host tests, stepped the way loop() steps it, and compared
// through the firmware's own timing::reached(), so the stepping is wrap-safe
// as the firmware is.

#include <stdint.h>

#include "Timing.h"

// Calls tick(now) every `step` ms until `ms` have passed, advancing `now`.
template <typename Tick>
void advance(uint32_t& now, uint32_t ms, uint32_t step, Tick tick) {
  const uint32_t end = now + ms;
  while (!timing::reached(now, end)) {
    tick(now);
    now += step;
  }
}

// As advance(), stopping at the first tick after which done() holds, for at
// most `ms`. Leaves `now` at that tick, and says whether done() held.
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

#endif

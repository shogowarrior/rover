#ifndef TIMING_H
#define TIMING_H

#include <stdint.h>

// Wrap-safe arithmetic on 32-bit millisecond clocks. millis() rolls over every
// ~49.7 days, so `now >= deadline` and `now - since > window` written naively
// go wrong once in a while, on a robot that drives. Every time comparison in
// the firmware goes through one of these two.
namespace timing {

// Has `now` reached `deadline`, a moment in the future when it was set? Valid
// while the deadline is less than ~24.8 days away, far beyond any move.
inline bool reached(uint32_t now, uint32_t deadline) {
  return static_cast<int32_t>(now - deadline) >= 0;
}

// Milliseconds since `since`, a moment in the past. Unsigned, so it stays
// correct for any age up to ~49.7 days: a long-silent source reads as old,
// never as fresh again.
inline uint32_t since(uint32_t now, uint32_t since) { return now - since; }

}  // namespace timing

#endif

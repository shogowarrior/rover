#ifndef TIMING_H
#define TIMING_H

#include <stdint.h>

// Wrap-safe arithmetic on 32-bit millisecond clocks. millis() rolls over every
// ~49.7 days, so `now >= deadline` and `now - since > window` written naively
// go wrong once in a while, on a robot that drives. Every time comparison in
// the firmware goes through these: reached() for a deadline, since() and
// elapsed() for an age, ageOf() for the age of a stamp that may be a little
// later than `now`.
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

// Has `interval` passed since `then`? An age, unsigned like since().
inline bool elapsed(uint32_t now, uint32_t then, uint32_t interval) {
  return since(now, then) >= interval;
}

// How far ahead of `now` a stamp may be and still read as just made: far
// more than one pass of loop() can take, which the loop watchdog bounds at
// 5 s.
constexpr uint32_t STAMP_AHEAD_MAX_MS = 60000;

// Milliseconds since `then`, which may be later than `now`: loop() reads
// `now` once, at the top of a pass, but the pad stamps with its own clock and
// the WebSocket server with millis() further into the pass, and a sonar ping
// before them can hold the pass for 30 ms. Compared with that earlier `now`,
// since() makes such a stamp ~49.7 days old: a hold read as lapsed, a change
// read as long still. A stamp up to STAMP_AHEAD_MAX_MS ahead is age 0 here;
// beyond that, unsigned like since(). Whatever compares an age this way must
// forget the stamp once it no longer matters, so it is never ~49.7 days old
// either.
inline uint32_t ageOf(uint32_t now, uint32_t then) {
  const uint32_t age = now - then;
  return age > UINT32_MAX - STAMP_AHEAD_MAX_MS ? 0 : age;
}

}  // namespace timing

#endif

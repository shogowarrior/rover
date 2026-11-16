#include "EventLog.h"

#include <stdarg.h>
#include <stdio.h>

// The line numbered `seq` lives at seq % CAPACITY. CAPACITY divides 2^32, so
// that holds across the counter's wrap too.
void EventLog::add(uint32_t now, Level level, const char* format, ...) {
  Entry& entry = entries[next % CAPACITY];
  entry.seq = next;
  entry.atMs = now;
  entry.level = level;
  va_list args;
  va_start(args, format);
  vsnprintf(entry.text, TEXT_MAX, format, args);
  va_end(args);
  // ASCII only. A line cut short at TEXT_MAX could split a multibyte
  // character, and a WebSocket text frame that is not valid UTF-8 makes a
  // browser close the link: the driver's, which stops the rover.
  for (char* c = entry.text; *c != '\0'; c++) {
    if (static_cast<unsigned char>(*c) >= 0x80) *c = '?';
  }

  next++;
  if (count < CAPACITY) count++;
  if (echo != nullptr) echo(entry);
}

const EventLog::Entry* EventLog::from(uint32_t seq) const {
  const uint32_t oldest = next - static_cast<uint32_t>(count);
  const int32_t ahead = static_cast<int32_t>(seq - oldest);
  if (ahead >= count) return nullptr;
  return &entries[(ahead < 0 ? oldest : seq) % CAPACITY];
}

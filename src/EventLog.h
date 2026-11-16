#ifndef EVENT_LOG_H
#define EVENT_LOG_H

#include <stddef.h>
#include <stdint.h>

// What the rover did and why, one short line each: the explorer's readings
// and decisions, mode changes, the sonar's mode, the pad, the links coming
// and going, the boot. Pure core (AGENTS.md, Architecture), host-tested in
// test/test_event_log, and written only from the loop task.
//
// A fixed ring: no heap, and the oldest line gives way to the newest.
// RemoteControl sends each new line to every client and, to a client that
// has just connected, every line still held, so a panel opened after the
// boot still sees why the rover started the way it did.
//
// Each line is numbered, from `firstSeq` at boot. main.cpp starts from a
// random number, so a client that kept the lines of an earlier boot never
// mistakes this boot's for lines it already has: the panel drops a line
// whose number it holds.
class EventLog {
 public:
  enum Level { INFO, WARN };

  static constexpr int CAPACITY = 32;
  static constexpr size_t TEXT_MAX = 80;  // the terminator included

  struct Entry {
    uint32_t seq;
    uint32_t atMs;  // the rover's clock: ms since boot
    Level level;
    char text[TEXT_MAX];
  };

  explicit EventLog(uint32_t firstSeq = 0) : next(firstSeq) {}

  // printf-style. A line longer than TEXT_MAX - 1 characters is cut short,
  // and any byte outside ASCII becomes '?'.
  void add(uint32_t now, Level level, const char* format, ...) __attribute__((format(printf, 4, 5)));

  // Each line is handed to `echo` as it is added: main.cpp prints it on the
  // serial console. nullptr for none.
  void echoTo(void (*echo)(const Entry& entry)) { this->echo = echo; }

  // The oldest line held numbered `seq` or later, or nullptr if there is
  // none yet. A reader asks for the number after the last line it took; if
  // the ring has moved past that, it gets the oldest line held, and the
  // lines in between are lost to it. Wrap-safe.
  const Entry* from(uint32_t seq) const;

  // The number the next line will get.
  uint32_t nextSeq() const { return next; }
  // The number of the oldest line held: nextSeq() while none is.
  uint32_t oldestSeq() const { return next - static_cast<uint32_t>(count); }

 private:
  Entry entries[CAPACITY];
  uint32_t next;
  int count = 0;  // lines held, up to CAPACITY
  void (*echo)(const Entry& entry) = nullptr;
};

#endif

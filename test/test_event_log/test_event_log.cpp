#include <string.h>
#include <unity.h>

#include <string>
#include <vector>

#include "EventLog.h"

// The rover's log: a ring of numbered lines (EventLog.h).

void setUp(void) {}
void tearDown(void) {}

namespace {

std::vector<std::string> echoed;
void echo(const EventLog::Entry& entry) { echoed.push_back(entry.text); }

// Every line from `seq` on, as a reader takes them: each next number after
// the one it got.
std::vector<uint32_t> read(const EventLog& log, uint32_t seq) {
  std::vector<uint32_t> got;
  for (const EventLog::Entry* entry = log.from(seq); entry != nullptr; entry = log.from(entry->seq + 1)) {
    got.push_back(entry->seq);
  }
  return got;
}

}  // namespace

void test_lines_are_numbered_from_the_first_number(void) {
  EventLog log(1000);
  TEST_ASSERT_NULL(log.from(1000));
  TEST_ASSERT_EQUAL_UINT32(1000, log.oldestSeq());
  log.add(5, EventLog::INFO, "one %d", 1);
  log.add(7, EventLog::WARN, "two");
  TEST_ASSERT_EQUAL_UINT32(1002, log.nextSeq());
  const EventLog::Entry* first = log.from(1000);
  TEST_ASSERT_NOT_NULL(first);
  TEST_ASSERT_EQUAL_UINT32(1000, first->seq);
  TEST_ASSERT_EQUAL_UINT32(5, first->atMs);
  TEST_ASSERT_EQUAL_INT(EventLog::INFO, first->level);
  TEST_ASSERT_EQUAL_STRING("one 1", first->text);
  const EventLog::Entry* second = log.from(1001);
  TEST_ASSERT_EQUAL_INT(EventLog::WARN, second->level);
  TEST_ASSERT_EQUAL_STRING("two", second->text);
  TEST_ASSERT_NULL(log.from(1002));
}

// A reader that fell behind gets the oldest line held, and loses those in
// between; one ahead of the log gets nothing.
void test_the_ring_keeps_the_newest_lines(void) {
  EventLog log(0);
  for (int i = 0; i < EventLog::CAPACITY + 10; i++) log.add(i, EventLog::INFO, "line %d", i);
  TEST_ASSERT_EQUAL_UINT32(10, log.oldestSeq());
  TEST_ASSERT_EQUAL_UINT32(10, log.from(0)->seq);
  TEST_ASSERT_EQUAL_STRING("line 10", log.from(3)->text);
  TEST_ASSERT_EQUAL_STRING("line 41", log.from(41)->text);
  TEST_ASSERT_NULL(log.from(42));
  TEST_ASSERT_NULL(log.from(1000));
  TEST_ASSERT_EQUAL_size_t(EventLog::CAPACITY, read(log, 0).size());
}

// The numbers start anywhere (main.cpp picks one at random), so they wrap.
void test_numbers_wrap_safely(void) {
  EventLog log(0xFFFFFFF0u);
  for (int i = 0; i < EventLog::CAPACITY + 8; i++) log.add(i, EventLog::INFO, "line %d", i);
  // 40 lines: 0xFFFFFFF0 to 0x17, the oldest 8 gone.
  TEST_ASSERT_EQUAL_UINT32(0xFFFFFFF8u, log.oldestSeq());
  TEST_ASSERT_EQUAL_UINT32(0x18u, log.nextSeq());
  const std::vector<uint32_t> all = read(log, 0xFFFFFFF0u);
  TEST_ASSERT_EQUAL_size_t(EventLog::CAPACITY, all.size());
  TEST_ASSERT_EQUAL_UINT32(0xFFFFFFF8u, all.front());
  TEST_ASSERT_EQUAL_UINT32(0x17u, all.back());
  TEST_ASSERT_EQUAL_STRING("line 8", log.from(0xFFFFFFF8u)->text);
  TEST_ASSERT_EQUAL_STRING("line 16", log.from(0)->text);
  TEST_ASSERT_NULL(log.from(0x18u));
}

void test_a_long_line_is_cut_short(void) {
  EventLog log;
  std::string longText(200, 'x');
  log.add(0, EventLog::INFO, "%s", longText.c_str());
  const EventLog::Entry* entry = log.from(0);
  TEST_ASSERT_EQUAL_size_t(EventLog::TEXT_MAX - 1, strlen(entry->text));
}

// A WebSocket text frame must be UTF-8, and a cut could split a character:
// the log keeps to ASCII.
void test_lines_are_ascii(void) {
  EventLog log;
  log.add(0, EventLog::INFO, "%s", "45\xC2\xB0 left, caf\xC3\xA9");
  TEST_ASSERT_EQUAL_STRING("45?? left, caf??", log.from(0)->text);
}

void test_each_line_is_echoed_as_it_is_added(void) {
  EventLog log;
  echoed.clear();
  log.add(0, EventLog::INFO, "before");
  log.echoTo(echo);
  log.add(1, EventLog::INFO, "after %s", "echo");
  log.echoTo(nullptr);
  log.add(2, EventLog::INFO, "not echoed");
  TEST_ASSERT_EQUAL_size_t(1, echoed.size());
  TEST_ASSERT_EQUAL_STRING("after echo", echoed[0].c_str());
}

// A line is the rover's own unless it names whose it is.
void test_each_line_says_whose_it_is(void) {
  EventLog log;
  log.add(1, EventLog::INFO, "the rover's");
  log.add(2, EventLog::WARN, SOURCE_PAD, "the pad's %d", 2);
  log.add(3, EventLog::INFO, SOURCE_USB, "the cable's");
  log.add(4, EventLog::INFO, SOURCE_WIFI, "a client's");
  TEST_ASSERT_EQUAL_INT(SOURCE_ROVER, log.from(0)->source);
  TEST_ASSERT_EQUAL_INT(SOURCE_PAD, log.from(1)->source);
  TEST_ASSERT_EQUAL_STRING("the pad's 2", log.from(1)->text);
  TEST_ASSERT_EQUAL_INT(EventLog::WARN, log.from(1)->level);
  TEST_ASSERT_EQUAL_INT(SOURCE_USB, log.from(2)->source);
  TEST_ASSERT_EQUAL_INT(SOURCE_WIFI, log.from(3)->source);
}

int main(int, char**) {
  UNITY_BEGIN();
  RUN_TEST(test_lines_are_numbered_from_the_first_number);
  RUN_TEST(test_the_ring_keeps_the_newest_lines);
  RUN_TEST(test_numbers_wrap_safely);
  RUN_TEST(test_a_long_line_is_cut_short);
  RUN_TEST(test_lines_are_ascii);
  RUN_TEST(test_each_line_is_echoed_as_it_is_added);
  RUN_TEST(test_each_line_says_whose_it_is);
  return UNITY_END();
}

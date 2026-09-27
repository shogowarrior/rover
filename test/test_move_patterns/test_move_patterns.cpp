#include <string.h>
#include <unity.h>

#include "MovePatterns.h"

// The wheel table is the whole wire-protocol-to-motion mapping. These tests
// pin it: the rows were transcribed from the eighteen per-move methods the
// table replaced (git show 89593e2:src/Rover.cpp), and a silent edit here
// would spin a wheel the wrong way with no compile error.

void setUp(void) {}
void tearDown(void) {}

namespace {

const WheelDirection F = WHEEL_FORWARD;
const WheelDirection B = WHEEL_BACKWARD;
const WheelDirection X = WHEEL_FREE;

struct Expected {
  MoveCode move;
  WheelDirection wheels[WHEEL_COUNT];  // front-left, front-right, rear-right, rear-left
};

const Expected EXPECTED[] = {
    {STOP, {X, X, X, X}},
    {MOVE_FORWARD, {F, F, F, F}},
    {MOVE_BACKWARD, {B, B, B, B}},
    {MOVE_RIGHT, {F, B, F, B}},
    {MOVE_LEFT, {B, F, B, F}},
    {MOVE_DIAGONAL45, {F, X, F, X}},
    {MOVE_DIAGONAL135, {X, F, X, F}},
    {MOVE_DIAGONAL225, {B, X, B, X}},
    {MOVE_DIAGONAL315, {X, B, X, B}},
    {PIVOT_RIGHT_FORWARD, {X, B, B, X}},
    {PIVOT_RIGHT_BACKWARD, {X, F, F, X}},
    {PIVOT_LEFT_FORWARD, {B, X, X, B}},
    {PIVOT_LEFT_BACKWARD, {F, X, X, F}},
    {PIVOT_SIDEWAYS_FORWARD_RIGHT, {F, B, X, X}},
    {PIVOT_SIDEWAYS_FORWARD_LEFT, {X, X, B, F}},
    {PIVOT_SIDEWAYS_BACKWARD_RIGHT, {X, F, X, B}},
    {PIVOT_SIDEWAYS_BACKWARD_LEFT, {F, X, B, X}},
    {ROTATE_CLOCKWISE, {F, B, B, F}},
    {ROTATE_COUNTERCLOCKWISE, {B, F, F, B}},
};

WheelDirection opposite(WheelDirection direction) {
  if (direction == WHEEL_FORWARD) return WHEEL_BACKWARD;
  if (direction == WHEEL_BACKWARD) return WHEEL_FORWARD;
  return WHEEL_FREE;
}

void assertOpposite(MoveCode a, MoveCode b) {
  const MovePattern* first = findMovePattern(a);
  const MovePattern* second = findMovePattern(b);
  TEST_ASSERT_NOT_NULL(first);
  TEST_ASSERT_NOT_NULL(second);
  for (int wheel = 0; wheel < WHEEL_COUNT; wheel++) {
    TEST_ASSERT_EQUAL_INT(opposite(first->wheels[wheel]), second->wheels[wheel]);
  }
}

}  // namespace

void test_every_motion_matches_the_original_methods(void) {
  for (const Expected& expected : EXPECTED) {
    const MovePattern* pattern = findMovePattern(expected.move);
    TEST_ASSERT_NOT_NULL_MESSAGE(pattern, "a motion code has no pattern");
    TEST_ASSERT_EQUAL_INT(expected.move, pattern->move);
    for (int wheel = 0; wheel < WHEEL_COUNT; wheel++) {
      TEST_ASSERT_EQUAL_INT_MESSAGE(expected.wheels[wheel], pattern->wheels[wheel], pattern->name);
    }
  }
}

void test_every_code_except_resume_is_a_motion(void) {
  for (int code = 0; code < MOVE_CODE_COUNT; code++) {
    const MovePattern* pattern = findMovePattern(static_cast<MoveCode>(code));
    if (code == RESUME_AUTONOMOUS) {
      TEST_ASSERT_NULL(pattern);
    } else {
      TEST_ASSERT_NOT_NULL(pattern);
      TEST_ASSERT_EQUAL_INT(code, pattern->move);
    }
  }
}

void test_names_are_the_enum_identifiers(void) {
  TEST_ASSERT_EQUAL_STRING("STOP", moveName(STOP));
  TEST_ASSERT_EQUAL_STRING("MOVE_FORWARD", moveName(MOVE_FORWARD));
  TEST_ASSERT_EQUAL_STRING("PIVOT_SIDEWAYS_BACKWARD_LEFT", moveName(PIVOT_SIDEWAYS_BACKWARD_LEFT));
  TEST_ASSERT_EQUAL_STRING("ROTATE_COUNTERCLOCKWISE", moveName(ROTATE_COUNTERCLOCKWISE));
  TEST_ASSERT_EQUAL_STRING("UNKNOWN", moveName(RESUME_AUTONOMOUS));
}

// Reversing a motion must reverse every wheel. A typo in one row breaks this.
void test_opposite_motions_mirror_every_wheel(void) {
  assertOpposite(MOVE_FORWARD, MOVE_BACKWARD);
  assertOpposite(MOVE_RIGHT, MOVE_LEFT);
  assertOpposite(MOVE_DIAGONAL45, MOVE_DIAGONAL225);
  assertOpposite(MOVE_DIAGONAL135, MOVE_DIAGONAL315);
  assertOpposite(ROTATE_CLOCKWISE, ROTATE_COUNTERCLOCKWISE);
  assertOpposite(PIVOT_RIGHT_FORWARD, PIVOT_RIGHT_BACKWARD);
  assertOpposite(PIVOT_LEFT_FORWARD, PIVOT_LEFT_BACKWARD);
}

void test_move_code_validation(void) {
  TEST_ASSERT_TRUE(isMoveCode(STOP));
  TEST_ASSERT_TRUE(isMoveCode(RESUME_AUTONOMOUS));
  TEST_ASSERT_FALSE(isMoveCode(-1));
  TEST_ASSERT_FALSE(isMoveCode(MOVE_CODE_COUNT));
  TEST_ASSERT_FALSE(isMoveCode(257));  // would wrap to MOVE_FORWARD through a uint8_t
}

int main(int, char**) {
  UNITY_BEGIN();
  RUN_TEST(test_every_motion_matches_the_original_methods);
  RUN_TEST(test_every_code_except_resume_is_a_motion);
  RUN_TEST(test_names_are_the_enum_identifiers);
  RUN_TEST(test_opposite_motions_mirror_every_wheel);
  RUN_TEST(test_move_code_validation);
  return UNITY_END();
}

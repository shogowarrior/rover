#include <string.h>
#include <unity.h>

#include "MovePatterns.h"

// The wheel table is the whole wire-protocol-to-motion mapping. These tests
// pin it, because a silent edit here would spin a wheel the wrong way with no
// compile error. The owner's reference is DroneBot Workshop's mecanum table
// (https://dronebotworkshop.com/mecanum/), and every row matches it.

void setUp(void) {}
void tearDown(void) {}

namespace {

// DroneBot Workshop's constants, verbatim, as the bits of each byte, with
// its name for each. Its moveMotors() writes two bits per motor from bit 7
// down: right front, left front, right rear, left rear, each as IN1 then IN2.
// "10" turns a motor forward (its motor test sketch drives "FR - Forward"
// with AI1 HIGH and AI2 LOW), "01" backward, and "00" leaves it off. Its
// PIVOT_SIDEWAYS_FRONT_* and _REAR_* are our PIVOT_SIDEWAYS_FORWARD_* and
// _BACKWARD_*: the axle that swings.
//
// The per-move methods this table replaced had the pivots inverted against
// their names and against DroneBot: each *_FORWARD pivot drove the wrong
// side's pair backward, and each *_BACKWARD pivot forward, so under ADVANCED
// a stick pushed forward with L1 held backed the rover up, where nothing
// watches. Of the sideways pivots, FORWARD_LEFT drove the rear axle, and the
// two BACKWARD ones a diagonal pair against itself, which only spins the
// rover on the spot.
struct Reference {
  MoveCode move;
  const char* bits;
};

const Reference DRONEBOT[] = {
    {MOVE_FORWARD, "10101010"},                   // MEC_STRAIGHT_FORWARD
    {MOVE_BACKWARD, "01010101"},                  // MEC_STRAIGHT_BACKWARD
    {MOVE_RIGHT, "01101001"},                     // MEC_SIDEWAYS_RIGHT
    {MOVE_LEFT, "10010110"},                      // MEC_SIDEWAYS_LEFT
    {MOVE_DIAGONAL45, "00101000"},                // MEC_DIAGONAL_45
    {MOVE_DIAGONAL135, "10000010"},               // MEC_DIAGONAL_135
    {MOVE_DIAGONAL225, "00010100"},               // MEC_DIAGONAL_225
    {MOVE_DIAGONAL315, "01000001"},               // MEC_DIAGONAL_315
    {PIVOT_RIGHT_FORWARD, "00100010"},            // MEC_PIVOT_RIGHT_FORWARD
    {PIVOT_RIGHT_BACKWARD, "00010001"},           // MEC_PIVOT_RIGHT_BACKWARD
    {PIVOT_LEFT_FORWARD, "10001000"},             // MEC_PIVOT_LEFT_FORWARD
    {PIVOT_LEFT_BACKWARD, "01000100"},            // MEC_PIVOT_LEFT_BACKWARD
    {PIVOT_SIDEWAYS_FORWARD_RIGHT, "01100000"},   // MEC_PIVOT_SIDEWAYS_FRONT_RIGHT
    {PIVOT_SIDEWAYS_FORWARD_LEFT, "10010000"},    // MEC_PIVOT_SIDEWAYS_FRONT_LEFT
    {PIVOT_SIDEWAYS_BACKWARD_RIGHT, "00001001"},  // MEC_PIVOT_SIDEWAYS_REAR_RIGHT
    {PIVOT_SIDEWAYS_BACKWARD_LEFT, "00000110"},   // MEC_PIVOT_SIDEWAYS_REAR_LEFT
    {ROTATE_CLOCKWISE, "01100110"},               // MEC_ROTATE_CLOCKWISE
    {ROTATE_COUNTERCLOCKWISE, "10011001"},        // MEC_ROTATE_COUNTERCLOCKWISE
};

// DroneBot's motor order, from bit 7 down, as our wheels.
const Wheel DRONEBOT_MOTORS[WHEEL_COUNT] = {WHEEL_FRONT_RIGHT, WHEEL_FRONT_LEFT, WHEEL_REAR_RIGHT, WHEEL_REAR_LEFT};

WheelDirection fromBits(char in1, char in2) {
  if (in1 == '1' && in2 == '0') return WHEEL_FORWARD;
  if (in1 == '0' && in2 == '1') return WHEEL_BACKWARD;
  return WHEEL_FREE;
}

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

// A pivot is half of a four-wheel move: one pair of wheels turns exactly as
// in `whole`, and the other pair coasts, so the rover swings about it.
void assertHalfOf(MoveCode pivot, MoveCode whole, Wheel first, Wheel second) {
  const MovePattern* half = findMovePattern(pivot);
  const MovePattern* full = findMovePattern(whole);
  TEST_ASSERT_NOT_NULL(half);
  TEST_ASSERT_NOT_NULL(full);
  for (int wheel = 0; wheel < WHEEL_COUNT; wheel++) {
    const bool driven = wheel == first || wheel == second;
    TEST_ASSERT_EQUAL_INT_MESSAGE(driven ? full->wheels[wheel] : WHEEL_FREE, half->wheels[wheel], half->name);
  }
}

}  // namespace

// Every motion DroneBot defines, decoded from its own bytes, so no row can
// drift from the reference unnoticed, as the pivots once had.
void test_every_motion_matches_dronebot_workshop(void) {
  for (const Reference& reference : DRONEBOT) {
    const MovePattern* pattern = findMovePattern(reference.move);
    TEST_ASSERT_NOT_NULL(pattern);
    TEST_ASSERT_EQUAL_INT(2 * WHEEL_COUNT, static_cast<int>(strlen(reference.bits)));
    for (int motor = 0; motor < WHEEL_COUNT; motor++) {
      const WheelDirection direction = fromBits(reference.bits[2 * motor], reference.bits[2 * motor + 1]);
      TEST_ASSERT_EQUAL_INT_MESSAGE(direction, pattern->wheels[DRONEBOT_MOTORS[motor]], pattern->name);
    }
  }
}

// A *_FORWARD pivot drives its pair forward and a *_BACKWARD pivot backward,
// the way MOVE_FORWARD and MOVE_BACKWARD turn those wheels, so the stick's
// fore-and-aft sense holds in the pivot family. RIGHT pivots about the
// right-hand wheels: the left pair drives, and the nose turns right going
// forward.
void test_pivots_drive_the_way_their_names_say(void) {
  assertHalfOf(PIVOT_RIGHT_FORWARD, MOVE_FORWARD, WHEEL_FRONT_LEFT, WHEEL_REAR_LEFT);
  assertHalfOf(PIVOT_RIGHT_BACKWARD, MOVE_BACKWARD, WHEEL_FRONT_LEFT, WHEEL_REAR_LEFT);
  assertHalfOf(PIVOT_LEFT_FORWARD, MOVE_FORWARD, WHEEL_FRONT_RIGHT, WHEEL_REAR_RIGHT);
  assertHalfOf(PIVOT_LEFT_BACKWARD, MOVE_BACKWARD, WHEEL_FRONT_RIGHT, WHEEL_REAR_RIGHT);
}

// A sideways pivot strafes one axle and lets the other coast, so that end of
// the rover swings toward the side named: FORWARD swings the front axle and
// BACKWARD the rear, the way MOVE_RIGHT and MOVE_LEFT turn its wheels.
void test_sideways_pivots_swing_the_axle_their_names_say(void) {
  assertHalfOf(PIVOT_SIDEWAYS_FORWARD_RIGHT, MOVE_RIGHT, WHEEL_FRONT_LEFT, WHEEL_FRONT_RIGHT);
  assertHalfOf(PIVOT_SIDEWAYS_FORWARD_LEFT, MOVE_LEFT, WHEEL_FRONT_LEFT, WHEEL_FRONT_RIGHT);
  assertHalfOf(PIVOT_SIDEWAYS_BACKWARD_RIGHT, MOVE_RIGHT, WHEEL_REAR_RIGHT, WHEEL_REAR_LEFT);
  assertHalfOf(PIVOT_SIDEWAYS_BACKWARD_LEFT, MOVE_LEFT, WHEEL_REAR_RIGHT, WHEEL_REAR_LEFT);
}

// DroneBot's table has no STOP row, so it is pinned here: every wheel coasts.
void test_every_code_except_resume_is_a_motion(void) {
  for (int code = 0; code < MOVE_CODE_COUNT; code++) {
    const MovePattern* pattern = findMovePattern(static_cast<MoveCode>(code));
    if (code == RESUME_AUTONOMOUS) {
      TEST_ASSERT_NULL(pattern);
    } else {
      TEST_ASSERT_NOT_NULL(pattern);
      TEST_ASSERT_EQUAL_INT(code, pattern->move);
    }
    if (code == STOP) {
      for (int wheel = 0; wheel < WHEEL_COUNT; wheel++) TEST_ASSERT_EQUAL_INT(WHEEL_FREE, pattern->wheels[wheel]);
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
  assertOpposite(PIVOT_SIDEWAYS_FORWARD_RIGHT, PIVOT_SIDEWAYS_FORWARD_LEFT);
  assertOpposite(PIVOT_SIDEWAYS_BACKWARD_RIGHT, PIVOT_SIDEWAYS_BACKWARD_LEFT);
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
  RUN_TEST(test_every_motion_matches_dronebot_workshop);
  RUN_TEST(test_pivots_drive_the_way_their_names_say);
  RUN_TEST(test_sideways_pivots_swing_the_axle_their_names_say);
  RUN_TEST(test_every_code_except_resume_is_a_motion);
  RUN_TEST(test_names_are_the_enum_identifiers);
  RUN_TEST(test_opposite_motions_mirror_every_wheel);
  RUN_TEST(test_move_code_validation);
  return UNITY_END();
}

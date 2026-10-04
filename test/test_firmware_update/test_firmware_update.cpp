#include <ArduinoJson.h>
#include <string.h>
#include <unity.h>

#include <algorithm>
#include <string>
#include <vector>

#include "../fakes/FakeHardware.h"
#include "FirmwareUpdate.h"
#include "Protocol.h"
#include "Tuning.h"

// A firmware update's rules, on the host: who may move one on, when the
// rover is stood down and when motion or silence ends the update, the
// password's challenge, the checks on every chunk, and what each reply says.
// FakeFirmwareSlot stands in for Update; every value here is made up.

namespace {

typedef FirmwareUpdate::Reply Reply;

const uint8_t PANEL = 1;  // the client updating the rover
const uint8_t OTHER = 2;  // another client, connected meanwhile
const char MD5[] = "0123456789abcdef0123456789abcdef";
const char SECRET[] = "feedfacefeedfacefeedfacefeedface";
const char CNONCE[] = "c0ffeec0ffeec0ffeec0ffeec0ffee00";
const size_t IMAGE_SIZE = 2500;  // two whole chunks and a part

FakeMotors* motors;
FakeScanner* scanner;
Rover* rover;
FakeFirmwareSlot* slot;
FirmwareUpdate* firmware;

// An image that starts as an ESP32 app does, then a pattern.
std::vector<uint8_t> appImage(size_t size = IMAGE_SIZE) {
  std::vector<uint8_t> image(size);
  for (size_t i = 0; i < size; i++) image[i] = static_cast<uint8_t>(i * 7 + 3);
  image[0] = 0xE9;
  image[12] = 0x00;
  image[13] = 0x00;
  const uint8_t appDescMagic[] = {0x32, 0x54, 0xCD, 0xAB};
  if (size >= 36) std::copy(appDescMagic, appDescMagic + 4, image.begin() + 32);
  return image;
}

// What the rover would send for `reply`, checked: every reply the core makes
// must fit RemoteControl's buffer, or the client waits on it in vain.
Reply sent(Reply reply) {
  if (reply.kind != Reply::NONE) {
    char out[protocol::OTA_REPLY_MAX_BYTES];
    TEST_ASSERT_TRUE_MESSAGE(protocol::writeOtaReply(reply, out, sizeof(out)) > 0, "the reply fits");
  }
  return reply;
}

void assertNothing(const Reply& reply) { TEST_ASSERT_EQUAL_INT(Reply::NONE, reply.kind); }

void assertNext(const Reply& reply, uint32_t offset, uint8_t client = PANEL) {
  TEST_ASSERT_EQUAL_INT(Reply::NEXT, reply.kind);
  TEST_ASSERT_EQUAL_UINT8(client, reply.client);
  TEST_ASSERT_EQUAL_UINT32(offset, reply.offset);
}

void assertFailed(const Reply& reply, uint8_t client, const char* reason) {
  TEST_ASSERT_EQUAL_INT(Reply::FAILED, reply.kind);
  TEST_ASSERT_EQUAL_UINT8(client, reply.client);
  TEST_ASSERT_EQUAL_STRING(reason, reply.reason);
}

Reply begin(uint32_t now, uint8_t client = PANEL, uint32_t size = IMAGE_SIZE, const char* md5 = MD5) {
  return sent(firmware->begin(client, size, md5, now));
}

Reply receive(const std::vector<uint8_t>& image, size_t from, size_t length, uint32_t now, uint8_t client = PANEL) {
  return sent(firmware->receive(client, image.data() + from, length, now));
}

// The panel's side: from each "next", the chunk at its offset, until a reply
// is anything else. Returns that reply.
Reply sendFrom(const Reply& first, const std::vector<uint8_t>& image, uint32_t now) {
  Reply reply = first;
  while (reply.kind == Reply::NEXT) {
    const size_t length = std::min(protocol::OTA_CHUNK_MAX_BYTES, image.size() - reply.offset);
    reply = receive(image, reply.offset, length, now);
  }
  return reply;
}

// md5hex(secret:nonce:cnonce), as a client that knows the password answers,
// with the fake's digest standing in for MD5.
std::string answer(const char* secret, const char* nonce, const char* cnonce = CNONCE) {
  hardware::Hex32 digest;
  FakeFirmwareSlot::digest((std::string(secret) + ":" + nonce + ":" + cnonce).c_str(), digest);
  return digest;
}

// An update under way, its first chunk written: offset 1000 next.
void receiving(uint32_t now) {
  assertNext(begin(now), 0);
  assertNext(receive(appImage(), 0, 1000, now), 1000);
}

// Drives the rover forward, as any client may meanwhile.
void drive(uint32_t now) { rover->command(MOVE_FORWARD, 100, 400, now); }

}  // namespace

void setUp(void) {
  motors = new FakeMotors();
  scanner = new FakeScanner();
  rover = new Rover(*motors, *scanner);
  rover->begin(Rover::MODE_MANUAL, 0);
  slot = new FakeFirmwareSlot();
  firmware = new FirmwareUpdate(*rover, *slot, false);
  firmware->setSecret("");  // as Network does once the running image is kept
}

void tearDown(void) {
  delete firmware;
  delete slot;
  delete rover;
  delete scanner;
  delete motors;
}

// Until Network has kept the running image, an update would overwrite the
// image it goes back to: refused, and the rover left as it was.
void test_nothing_begins_before_the_secret_is_set(void) {
  FirmwareUpdate fresh(*rover, *slot, false);
  rover->command(RESUME_AUTONOMOUS, 0, 0, 0);
  assertFailed(sent(fresh.begin(PANEL, IMAGE_SIZE, MD5, 10)), PANEL,
               "The rover is still trying out new firmware: try again in half a minute.");
  TEST_ASSERT_FALSE(slot->open);
  TEST_ASSERT_EQUAL_INT(Rover::MODE_AUTONOMOUS, rover->status().mode);
}

// Where updates need a password (features::LINK_UPDATE_NEEDS_PASSWORD), a
// rover without one refuses every update, to its client, and changes
// nothing; with one, it asks for it.
void test_no_update_without_a_password_where_one_is_needed(void) {
  FirmwareUpdate strict(*rover, *slot, true);
  strict.setSecret("");
  rover->command(RESUME_AUTONOMOUS, 0, 0, 0);
  assertFailed(sent(strict.begin(PANEL, IMAGE_SIZE, MD5, 10)), PANEL,
               "This rover has no OTA password, and updates from the panel need one: see the README.");
  TEST_ASSERT_FALSE(slot->open);
  TEST_ASSERT_EQUAL_INT(0, slot->beginCalls);
  TEST_ASSERT_EQUAL_INT(Rover::MODE_AUTONOMOUS, rover->status().mode);

  strict.setSecret(SECRET);
  const Reply challenge = sent(strict.begin(PANEL, IMAGE_SIZE, MD5, 20));
  TEST_ASSERT_EQUAL_INT(Reply::AUTH, challenge.kind);
  TEST_ASSERT_EQUAL_INT(Rover::MODE_MANUAL, rover->status().mode);
}

// Without a password the slot opens at once, for the size and MD5 asked, and
// the first chunk asked for is at 0.
void test_begin_opens_the_slot(void) {
  assertNext(begin(0), 0);
  TEST_ASSERT_TRUE(slot->open);
  TEST_ASSERT_EQUAL_UINT32(IMAGE_SIZE, slot->begunSize);
  TEST_ASSERT_EQUAL_STRING(MD5, slot->begunMd5.c_str());
}

// Update compares the image's MD5 with the one it was given as lowercase hex.
void test_begin_lowercases_the_md5(void) {
  begin(0, PANEL, IMAGE_SIZE, "0123456789ABCDEF0123456789ABCDEF");
  TEST_ASSERT_EQUAL_STRING(MD5, slot->begunMd5.c_str());
}

// Nothing may move while the flash is written: a driving rover stops, and an
// exploring one drops to manual, so it is still there when the update ends.
void test_begin_stands_the_rover_down(void) {
  drive(0);
  begin(10);
  TEST_ASSERT_FALSE(motors->driving);
  TEST_ASSERT_FALSE(rover->status().moving);

  tearDown();
  setUp();
  rover->begin(Rover::MODE_AUTONOMOUS, 0);
  begin(10);
  TEST_ASSERT_EQUAL_INT(Rover::MODE_MANUAL, rover->status().mode);
}

// A begin with no size or a malformed MD5 is refused, to its client, before
// anything happens: the rover explores on and the slot stays shut.
void test_a_malformed_begin_is_refused_and_changes_nothing(void) {
  rover->begin(Rover::MODE_AUTONOMOUS, 0);
  assertFailed(begin(0, OTHER, 0), OTHER, "The firmware file is empty.");
  const char* const malformed[] = {"", "0123456789abcdef0123456789abcde", "0123456789abcdef0123456789abcdef0",
                                   "0123456789abcdef0123456789abcdeg", "0123456789abcdef 123456789abcdef"};
  for (const char* md5 : malformed) {
    assertFailed(begin(0, OTHER, IMAGE_SIZE, md5), OTHER, "The update's MD5 is not 32 hex digits.");
  }
  TEST_ASSERT_EQUAL_INT(0, slot->beginCalls);
  TEST_ASSERT_EQUAL_INT(Rover::MODE_AUTONOMOUS, rover->status().mode);
}

// One update at a time. A second begin, from anyone, is refused and the
// first goes on, waiting for its password or its next chunk alike.
void test_a_second_begin_is_refused_while_one_is_under_way(void) {
  receiving(0);
  assertFailed(begin(10, OTHER), OTHER, "Another update is under way.");
  assertFailed(begin(10, PANEL), PANEL, "Another update is under way.");
  assertNext(receive(appImage(), 1000, 1000, 20), 2000);
  TEST_ASSERT_EQUAL_INT(1, slot->beginCalls);

  tearDown();
  setUp();
  firmware->setSecret(SECRET);
  begin(0);
  assertFailed(begin(10, OTHER), OTHER, "Another update is under way.");
  assertNext(sent(firmware->authenticate(PANEL, CNONCE, answer(SECRET, "00000000000000000000000000000001").c_str(), 20)),
             0);
}

// The slot's refusal (ArduinoOTA's upload under way, an image too big for
// the slot) is the client's answer, and leaves room for another try.
void test_the_slot_refusing_to_begin_fails_the_update(void) {
  slot->refuseBegin = true;
  assertFailed(begin(0), PANEL, slot->error());
  slot->refuseBegin = false;
  assertNext(begin(10, OTHER), 0, OTHER);
}

// Each "next" names where the image goes on, and the slot gets every byte
// once, in order. The last makes it whole: "done", and nothing aborted.
void test_the_image_is_written_whole_and_in_order(void) {
  const std::vector<uint8_t> image = appImage();
  const Reply done = sendFrom(begin(0), image, 10);
  TEST_ASSERT_EQUAL_INT(Reply::DONE, done.kind);
  TEST_ASSERT_EQUAL_UINT8(PANEL, done.client);
  TEST_ASSERT_TRUE(slot->image == image);
  TEST_ASSERT_TRUE(slot->finished);
  TEST_ASSERT_EQUAL_INT(0, slot->abortCalls);
}

// "done" goes out OTA_RESTART_DELAY_MS before the restart, so it leaves
// before the reset. Nothing else is ever a reason to restart.
void test_the_restart_is_due_only_after_done(void) {
  TEST_ASSERT_FALSE(firmware->restartDue(0));
  receiving(0);
  TEST_ASSERT_FALSE(firmware->restartDue(tuning::OTA_SILENCE_MS - 1));
  sendFrom(receive(appImage(), 1000, 1000, 100), appImage(), 100);
  TEST_ASSERT_FALSE(firmware->restartDue(100 + tuning::OTA_RESTART_DELAY_MS - 1));
  TEST_ASSERT_TRUE(firmware->restartDue(100 + tuning::OTA_RESTART_DELAY_MS));
}

// Once the image is whole, nothing is taken: not another update, not a
// cancel, not the client's leaving, and motion abandons nothing.
void test_done_takes_nothing_more(void) {
  const std::vector<uint8_t> image = appImage();
  sendFrom(begin(0), image, 0);
  assertFailed(begin(10, OTHER), OTHER, "The rover is about to restart into new firmware.");
  assertNothing(receive(image, 0, 1000, 10));
  assertNothing(sent(firmware->cancel(PANEL)));
  assertNothing(sent(firmware->fragmented(PANEL)));
  assertNothing(sent(firmware->authenticate(PANEL, CNONCE, CNONCE, 10)));
  firmware->disconnected(PANEL);
  drive(10);
  assertNothing(sent(firmware->update(20)));
  TEST_ASSERT_EQUAL_INT(0, slot->abortCalls);
}

// The shield keeps its PWM through a reset, so a rover driven after "done"
// restarts only once it is at rest: here its stop's first write lost, and
// the wheels turning on until the second.
void test_the_restart_waits_for_the_rover_at_rest(void) {
  sendFrom(begin(0), appImage(), 0);
  drive(10);
  motors->releasesToLose = 1;
  uint32_t now = 10;
  for (; now < 410 + tuning::MOTOR_REFRESH_MS; now += 10) {
    rover->update(now);
    TEST_ASSERT_FALSE(firmware->restartDue(now));
  }
  TEST_ASSERT_TRUE(motors->driving);
  rover->update(now);
  TEST_ASSERT_FALSE(motors->driving);
  TEST_ASSERT_TRUE(firmware->restartDue(now));
}

// With a password, the rover asks for its answer to a fresh nonce, and opens
// nothing until it has it. It has stood down already.
void test_a_password_is_asked_for_first(void) {
  firmware->setSecret(SECRET);
  drive(0);
  const Reply challenge = begin(10);
  TEST_ASSERT_EQUAL_INT(Reply::AUTH, challenge.kind);
  TEST_ASSERT_EQUAL_UINT8(PANEL, challenge.client);
  TEST_ASSERT_EQUAL_STRING("00000000000000000000000000000001", challenge.nonce);
  TEST_ASSERT_EQUAL_INT(0, slot->beginCalls);
  TEST_ASSERT_FALSE(motors->driving);
}

// The answer is ArduinoOTA's, md5hex(secret:nonce:cnonce), so one password
// serves espota and the panel: exactly that text is digested, and the right
// answer opens the slot.
void test_the_right_answer_opens_the_slot(void) {
  firmware->setSecret(SECRET);
  const Reply challenge = begin(0);
  assertNext(sent(firmware->authenticate(PANEL, CNONCE, answer(SECRET, challenge.nonce).c_str(), 10)), 0);
  TEST_ASSERT_EQUAL_STRING((std::string(SECRET) + ":" + challenge.nonce + ":" + CNONCE).c_str(),
                           slot->digested.back().c_str());
  TEST_ASSERT_TRUE(slot->open);
  TEST_ASSERT_EQUAL_STRING(MD5, slot->begunMd5.c_str());
}

// A hash written in capitals is the same password: the panel and espota
// both hash it as lowercase hex.
void test_the_secret_is_lowercased(void) {
  firmware->setSecret("FEEDFACEFEEDFACEFEEDFACEFEEDFACE");
  const Reply challenge = begin(0);
  assertNext(sent(firmware->authenticate(PANEL, CNONCE, answer(SECRET, challenge.nonce).c_str(), 10)), 0);
}

// A wrong answer ends the update, and the nonce with it: the right answer
// to it, sent next, finds nothing to answer.
void test_a_wrong_answer_fails_and_spends_the_nonce(void) {
  firmware->setSecret(SECRET);
  const Reply challenge = begin(0);
  const std::string wrong = answer("0000000000000000000000000000000f", challenge.nonce);
  assertFailed(sent(firmware->authenticate(PANEL, CNONCE, wrong.c_str(), 10)), PANEL, "Wrong OTA password.");
  assertNothing(sent(firmware->authenticate(PANEL, CNONCE, answer(SECRET, challenge.nonce).c_str(), 20)));
  TEST_ASSERT_EQUAL_INT(0, slot->beginCalls);
}

// A cnonce or response that is not 32 hex digits is a wrong answer. Neither
// can carry a ':' into the challenge, or overrun it.
void test_a_malformed_answer_is_a_wrong_one(void) {
  firmware->setSecret(SECRET);
  const char* const cnonces[] = {"", "c0ffee", "c0ffeec0ffeec0ffeec0ffeec0ffee0:", "c0ffeec0ffeec0ffeec0ffeec0ffee000"};
  for (const char* cnonce : cnonces) {
    const Reply challenge = begin(0);
    assertFailed(sent(firmware->authenticate(PANEL, cnonce, answer(SECRET, challenge.nonce, cnonce).c_str(), 10)),
                 PANEL, "Wrong OTA password.");
  }
  const Reply challenge = begin(0);
  std::string shouted = answer(SECRET, challenge.nonce);
  std::transform(shouted.begin(), shouted.end(), shouted.begin(), ::toupper);
  assertFailed(sent(firmware->authenticate(PANEL, CNONCE, shouted.c_str(), 10)), PANEL, "Wrong OTA password.");
  TEST_ASSERT_EQUAL_INT(0, slot->beginCalls);
}

// Every challenge is new: an answer overheard once opens nothing again.
void test_each_begin_asks_a_fresh_nonce(void) {
  firmware->setSecret(SECRET);
  const std::string first = begin(0).nonce;
  sent(firmware->cancel(PANEL));
  TEST_ASSERT_TRUE(first != begin(10).nonce);
}

// Only the client that began the update answers for it; anyone else's
// answer, right or not, is ignored, and an answer with no question too.
void test_only_the_owner_answers(void) {
  assertNothing(sent(firmware->authenticate(PANEL, CNONCE, CNONCE, 0)));
  firmware->setSecret(SECRET);
  const Reply challenge = begin(0);
  const std::string right = answer(SECRET, challenge.nonce);
  assertNothing(sent(firmware->authenticate(OTHER, CNONCE, right.c_str(), 10)));
  assertNext(sent(firmware->authenticate(PANEL, CNONCE, right.c_str(), 20)), 0);
  assertNothing(sent(firmware->authenticate(PANEL, CNONCE, right.c_str(), 30)));
  assertNext(receive(appImage(), 0, 1000, 40), 1000);
}

// Another client's frames are not the image, and frames with no update are
// nothing: neither is written, and the update goes on.
void test_other_frames_are_ignored(void) {
  const std::vector<uint8_t> image = appImage();
  assertNothing(receive(image, 0, 1000, 0));
  receiving(0);
  assertNothing(receive(image, 1000, 1000, 10, OTHER));
  TEST_ASSERT_EQUAL_UINT(1000, slot->image.size());
  assertNext(receive(image, 1000, 1000, 20), 2000);
}

// The image before the rover asked for it, before the password or before
// the rover came to rest, is a client that skipped a step: the update ends,
// and the slot, if it was opened, is abandoned.
void test_a_frame_before_it_is_asked_for_fails(void) {
  const char reason[] = "The image came before the rover asked for it.";
  firmware->setSecret(SECRET);
  begin(0);
  assertFailed(receive(appImage(), 0, 1000, 10), PANEL, reason);
  TEST_ASSERT_EQUAL_INT(0, slot->beginCalls);
  TEST_ASSERT_EQUAL_INT(0, slot->abortCalls);

  tearDown();
  setUp();
  drive(0);
  assertNothing(begin(10));  // the stand-down's second write still to come
  assertFailed(receive(appImage(), 0, 1000, 20), PANEL, reason);
  TEST_ASSERT_EQUAL_INT(1, slot->abortCalls);
}

// A stop is written again MOTOR_REFRESH_MS later in case the bus lost it,
// and a flash write can hold the loop, and that second write with it, for
// seconds. So the first chunk is asked for only once the rover is at rest:
// here the stand-down's first write lost, and the wheels turning on until
// the second.
void test_the_image_is_asked_for_once_the_rover_is_at_rest(void) {
  drive(0);
  motors->releasesToLose = 1;
  assertNothing(begin(10));
  TEST_ASSERT_TRUE(slot->open);
  uint32_t now = 10;
  for (; now < 10 + tuning::MOTOR_REFRESH_MS; now += 10) {
    rover->update(now);
    assertNothing(sent(firmware->update(now)));
  }
  TEST_ASSERT_TRUE(motors->driving);
  rover->update(now);  // as loop() runs it, before the link
  TEST_ASSERT_FALSE(motors->driving);
  assertNext(sent(firmware->update(now)), 0);
}

// An empty chunk, one over OTA_CHUNK_MAX_BYTES, or one past the image's end
// fails the update, and what was written is abandoned.
void test_a_chunk_of_the_wrong_size_fails(void) {
  const char reason[] = "A chunk of the image had the wrong size.";
  const std::vector<uint8_t> image = appImage(protocol::OTA_CHUNK_MAX_BYTES + 1);
  assertNext(begin(0, PANEL, image.size()), 0);
  assertFailed(receive(image, 0, 0, 10), PANEL, reason);
  TEST_ASSERT_EQUAL_INT(1, slot->abortCalls);

  assertNext(begin(20, PANEL, image.size()), 0);
  assertFailed(receive(image, 0, protocol::OTA_CHUNK_MAX_BYTES + 1, 30), PANEL, reason);
  TEST_ASSERT_EQUAL_INT(2, slot->abortCalls);

  const std::vector<uint8_t> longer = appImage(1600);
  assertNext(begin(40, PANEL, 1500), 0);
  assertNext(receive(longer, 0, 1000, 50), 1000);
  assertFailed(receive(longer, 1000, 600, 60), PANEL, reason);
  TEST_ASSERT_EQUAL_INT(3, slot->abortCalls);
  TEST_ASSERT_FALSE(slot->open);
}

// The first chunk must start an ESP32 app image: a bootloader.bin, a
// partitions.bin or another chip's firmware gets no further. Each byte the
// check reads, broken in turn, and a first chunk too short to hold them.
void test_the_first_chunk_must_start_an_esp32_app(void) {
  const char reason[] = "Not an ESP32 app image: pick firmware.bin from .pio/build/<env>/.";
  const size_t checked[] = {0, 12, 13, 32, 33, 34, 35};
  int failures = 0;
  for (size_t at : checked) {
    std::vector<uint8_t> image = appImage();
    image[at] ^= 0x09;  // the ESP32-S3's chip id, at 12
    assertNext(begin(0), 0);
    assertFailed(receive(image, 0, 1000, 10), PANEL, reason);
    TEST_ASSERT_EQUAL_INT(++failures, slot->abortCalls);
    TEST_ASSERT_TRUE(slot->image.empty());
  }
  // An image's first 35 bytes: one short of the magic word's last.
  assertNext(begin(20, PANEL, 35), 0);
  assertFailed(receive(appImage(), 0, 35, 30), PANEL, reason);
}

// The flash refusing a chunk, or the whole image (a wrong MD5, an image that
// does not verify), fails the update with the slot's own words, and the old
// firmware stays: no restart.
void test_the_slot_refusing_the_image_fails_the_update(void) {
  receiving(0);
  slot->refuseWrite = true;
  assertFailed(receive(appImage(), 1000, 1000, 10), PANEL, slot->error());
  TEST_ASSERT_EQUAL_INT(1, slot->abortCalls);

  tearDown();
  setUp();
  slot->refuseFinish = true;
  assertFailed(sendFrom(begin(0), appImage(), 10), PANEL, slot->error());
  TEST_ASSERT_FALSE(slot->finished);
  TEST_ASSERT_EQUAL_INT(1, slot->abortCalls);
  TEST_ASSERT_FALSE(firmware->restartDue(10 + tuning::OTA_RESTART_DELAY_MS));
}

// Driving ends the update: the operator's hands win, and the wheels drive
// on, undisturbed, while the slot is abandoned.
void test_driving_ends_the_update(void) {
  receiving(0);
  drive(10);
  assertFailed(sent(firmware->update(10)), PANEL, "The rover was driven, so the update stopped.");
  TEST_ASSERT_EQUAL_INT(1, slot->abortCalls);
  TEST_ASSERT_TRUE(motors->driving);
}

// Exploring is motion too, standing still between moves or not.
void test_exploring_ends_the_update(void) {
  receiving(0);
  rover->command(RESUME_AUTONOMOUS, 0, 0, 10);
  assertFailed(sent(firmware->update(10)), PANEL, "The rover was driven, so the update stopped.");
  TEST_ASSERT_EQUAL_INT(Rover::MODE_AUTONOMOUS, rover->status().mode);
}

// Waiting for the password, or for the rover to come to rest, motion ends
// the update just the same.
void test_driving_ends_an_update_before_its_first_chunk(void) {
  firmware->setSecret(SECRET);
  begin(0);
  drive(10);
  assertFailed(sent(firmware->update(10)), PANEL, "The rover was driven, so the update stopped.");
  TEST_ASSERT_EQUAL_INT(0, slot->abortCalls);  // nothing was opened

  tearDown();
  setUp();
  drive(0);
  assertNothing(begin(10));
  drive(20);
  assertFailed(sent(firmware->update(20)), PANEL, "The rover was driven, so the update stopped.");
  TEST_ASSERT_EQUAL_INT(1, slot->abortCalls);
}

// A command and a chunk can arrive in one pass of the loop, before update()
// runs: no chunk is written while the wheels turn.
void test_no_chunk_is_written_while_the_wheels_turn(void) {
  receiving(0);
  drive(10);
  assertFailed(receive(appImage(), 1000, 1000, 10), PANEL, "The rover was driven, so the update stopped.");
  TEST_ASSERT_EQUAL_UINT(1000, slot->image.size());
}

// A move short enough to be released before the next pass of the loop never
// shows as moving there, but its stop's second write is still to come, and
// a chunk's flash write would hold it up: it ends the update all the same.
void test_a_move_already_released_ends_the_update(void) {
  receiving(0);
  rover->command(MOVE_FORWARD, 100, 1, 10);
  motors->releasesToLose = 1;
  rover->update(12);
  TEST_ASSERT_FALSE(rover->status().moving);
  assertFailed(sent(firmware->update(12)), PANEL, "The rover was driven, so the update stopped.");
  TEST_ASSERT_EQUAL_UINT(1000, slot->image.size());
}

// The same, when the chunk comes in the pass the move arrives in.
void test_no_chunk_is_written_after_a_move_already_released(void) {
  receiving(0);
  rover->command(MOVE_FORWARD, 100, 1, 10);
  rover->update(12);
  assertFailed(receive(appImage(), 1000, 1000, 12), PANEL, "The rover was driven, so the update stopped.");
  TEST_ASSERT_EQUAL_UINT(1000, slot->image.size());
}

// Stop is not motion: it takes control, and the update goes on.
void test_stop_is_not_motion(void) {
  receiving(0);
  rover->command(STOP, 0, 0, 10);
  assertNothing(sent(firmware->update(10)));
  assertNext(receive(appImage(), 1000, 1000, 20), 2000);
}

// Silence for OTA_SILENCE_MS after the last reply is a client that has gone.
// Each reply starts the wait again.
void test_silence_ends_the_update(void) {
  receiving(0);
  assertNext(receive(appImage(), 1000, 1000, 3000), 2000);
  assertNothing(sent(firmware->update(3000 + tuning::OTA_SILENCE_MS - 1)));
  assertFailed(sent(firmware->update(3000 + tuning::OTA_SILENCE_MS)), PANEL, "The panel stopped sending.");
  TEST_ASSERT_EQUAL_INT(1, slot->abortCalls);
}

// Waiting for the password, as waiting for a chunk.
void test_silence_ends_an_update_waiting_for_its_password(void) {
  firmware->setSecret(SECRET);
  begin(100);
  assertNothing(sent(firmware->update(100 + tuning::OTA_SILENCE_MS - 1)));
  assertFailed(sent(firmware->update(100 + tuning::OTA_SILENCE_MS)), PANEL, "The panel stopped sending.");
}

// millis() wraps every 49.7 days; a wait that spans it is no shorter. A pass
// of the loop can also read the clock before a reply it then sends is
// stamped, which must not read as a wait long over.
void test_silence_is_timed_across_the_clock_wrap(void) {
  const uint32_t start = 0xFFFFFFFFu - 1000;
  receiving(start);
  assertNothing(sent(firmware->update(start - 10)));
  assertNothing(sent(firmware->update(start + tuning::OTA_SILENCE_MS - 1)));
  assertFailed(sent(firmware->update(start + tuning::OTA_SILENCE_MS)), PANEL, "The panel stopped sending.");
}

// The owner may cancel at any point before the image is whole; anyone
// else's cancel is ignored.
void test_the_owner_can_cancel(void) {
  receiving(0);
  assertNothing(sent(firmware->cancel(OTHER)));
  assertFailed(sent(firmware->cancel(PANEL)), PANEL, "Cancelled.");
  TEST_ASSERT_EQUAL_INT(1, slot->abortCalls);
  TEST_ASSERT_FALSE(slot->open);
  assertNothing(sent(firmware->cancel(PANEL)));

  firmware->setSecret(SECRET);
  begin(10);
  assertFailed(sent(firmware->cancel(PANEL)), PANEL, "Cancelled.");
  TEST_ASSERT_EQUAL_INT(Reply::AUTH, begin(20, OTHER).kind);  // and another may begin
}

// A frame in pieces from the owner would leave a gap in the image; another
// client's is none of the update's business.
void test_a_fragment_from_the_owner_fails_the_update(void) {
  receiving(0);
  assertNothing(sent(firmware->fragmented(OTHER)));
  assertFailed(sent(firmware->fragmented(PANEL)), PANEL, "A frame came in pieces, which the rover cannot take.");
  TEST_ASSERT_EQUAL_INT(1, slot->abortCalls);
}

// The owner gone (closed, dropped by the heartbeat) takes the update with
// it, with nobody to tell; another client leaving changes nothing.
void test_losing_the_owner_ends_the_update(void) {
  receiving(0);
  firmware->disconnected(OTHER);
  assertNext(receive(appImage(), 1000, 1000, 10), 2000);
  firmware->disconnected(PANEL);
  TEST_ASSERT_EQUAL_INT(1, slot->abortCalls);
  assertNext(begin(20, OTHER), 0, OTHER);
}

// A failed update leaves the rover as beginning left it, stopped in manual,
// however long it then waits, and the old firmware booting.
void test_a_failed_update_leaves_the_rover_stopped_in_manual(void) {
  rover->begin(Rover::MODE_AUTONOMOUS, 0);
  receiving(0);
  sent(firmware->cancel(PANEL));
  for (uint32_t now = 0; now < 3000; now += 10) rover->update(now);
  TEST_ASSERT_EQUAL_INT(Rover::MODE_MANUAL, rover->status().mode);
  TEST_ASSERT_FALSE(motors->driving);
  TEST_ASSERT_FALSE(firmware->restartDue(3000));
}

// Telemetry's "firmware" is the slot's account of the running image.
void test_running_is_the_slots(void) { TEST_ASSERT_EQUAL_STRING(slot->running(), firmware->running()); }

int main(int, char**) {
  UNITY_BEGIN();
  RUN_TEST(test_nothing_begins_before_the_secret_is_set);
  RUN_TEST(test_no_update_without_a_password_where_one_is_needed);
  RUN_TEST(test_begin_opens_the_slot);
  RUN_TEST(test_begin_lowercases_the_md5);
  RUN_TEST(test_begin_stands_the_rover_down);
  RUN_TEST(test_a_malformed_begin_is_refused_and_changes_nothing);
  RUN_TEST(test_a_second_begin_is_refused_while_one_is_under_way);
  RUN_TEST(test_the_slot_refusing_to_begin_fails_the_update);
  RUN_TEST(test_the_image_is_written_whole_and_in_order);
  RUN_TEST(test_the_restart_is_due_only_after_done);
  RUN_TEST(test_done_takes_nothing_more);
  RUN_TEST(test_the_restart_waits_for_the_rover_at_rest);
  RUN_TEST(test_a_password_is_asked_for_first);
  RUN_TEST(test_the_right_answer_opens_the_slot);
  RUN_TEST(test_the_secret_is_lowercased);
  RUN_TEST(test_a_wrong_answer_fails_and_spends_the_nonce);
  RUN_TEST(test_a_malformed_answer_is_a_wrong_one);
  RUN_TEST(test_each_begin_asks_a_fresh_nonce);
  RUN_TEST(test_only_the_owner_answers);
  RUN_TEST(test_other_frames_are_ignored);
  RUN_TEST(test_a_frame_before_it_is_asked_for_fails);
  RUN_TEST(test_the_image_is_asked_for_once_the_rover_is_at_rest);
  RUN_TEST(test_a_chunk_of_the_wrong_size_fails);
  RUN_TEST(test_the_first_chunk_must_start_an_esp32_app);
  RUN_TEST(test_the_slot_refusing_the_image_fails_the_update);
  RUN_TEST(test_driving_ends_the_update);
  RUN_TEST(test_exploring_ends_the_update);
  RUN_TEST(test_driving_ends_an_update_before_its_first_chunk);
  RUN_TEST(test_no_chunk_is_written_while_the_wheels_turn);
  RUN_TEST(test_a_move_already_released_ends_the_update);
  RUN_TEST(test_no_chunk_is_written_after_a_move_already_released);
  RUN_TEST(test_stop_is_not_motion);
  RUN_TEST(test_silence_ends_the_update);
  RUN_TEST(test_silence_ends_an_update_waiting_for_its_password);
  RUN_TEST(test_silence_is_timed_across_the_clock_wrap);
  RUN_TEST(test_the_owner_can_cancel);
  RUN_TEST(test_a_fragment_from_the_owner_fails_the_update);
  RUN_TEST(test_losing_the_owner_ends_the_update);
  RUN_TEST(test_a_failed_update_leaves_the_rover_stopped_in_manual);
  RUN_TEST(test_running_is_the_slots);
  return UNITY_END();
}

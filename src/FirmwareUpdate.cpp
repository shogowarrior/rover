#include "FirmwareUpdate.h"

#include <ctype.h>
#include <stdio.h>
#include <string.h>

#include "Protocol.h"
#include "Timing.h"
#include "Tuning.h"

namespace {

const char DRIVEN[] = "The rover was driven, so the update stopped.";
const char WRONG_PASSWORD[] = "Wrong OTA password.";

bool isHex32(const char* text) {
  return strspn(text, "0123456789abcdefABCDEF") == 32 && text[32] == '\0';
}

// ArduinoOTA and Update compare digests as lowercase hex.
void copyLowercase(const char* text, hardware::Hex32& out) {
  size_t i = 0;
  for (; i < sizeof(out) - 1 && text[i] != '\0'; i++) {
    out[i] = static_cast<char>(tolower(static_cast<unsigned char>(text[i])));
  }
  out[i] = '\0';
}

// The start of an ESP32 app image: the image header's magic byte and chip
// id (esp_image_header_t), then, past the first segment's 8-byte header,
// the app description's magic word (esp_app_desc_t). A bootloader.bin is an
// image too, and Update checks only the magic byte, so it, or a
// partitions.bin, picked by mistake would otherwise get as far as the slot.
bool isEsp32AppImage(const uint8_t* data, size_t length) {
  return length >= 36 && data[0] == 0xE9                // ESP_IMAGE_HEADER_MAGIC
         && data[12] == 0x00 && data[13] == 0x00          // ESP_CHIP_ID_ESP32, little-endian
         && data[32] == 0x32 && data[33] == 0x54 && data[34] == 0xCD && data[35] == 0xAB;  // 0xABCD5432
}

FirmwareUpdate::Reply replyTo(uint8_t client, FirmwareUpdate::Reply::Kind kind) {
  FirmwareUpdate::Reply reply = {};
  reply.kind = kind;
  reply.client = client;
  return reply;
}

FirmwareUpdate::Reply nothing() { return replyTo(0, FirmwareUpdate::Reply::NONE); }

FirmwareUpdate::Reply failure(uint8_t client, const char* reason) {
  FirmwareUpdate::Reply reply = replyTo(client, FirmwareUpdate::Reply::FAILED);
  reply.reason = reason;
  return reply;
}

}  // namespace

FirmwareUpdate::FirmwareUpdate(Rover& rover, FirmwareSlot& slot) : rover(rover), slot(slot) {}

void FirmwareUpdate::setSecret(const char* md5Hex) { copyLowercase(md5Hex, secret); }

FirmwareUpdate::Reply FirmwareUpdate::begin(uint8_t client, uint32_t size, const char* md5, uint32_t now) {
  if (state == DONE) return nothing();
  if (state != IDLE) return failure(client, "Another update is under way.");
  if (size == 0) return failure(client, "The firmware file is empty.");
  if (!isHex32(md5)) return failure(client, "The update's MD5 is not 32 hex digits.");

  // Nothing may move while the flash is written. Standing down rather than
  // stopping leaves an exploring rover still, whether the update succeeds or
  // not.
  rover.standDown(now);
  owner = client;
  imageSize = size;
  copyLowercase(md5, imageMd5);
  if (secret[0] == '\0') return start(now);

  state = AUTH;
  slot.randomHex(nonce);
  deadline = now + tuning::OTA_SILENCE_MS;
  Reply challenge = replyTo(owner, Reply::AUTH);
  memcpy(challenge.nonce, nonce, sizeof(nonce));
  return challenge;
}

FirmwareUpdate::Reply FirmwareUpdate::authenticate(uint8_t client, const char* cnonce, const char* response,
                                                   uint32_t now) {
  if (state != AUTH || client != owner) return nothing();
  if (!isHex32(cnonce)) return fail(WRONG_PASSWORD);
  // ArduinoOTA's challenge, so the one password serves espota and the panel.
  char challenge[3 * 32 + 3];
  snprintf(challenge, sizeof(challenge), "%s:%s:%s", secret, nonce, cnonce);
  hardware::Hex32 expected;
  slot.md5Hex(challenge, expected);
  if (strcmp(response, expected) != 0) return fail(WRONG_PASSWORD);
  return start(now);
}

FirmwareUpdate::Reply FirmwareUpdate::receive(uint8_t client, const uint8_t* data, size_t length, uint32_t now) {
  if (!ownedBy(client)) return nothing();
  if (state != RECEIVING) return fail("The image came before the rover asked for it.");
  // As well as in update(): a command and a chunk can arrive in one pass of
  // the loop, the command first.
  if (driven()) return fail(DRIVEN);
  if (length == 0 || length > protocol::OTA_CHUNK_MAX_BYTES || length > imageSize - received) {
    return fail("A chunk of the image had the wrong size.");
  }
  if (received == 0 && !isEsp32AppImage(data, length)) {
    return fail("Not an ESP32 app image: pick firmware.bin from .pio/build/<env>/.");
  }
  if (!slot.write(data, length)) return fail(slot.error());
  received += length;
  if (received < imageSize) return next(now);

  if (!slot.finish()) return fail(slot.error());
  state = DONE;
  deadline = now + tuning::OTA_RESTART_DELAY_MS;
  return replyTo(owner, Reply::DONE);
}

FirmwareUpdate::Reply FirmwareUpdate::cancel(uint8_t client) {
  return ownedBy(client) ? fail("Cancelled.") : nothing();
}

FirmwareUpdate::Reply FirmwareUpdate::fragmented(uint8_t client) {
  return ownedBy(client) ? fail("A frame came in pieces, which the rover cannot take.") : nothing();
}

void FirmwareUpdate::disconnected(uint8_t client) {
  if (ownedBy(client)) abandon();  // nobody left to tell
}

FirmwareUpdate::Reply FirmwareUpdate::update(uint32_t now) {
  if (state == IDLE || state == DONE) return nothing();
  if (driven()) return fail(DRIVEN);
  if (state == SETTLING) return rover.atRest() ? next(now) : nothing();
  if (timing::reached(now, deadline)) return fail("The panel stopped sending.");
  return nothing();
}

bool FirmwareUpdate::restartDue(uint32_t now) const {
  return state == DONE && timing::reached(now, deadline) && rover.atRest();
}

bool FirmwareUpdate::ownedBy(uint8_t client) const { return state != IDLE && state != DONE && client == owner; }

bool FirmwareUpdate::driven() const {
  const Rover::Status status = rover.status();
  return status.moving || status.mode == Rover::MODE_AUTONOMOUS;
}

FirmwareUpdate::Reply FirmwareUpdate::start(uint32_t now) {
  if (!slot.begin(imageSize, imageMd5)) return fail(slot.error());
  state = SETTLING;
  received = 0;
  return update(now);
}

FirmwareUpdate::Reply FirmwareUpdate::next(uint32_t now) {
  state = RECEIVING;
  deadline = now + tuning::OTA_SILENCE_MS;
  Reply reply = replyTo(owner, Reply::NEXT);
  reply.offset = received;
  return reply;
}

FirmwareUpdate::Reply FirmwareUpdate::fail(const char* reason) {
  abandon();
  return failure(owner, reason);
}

void FirmwareUpdate::abandon() {
  if (state == SETTLING || state == RECEIVING) slot.abort();
  state = IDLE;
}

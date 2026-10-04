#ifndef FIRMWARE_UPDATE_H
#define FIRMWARE_UPDATE_H

#include <stddef.h>
#include <stdint.h>

#include "Hardware.h"
#include "Rover.h"

// A firmware update over the WebSocket link: a client sends a new image in
// binary frames, one at a time, and this writes it into the slot that is not
// running. Pure, like Rover: Update and the WebSocket server stay in
// FlashSlot and RemoteControl, and this is host-tested
// (test/test_firmware_update). Protocol.h has the messages.
//
// The rules it keeps:
//   * One update at a time, owned by the client that began it: only that
//     client's messages and frames move it on, and losing that client ends
//     it. Any other client's are ignored, but for a second "begin", which is
//     refused.
//   * Beginning stands the rover down, and motion ends the update: a rover
//     driven or set exploring while one waits on its client fails it, before
//     another chunk is written. The operator's hands win, as they win over a
//     program, and a flash write holds the loop, and every move deadline
//     with it, for as long as an erase takes. Stop is not motion.
//   * The first chunk is asked for only once the rover is at rest
//     (Rover::atRest()): until then the stand-down's second write, which
//     stops wheels a lost first write left turning, is still to come, and a
//     flash write would hold it up.
//   * With an OTA password, nothing is written until the client has proved
//     it knows it, as ArduinoOTA checks espota: the answer to a single-use
//     nonce. A wrong answer ends the update.
//   * The first chunk must start an ESP32 app image; the slot checks the
//     image's MD5 once every byte has arrived, and the image itself as it
//     makes it the one that boots.
//   * A client silent for OTA_SILENCE_MS after a reply has gone: the update
//     fails. One that disconnects takes the update with it.
//   * A failed update leaves the old firmware booting, and the rover as
//     beginning left it, stopped in manual, unless the operator has driven
//     it since.
//   * Once the image is whole, nothing more is taken: the restart is due
//     OTA_RESTART_DELAY_MS after "done" went out, with the rover at rest.
//
// Strings handed in are never null: Protocol reads an absent one as "".
class FirmwareUpdate {
 public:
  // What to send, and to whom, after a call: one text frame (Protocol.h,
  // writeOtaReply()), or nothing.
  struct Reply {
    enum Kind { NONE, AUTH, NEXT, DONE, FAILED };
    Kind kind;
    uint8_t client;
    uint32_t offset;        // NEXT: where the next chunk starts, the bytes received so far
    hardware::Hex32 nonce;  // AUTH: what the password's answer must answer
    const char* reason;     // FAILED: a short sentence for the operator
  };

  FirmwareUpdate(Rover& rover, FirmwareSlot& slot);

  // The OTA password as ArduinoOTA keeps it, md5hex(password), or "" for
  // none. Call before the link starts.
  void setSecret(const char* md5Hex);

  // A client asks to send an image of `size` bytes whose MD5 is `md5`.
  Reply begin(uint8_t client, uint32_t size, const char* md5, uint32_t now);
  // The client's answer to the nonce: md5hex(secret:nonce:cnonce).
  Reply authenticate(uint8_t client, const char* cnonce, const char* response, uint32_t now);
  // A binary frame: the image's next bytes.
  Reply receive(uint8_t client, const uint8_t* data, size_t length, uint32_t now);
  Reply cancel(uint8_t client);
  // A frame that came in pieces, which could leave a gap in the image.
  Reply fragmented(uint8_t client);
  void disconnected(uint8_t client);

  // Every loop: motion and silence end an update, and the first chunk is
  // asked for once the rover is at rest.
  Reply update(uint32_t now);

  // Whether to restart into the new image now. The shield keeps its PWM
  // through a reset (AGENTS.md, Invariants), so a rover driven since "done"
  // restarts only once it is at rest again, its stop written twice.
  bool restartDue(uint32_t now) const;

  // The running image's MD5, which telemetry reports.
  const char* running() const { return slot.running(); }

 private:
  enum State {
    IDLE,
    AUTH,       // waiting for the password's answer
    SETTLING,   // the slot open, waiting for the rover to come to rest
    RECEIVING,  // waiting for the chunk asked for
    DONE,       // the image whole, the restart due
  };

  // Whether `client` owns an update that is under way.
  bool ownedBy(uint8_t client) const;
  bool driven() const;
  Reply start(uint32_t now);
  Reply next(uint32_t now);
  // End the update, telling its client why; abandon() without telling.
  Reply fail(const char* reason);
  void abandon();

  Rover& rover;
  FirmwareSlot& slot;
  hardware::Hex32 secret = {};

  State state = IDLE;
  uint8_t owner = 0;  // the client that began it; meaningful unless IDLE
  uint32_t imageSize = 0;
  hardware::Hex32 imageMd5 = {};
  hardware::Hex32 nonce = {};  // meaningful in AUTH, which one answer leaves
  uint32_t received = 0;
  // AUTH and RECEIVING: when silence ends the update. DONE: the restart.
  uint32_t deadline = 0;
};

#endif

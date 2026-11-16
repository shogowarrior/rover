#include "RemoteControl.h"

#include <WiFi.h>

#include "Timing.h"
#include "Tuning.h"

namespace {

// Ping every client each second and drop one that misses two pongs in a row.
// Browsers and the Python websockets library answer automatically.
//
// This is not just tidiness. A client that vanishes without closing (a phone
// that sleeps, a laptop that roams) still looks connected, and once its send
// buffer fills every telemetry broadcast to it blocks loop() for seconds --
// move deadlines, STOP commands and OTA all stall with it. Dropping it within
// ~2 s keeps its queue short of that. The pong timeout must stay below the
// ping interval, or a fresh ping resets the timer before it can expire.
//
// HeartbeatServer clears a slot's misses on every connect and disconnect
// (RemoteControl.h says why). The library charges a new client one miss
// HEARTBEAT_PONG_TIMEOUT_MS after accept, before any ping, and pings it then;
// its first pong must arrive within HEARTBEAT_PONG_TIMEOUT_MS of that ping,
// or the second miss drops it.
constexpr uint32_t HEARTBEAT_INTERVAL_MS = 1000;
constexpr uint32_t HEARTBEAT_PONG_TIMEOUT_MS = 600;
constexpr uint8_t HEARTBEAT_MISSES_TO_DROP = 2;

// At most one log line to each client this often. A client that has just
// connected is owed up to EventLog::CAPACITY of them, about 5 KB: sent in a
// burst, they could fill the socket's send buffer, which telemetry shares,
// and a client slow to acknowledge would then hold the loop in sendTXT(),
// move deadlines and STOPs with it. Paced, a full backlog takes 1.6 s, and
// the rover adds a line or two a second while it explores.
constexpr uint32_t LOG_LINE_GAP_MS = 50;

}  // namespace

RemoteControl::RemoteControl(Rover& rover, Control& control, Settings& settings, FirmwareUpdate& firmware,
                             Gamepad& gamepad, EventLog& log)
    : rover(rover),
      control(control),
      settings(settings),
      firmware(firmware),
      gamepad(gamepad),
      log(log),
      server(tuning::WEBSOCKET_PORT) {}

void RemoteControl::begin() {
  // The loop's timing starts afresh with the link: the time offline is not
  // a pass.
  lastUpdateMs = millis();
  lastMetricsMs = lastUpdateMs;
  passes = 0;
  longestPassMs = 0;
  if (started) return;
  server.begin();
  server.onEvent([this](uint8_t client, WStype_t type, uint8_t* payload, size_t length) {
    onEvent(client, type, payload, length);
  });
  server.enableHeartbeat(HEARTBEAT_INTERVAL_MS, HEARTBEAT_PONG_TIMEOUT_MS,
                         HEARTBEAT_MISSES_TO_DROP);
  started = true;
}

void RemoteControl::update(uint32_t now) {
  const uint32_t pass = timing::since(now, lastUpdateMs);
  if (pass > longestPassMs) longestPassMs = pass;
  passes++;
  lastUpdateMs = now;

  if (firmware.restartDue(now)) {
    // At rest already: restartDue() waits for it. Standing down as well
    // writes the release once more on the way into the reset, as an
    // ArduinoOTA upload's start does.
    rover.standDown(now, "restarting into the new firmware");
    ESP.restart();
  }
  send(firmware.update(now));

  server.loop();
  sendSettings(now);
  sendLogLines(now);

  if (timing::since(now, lastMetricsMs) >= tuning::METRICS_INTERVAL_MS) broadcastMetrics(now);
  if (timing::since(now, lastBroadcastMs) < tuning::TELEMETRY_INTERVAL_MS) return;
  lastBroadcastMs = now;
  if (server.connectedClients() > 0) broadcastTelemetry(now);
}

void RemoteControl::onEvent(uint8_t client, WStype_t type, uint8_t* payload, size_t length) {
  switch (type) {
    case WStype_TEXT:
      onCommand(client, payload, length);
      break;

    case WStype_BIN:
      send(firmware.receive(client, payload, length, millis()));
      break;

    // No client of the rover sends a message in pieces, and the image is
    // taken one whole frame at a time: a fragment is a gap in it.
    case WStype_FRAGMENT_TEXT_START:
    case WStype_FRAGMENT_BIN_START:
    case WStype_FRAGMENT:
    case WStype_FRAGMENT_FIN:
      send(firmware.fragmented(client));
      break;

    case WStype_CONNECTED: {
      // As well as on the disconnect: in the pass of server.loop() that
      // disconnects a client (a 1002 for a frame whose rest never came, say),
      // the library still runs that slot's heartbeat timeout afterwards,
      // which can count a miss after the disconnect cleared them, for the
      // slot's next client.
      server.forgetMissedPongs(client);
      if (client < WEBSOCKETS_SERVER_CLIENT_MAX) {
        // Every line still held, from the oldest: why the rover is as it is.
        connected[client] = true;
        nextLine[client] = log.oldestSeq();
        lastLineMs[client] = millis() - LOG_LINE_GAP_MS;
        ignoredOnce[client] = false;
        settingsOwed[client] = true;
      }
      const IPAddress remote = server.remoteIP(client);
      log.add(millis(), EventLog::INFO, SOURCE_WIFI, "Link: client %u connected from %d.%d.%d.%d", client,
              remote[0], remote[1], remote[2], remote[3]);
      break;
    }

    case WStype_DISCONNECTED:
      if (client < WEBSOCKETS_SERVER_CLIENT_MAX) connected[client] = false;
      server.forgetMissedPongs(client);  // the slot's next client starts afresh
      firmware.disconnected(client);
      log.add(millis(), EventLog::INFO, SOURCE_WIFI, "Link: client %u disconnected", client);
      if (client == driver) {
        // The operator has lost the ability to steer. Anything other than
        // stopping leaves the rover driving on its last instruction, unless
        // another controller has taken over since.
        driver = NO_CLIENT;
        control.lost(SOURCE_WIFI, millis());
      }
      break;

    default:
      break;
  }
}

void RemoteControl::onCommand(uint8_t client, const uint8_t* payload, size_t length) {
  if (length > protocol::COMMAND_MAX_BYTES) {
    noteIgnored(client, "a message too long to read");
    return;
  }

  JsonDocument input;
  // Passing the length keeps the parser inside the frame instead of relying
  // on the payload happening to be NUL-terminated.
  const DeserializationError error = deserializeJson(input, payload, length);
  if (error) {
    noteIgnored(client, "a message that is not JSON");
    return;
  }

  const uint32_t now = millis();
  const protocol::Message message = protocol::readMessage(input.as<JsonVariantConst>());
  switch (control.apply(SOURCE_WIFI, message, now)) {
    case Control::ACCEPTED:
      if (driver != client) log.add(now, EventLog::INFO, SOURCE_WIFI, "Link: client %u is driving", client);
      driver = client;
      break;
    case Control::REFUSED:  // Control says so in the log
    case Control::SETTING:  // Settings does
      break;
    case Control::IGNORED:
      noteIgnored(client, "a setting with a value it does not know");
      break;
    case Control::UPDATE:
      onUpdateRequest(client, message.ota);  // its strings live in `input`
      break;
  }
}

void RemoteControl::noteIgnored(uint8_t client, const char* what) {
  if (client < WEBSOCKETS_SERVER_CLIENT_MAX) {
    if (ignoredOnce[client]) return;
    ignoredOnce[client] = true;
  }
  log.add(millis(), EventLog::WARN, SOURCE_WIFI, "Link: ignored %s from client %u", what, client);
}

void RemoteControl::onUpdateRequest(uint8_t client, const protocol::OtaRequest& request) {
  const uint32_t now = millis();
  switch (request.action) {
    case protocol::OtaRequest::BEGIN:
      send(firmware.begin(client, request.size, request.md5, now));
      break;
    case protocol::OtaRequest::AUTH:
      send(firmware.authenticate(client, request.cnonce, request.response, now));
      break;
    case protocol::OtaRequest::CANCEL:
      send(firmware.cancel(client));
      break;
    case protocol::OtaRequest::UNKNOWN:
      noteIgnored(client, "an update message it does not know");
      break;
  }
}

// Replies go to the one client updating the rover, never to every client.
void RemoteControl::send(const FirmwareUpdate::Reply& reply) {
  char frame[protocol::OTA_REPLY_MAX_BYTES];
  const size_t length = protocol::writeOtaReply(reply, frame, sizeof(frame));
  if (length == 0) return;  // nothing to say
  if (reply.kind == FirmwareUpdate::Reply::FAILED) {
    log.add(millis(), EventLog::WARN, "Update failed: %s", reply.reason);
  } else if (reply.kind == FirmwareUpdate::Reply::DONE) {
    log.add(millis(), EventLog::INFO, "Update: the new firmware is written; restarting once still");
  }
  server.sendTXT(reply.client, frame, length);
}

void RemoteControl::broadcastTelemetry(uint32_t now) {
  protocol::Report report;
  report.status = rover.status();
  report.scheme = settings.scheme();
  report.pad = gamepad.state();
  report.control = control.holder(now);
  report.temperatureC = temperatureRead();
  report.firmware = firmware.running();
  char frame[protocol::TELEMETRY_MAX_BYTES];
  const size_t length = protocol::writeTelemetry(report, frame, sizeof(frame));
  if (length == 0) {
    // Clients would only see telemetry freeze. Say why once, not every
    // TELEMETRY_INTERVAL_MS.
    static bool reported = false;
    if (!reported) log.add(millis(), EventLog::WARN, "Telemetry outgrew TELEMETRY_MAX_BYTES: not sent");
    reported = true;
    return;
  }
  server.broadcastTXT(frame, length);
}

// Every setting, to each client that has just connected, and to every client
// as they change, at most every SETTINGS_BROADCAST_MS: the pad's right stick
// changes the aim on every pass while it pans.
void RemoteControl::sendSettings(uint32_t now) {
  const bool changed = settings.version() != sentSettingsVersion &&
                       timing::since(now, lastSettingsMs) >= tuning::SETTINGS_BROADCAST_MS;
  bool owed = false;
  for (uint8_t client = 0; client < WEBSOCKETS_SERVER_CLIENT_MAX; client++) owed = owed || settingsOwed[client];
  if (!changed && !owed) return;
  char frame[protocol::SETTINGS_MAX_BYTES];
  const size_t length = protocol::writeSettings(settings, frame, sizeof(frame));
  if (length == 0) return;  // test_settings_fit keeps this from happening
  if (changed) {
    sentSettingsVersion = settings.version();
    lastSettingsMs = now;
    server.broadcastTXT(frame, length);
    for (bool& owing : settingsOwed) owing = false;
    return;
  }
  for (uint8_t client = 0; client < WEBSOCKETS_SERVER_CLIENT_MAX; client++) {
    if (!settingsOwed[client]) continue;
    settingsOwed[client] = false;
    if (connected[client]) server.sendTXT(client, frame, length);
  }
}

void RemoteControl::sendLogLines(uint32_t now) {
  for (uint8_t client = 0; client < WEBSOCKETS_SERVER_CLIENT_MAX; client++) {
    if (!connected[client] || timing::since(now, lastLineMs[client]) < LOG_LINE_GAP_MS) continue;
    const EventLog::Entry* entry = log.from(nextLine[client]);
    if (entry == nullptr) continue;
    nextLine[client] = entry->seq + 1;
    lastLineMs[client] = now;
    char frame[protocol::LOG_LINE_MAX_BYTES];
    const size_t length = protocol::writeLogLine(*entry, frame, sizeof(frame));
    if (length > 0) server.sendTXT(client, frame, length);
  }
}

void RemoteControl::broadcastMetrics(uint32_t now) {
  const uint32_t interval = timing::since(now, lastMetricsMs);
  const Rover::Status status = rover.status();
  protocol::Metrics metrics;
  metrics.uptimeS = now / 1000;
  metrics.loopHz = interval > 0 ? static_cast<uint32_t>(static_cast<uint64_t>(passes) * 1000 / interval) : 0;
  metrics.loopMaxMs = longestPassMs;
  metrics.heapFree = ESP.getFreeHeap();
  metrics.heapMinFree = ESP.getMinFreeHeap();
  metrics.rssi = WiFi.RSSI();
  metrics.clients = server.connectedClients();
  metrics.pings = status.pings;
  metrics.silentPings = status.silentPings;
  lastMetricsMs = now;
  passes = 0;
  longestPassMs = 0;
  if (metrics.clients == 0) return;
  char frame[protocol::METRICS_MAX_BYTES];
  const size_t length = protocol::writeMetrics(metrics, frame, sizeof(frame));
  if (length > 0) server.broadcastTXT(frame, length);
}

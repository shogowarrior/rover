#include "common.h"

namespace {

// The complete wire-protocol-to-wheels mapping, in one auditable place.
//
// Each entry gives the direction for the four motors in the fixed index order
// front-left, front-right, rear-right, rear-left. RELEASE means that wheel
// free-wheels for this move, which is how the diagonal and pivot moves work on
// mecanum wheels.
//
// This replaces eighteen near-identical methods that each assigned four struct
// literals. Those were also chained with commas rather than semicolons, so a
// single mistyped line would have silently folded four assignments into one
// expression without any diagnostic.
struct MovePattern {
  MoveCode move;
  const char *name;
  uint8_t direction[4];
};

const MovePattern MOVE_PATTERNS[] = {
    {STOP, "STOP", {RELEASE, RELEASE, RELEASE, RELEASE}},
    {MOVE_FORWARD, "MOVE_FORWARD", {FORWARD, FORWARD, FORWARD, FORWARD}},
    {MOVE_BACKWARD, "MOVE_BACKWARD", {BACKWARD, BACKWARD, BACKWARD, BACKWARD}},
    {MOVE_RIGHT, "MOVE_RIGHT", {FORWARD, BACKWARD, FORWARD, BACKWARD}},
    {MOVE_LEFT, "MOVE_LEFT", {BACKWARD, FORWARD, BACKWARD, FORWARD}},
    {MOVE_DIAGONAL45, "MOVE_DIAGONAL45", {FORWARD, RELEASE, FORWARD, RELEASE}},
    {MOVE_DIAGONAL135, "MOVE_DIAGONAL135", {RELEASE, FORWARD, RELEASE, FORWARD}},
    {MOVE_DIAGONAL225, "MOVE_DIAGONAL225", {BACKWARD, RELEASE, BACKWARD, RELEASE}},
    {MOVE_DIAGONAL315, "MOVE_DIAGONAL315", {RELEASE, BACKWARD, RELEASE, BACKWARD}},
    {PIVOT_RIGHT_FORWARD, "PIVOT_RIGHT_FORWARD", {RELEASE, BACKWARD, BACKWARD, RELEASE}},
    {PIVOT_RIGHT_BACKWARD, "PIVOT_RIGHT_BACKWARD", {RELEASE, FORWARD, FORWARD, RELEASE}},
    {PIVOT_LEFT_FORWARD, "PIVOT_LEFT_FORWARD", {BACKWARD, RELEASE, RELEASE, BACKWARD}},
    {PIVOT_LEFT_BACKWARD, "PIVOT_LEFT_BACKWARD", {FORWARD, RELEASE, RELEASE, FORWARD}},
    {PIVOT_SIDEWAYS_FORWARD_RIGHT, "PIVOT_SIDEWAYS_FORWARD_RIGHT", {FORWARD, BACKWARD, RELEASE, RELEASE}},
    {PIVOT_SIDEWAYS_FORWARD_LEFT, "PIVOT_SIDEWAYS_FORWARD_LEFT", {RELEASE, RELEASE, BACKWARD, FORWARD}},
    {PIVOT_SIDEWAYS_BACKWARD_RIGHT, "PIVOT_SIDEWAYS_BACKWARD_RIGHT", {RELEASE, FORWARD, RELEASE, BACKWARD}},
    {PIVOT_SIDEWAYS_BACKWARD_LEFT, "PIVOT_SIDEWAYS_BACKWARD_LEFT", {FORWARD, RELEASE, BACKWARD, RELEASE}},
    {ROTATE_CLOCKWISE, "ROTATE_CLOCKWISE", {FORWARD, BACKWARD, BACKWARD, FORWARD}},
    {ROTATE_COUNTERCLOCKWISE, "ROTATE_COUNTERCLOCKWISE", {BACKWARD, FORWARD, FORWARD, BACKWARD}},
};

const MovePattern *findPattern(MoveCode move) {
  for (const MovePattern &pattern : MOVE_PATTERNS) {
    if (pattern.move == move) return &pattern;
  }
  return nullptr;
}

}  // namespace

void Rover::initRover() {
  AFMS.begin();
  motors[0] = AFMS.getMotor(MOTOR1_A);  // front left
  motors[1] = AFMS.getMotor(MOTOR2_A);  // front right
  motors[2] = AFMS.getMotor(MOTOR2_B);  // rear right
  motors[3] = AFMS.getMotor(MOTOR1_B);  // rear left

  for (int i = 0; i < SCAN_POINTS; i++) {
    distances[i] = kinematics::DISTANCE_FAR_CM;
  }

  servo.attach(SERVO_PIN);
  servo.write(90);

  releaseMotors();
  lastCommandMs = millis();
  scanTimer = millis();
}

void Rover::setMode(Mode mode) {
  if (mode == currentMode) return;
  currentMode = mode;
  stop();
  // Restart the scan cycle so autonomous mode never acts on readings taken
  // before a human was driving.
  scanState = SCAN_AIM;
  scanIndex = 0;
}

// ---------------------------------------------------------------------------
// Motors
// ---------------------------------------------------------------------------

void Rover::releaseMotors() {
  for (int i = 0; i < MOTOR_COUNT; i++) {
    if (motors[i] == nullptr) continue;
    motors[i]->setSpeed(0);
    motors[i]->run(RELEASE);
  }
  moveDeadline = 0;
}

void Rover::stop() {
  doc["move"] = "STOP";
  releaseMotors();
}

// Energise the wheels for `durationMs` and record when they must stop.
//
// The previous implementation spawned four detached FreeRTOS tasks per move,
// each holding a pointer into one shared MotorParams array. The next move
// overwrote that array while those tasks were still reading it, and nothing
// bounded how many tasks a fast client could create. Setting the motors takes
// a few I2C writes and needs no concurrency at all; update() handles the
// waiting.
void Rover::applyMove(MoveCode move, int speed, int durationMs) {
  const MovePattern *pattern = findPattern(move);
  if (pattern == nullptr) {
    // Unknown code from a client we do not control. Stopping is the only safe
    // interpretation of an instruction we cannot read.
    stop();
    return;
  }

  speed = kinematics::clampSpeed(speed);
  durationMs = kinematics::clampDuration(durationMs);

  doc["move"] = pattern->name;

  if (move == STOP || speed == 0 || durationMs == 0) {
    releaseMotors();
    return;
  }

  for (int i = 0; i < MOTOR_COUNT; i++) {
    if (motors[i] == nullptr) continue;
    const uint8_t direction = pattern->direction[i];
    motors[i]->setSpeed(direction == RELEASE ? 0 : speed);
    motors[i]->run(direction);
  }

  moveDeadline = millis() + durationMs;
  if (moveDeadline == 0) moveDeadline = 1;  // 0 is the idle sentinel
}

void Rover::update() {
  const unsigned long now = millis();

  // Signed comparison so this still works across the millis() rollover.
  if (isMoving() && static_cast<long>(now - moveDeadline) >= 0) {
    releaseMotors();
  }

  // Deadman switch. A manual client that disconnects, crashes, or drops off
  // the network stops sending; without this the rover keeps its last command
  // until that command's own deadline, and reconnect logic elsewhere cannot be
  // relied on to fire.
  if (currentMode == MODE_MANUAL &&
      static_cast<long>(now - lastCommandMs) > MANUAL_COMMAND_TIMEOUT_MS) {
    if (isMoving()) releaseMotors();
  }
}

void Rover::command(MoveCode move, int speed, int durationMs) {
  lastCommandMs = millis();

  // The only command that gives control back. setMode() stops the motors and
  // resets the scan cycle, so exploration restarts from fresh readings rather
  // than from whatever the rover last saw before a human took over.
  if (move == RESUME_AUTONOMOUS) {
    setMode(MODE_AUTONOMOUS);
    return;
  }

  setMode(MODE_MANUAL);
  applyMove(move, speed, durationMs);
}

void Rover::executeMove(JsonVariantConst json) {
  // `|` supplies the default when the key is absent or the wrong type, so a
  // malformed payload degrades to STOP rather than to whatever as<int>() would
  // have produced for a missing field.
  const MoveCode move = static_cast<MoveCode>(json["move"] | static_cast<int>(STOP));
  const int speed = json["speed"] | 0;
  const int durationMs = json["duration"] | MOVE_DURATION;

  command(move, speed, durationMs);
}

// ---------------------------------------------------------------------------
// Sensing and autonomy
// ---------------------------------------------------------------------------

float Rover::readDistance(UltraSonicDistanceSensor &sensor) {
  return kinematics::normalizeDistance(sensor.measureDistanceCm());
}

// One step of a scan/decide/drive cycle, driven by millis() rather than by
// delay().
//
// The blocking version sat in three 1500 ms delays -- 4.5 s per cycle during
// which webSocket.loop() and ArduinoOTA.handle() never ran. That starved the
// control link (so stop commands could not arrive) and made OTA flashing fail
// far more often than not.
void Rover::explore() {
  if (currentMode != MODE_AUTONOMOUS) return;

  static const int SCAN_ANGLES[SCAN_POINTS] = {20, 90, 160};
  const unsigned long now = millis();

  switch (scanState) {
    case SCAN_AIM:
      servo.write(SCAN_ANGLES[scanIndex]);
      scanTimer = now;
      scanState = SCAN_SETTLE;
      break;

    case SCAN_SETTLE: {
      if (static_cast<long>(now - scanTimer) < SERVO_SETTLE_MS) break;

      distances[scanIndex] = readDistance(rotatingSensor);
      scanIndex++;

      if (scanIndex < SCAN_POINTS) {
        scanState = SCAN_AIM;
        break;
      }

      scanIndex = 0;
      doc["distanceLeft"] = distances[SCAN_LEFT];
      doc["distanceFront"] = distances[SCAN_FRONT];
      doc["distanceRight"] = distances[SCAN_RIGHT];

      const kinematics::ExploreDecision decision = kinematics::chooseExploreMove(
          distances[SCAN_LEFT], distances[SCAN_FRONT], distances[SCAN_RIGHT],
          SAFE_DISTANCE, MOVE_DURATION);

      applyMove(decision.move, EXPLORE_SPEED, decision.durationMs);
      scanState = SCAN_DRIVING;
      break;
    }

    case SCAN_DRIVING:
      // update() releases the motors when the deadline passes. Rescan only
      // once the rover has actually stopped, so every decision is made from
      // readings taken where the rover now is.
      if (!isMoving()) scanState = SCAN_AIM;
      break;
  }
}

// ---------------------------------------------------------------------------
// Telemetry
// ---------------------------------------------------------------------------

float Rover::getTemperature() {
  // temperatureRead() already returns degrees Celsius. An earlier version cast
  // it to int and applied `(t / 2.0) + 25.0`, which is not a conversion between
  // any two units -- it just reported ~45 when the die was at 40.
  return temperatureRead();
}

String Rover::getData() {
  doc["temperature"] = getTemperature();
  doc["mode"] = (currentMode == MODE_AUTONOMOUS) ? "AUTONOMOUS" : "MANUAL";
  doc["moving"] = isMoving();

  String jsonStr;
  serializeJson(doc, jsonStr);
  return jsonStr;
}

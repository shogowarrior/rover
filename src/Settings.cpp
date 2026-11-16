#include "Settings.h"

#include "Timing.h"
#include "Tuning.h"

Settings::Settings(EventLog& log, kinematics::ControlScheme scheme) : log(log), currentScheme(scheme) {}

Source Settings::priority(int rank) const {
  return rank >= 0 && rank < CONTROLLER_COUNT ? order[rank] : SOURCE_ROVER;
}

int Settings::rankOf(Source source) const {
  for (int rank = 0; rank < CONTROLLER_COUNT; rank++) {
    if (order[rank] == source) return rank;
  }
  return CONTROLLER_COUNT;
}

void Settings::setScheme(kinematics::ControlScheme scheme, Source from, uint32_t now) {
  if (scheme == currentScheme) return;
  currentScheme = scheme;
  log.add(now, EventLog::INFO, from, "Scheme: %s", scheme == kinematics::SCHEME_ADVANCED ? "Advanced" : "Normal");
  changed(now);
}

void Settings::setSonar(Explorer::SonarMode mode, Source from, uint32_t now) {
  if (mode == sonarMode) return;
  sonarMode = mode;
  static const char* const SAYS[] = {"sweeps", "looks ahead", "aims"};
  log.add(now, EventLog::INFO, from, "Sonar: %s in manual mode", SAYS[mode]);
  changed(now);
}

void Settings::setAim(int aimDeg, Source, uint32_t now) {
  const int clamped = kinematics::clampInt(aimDeg, -tuning::SONAR_AIM_MAX_DEG, tuning::SONAR_AIM_MAX_DEG);
  if (clamped == aim) return;
  aim = clamped;
  changed(now);
}

void Settings::setPad(bool on, Source from, uint32_t now) {
  if (on == pad) return;
  pad = on;
  log.add(now, EventLog::INFO, from, on ? "Pad control on" : "Pad control off: only Cross works, as Stop");
  changed(now);
}

bool Settings::setPriority(const Source wanted[CONTROLLER_COUNT], Source from, uint32_t now) {
  bool seen[CONTROLLER_COUNT] = {false, false, false};
  for (int rank = 0; rank < CONTROLLER_COUNT; rank++) {
    const int source = wanted[rank];
    if (source < 0 || source >= CONTROLLER_COUNT || seen[source]) return false;
    seen[source] = true;
  }
  bool same = true;
  for (int rank = 0; rank < CONTROLLER_COUNT; rank++) same = same && order[rank] == wanted[rank];
  if (same) return true;
  for (int rank = 0; rank < CONTROLLER_COUNT; rank++) order[rank] = wanted[rank];
  log.add(now, EventLog::INFO, from, "Priority: %s, then %s, then %s", sourceName(order[0]), sourceName(order[1]),
          sourceName(order[2]));
  changed(now);
  return true;
}

void Settings::setChecksAtBoot(bool on, Source from, uint32_t now) {
  if (on == checksOnBoot) return;
  checksOnBoot = on;
  log.add(now, EventLog::INFO, from, on ? "Checks at boot: on (no wheel turns)" : "Checks at boot: off");
  changed(now);
}

void Settings::apply(const Change& change, Source from, uint32_t now) {
  if (change.hasScheme) setScheme(change.scheme, from, now);
  if (change.hasSonar) setSonar(change.sonar, from, now);
  if (change.hasAim) setAim(change.aimDeg, from, now);
  if (change.hasPad) setPad(change.padOn, from, now);
  if (change.hasPriority && !setPriority(change.priority, from, now)) {
    log.add(now, EventLog::WARN, from, "Priority: ignored, it must name USB, PAD and WIFI once each");
  }
  if (change.hasChecksAtBoot) setChecksAtBoot(change.checksAtBoot, from, now);
}

// ageOf(), not since(): a change from the pad or a WebSocket client is
// stamped later in the pass than the `now` main.cpp asks with, and since()
// made it ~49.7 days old, so the aim panned on the pad was written to flash
// on most passes instead of once it had been still for 3 s.
bool Settings::saveDue(uint32_t now, bool atRest) const {
  return changes != savedVersion && atRest &&
         timing::ageOf(now, lastChangeMs) >= tuning::SETTINGS_SAVE_DELAY_MS;
}

void Settings::changed(uint32_t now) {
  changes++;
  lastChangeMs = now;
}

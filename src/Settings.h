#ifndef SETTINGS_H
#define SETTINGS_H

#include <stdint.h>

#include "EventLog.h"
#include "Explorer.h"
#include "Kinematics.h"
#include "Source.h"

// Every setting a controller can change, in one place: what Rover, Control
// and GamepadSession read, what clients are sent ({"settings": ...},
// Protocol.h), and what main.cpp keeps in flash so that it lasts from boot
// to boot. Pure core, host-tested in test/test_control.
//
// A setting is configuration, never a command: changing one takes no control
// and stops nothing by itself, so a client may change one while the rover
// explores. Any controller may change any of them, the priority included.
// Each change goes in the EventLog as its source's, but the aim alone does
// not: the pad's right stick moves it on every pass while it pans.
//
// Starting in manual mode is not a setting. Every boot is manual (Features.h
// says why), and a setting any WiFi client can change must not be able to
// send the next power-on exploring.
class Settings {
 public:
  // What a message, or the copy in flash, asks to change: only the fields
  // marked present. Protocol.cpp reads one; apply() applies it.
  struct Change {
    bool hasScheme = false;
    kinematics::ControlScheme scheme = kinematics::SCHEME_NORMAL;
    bool hasSonar = false;
    Explorer::SonarMode sonar = Explorer::SONAR_FRONT;
    bool hasAim = false;
    int aimDeg = 0;
    bool hasPad = false;
    bool padOn = true;
    bool hasPriority = false;
    Source priority[CONTROLLER_COUNT] = {SOURCE_USB, SOURCE_PAD, SOURCE_WIFI};
    bool hasChecksAtBoot = false;
    bool checksAtBoot = false;

    bool empty() const { return !(hasScheme || hasSonar || hasAim || hasPad || hasPriority || hasChecksAtBoot); }
  };

  Settings(EventLog& log, kinematics::ControlScheme scheme);

  // The control scheme every controller drives under (kinematics.h).
  kinematics::ControlScheme scheme() const { return currentScheme; }
  // Where manual mode points the sonar (Explorer::survey()), and the angle
  // it holds while that is SONAR_AIM, positive left. The aim is kept in the
  // other modes, for the next time the sonar aims.
  Explorer::SonarMode sonar() const { return sonarMode; }
  int aimDeg() const { return aim; }
  // Whether the pad drives. Off, Cross still stops the rover.
  bool padOn() const { return pad; }
  // The controller ranked `rank`, 0 first, and the rank of `source`
  // (CONTROLLER_COUNT for SOURCE_ROVER, below them all).
  Source priority(int rank) const;
  int rankOf(Source source) const;
  // Whether the boot runs the checks that move no wheel: the shield's answer
  // and the sonar (SelfTest.h).
  bool checksAtBoot() const { return checksOnBoot; }

  // Each change bumps this, so a reader can tell that something changed.
  uint32_t version() const { return changes; }

  void setScheme(kinematics::ControlScheme scheme, Source from, uint32_t now);
  void setSonar(Explorer::SonarMode mode, Source from, uint32_t now);
  // Clamped to tuning::SONAR_AIM_MAX_DEG either side.
  void setAim(int aimDeg, Source from, uint32_t now);
  void setPad(bool on, Source from, uint32_t now);
  // Ignored, and false, unless `order` names USB, PAD and WIFI once each.
  bool setPriority(const Source order[CONTROLLER_COUNT], Source from, uint32_t now);
  void setChecksAtBoot(bool on, Source from, uint32_t now);
  // Each field `change` has, as its setter would.
  void apply(const Change& change, Source from, uint32_t now);

  // Whether to write the settings to flash now: something changed since the
  // last write, nothing has for tuning::SETTINGS_SAVE_DELAY_MS, and the
  // rover is at rest, since a write can hold the loop while flash is erased.
  bool saveDue(uint32_t now, bool atRest) const;
  // They were written (or read back at boot): nothing is due until the next
  // change.
  void saved() { savedVersion = changes; }

 private:
  void changed(uint32_t now);

  EventLog& log;
  kinematics::ControlScheme currentScheme;
  Explorer::SonarMode sonarMode = Explorer::SONAR_FRONT;
  int aim = 0;
  bool pad = true;
  Source order[CONTROLLER_COUNT] = {SOURCE_USB, SOURCE_PAD, SOURCE_WIFI};
  bool checksOnBoot = false;
  uint32_t changes = 0;
  uint32_t savedVersion = 0;
  uint32_t lastChangeMs = 0;
};

#endif

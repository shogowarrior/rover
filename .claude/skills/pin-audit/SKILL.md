---
name: pin-audit
description: Cross-check every pin #define in src/ against the Wemos D1 R32 header map and the ESP32's strapping/reserved-pin constraints. Use when adding a peripheral, changing a pin assignment, or debugging a board that boots intermittently.
disable-model-invocation: true
---

# Pin Audit

Pin assignments in this project live in three places that nothing keeps in sync:

- `#define`s in [src/Rover.h](../../../src/Rover.h) — the authority the firmware actually uses
- prose tables in [docs/pinouts.md](../../../docs/pinouts.md) and [docs/Readme.md](../../../docs/Readme.md)
- photographs in [images/pinouts/](../../../images/pinouts/)

A wrong pin here does not produce a compile error. It produces a robot that
does not boot, or a sensor that silently reads garbage.

## Procedure

1. **Collect every assignment.** Grep for pin defines and any bare `pinMode`,
   `digitalWrite`, `analogRead`, or `attach` call that takes a literal:

   ```
   grep -rnE '#define +[A-Z_]*PIN[A-Z0-9_]* +[0-9]+' src/
   grep -rnE '(pinMode|digitalWrite|digitalRead|analogRead|attach)\( *[0-9]+' src/
   ```

2. **Check each GPIO against [references/d1r32-pinmap.md](references/d1r32-pinmap.md).**
   For every pin, confirm in order:
   - Is it physically broken out on the D1 R32 header?
   - Is it in the **unusable** list (flash)? → hard failure, must move.
   - Is it in the **strapping** list? → hazard. Only acceptable as an *output*
     the firmware drives after boot, never as an input a peripheral can hold
     high or low at reset.
   - Is it **input-only** (34-39)? → cannot be a TRIG, only an ECHO/analog input.
   - Is it already claimed by another peripheral, including the I2C bus the
     motor shield sits on (GPIO21/22)?

3. **Check the direction matches the role.** Ultrasonic TRIG is an output,
   ECHO is an input. Servo signal is an output (and must be PWM-capable —
   on ESP32 with ESP32Servo, any output pin works via LEDC).

4. **Check level shifting.** HC-SR04 modules run at 5 V and drive ECHO to 5 V.
   The ESP32 is **not** 5 V tolerant. Every ECHO line needs a divider or level
   shifter. Note any ECHO pin wired directly.

5. **Report a table** of pin → symbol → role → verdict, then list only the
   assignments that need to change and what to change them to. If a change
   requires physically rewiring the robot, say so explicitly and prominently —
   the firmware and the hardware must be changed together or the robot breaks.

## Do not

- Do not silently change a pin `#define`. A pin change is a hardware change.
  Report it, explain the rewiring, and let the operator decide.
- Do not trust the docs over the source. `src/` is what runs.

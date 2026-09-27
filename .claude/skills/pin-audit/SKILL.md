---
name: pin-audit
description: Cross-check every pin constant in src/Pins.h against the Wemos D1 R32 header map and the ESP32's strapping/reserved-pin constraints. Use when adding a peripheral, changing a pin assignment, or debugging a board that boots intermittently.
---

# Pin Audit

Read-only: this audit reports, it never edits. Pin assignments in this project
live in three places that nothing keeps in sync:

- `constexpr` constants in `namespace pins` in [src/Pins.h](../../../src/Pins.h)
  — the authority the firmware actually uses, and the only place in `src/` a
  pin number may appear
- prose tables in [docs/pinouts.md](../../../docs/pinouts.md) and [docs/Readme.md](../../../docs/Readme.md)
- photographs in [images/pinouts/](../../../images/pinouts/)

A wrong pin here does not produce a compile error. It produces a robot that
does not boot, or a sensor that silently reads garbage.

## Procedure

1. **Collect every assignment.** List the constants in `Pins.h`, where each is
   used, and anything that bypasses `Pins.h` — a pin `#define`, or a pin API
   called with a literal:

   ```
   grep -nE 'constexpr +uint8_t +[A-Z_0-9]+(\[[0-9]*\])? *=' src/Pins.h
   git grep --untracked -n 'pins::' -- src/
   git grep --untracked -nE '#define +[A-Z_]*PIN[A-Z0-9_]* +[0-9]+' -- src/
   git grep --untracked -nE '(pinMode|digitalWrite|digitalRead|analogRead|analogWrite|attach)\( *[0-9]+' -- src/
   ```

   `git grep --untracked` searches new files too but skips gitignored ones, so
   it never opens `src/config.h`, which holds the WiFi credentials; a recursive
   `grep -r src/` would. The last two should find nothing. A hit is a pin
   living outside `Pins.h`; report it as a finding in its own right.

2. **Check each GPIO against [references/d1r32-pinmap.md](references/d1r32-pinmap.md).**
   Every constant in `Pins.h` except `MOTOR_TERMINAL` is an ESP32 GPIO. For
   each, confirm in order:
   - Is it physically broken out on the D1 R32 header?
   - Is it in the **unusable** list (flash)? → hard failure, must move.
   - Is it in the **strapping** list? → hazard. Only acceptable as an *output*
     the firmware drives after boot, never as an input a peripheral can hold
     high or low at reset.
   - Is it **input-only** (34-39)? → cannot be a TRIG, only an ECHO/analog input.
   - Is it already claimed by another peripheral, including the I2C bus the
     motor shield sits on (GPIO21/22)?

3. **Check the direction matches the role.** Follow each `pins::` use from
   step 1 to the driver it is handed to. Ultrasonic TRIG is an output, ECHO is
   an input — the HCSR04 library sets both modes in `UltraSonicDistanceSensor`'s
   constructor (`Scanner.cpp`), so the argument order there is the direction.
   Servo signal is an output (and must be PWM-capable — on ESP32 with
   ESP32Servo, any output pin works via LEDC).

4. **Check `MOTOR_TERMINAL` separately.** Its entries are Adafruit Motor Shield
   terminals (M1..M4), not GPIOs — all four motors are driven over I2C. It must
   be a permutation of 1..4, indexed in the `Wheel` order of `MovePatterns.h`
   (front-left, front-right, rear-right, rear-left). A wrong entry does not stop
   the board booting; it spins the wrong wheel. `Pins.h` notes that
   `docs/Readme.md`'s terminal table disagrees with the firmware; report which
   one the operator should verify on the bench rather than picking a side.

5. **Check level shifting.** HC-SR04 modules run at 5 V and drive ECHO to 5 V.
   The ESP32 is **not** 5 V tolerant. Every ECHO line needs a divider or level
   shifter. Note any ECHO pin wired directly.

6. **Report a table** of pin → `pins::` constant → role → verdict, then list
   only the assignments that need to change and what to change them to. If a
   change requires physically rewiring the robot, say so explicitly and
   prominently — the firmware and the hardware must be changed together or the
   robot breaks.

## Do not

- Do not change a constant in `Pins.h`. A pin constant is a hardware change:
  it describes where a wire is soldered. Report it, explain the rewiring, and
  let the operator decide.
- Do not trust the docs over the source. `src/` is what runs.

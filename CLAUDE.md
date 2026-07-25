# rover

Firmware for a four-wheel mecanum rover. ESP32 (Wemos D1 R32) running the
Arduino framework under PlatformIO, driving an Adafruit MotorShield V2, with a
servo-mounted ultrasonic scanner and a WebSocket control link.

## Commands

`pio` is not on `PATH`. It lives at `~/.platformio/penv/bin/pio`.

```
~/.platformio/penv/bin/pio run -e car_wire              # build (~8s warm)
~/.platformio/penv/bin/pio run -e car_wire -t upload    # flash over USB
~/.platformio/penv/bin/pio run -e car_ota  -t upload    # flash over WiFi
~/.platformio/penv/bin/pio device monitor -e car_wire   # serial, with exception decoder
~/.platformio/penv/bin/pio test -e native               # host-side unit tests
```

Use `/flash` rather than invoking upload directly — it checks the transport is
actually reachable first.

There is no runtime feedback loop on this project: a mistake is not visible
until the board is flashed. A `PostToolUse` hook compiles after every edit
under `src/`. Do not disable it.

## Layout

| Path | What |
|------|------|
| `src/main.cpp` | `setup()` / `loop()`. Loop must stay non-blocking. |
| `src/Rover.{h,cpp}` | Motors, servo, ultrasonic scan, autonomous exploration |
| `src/Service.{h,cpp}` | WiFi, ArduinoOTA, WebSocket server on port 81 |
| `src/Controller.{h,cpp}` | PS3 gamepad input (compiled, not currently attached) |
| `src/Kinematics.{h,cpp}` | Pure decision/geometry logic — **no Arduino dependencies** |
| `src/common.h` | Shared constants and the move-code enum |
| `src/config.h` | WiFi credentials. Gitignored. **Off limits.** |
| `src/config.example.h` | Template for the above; CI compiles against it |
| `test/` | Host-side unit tests for `Kinematics` |
| `client/drive.py` | Interactive control + telemetry over WebSocket |
| `client/ws.py` | Telemetry listener only |
| `extras/joystick/` | Browser joystick UI — **not wired to the rover** |
| `docs/`, `images/` | Wiring, BOM, pinouts |

`src/config.h` holds the live WiFi SSID and password. A `PreToolUse` hook
blocks reading it. Its shape is in `src/config.example.h` — that is everything
you need to know about it.

## Invariants

These are not style preferences. Each one corresponds to a bug that has been
in this codebase.

**`loop()` never blocks.** No `delay()`, no unbounded `while`, in anything
reachable from `loop()`. Blocking starves `webSocket.loop()` and
`ArduinoOTA.handle()`, which means the rover stops accepting commands —
*including stop commands* — and cannot be OTA-recovered. Sensor timing is a
`millis()`-based state machine (`Rover::ScanState`), not a sleep.

**Motors are released by deadline, not by waiting.** `runMotors()` sets the
four motors and records `moveDeadline`. `Rover::update()`, called every loop,
releases them once it passes. There are no per-move FreeRTOS tasks — an
earlier design spawned four per move, which raced on shared motor parameters
and could exhaust the heap under a fast client.

**Every external input is clamped before it reaches a motor.** `speed` and
`duration` arriving over WebSocket are attacker-controlled in practice. Clamp
at the boundary, in `Rover::executeMove`, not at the call sites.

**Loss of control stops the rover.** Client disconnect, command timeout, and
WiFi drop all end with the motors released. If you add a new way to lose the
link, add its failsafe in the same change.

**Autonomous and manual modes never both drive.** `Rover::explore()` returns
immediately unless the mode is `MODE_AUTONOMOUS`. An incoming WebSocket move
switches to `MODE_MANUAL`, and only `RESUME_AUTONOMOUS` (move code 19) switches
back. Without this arbitration, exploration overwrites every remote command a
few milliseconds after it arrives; without the way back, the first command
ever sent strands the rover in manual until it is power-cycled.

**Sensor error sentinels are checked against the library, not guessed.**
`measureDistanceCm()` returns **-1** on timeout, not 0. Testing for `== 0` (as
an earlier version did) let -1 through, and -1 is below any safe distance, so
every missed reading was read as an obstacle against the sensor. Normalisation
lives in `kinematics::normalizeDistance`: negative means the echo never came
back, which for an ultrasonic means nothing is within range, so it maps to
`DISTANCE_FAR_CM`. Zero is a real reading and is left alone.

## Pins

Pin numbers are ESP32 GPIOs, not the D1 R32's UNO-style silkscreen labels.
The two differ; D8 on the silkscreen is GPIO12, which is a strapping pin that
prevents boot if held high at reset.

**A pin `#define` is a hardware change.** Changing one without rewiring the
robot breaks it. Never change one unprompted — report it and let the operator
decide. Run `/pin-audit` when touching pins or adding a peripheral.

Open hazard: `ECHO_PIN_1` is on GPIO12, a strapping pin, which can stop the
board booting. It is documented in `Rover.h` and deliberately left alone
because the fix is a wire, not a `#define`.

## Conventions

- `.clang-format` is Google style, 2-space indent, no column limit.
- Move codes are `#define`s in `common.h` and are part of the WebSocket wire
  protocol — clients in `client/` and `extras/joystick/` depend on the numeric
  values. Append; do not renumber.
- ArduinoJson v7. `JsonDocument` is not fixed-capacity as it was in v6, and
  passing one by value deep-copies. Take `JsonVariantConst` for read-only
  parameters.
- Prefer deleting dead code over commenting it out. Git has the history.

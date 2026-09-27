# rover

Firmware for a four-wheel mecanum rover, and the clients that drive it. This
file is the guide for any coding agent working in this repository. Claude
Code's own setup (hooks, skills, a review agent) is in `CLAUDE.md`.

**The hardware.** A Wemos D1 R32 (an ESP32-WROOM-32 on an Arduino UNO
footprint) runs the Arduino framework under PlatformIO. An Adafruit Motor
Shield V2 on I2C drives four yellow TT gear motors on 60 mm mecanum wheels,
under a two-deck aluminium chassis 255 x 160 x 85 mm, powered by a 3S 18650
pack (11.1-12.6 V) through a BMS. An HC-SR04 ultrasonic sensor on a servo on
the top deck scans ahead; a second HC-SR04 is wired but not read, because
nobody has recorded where it points. None of the wiring has been verified on
the bench yet: [docs/bench-checklist.md](docs/bench-checklist.md) is how.

## Ground rules

- **Never flash the board or open its serial monitor.** Uploading moves a
  physical robot, and opening the monitor can reset the board into
  exploring; only the operator does either. Build and test freely.
- **Never read `src/config.h`** by any means. See [config.h](#srcconfigh).
- **Never change a pin assignment unprompted.** See [Pins](#pins).
- There is no runtime feedback loop: a mistake is invisible until the board
  is flashed. Build after every firmware change, and run the host tests after
  every change to the pure modules.

## Commands

`pio` is not on `PATH`. It lives at `~/.platformio/penv/bin/pio`.

```
~/.platformio/penv/bin/pio run -e car_wire             # build the firmware (~8 s warm)
~/.platformio/penv/bin/pio run -e car_wire_gamepad     # build with the PS3 gamepad compiled in
~/.platformio/penv/bin/pio test -e native              # host-side unit tests, no board needed
python3 tools/check_protocol.py                        # clients' copies of move codes, port, thresholds match src/
```

Building a board environment needs `src/config.h`. In a fresh clone the
operator creates it from `src/config.example.h`; CI copies the template in its
own checkout. Never create or overwrite it yourself. The native tests do not
need it.

Flashing, for the operator only: `pio run -e car_wire -t upload` over USB
(always works, and is required after any change that could break WiFi or the
loop), `pio run -e car_ota -t upload` over WiFi to a rover already running good
firmware.

The serial console, `pio device monitor -e car_wire` (with the exception
decoder), is operator-only too. Opening it can reset the board through EN,
and an EN reset counts as a power-on, so the rover starts exploring: treat it
like flashing, with the rover on a stand. It also never exits on its own.

## Layout

| Path | What |
|------|------|
| `src/main.cpp` | Composition root: every object allocated statically and wired by reference; `setup()` and `loop()` |
| `src/Rover.{h,cpp}` | Mode arbitration, move deadlines, and the one clamped path to the motors. Pure |
| `src/Explorer.{h,cpp}` | Autonomous exploration state machine; `ExploreParams` holds its thresholds. Pure |
| `src/MovePatterns.{h,cpp}` | The table from move code to four wheel directions, and telemetry move names. Pure |
| `src/Protocol.{h,cpp}` | The WebSocket JSON format, both directions. Pure (ArduinoJson builds on the host) |
| `src/Kinematics.{h,cpp}` | Clamping, sensor normalisation, stick-to-move mapping. Pure |
| `src/Hardware.h` | The `Motors` and `RangeScanner` interfaces between the pure core and the hardware |
| `src/MoveCodes.h` | The move-code enum: the wire protocol. Append only |
| `src/Tuning.h` | Behaviour constants shared by the firmware and the tests |
| `src/Pins.h` | Every GPIO and motor terminal. A value here is a wire |
| `src/Features.h` | Compile-time switches: gamepad, explore at power-on, the pad's host MAC |
| `src/DriveTrain.{h,cpp}` | `Motors` on the Adafruit Motor Shield V2 |
| `src/Scanner.{h,cpp}` | `RangeScanner`: the servo and both HC-SR04s |
| `src/Network.{h,cpp}` | WiFi station, ArduinoOTA, and the WiFi-loss failsafe |
| `src/RemoteControl.{h,cpp}` | WebSocket server on port 81: commands in, telemetry out, driver tracking, heartbeat |
| `src/Gamepad.{h,cpp}` | PS3 controller over Bluetooth, compiled in only with `ROVER_ENABLE_GAMEPAD` |
| `src/config.h` | WiFi credentials. Gitignored. **Off limits** |
| `src/config.example.h` | The template for `config.h`; CI compiles against it |
| `test/test_*/` | Host tests: kinematics, move patterns, explorer, rover, protocol |
| `test/fakes/` | Fake `Motors` and `RangeScanner` for the host tests |
| `tools/check_protocol.py` | Checks the values the clients copy from the firmware (the move codes above all) against `src/` |
| `client/drive.py` | Keyboard control and telemetry, in a terminal |
| `client/ws.py` | Telemetry listener only |
| `client/rover.ipynb` | Notebook experiments over the same link |
| `extras/joystick/` | Browser control panel: open `joystick.html` from disk (see below) |
| `platformio.ini` | Environments `car_wire`, `car_ota`, `car_wire_gamepad`, `native`; pinned versions |
| `partition.csv` | Two OTA app slots and no filesystem |
| `docs/`, `images/` | Wiring, BOM, pinouts, the mecanum table, bench checklist, roadmap |

## Architecture

`main.cpp` builds the object graph and does nothing else. Each pass of
`loop()` calls `rover.update(now)`, then `gamepad.update(now)`, then
`network.update(now)`, which serves OTA and the WebSocket.

```
  RemoteControl (WebSocket :81, Protocol) --+ commands
  Gamepad (PS3, optional) ------------------+-----------> Rover --Motors--------> DriveTrain
  Network (WiFi, OTA) ----------------------+ link lost,    |   (MovePatterns)   (Motor Shield V2)
                                              OTA start     |
                                                         Explorer --RangeScanner--> Scanner
                                                                                   (servo, HC-SR04s)
```

`Network` also starts `RemoteControl` once WiFi is up and serves it each loop.

**The pure core** is `Rover`, `Explorer`, `MovePatterns`, `Protocol` and
`Kinematics`. None of it calls Arduino: time arrives as a `now` argument, and
the hardware is reached only through the interfaces in `Hardware.h`. That is
what lets `pio test -e native` test mode arbitration, move deadlines, clamping,
the whole of autonomy and the wire format on the host, compiled as gnu++11 like
the board.

**The adapters** are `DriveTrain`, `Scanner`, `Network`, `RemoteControl` and
`Gamepad`. They only translate between the core and a library, and they are not
host-tested, so keep them thin. Logic that could be wrong belongs in the core,
with a test. If a core module seems to need `millis()`, a motor or `Serial`,
pass the value in or add an interface instead.

## Invariants

These are not style preferences. Each corresponds to a bug that has been in
this codebase.

**`loop()` never blocks.** No `delay()`, no unbounded `while`, nothing that
waits on the network, in anything reachable from `loop()`. Blocking starves the
WebSocket server and ArduinoOTA: commands stop arriving, *stop commands
included*, and the board cannot be recovered over the air. Timing is state
compared against `millis()` (move deadlines, Explorer's phases), never a sleep.
The only routine busy-wait is the sonar ping in `Scanner::measureCm()`,
bounded at about 30 ms and spaced at least 70 ms apart. A WebSocket handshake
can still hold the loop for up to 2 s, and no move deadline is serviced
meanwhile: `WEBSOCKETS_TCP_TIMEOUT=2` in `platformio.ini` bounds it, where the
library's default let one stray byte freeze the loop for 83 minutes. The loop
watchdog, enabled at the end of `setup()`, resets the board (and so releases
the motors) if one pass ever takes 5 s; OTA feeds it while flashing. The only
`delay()` is the bounded WiFi connect in `setup()`.

**Motors are released by deadline, not by waiting.** `Rover::drive()` sets the
wheels and records `moveDeadline` (a repeat of the move already running only
moves the deadline); `Rover::update()`, every loop, releases them once it
passes. There are no per-move tasks or timers: an earlier design
spawned four FreeRTOS tasks per move, which raced on shared motor parameters
and could exhaust the heap under a fast client.

**Every input is clamped in `Rover::drive()`, the one path to the motors.**
WebSocket commands, the gamepad and Explorer all arrive there. Speed is clamped
to `tuning::MOTOR_SPEED_LIMIT` (never above 255: the driver takes a byte, so 300
would wrap to 44) and duration to `tuning::COMMAND_DURATION_MAX_MS`.
`Rover::command()` checks a raw code with `isMoveCode()` before casting it, and
an unknown code stops the rover. Clamp there, not at call sites, and never add
a second route to `Motors`.

**The 1.5 s duration cap is the deadman.** There is no separate timer: every
command ends within `COMMAND_DURATION_MAX_MS`, whatever it asked for, so a
client that stops sending stops the rover. Clients keep moving by re-sending
(the panel and the gamepad every 200 ms, `drive.py` through key auto-repeat).
Any client's repeat interval must stay well inside the cap.

**Loss of control stops the rover.** Each of these ends with the motors
released:

- The *driver*, the WebSocket client that last sent a command, disconnects. A
  telemetry-only listener coming and going does not stop anything.
- A client stops answering the heartbeat: the server pings every client each
  second and drops one that misses two pongs, which counts as a disconnect.
  This also keeps a vanished client's full send buffer from blocking the loop.
- WiFi drops: `Rover::onLinkLost()` stops and switches to manual, because no
  STOP could reach an exploring rover.
- An OTA flash starts.
- The gamepad goes silent for `GAMEPAD_SILENCE_MS`.
- Any reset other than a power-on (OTA, crash, watchdog, brownout) starts in
  manual (`startupMode()` in `main.cpp`), so a recovering rover stays put. The
  EN button, and so a USB flash, resets like a power-on and starts exploring.

If you add a new way to lose the link, add its failsafe in the same change.

**Autonomous and manual never both drive.** In `MODE_AUTONOMOUS`,
`Rover::update()` runs `Explorer::update()`, which may request motion; in
`MODE_MANUAL` it runs `Explorer::survey()`, which keeps sweeping and measuring
but never moves. Any command, STOP included, switches to manual; only
`RESUME_AUTONOMOUS` (code 19) switches back, restarting exploration from a
fresh sweep. Without the arbitration, exploration overwrote every remote
command milliseconds after it arrived; without the way back, the first command
ever sent stranded the rover in manual until a power cycle. Because STOP takes
control, a client must not send one just because it lost focus or is quitting
while the rover explores: stop only what it is driving itself.

**Sensor sentinels come from the library, not from guesses.** HCSR04 2.0.0's
`measureDistanceCm()` returns **-1** for every failure (no echo within about
4 m, an echo deflected away, a dead sensor) and never 0. Testing for `== 0`, as
an earlier version did, let -1 through as an obstacle touching the sensor.
`kinematics::normalizeDistance()` maps negative to `DISTANCE_FAR_CM` (999,
nothing in range); zero is a real reading. A dead or unplugged sensor also
reads -1 everywhere, and that normalises to open space -- so a sweep that
heard no echo at any bearing is never grounds to drive forward: Explorer only
turns in place to look again, and halts with `sensor silent` after three such
sweeps in a row. Keep it that way: an absent echo alone must never justify
motion.

**The gamepad's Bluetooth callback only fills a mailbox.** The PS3 library
calls back on the Bluetooth task (core 0); everything else runs on the loop
task (core 1). The callback copies the controls under a spinlock and touches
nothing else; `Gamepad::update()`, on the loop task, is the only thing that
talks to `Rover`. Keep motor state and the I2C bus single-threaded: no calls
into `Rover` from callbacks, interrupts or other tasks.

## How autonomy works

`Explorer` is a non-blocking state machine stepped once per loop. It measures
five bearings: +70, +35, 0, -35 and -70 degrees from straight ahead (positive
is left), reported as left, front-left, front, front-right and right. It cruises
only when nothing *in the rover's path* is within `EXPLORE_GO_CM` (40 cm), and
ends a cruise when something is within `EXPLORE_STOP_CM` (25 cm); the gap
between the two is hysteresis. Testing the path rather than each ray is what
lets it enter a corridor whose walls are near at the sides but not ahead. It
drives at `EXPLORE_SPEED` (64).

| Phase | What happens |
|-------|--------------|
| `SWEEP` | Stand still and measure all five bearings, sweeping back and forth |
| `CRUISE` | Drive forward on a 400 ms lease that only a clear ping renews, the servo weaving ahead and to each side. Ends on an obstacle in the path, a near echo that vanishes (deflected, not gone), a front reading that stops shrinking (stuck below the beam), or after 2.5 s |
| `TURN` | Rotate toward the more open side in short steps, measuring after each, and keep that direction until the front is clear twice |
| `BACKOFF` | Reverse briefly, and only over ground just driven forward: nothing watches behind |
| `SIDESTEP` | Strafe away from a flank too close to rotate beside. The strafe direction is learned, since the wiring is unverified |
| `HALTED` | Stopped: `boxed in` after a full circle finds no way out (it resumes only when the way opens by itself), or `sensor silent` after three sweeps hear nothing. Retries every 5 s |

The shared thresholds are in `Tuning.h`; the finer ones are `ExploreParams`
in `Explorer.h`.

## Wire protocol

JSON text frames over a WebSocket on port 81. `src/Protocol.h` is the
reference; in short:

- **Client to rover:** `{"move": <code>, "speed": 0..255, "duration": <ms>}`.
  A missing or mistyped field defaults to STOP, speed 0 and 750 ms, so a
  malformed command stops the rover. Frames over 256 bytes and invalid JSON are
  ignored. Move codes are in `src/MoveCodes.h`: 0 `STOP` to 18
  `ROTATE_COUNTERCLOCKWISE`, and 19 `RESUME_AUTONOMOUS`.
- **Rover to clients,** every 500 ms: `mode` (`AUTONOMOUS` or `MANUAL`),
  `move` (`STOP` whenever the wheels are idle), `moving`, `temperature` (the
  ESP32's own, in C), `phase` (only while autonomous), `halt` (only when
  halted), and `distanceLeft`, `distanceFrontLeft`, `distanceFront`,
  `distanceFrontRight`, `distanceRight` in cm once every bearing has been
  measured (999 means no echo). Distances stay live in manual mode too.

## The browser control panel

`extras/joystick/joystick.html` opens directly from disk; the rover cannot
serve it. `partition.csv` gives the whole flash to `nvs`, `otadata` and two OTA
app slots, leaving no SPIFFS or LittleFS partition for web assets. Adding one
means repartitioning, which needs a USB erase and breaks OTA, so the panel is a
local file that connects out to `ws://<rover>:81` (the address field takes
`host` or `host:port`).

The panel holds a move by re-sending it every 200 ms (`REPEAT_MS` in
`control.js`), each asking for 400 ms. `REPEAT_MS` must stay well under
`COMMAND_DURATION_MAX_MS`. Letting go, blurring the window or hiding the tab
stops what the panel is driving and leaves an exploring rover alone.

## Pins

Every GPIO and motor-terminal assignment is in `src/Pins.h`. The numbers are
ESP32 GPIOs, not the D1 R32's UNO-style silkscreen labels, and the two differ:
D8 on the silkscreen is GPIO12.

**A pin constant is a hardware change.** It records where a wire is soldered;
changing one without rewiring the robot breaks it. Never change one unprompted:
report it and let the operator decide.

Open hazard: the scanner's ECHO (`pins::SCAN_ECHO`) is on GPIO12, a strapping
pin. Held high at reset it switches the flash supply to 1.8 V and the board
does not boot, intermittently. The fix is a wire (to GPIO34) plus the constant,
in one change, which is the operator's call. Both ECHO lines also carry 5 V and
need a divider or level shifter. `MOTOR_TERMINAL` disagrees with the table in
`docs/Readme.md`. The bench checklist covers all three.

## src/config.h

`src/config.h` holds the live WiFi SSID and password, and optionally an OTA
password. It is gitignored. Never read it by any means (an editor, `cat`,
`grep`, a glob that matches it, printing its macros), never commit it, and
never paste from it. To search `src/`, use `git grep --untracked`, which
searches new files too but skips gitignored ones; a plain recursive `grep`
reads it. The build products under `.pio/build/` (`firmware.elf`,
`firmware.bin`, `Network.cpp.o`) contain the same strings, so never dump them
with `strings`, `xxd` or similar either. `src/config.example.h` has the same
shape with placeholder values, and that is everything you need. Only
`src/Network.cpp` includes it. A new setting that belongs there must be added
to `config.example.h` too, because CI builds against the template.

## Conventions

- `.clang-format` is Google style, 2-space indent, no column limit.
- The board compiles as **C++11** (gnu++11), and so do the host tests. No
  C++14 or C++17: no `std::optional`, structured bindings, `if constexpr`,
  `std::make_unique`, or multi-statement `constexpr` functions.
- Move codes are part of the wire protocol and the clients carry copies.
  Append new codes before `MOVE_CODE_COUNT`; never renumber.
  `tools/check_protocol.py`, run in CI, fails when a client's copy drifts.
- Behaviour constants go in `Tuning.h` (free of Arduino, so the tests share
  them), autonomy thresholds in `ExploreParams`, pins in `Pins.h`. A value a
  client mirrors names its copy in a comment, and `tools/check_protocol.py`
  checks the copy.
- Optional features are switches in `Features.h`, not commented-out code, and
  every setting keeps compiling (CI builds `car_wire_gamepad` for the gamepad
  path).
- Prefer deleting dead code to commenting it out. Git has the history.
- ArduinoJson 7: `JsonDocument` grows on the heap rather than having a fixed
  capacity, and passing one by value deep-copies it. Take `JsonVariantConst`
  for read-only parameters, and read fields with `|` so a missing or mistyped
  key gets a safe default.
- `millis()` wraps every 49.7 days. Compare times as
  `static_cast<int32_t>(now - deadline) >= 0`, never `now >= deadline`.
- Library and platform versions are pinned exactly in `platformio.ini`. Bump
  one at a time and re-run everything.
- Comments explain why, and often name the bug a line prevents.

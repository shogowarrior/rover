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
  is flashed. Build after every firmware change, run the host tests after
  every change to the pure modules, run `tools/check_protocol.py` after
  changing a client or a value a client mirrors, and run the panel's tests
  after changing the browser panel or anything in `src/`.

## Commands

`pio` is not on `PATH`. It lives at `~/.platformio/penv/bin/pio`.

```
~/.platformio/penv/bin/pio run -e car_wire             # build the firmware (~8 s warm)
~/.platformio/penv/bin/pio run -e car_wire_gamepad     # build with the PS3 gamepad compiled in
~/.platformio/penv/bin/pio test -e native              # host-side unit tests, no board needed
python3 tools/check_protocol.py                        # the clients' copies of the protocol match src/
node --test extras/joystick/test/                      # the browser panel against a fake DOM, no rover needed
```

Building a board environment needs `src/config.h`. In a fresh clone the
operator creates it from `src/config.example.h`; CI copies the template in its
own checkout. Never create or overwrite it yourself. The native tests do not
need it.

Flashing, for the operator only: `pio run -e car_wire -t upload` over USB
(always works, and is required after any change that could break WiFi or the
loop), `pio run -e car_ota -t upload` over WiFi to a rover already running good
firmware. `car_ota` builds without the gamepad, so on a gamepad rover an OTA
update removes the pad unless `ROVER_ENABLE_GAMEPAD` defaults to 1 in
`src/Features.h`, which turns it on for every environment.

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
| `src/GamepadSession.{h,cpp}` | The gamepad's rules: pad reports to rover commands, re-send and silence timing, START, SELECT, when to rewrite the player LEDs. Pure |
| `src/Timing.h` | `timing::reached()` for a deadline, `since()` and `elapsed()` for an age: every wrap-safe time comparison |
| `src/Hardware.h` | The `Motors` and `RangeScanner` interfaces between the pure core and the hardware |
| `src/MoveCodes.h` | The move-code enum: the wire protocol. Append only |
| `src/Tuning.h` | Behaviour constants shared by the firmware and the tests |
| `src/Pins.h` | Every GPIO and motor terminal. A value here is a wire |
| `src/Features.h` | Compile-time switches: gamepad, explore at power-on, the pad's host MAC, the default control scheme |
| `src/DriveTrain.{h,cpp}` | `Motors` on the Adafruit Motor Shield V2, and whether it answered at boot |
| `src/Scanner.{h,cpp}` | `RangeScanner`: the servo and both HC-SR04s |
| `src/Network.{h,cpp}` | WiFi station, ArduinoOTA, and the WiFi-loss failsafe |
| `src/RemoteControl.{h,cpp}` | WebSocket server on port 81: commands and scheme changes in, telemetry out, driver tracking, heartbeat |
| `src/Gamepad.{h,cpp}` | PS3 controller over Bluetooth: only the callback's mailbox, and the player LED write. Compiled in only with `ROVER_ENABLE_GAMEPAD` |
| `src/config.h` | WiFi credentials. Gitignored. **Off limits** |
| `src/config.example.h` | The template for `config.h`; CI compiles against it |
| `test/test_*/` | Host tests: kinematics, move patterns, explorer, rover, gamepad, protocol |
| `test/fakes/` | Fake `Motors` and `RangeScanner` for the host tests |
| `test/support/` | Helpers the host tests share: `Loop.h` steps time the way `loop()` does, `Vectors.h` reads `test/vectors/` |
| `test/vectors/` | Cases as JSON: stick to move, shared by the firmware's tests and the panel's; telemetry frames |
| `tools/check_protocol.py` | Checks the values the clients copy from the firmware (the move codes above all) against `src/` |
| `client/drive.py` | Keyboard control and telemetry, in a terminal |
| `client/ws.py` | Telemetry listener only |
| `client/rover.ipynb` | Notebook experiments over the same link |
| `extras/joystick/` | Browser control panel: open `joystick.html` from disk (see below). A Drive tab, and a Program tab of block programs with a simulator to preview them on. `js/` holds its classes, `app.js` wires them, `test/` runs them in Node |
| `platformio.ini` | Environments `car_wire`, `car_ota`, `car_wire_gamepad`, `native`; pinned versions |
| `partition.csv` | Two OTA app slots and no filesystem |
| `docs/`, `images/` | Wiring, BOM, pinouts, the mecanum table, bench checklist, roadmap |

## Architecture

`main.cpp` builds the object graph and does nothing else. Each pass of
`loop()` calls `rover.update(now)`, then `gamepad.update()`, which reads its
own clock (see the mailbox below), then `network.update(now)`, which serves
OTA and the WebSocket.

```
  RemoteControl (WebSocket :81, Protocol) --+ commands
  Gamepad (PS3) -> GamepadSession ----------+-----------> Rover --Motors--------> DriveTrain
  Network (WiFi, OTA) ----------------------+ standDown:    |   (MovePatterns)   (Motor Shield V2)
                                              link lost,    |
                                              OTA start  Explorer --RangeScanner--> Scanner
                                                                                   (servo, HC-SR04s)
```

`Network` also starts `RemoteControl` once WiFi is up and serves it each loop.

**The pure core** is `Rover`, `Explorer`, `GamepadSession`, `MovePatterns`,
`Protocol` and `Kinematics`, with `Timing.h`. None of it calls Arduino: time
arrives as a `now` argument, and the hardware is reached only through the
interfaces in `Hardware.h`. That is what lets `pio test -e native` test mode
arbitration, move deadlines, clamping, the whole of autonomy, the gamepad's
rules and the wire format on the host, compiled as gnu++11 like the board.

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
can still stall the loop, and no move deadline is serviced meanwhile:
`WEBSOCKETS_TCP_TIMEOUT=2` in `platformio.ini` (whose comment says why)
bounds each handshake read, not the pass. The real bound is the loop
watchdog, enabled at the end of `setup()`: it resets the board if one pass
ever takes 5 s (OTA feeds it while flashing). The reset alone does not stop
the wheels. The shield's PCA9685 is not reset with the ESP32 and keeps its
last PWM, so the wheels run on through the reboot (about half a second) until
`DriveTrain::begin()` releases them (it tries even when the shield's probe
fails), and indefinitely if the board never boots that far. The only
`delay()` calls are in `setup()`: the bounded WiFi connect and the shield
probe's retries.

**Motors are released by deadline, not by waiting.** `Rover::drive()` sets the
wheels and records `moveDeadline`; `Rover::update()`, every loop, releases them
once it passes. A repeat of the move already running only moves the deadline,
except that the pattern is rewritten every `tuning::MOTOR_REFRESH_MS` (500 ms)
to repair an I2C write the bus lost, which the library never reports. A
release always writes, and one that ends motion is written once more
`MOTOR_REFRESH_MS` later, because a stop has no next command to repair a lost
write (`Rover::release()` says what that cost); a new move cancels it, and an
idle rover writes nothing. `Rover::servicePendingRelease()` makes that second
write, from `update()` and, while an OTA upload blocks the loop, from its
progress callback. There are no per-move tasks or timers: an earlier design
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
Any client's repeat interval must stay well inside the duration it asks for,
which the cap bounds.

**Loss of control stops the rover.** Each of these ends with the motors
released:

- The *driver*, the WebSocket client that last sent a command, disconnects:
  `Rover::stop()` releases the wheels and keeps the mode. A telemetry-only
  listener coming and going does not stop anything.
- A client stops answering the heartbeat: the server pings every client each
  second and drops one that misses two pongs in a row, which counts as a
  disconnect. This also keeps a vanished client's full send buffer from
  blocking the loop. A new client's first ping goes out about 600 ms after
  it connects, and its pong must come back within 600 ms of that ping.
  `HeartbeatServer` clears a slot's missed pongs on every disconnect
  (`RemoteControl.h` says why).
- WiFi drops: `Rover::standDown()` stops and switches to manual, because no
  STOP could reach an exploring rover.
- An OTA flash starts: `standDown()` too, so an upload that fails also leaves
  the rover stopped in manual, as a successful one's reboot does. The upload
  blocks the loop until it ends, so the stop's second write comes from its
  progress callback, which runs only while data arrives: flash over WiFi
  with the rover still or on the stand.
- The gamepad goes silent for `GAMEPAD_SILENCE_MS` (500 ms). A report that old
  never reads as fresh again, however long the silence.
- Any reset other than a power-on (OTA, crash, watchdog, brownout) starts in
  manual (`startupMode()` in `main.cpp`), so a recovering rover stays put once
  `DriveTrain::begin()` has released the wheels (see above). The EN button,
  and so a USB flash, resets like a power-on and starts exploring.

If you add a new way to lose the link, add its failsafe in the same change.

**Autonomous and manual never both drive.** In `MODE_AUTONOMOUS`,
`Rover::update()` runs `Explorer::update()`, which may request motion; in
`MODE_MANUAL` it runs `Explorer::survey()`, which keeps sweeping and measuring
but never moves. Any command, STOP included, switches to manual; only
`RESUME_AUTONOMOUS` (code 19) switches back, restarting exploration from a
fresh sweep. Sent while already exploring, it restarts an explorer that has
halted (clearing `boxed in` or `sensor silent`) and otherwise does nothing.
Without the arbitration, exploration overwrote every remote command
milliseconds after it arrived; without the way back, the first command ever
sent stranded the rover in manual until a power cycle. Because STOP takes
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
turns in place to look again (backing out of a dead end too narrow to turn
in, it stands still to look again), and halts with `sensor silent` after
three such sweeps in a row. A sensor that dies mid-cruise ends the cruise
once four looks in a row hear nothing. Keep it that way: an absent echo
alone must never justify motion.

**The gamepad's Bluetooth callback only fills a mailbox.** The PS3 library
calls back on the Bluetooth task (core 0); everything else runs on the loop
task (core 1). The callback copies the controls under a spinlock and touches
nothing else; `Gamepad::update()`, on the loop task, takes a copy and hands it
to `GamepadSession`, the only thing that talks to `Rover`. Keep motor state and
the I2C bus single-threaded: no calls into `Rover` from callbacks, interrupts
or other tasks. `Gamepad::update()` reads the clock under the same lock, not
`loop()`'s `now`, so no report is stamped later than the clock it is aged
against (its comment says what that cost).

## How autonomy works

`Explorer` is a non-blocking state machine stepped once per loop. It measures
five bearings: +70, +35, 0, -35 and -70 degrees from straight ahead (positive
is left), reported as left, front-left, front, front-right and right. It cruises
only when nothing *in the rover's path* is within `EXPLORE_GO_CM` (40 cm), and
ends a cruise when something in it comes within `EXPLORE_STOP_CM` (25 cm); the
gap between the two is hysteresis. Testing the path rather than each ray is what
lets it enter a corridor whose walls are near at the sides but not ahead. It
drives at `EXPLORE_SPEED` (64).

| Phase | What happens |
|-------|--------------|
| `SWEEP` | Stand still and measure all five bearings, sweeping back and forth |
| `CRUISE` | Drive forward on a 400 ms lease that only a clear ping renews, the servo weaving 0, +25, 0, -25 degrees. Ends on an obstacle in the path, a near echo that vanishes (deflected, not gone), a front echo that has not changed by 3 cm either way in 1 s (stuck below the beam: back off, then turn well clear), four looks in a row that hear nothing (a sensor dying mid-cruise), or after 2.5 s |
| `TURN` | Rotate toward the more open side in short steps, measuring after each, and keep that direction until the front is clear twice. Also one step away from what a weave look stopped on, and a small wander after a cruise that ran its 2.5 s; these optional turns are skipped where rotating would swing a corner into a wall |
| `BACKOFF` | Reverse briefly, and only over ground just driven forward: nothing watches behind. After a stuck cruise, only the driving before it got stuck counts. At a dead end too narrow to rotate in, back out the way it came, a step at a time with a sweep after each, until the flanks have room or that ground runs out, and only then turn: turning there swings the corners into the walls. A way ahead that looks clear again meanwhile does not send it back in, and a sweep that hears nothing only makes it look again |
| `SIDESTEP` | Strafe away from a flank too close to rotate beside, when the other side has room: instead of a turn, or when the path is clear but one flank is close. At most two in a row. The strafe direction is learned, since the wiring is unverified |
| `HALTED` | Stopped: `boxed in` when more than a full circle of turning, counted since the rover last drove clear, finds no way out (it then resumes only when the way opens by itself); or `sensor silent` after three sweeps in a row hear nothing. Retries every 5 s; `RESUME_AUTONOMOUS` restarts it at once |

The shared thresholds are in `Tuning.h`; the finer ones are `ExploreParams`
in `Explorer.h`.

## Wire protocol

JSON text frames over a WebSocket on port 81. `src/Protocol.h` is the
reference; in short:

- **Client to rover:** `{"move": <code>, "speed": 0..255, "duration": <ms>}`.
  A missing or mistyped field defaults to STOP, speed 0 and 750 ms, so a
  malformed command stops the rover. Frames over `protocol::COMMAND_MAX_BYTES`
  (256 bytes) and invalid JSON are ignored, and `test_longest_command_fits`
  checks that the longest a client sends fits. Move codes are in
  `src/MoveCodes.h`: 0 `STOP` to 18 `ROTATE_COUNTERCLOCKWISE`, and 19
  `RESUME_AUTONOMOUS`.
- **Client to rover, configuration:** `{"scheme": "NORMAL" | "ADVANCED"}`
  (no `move`) sets the control scheme below. It is not a command: it neither
  takes control nor stops anything, so a client may send it while the rover
  explores. An unknown scheme name is ignored.
- **Rover to clients,** every 500 ms: `mode` (`AUTONOMOUS` or `MANUAL`),
  `move` (`STOP` whenever the wheels are idle), `moving`, `temperature` (the
  ESP32's own, in C), `motorsReady` (always sent; `false` when the motor
  shield did not answer at boot, so no move reaches the wheels whatever `move`
  says), `phase` (only while autonomous), `halt` (only when halted), and
  `distanceLeft`, `distanceFrontLeft`, `distanceFront`, `distanceFrontRight`,
  `distanceRight` in cm once every bearing has been measured (999 means no
  echo). Distances stay live in manual mode too. `scheme` (`NORMAL` or
  `ADVANCED`) is always sent. A frame must fit `protocol::TELEMETRY_MAX_BYTES`
  (384 bytes; `Protocol.h` says why), and `test_longest_telemetry_fits` fails
  the host tests when a new key would not. `test/vectors/telemetry.json`
  holds example frames, key for key, that `test_protocol` checks.

## The browser control panel

`extras/joystick/joystick.html` opens directly from disk; the rover cannot
serve it. `partition.csv` holds `nvs`, `otadata` and two 1.8 MB OTA app
slots, leaves the last 320 KB of the 4 MB flash unallocated, and has no
SPIFFS or LittleFS partition for web assets. Adding one means a new partition
table, which only a USB flash can write (OTA never does), so the panel is a
local file that connects out to `ws://<rover>:81` (the address field takes
`host` or `host:port`).

Chrome refuses module scripts from `file://`, so the panel is classic
`<script src>` files loaded in order, sharing one global scope: no modules, no
bundler, no packages. Its one remote script is Blockly 13.3.0 from
cdn.jsdelivr.net, for the Program tab: pinned, checked against its hash and
deferred, so driving never waits for it or depends on it. The panel reads like
the firmware: small classes in `js/`, each documenting its contract in its
header, wired by `js/app.js`, the composition root, whose header lists them in
load order.

Every constant mirrored from `src/` is in `js/protocol.js`, except the scan's
bearings and telemetry keys (`BEARINGS` in `js/scan.js`), the stick mapping,
its family names and the move names telemetry reports (`js/mecanum.js`), and
the simulator's own copies (`js/sim.js`). `joy.js` is a vendored third-party
joystick: leave it unmodified. `test/` runs the real page in Node against a
fake DOM, WebSocket and clock (`panel.test.js`), and the runner and blocks
(`program.test.js`), the simulator (`sim.test.js`) and the stick mapping
(`mecanum.test.js`) on their own. `test/firmware.js` reads what they check
against in `src/` and `test/vectors/`, and `test/harness.js` sets the time
limit an asynchronous test runs under, so one that never ends fails by name.

The panel holds a move by re-sending it every 200 ms (`REPEAT_MS` in
`js/protocol.js`), each asking for 400 ms (`MOVE_DURATION_MS`). `REPEAT_MS`
must stay well under `MOVE_DURATION_MS`, or a held move stutters
(`tools/check_protocol.py` holds it to half), and so under the cap. A new
direction goes out at once, a new speed in the same direction at most every
100 ms (`STICK_SEND_MS`, the gamepad's rule below). Letting go, blurring the
window or hiding the tab stops what the panel is driving and leaves an
exploring rover alone. Its Drive and Program tabs switch only what is shown,
with one exception: leaving the Drive tab lets go of a held stick (one STOP,
only if it was driving), which hidden could be neither steered nor centred.
A held rotate button carries on. The scan, the readouts and the Stop and
Autonomous buttons stay on screen on both tabs. Stop and Autonomous stay in
the same place; the scan gives the Program tab room, as a strip above it on
a phone and a narrower column beside it on a wide screen.

The layout is `css/panel.css`'s, on its tokens (colours, type, space, radii).
On a phone the Drive tab is a dock at the foot of the screen, the stick under
the left thumb, rotate, speed and Stop under the right, and the scan takes
what height is left; on a wide screen (960 px by 521 px and up) the open tab
fills the left, the scan and readouts a column on the right, and Stop and
Autonomous a bar across the foot, Stop under the controls. No ancestor of the
stick may be positioned, transformed, filtered or contained: joy.js places a
touch by its canvas's offsetParent, and `panel.test.js` reads every stylesheet
for it. Any move of the stick's box on the screen under a held stick lets go
of it, as a scheme change does: a thumb resting where it was would otherwise
steer the moved stick another way. A window resize or a turned phone lets go
at once (a 375 px phone turned on its side moves the stick and keeps its
size); a move nothing reports, a row above the stick coming or going or the
page scrolling, lets go at joy.js's next report, before it can drive. So
nothing above the stick changes height while it is held: the pivot caveat
keeps its line on a phone on its side, and the stick's caption stays on one
line, which keeps a family chosen under a held stick a re-steer. joy.js
sizes its canvas once, as it is built, so when the box settles at a new size
the Driver builds the stick again. The stick's teal is joy.js's own
(`js/drive.js`), and the theme's accent follows it.

**The scheme toggle** in the header shows only what telemetry reports, and
stays disabled until a frame names a scheme. Its `{"scheme": ...}` message is
configuration, never a command: it neither takes control nor stops an
exploring rover. A change, from anyone, lets go of a held stick (one STOP, and
only if the stick was driving), which drives again only from a fresh press; a
held rotate button and a running program carry on. The family selector
(Translate, Pivot, Pivot sideways) appears only under ADVANCED.

**The Program tab** runs a block program on the rover, or previews it on the
simulator. On the rover it needs a live link, and drives only through
`Driver.program()`: each move is re-sent every `REPEAT_MS`, asking 400 ms,
like a held control, and the operator's hands win over it. A drive press,
blur, a hidden or closed page, the link lost, stale or disconnected, Stop,
Autonomous, the tab's Stop program or a switch of target stops a run, and an
abort sends STOP only if the program was driving. Its commands are paced
(`COMMAND_GAP_MS` and `REPEAT_GAP_MS` in `js/program.js`), so no loop floods
the rover; it acts only on fresh readings, and never takes no echo for a
clear way; every loop yields. Its limits on a drive, a drive-until and a wait
are `ProgramRunner`'s (`js/program.js`). The compiled code runs with the
page's globals in reach, so a program loaded from anywhere goes through
`RoverBlocks.sanitize()`, which drops block ids, and `RoverBlocks.harden()`
keeps comments out of the code. On the rover, Run asks first when the editor
holds several stacks, and when the program drives a pivot while the rover is
not on ADVANCED. It asks in the page, in a `<dialog>`, never with
`window.confirm()`: desktop Chrome blurs the window as its own dialog
closes, and the blur stopped the run just confirmed. A program's own stop
and start exploring are not presses:
the Driver raises no event for them.

**The simulator** holds no Link and no Driver: a preview sends nothing, and
its telemetry never reaches the scan fan or the readouts. It follows the
firmware's wheel table with ideal mecanum kinematics, `MOTOR_SPEED_LIMIT`, the
400 ms deadline and the 200 ms re-send, the sweep's timing (so readings are as
old as the rover's) and telemetry every 500 ms. It does not model exploring,
wheel slip, inertia, motor lag, the sonar's beam width, or temperature, phase
and halt. The numbers that describe this rover are estimates, in the
calibration block of `js/sim.js` with how to measure each.

## The gamepad

`GamepadSession` turns the pad's reports into commands; `test/test_gamepad`
checks its rules. The left stick picks one of eight moves and wins over the
triggers; L2 rotates left (counter-clockwise) and R2 right, matching the
panel's Left button and `drive.py`'s `q`. A trigger's speed follows its whole
pull, up to half the stick's top speed. A held stick is re-sent every
`GAMEPAD_REFRESH_MS` (200 ms); a new direction goes at once, a new speed in
the same direction at most every `GAMEPAD_SPEED_CHANGE_MS` (100 ms). Letting
go sends one STOP, never a stream, so a resting pad cannot keep forcing manual
while the rover explores; a pad silent for `GAMEPAD_SILENCE_MS` counts as let
go. START sends `RESUME_AUTONOMOUS`.

**Control schemes.** The rover holds one scheme for every controller
(`main.cpp` owns it; the default is `DEFAULT_CONTROL_SCHEME` in `Features.h`),
so the pad and the panel always drive the same way. NORMAL is the above.
ADVANCED adds the eight pivots (codes 9 to 16): holding L1 makes the stick's
quadrant pick a pivot, holding R1 a pivot sideways; the panel has the same
choice as a selector. SELECT toggles the scheme, the panel's toggle sends the
`scheme` message, and the pad's player LEDs show it (1 NORMAL, 2 ADVANCED),
rewritten at most every `GAMEPAD_LED_MIN_INTERVAL_MS` (250 ms): each write is
a Bluetooth send from the loop task, and any client can flip the scheme as
fast as it sends.
Any client may change the scheme, so a change never redirects a held stick:
the pad stops what it was driving and waits for the stick to come back to
centre, so a toggle elsewhere can only ever stop it. The panel's stick does
the same, and waits for a fresh press.
`kinematics::moveForStick` maps the stick for the pad; the panel carries a
copy, and both are tested against `test/vectors/stick_moves.json`.
[docs/mecanum.md](docs/mecanum.md) has the table and warns that none of it
is bench-verified yet. Every row matches the owner's reference,
[DroneBot Workshop's mecanum table](https://dronebotworkshop.com/mecanum/),
whose constants `test/test_move_patterns` decodes, so change a row only on the
bench's evidence or the reference's.

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
in one change, which is the operator's call. Both ECHO lines also carry 5 V
and need a divider or level shifter. `MOTOR_TERMINAL` disagrees with the table
in `docs/Readme.md`. The bench checklist covers all three, along with the
alternatives for GPIO12 and how to recover a board that will not boot.

## src/config.h

`src/config.h` holds the live WiFi SSID and password, and optionally an OTA
password. It is gitignored. Never read it by any means (an editor, `cat`,
`grep`, a glob that matches it, printing its macros), never commit it, and
never paste from it. To search `src/`, use `git grep --untracked`, which
searches new files too but skips gitignored ones; a plain recursive `grep`
reads it, and so does `git grep` with `--no-index` or
`--no-exclude-standard`. The build products under `.pio/build/`
(`firmware.elf`, `firmware.bin`, `Network.cpp.o`) contain the same strings,
so never dump them with `strings`, `xxd` or similar either.
`src/config.example.h` has the same shape with placeholder values, and that
is everything you need. Only `src/Network.cpp` includes it. A new setting
that belongs there must be added to `config.example.h` too, because CI
builds against the template. Never write an OTA password into
`platformio.ini`, which git tracks: `config.example.h` shows how the
operator passes one to an upload instead.

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
  checks the copy. The panel simulator's copies in
  `extras/joystick/js/sim.js` (the wheel table, the sweep timing) are
  checked by `extras/joystick/test/sim.test.js` instead.
- Optional features are switches in `Features.h`, not commented-out code, and
  every setting keeps compiling (CI builds `car_wire_gamepad` for the gamepad
  path).
- Prefer deleting dead code to commenting it out. Git has the history.
- ArduinoJson 7: `JsonDocument` grows on the heap rather than having a fixed
  capacity, and passing one by value deep-copies it. Take `JsonVariantConst`
  for read-only parameters, and read fields with `|` so a missing or mistyped
  key gets a safe default.
- `millis()` wraps every 49.7 days. Compare times only through `src/Timing.h`:
  `timing::reached(now, deadline)` for a deadline in the future (signed),
  `timing::since(now, then)` or `timing::elapsed(now, then, interval)` for an
  age (unsigned, so it stays right for any age up to 49.7 days). Never
  `now >= deadline`.
- Library and platform versions are pinned exactly in `platformio.ini`. Bump
  one at a time and re-run everything.
- Comments explain why, and often name the bug a line prevents.

# Bench checklist

The host tests prove the firmware's logic. They cannot know how the robot is
wired: which motor is on which terminal, which way the servo turns, where the
second sonar points. This checklist finds out, safely, in an order where each
step relies only on the ones before it.

Everything here is operator work: it involves flashing, wiring and sometimes a
pin change. Record what you find (in [Readme.md](Readme.md),
[BOM.md](BOM.md) and the comments in [src/Pins.h](../src/Pins.h)) so nobody
has to repeat it.

## 0. Before you start

1. **Put the rover on a stand with all four wheels off the ground before you
   switch it on.** A power-on starts autonomous exploration straight away, and
   the wheels will turn.
2. Flash over USB and watch the serial monitor:
   ```
   ~/.platformio/penv/bin/pio run -e car_wire -t upload
   ~/.platformio/penv/bin/pio device monitor -e car_wire
   ```
   Expect `Wireless connected: <address>` and `OTA and WebSocket services up.`
   If you see `Motor shield not found on I2C (0x60); motors disabled.`, stop
   and reseat or power the shield: nothing below will work. Telemetry says
   the same with `"motorsReady": false`, so you can check it without the
   serial monitor.
3. Connect the keyboard client and press **space**. That takes control
   (each telemetry line starts `MANUAL`) and stops the wheels:
   ```
   python3 client/drive.py --host <address>
   ```
   It starts at speed 64, which is plenty on the stand. `-` lowers it.
4. Some steps need move codes `drive.py` has no key for. This sends one code
   for three seconds, re-sending it the way the panel does, then stops:
   ```
   python3 - <address> <code> <<'EOF'
   import asyncio, json, sys, websockets

   async def main(host, move, speed=60):
       async with websockets.connect(f"ws://{host}:81") as ws:
           for _ in range(15):  # 3 s: re-send every 200 ms, as the panel does
               await ws.send(json.dumps({"move": move, "speed": speed, "duration": 400}))
               await asyncio.sleep(0.2)
           await ws.send(json.dumps({"move": 0, "speed": 0}))

   asyncio.run(main(sys.argv[1], int(sys.argv[2])))
   EOF
   ```

[mecanum.md](mecanum.md) has the expected direction of every wheel for every
code.

## 1. Motor polarity and terminals (on the stand)

The firmware drives front-left from M2, front-right from M1, rear-right from
M4 and rear-left from M3 (`pins::MOTOR_TERMINAL = {2, 1, 4, 3}`).
[Readme.md](Readme.md)'s table says otherwise. At most one is right.

1. **Polarity.** Press `w` (code 1, `MOVE_FORWARD`). All four wheels should
   turn forward. A wheel turning backward has its two motor leads reversed:
   swap them at its shield terminal. There is no firmware setting for this.
2. **Terminals.** Send code 5 (`MOVE_DIAGONAL45`): only front-left and
   rear-right should turn, both forward. Then code 13
   (`PIVOT_SIDEWAYS_FORWARD_RIGHT`): only front-left (forward) and
   front-right (backward).
3. If other wheels turned, work out the real wiring. Code 5 energises M2 and
   M4; code 13 energises M2 and M1. So the wheel that turned both times is on
   **M2**, the other one in code 5 is on **M4**, the other one in code 13 is
   on **M1**, and the wheel that never turned is on **M3**.
4. **Fix:** either move the motor wires to match `src/Pins.h`, or set
   `MOTOR_TERMINAL` to the terminals you found, in the order front-left,
   front-right, rear-right, rear-left. That is a pin change: the operator's
   call, flashed over USB, in the same change as correcting the table in
   Readme.md. Then repeat steps 1 and 2.
5. Press `d` (code 3, strafe right) and `e` (code 17, rotate clockwise) and
   compare every wheel with mecanum.md.

## 2. Mecanum wheel placement (on the floor)

Only once section 1 passes. On a clear floor at speed 64 or lower:

- `w` drives forward, `e` rotates clockwise seen from above, and `d` strafes
  right **without turning**.
- **If `d` rotates the rover, or it hardly moves:** two wheels of the same
  type are on one side or one axle. Diagonally opposite wheels must be the
  same type: front-left matches rear-right, front-right matches rear-left.
  Swap wheels until they do.
- **If `d` strafes left** while `w` is right (and `e` rotates only weakly, or
  the wrong way): the whole pattern is mirrored. Swap front-left with
  front-right and rear-left with rear-right.
- Seen from above, the top rollers of the four wheels form an X, each
  pointing toward the middle of the chassis; the rollers touching the ground
  form a diamond.

Do not fix wheel placement in software: every client and the autonomy share
the same table.

**Pivots, before anyone switches to ADVANCED.** Once the moves above are
right, send each pivot (codes 9 to 16) with the script in section 0, step 4,
and watch which pair drives and which way the rover goes.
[mecanum.md](mecanum.md) has all eight; for example:

- Code 9 (`PIVOT_RIGHT_FORWARD`): only the left-hand wheels turn, forward,
  and the rover moves **forward** with its nose turning right, about its
  right wheels. Code 10 drives the same pair backward.
- Code 13 (`PIVOT_SIDEWAYS_FORWARD_RIGHT`): only the front axle turns, and
  the front swings right about the rear axle. Code 15 swings the rear right,
  about the front axle.

The rows follow the reference table, so with `w` and `d` right, a pivot that
travels against its name means a wrong row: fix it in
`src/MovePatterns.cpp`, with its test in `test/test_move_patterns`, and in
`RoverSim.WHEELS` in `extras/joystick/js/sim.js`. How far a pivot swings is
for the floor to show: with rollers that never slip, as the panel's
simulator models them, no row needs a released wheel to turn, so the
released gearboxes change nothing there, and slip and grip decide the rest.
Write what you see in mecanum.md.

## 3. Scanner left and right (on the stand)

In manual mode the rover holds still but keeps sweeping its five bearings, so
the distances stay live.

1. Hold a book or a flat hand about 15 cm from the sensor, level with it, at
   the rover's **left**. Within two seconds the `L` reading on `drive.py`'s
   telemetry line (the leftmost wedge on the panel) should drop to about 15,
   and `R` should not.
2. **If `R` drops instead,** the servo turns the other way from what the
   firmware assumes. Set `servoDegPerBearing = +1` in `ExploreParams`
   ([src/Explorer.h](../src/Explorer.h)). Leaving it mirrored makes the rover
   turn toward the nearer wall instead of away from it.
3. Hold the book 30 cm straight ahead: `F` should drop to about 30.

## 4. Echo levels and the GPIO12 hazard

1. **Level shifting.** The HC-SR04 is a 5 V part and drives ECHO to 5 V; the
   ESP32 is not 5 V tolerant. Follow each ECHO wire (the scanner's to GPIO12,
   the second sensor's to GPIO19) from sensor to board. There must be a
   divider (for example 1 kOhm in series and 2 kOhm to ground, giving 3.3 V)
   or a level shifter channel on each. If there is not, fit one before going
   further. A 3.3 V sonar such as the RCWL-1601 avoids the problem (see the
   [roadmap](ROADMAP.md)).
2. **GPIO12.** The scanner's ECHO is on GPIO12 (D8 on the silkscreen), a
   strapping pin: held high at reset, it sets the flash supply to 1.8 V and
   the board does not boot. Power-on (EN included) and RTC-watchdog resets
   sample it, and so does a supply sag deep enough to become a power-on
   reset. The reset after a crash, the loop watchdog or the brownout detector
   (a software reset in this build) does not.
   On the stand, power-cycle ten times and check it boots every time (serial
   output, or telemetry returning). An occasional dead boot is this.
3. **Fix, whenever the wiring is next open.** Each option is the operator's
   call:
   - **(a) Move the echo to GPIO34 (preferred).** Move that ECHO wire,
     through its divider, to GPIO34, labelled A3, which is input-only with no
     strapping role, and change `pins::SCAN_ECHO` to 34 in `src/Pins.h` in the
     same change. Flash over USB, then repeat section 3. Run `/pin-audit`.
   - **(b) A 10 kOhm pull-down on GPIO12** helps only while the echo line
     idles low. It cannot overpower an echo the sensor drives high mid-ping,
     and a divider's resistor to ground already does the same job.
   - **(c) Burn the flash-voltage eFuse:**
     `espefuse.py --port <port> set_flash_voltage 3.3V` fixes the flash
     supply at 3.3 V, so GPIO12 is ignored at boot. Valid only for a module
     whose flash runs at 3.3 V, as the ESP32-WROOM-32's does. It is
     permanent: an eFuse cannot be unburned.
   - **(d) Recovery, if it will not boot:** disconnect the wire from GPIO12,
     jumper GPIO0 to GND and power-cycle. The D1 R32 has no BOOT button:
     GPIO0 is the first pin of the power header, above 5V, and the shield
     may need lifting to reach it. The ROM bootloader then waits for
     esptool, and a USB flash works again. Remove the jumper afterwards, or
     every reset stops in the bootloader.

## 5. The second HC-SR04

It is wired (TRIG GPIO18, ECHO GPIO19) and powered, but the firmware never
reads it, because nobody has recorded where it points.

- Look: does it face forward, down or backward, and how high is it?
- Write that in the comment above `BOTTOM_TRIG` in `src/Pins.h` and in
  BOM.md.
- Then decide what it is for. Facing forward at bumper height it catches
  obstacles under the servo sonar's beam; facing backward it covers the
  reversing the rover now does blind. The roadmap discusses both. Nothing
  changes in the firmware until that decision.

## 6. Gamepad (only if you use it)

Build and flash `car_wire_gamepad`. `PS3_HOST_MAC` in
[src/Features.h](../src/Features.h) must be the host address stored in the
pad (set with SixaxisPairTool or sixaxispairer). Pairing changes the board's
MAC address, WiFi included, so DHCP reservations may need updating. Watch
with `python3 client/drive.py --listen`; a listener never stops the rover.

`car_ota` builds without the pad, so an OTA update removes it and gives the
board its own MAC address back. On a gamepad rover, set
`ROVER_ENABLE_GAMEPAD` to 1 in `src/Features.h` before flashing over WiFi;
every environment then has the pad.

On the stand:

- Left stick **up** drives forward (all four wheels forward, telemetry
  `MOVE_FORWARD`); stick right strafes right.
- **L2** rotates left (`ROTATE_COUNTERCLOCKWISE`), **R2** rotates right.
  Earlier firmware had them the other way round.
- Pulling a trigger further turns faster, right to the end of its travel.
  Earlier firmware reached its top rotate speed at half a pull.
- Holding the stick keeps the wheels turning; releasing it stops them.
  **START** switches to autonomous, or restarts exploration that has halted.
- Switching the pad off while holding the stick stops the wheels within half
  a second.
- **SELECT** switches to ADVANCED (the LEDs show player 2). Holding **L1**
  with the stick up and to the right then shows `PIVOT_RIGHT_FORWARD` and
  turns only the left-hand wheels, forward; up and to the left shows
  `PIVOT_LEFT_FORWARD` and turns only the right-hand wheels, forward. The
  stick's quadrant picks the pivot ([mecanum.md](mecanum.md)), so a push
  straight up can show either. SELECT again goes back to NORMAL.

If the stick drives backward while `w` in `drive.py` drives forward, or L2 and
R2 are swapped, the fault is in `kinematics::translateGamepad`
([src/Kinematics.cpp](../src/Kinematics.cpp)); fix it there together with its
test in `test/test_kinematics`. The timing rules (re-sending, silence, START,
SELECT, when the player LEDs are rewritten) are in `GamepadSession`, tested in
`test/test_gamepad`.

## 7. Reset behaviour

With the rover on the stand, running and connected:

1. Flash over WiFi: `~/.platformio/penv/bin/pio run -e car_ota -t upload`
   (on a gamepad rover, read section 6 first). The wheels stop as the upload
   starts, and the rover drops to manual even if the upload then fails.
   After it reboots, telemetry must show `MANUAL` and the wheels must stay
   still. Any reset other than a power-on (OTA, crash, watchdog, brownout)
   starts in manual.
2. Press EN or power-cycle: the mode is `AUTONOMOUS` and the wheels turn. A
   USB flash resets the board through EN too, so it also comes up exploring.
   Press EN while the wheels turn: they keep turning while you hold it and
   for about half a second after, because the shield's PWM chip is not reset
   with the ESP32 and only the rebooted firmware releases them. If they never
   stop, the board did not boot: cut the motor power and see section 4.
3. If the rover explores after an OTA flash, look at `startupMode()` in
   [src/main.cpp](../src/main.cpp) and `AUTONOMOUS_AT_POWER_ON` in
   `src/Features.h`.

## 8. Motor voltage and noise

PWM duty is a fraction of the pack voltage. The 3S pack gives 11.1 to 12.6 V;
TT motors are rated about 3 to 6 V. At PWM 255 they see about twice their
rating, which overheats them and wears the brushes and gears.
`tuning::MOTOR_SPEED_LIMIT` in [src/Tuning.h](../src/Tuning.h) is still 255
until the operator decides. (The shield itself is fine: it drives motors from
4.5 to 13.5 V.)

Measure the pack at the shield's motor power terminal, then pick one:

- **Cap the duty:** set `MOTOR_SPEED_LIMIT` to about 120, roughly 5.9 V from a
  full pack, in src/Tuning.h and in its copy, the panel simulator's clamp, in
  [extras/joystick/js/protocol.js](../extras/joystick/js/protocol.js)
  (`tools/check_protocol.py` fails until the two match). Every source is
  clamped to it, so the panel's slider above 120 simply drives at 120.
- **Regulate the supply:** feed the motors from a 6 V buck regulator and keep
  255. The same duty then gives about half the voltage, so raise
  `EXPLORE_SPEED` (64) and `GAMEPAD_MAX_SPEED` (50) by about two times, or
  the rover will barely move.

**Motor noise.** Brushed motors spark at their commutators, and that noise
resets ESP32s and corrupts I2C. Solder a 100 nF ceramic capacitor across each
TT motor's two terminals, at the motor, and fit a bulk electrolytic (for
example 470 uF, rated 25 V or more) across the shield's motor power terminal.
Suspect noise when the board resets as motors start or reverse, when
telemetry shows `"motorsReady": false` after a reset, or when a wheel does
not do what telemetry says. The firmware rewrites a held move every 500 ms
(`tuning::MOTOR_REFRESH_MS`), and writes the stop that ends a move once more
500 ms later, to repair a lost I2C write; that is a patch, not a cure.

## 9. Failsafes, end to end

The host tests cover the logic; this checks it on the board. On the stand,
drive with `w` held down, then:

- Quit `drive.py` with `x`: the wheels stop at once.
- Turn off the laptop's WiFi (the rover gets no goodbye): the wheels stop
  within 1.5 s, the longest any one command runs.
- In autonomous mode, switch off the access point: the wheels stop within a
  few seconds, once the WiFi stack notices, and after it reconnects the
  telemetry shows `MANUAL`.

Only when every section passes should the rover go on the floor on its own.

# Roadmap

What would make the rover drive and navigate better, most useful first.
Nothing here is started. Prices are rough, in US dollars, as of 2026.

**The division of labour this aims at.** The ESP32 keeps everything that must
be fast and must keep working when the link drops: sensing, heading hold,
reactive obstacle avoidance and the failsafes, at 50 to 100 Hz. A Python
program on a laptop does what needs memory, a screen and hindsight: logging,
mapping, SLAM and choosing where to go next. The WebSocket link joins them,
and the rover never waits for the laptop to avoid a wall or to stop.

## Now: no new hardware, or very little

**Stop over-volting the motors.** PWM duty is a fraction of the pack voltage,
so 255 on a 12.6 V pack drives the 3-6 V TT motors at about twice their
rating. Either cap `tuning::MOTOR_SPEED_LIMIT` at about 120 (5.9 V from a full
pack), or feed the motors from a 6 V buck regulator such as the
[Pololu D36V50F6](https://www.pololu.com/product/4092) (6 V, 5.5 A, about
$35-40) and raise `EXPLORE_SPEED` and `GAMEPAD_MAX_SPEED` to suit. The
regulator also keeps speed constant as the pack drains. See section 8 of the
[bench checklist](bench-checklist.md).

**Measure the battery.** A 100 kOhm / 22 kOhm divider from the pack turns
12.6 V into 2.3 V, safely inside the ADC's range. It must go to an ADC1 pin,
because ADC2 does not work while WiFi is on, and to one that is free on this
stack: not GPIO36 or GPIO39, which sit at A4/A5, where the motor shield ties
the header to its I2C lines
([Adafruit FAQ](https://learn.adafruit.com/adafruit-motor-shield-v2-for-arduino/faq)).
GPIO35 (A2) works if the second sonar's echo is not moved there. Confirm with
`/pin-audit`. Report volts in telemetry,
stop exploring well before the BMS cuts off (2.5 V per cell), and optionally
scale PWM by voltage so a given speed means the same thing on a full and a
tired pack.

**Get the scanner's echo off GPIO12.** It is a strapping pin that can stop the
board booting. Move the wire to GPIO34 through a divider, or swap in an
[RCWL-1601](https://www.adafruit.com/product/4007) (Adafruit 4007, $3.95), an
HC-SR04-compatible sonar that runs at 3.3 V so its echo needs no divider. See
section 4 of the bench checklist.

**Proportional mecanum drive.** Today the panel's stick picks one of eight
fixed moves. Mecanum wheels can do better: for a wanted forward speed `vx`,
rightward speed `vy` and clockwise turn rate `w`,

```
front-left  = vx + vy + w        front-right = vx - vy - w
rear-left   = vx - vy + w        rear-right  = vx + vy - w
```

then scale all four down together if any exceeds full duty, which keeps the
direction. (These reproduce every four-wheel and diagonal row in
[mecanum.md](mecanum.md).) Add it as a new move code appended after 19,
carrying `vx`, `vy` and `w`, still clamped in `Rover::drive`, with a per-wheel
method on `Motors`. The stick can then command any direction at any speed,
and `w` is where heading hold plugs in later. The
[gm0 mecanum tutorial](https://gm0.org/en/latest/docs/software/tutorials/mecanum-drive.html)
walks through the same maths.

**Time echoes without waiting.** `Scanner::measureCm()` busy-waits up to
about 30 ms per ping, the longest pause in `loop()`. Instead, record
`micros()` on both edges of the echo in a GPIO interrupt, or let the ESP32's
MCPWM capture unit do it (ESP-IDF v4.4, which this project's Arduino core is
built on, has an
[HC-SR04 capture example](https://github.com/espressif/esp-idf/tree/v4.4.2/examples/peripherals/mcpwm/mcpwm_capture_hc_sr04)).
The loop then only triggers and collects. Keep exactly one ping in flight
across all sonars, at least 60 ms apart for the HC-SR04 (the firmware uses
70 ms; a shorter interval only for sensors rated for it), or they hear each
other's echoes.

**Make telemetry replayable.** Add a sequence number and the rover's clock
(`seq`, `tMs`) to every frame, and send each raw ping (bearing, raw
centimetres, a no-echo flag) as well as the normalised scan. Have the Python
client log every frame to a JSONL file. Autonomy bugs can then be replayed and
studied offline, and everything below has real data to be tuned against.

## Next: small sensors

**An IMU for heading hold.** A CEVA BNO085 breakout
([Adafruit 4754](https://www.adafruit.com/product/4754), about $25-30) in
[UART-RVC mode](https://learn.adafruit.com/adafruit-9-dof-orientation-imu-fusion-breakout-bno085/uart-rvc-for-arduino)
sends fused yaw at 100 Hz as plain serial frames: one wire into `Serial2` RX
on GPIO16, and no I2C driver. With yaw the rover can hold its heading
while it drives or strafes, and turn by a measured angle rather than in timed
steps of unknown size. A cheaper raw 6-axis part (ICM-42688-P, or an
LSM6DS-series chip) works too, but then the drift handling below is yours to
write. Do not rely on a magnetometer indoors next to motors: steel furniture,
floor reinforcement and the motor currents all bend the heading it reports.

**Range sensors behind and at the sides.** The rover reverses and strafes
blind; Explorer only reverses over ground it has just driven forward across
for exactly that reason. Options: [VL53L1X](https://www.st.com/en/imaging-and-photonics-solutions/vl53l1x.html)
time-of-flight sensors (27 degree field of view, up to 4 m, I2C; several on
one bus need new addresses set at boot through their XSHUT pins; poll
`dataReady` so nothing blocks), or more RCWL-1601s on the shared ping
schedule. The unread second HC-SR04 could be remounted facing backward
(section 5 of the bench checklist).

**Optical-flow odometry.** Mecanum rollers slip, especially when strafing, so
wheel rotation says little about where the rover actually went. A downward
optical-flow sensor watches the floor itself. The
[Pimoroni PAA5100JE](https://shop.pimoroni.com/products/paa5100je-optical-tracking-spi-breakout)
works 15 to 35 mm above the floor, which suits this chassis; the better-known
PMW3901 needs at least 80 mm. It is SPI, and the default SPI pins (GPIO18 and
19) are taken by the second sonar, so plan pins with `/pin-audit`.

**Wheel encoders.** TT-format motors with quadrature encoders, such as the
[DFRobot FIT0450](https://wiki.dfrobot.com/Micro_DC_Motor_with_Encoder-SJ01_SKU__FIT0450),
counted by the ESP32's PCNT hardware through the
[ESP32Encoder](https://github.com/madhephaestus/ESP32Encoder) library. Their
main value is per-wheel speed control: a mecanum rover only goes where it is
pointed if all four wheels turn at the commanded speed, and no two TT motors
match. As odometry they suffer from roller slip. Four encoders need eight
input pins, which this board is short of.

**A front guard at bumper height.** The servo sonar sits on the top deck, so
low obstacles pass under its beam. Today Explorer notices only after a second
of pushing without the front echo getting closer, and not at all if there is
no echo ahead to measure against, in which case the 2.5 s cruise limit ends
the push. One fixed VL53L1X low on the front covers that gap.

## Later: map and plan

**A 2-D LiDAR**, such as the LDROBOT LD06 (about $70-100) or the
[SLAMTEC RPLIDAR C1](https://www.slamtec.com/en/c1) (about $80-105): 360
degrees, 12 m, over UART. The ESP32 forwards the scans; Python runs SLAM, for
example [BreezySLAM](https://github.com/simondlevy/BreezySLAM).

**Frontier-based exploration, off-board.** From the map, pick the boundary
between known-free and unknown space, plan a path to it and send waypoints.
The ESP32 still drives reactively underneath and may refuse a waypoint that
its own sensors say is blocked.

## IMU drift, Kalman filters and mapping

A gyro measures turn rate, and heading is its integral, so its errors
accumulate:

- A constant **bias** (a small rate reported while standing still)
  integrates into heading error that grows linearly with time.
- **Noise** integrates into a random walk that grows with the square root of
  time ("angle random walk"). It is smaller, but it never goes away.

Bias is the part worth fighting. Calibrate it at boot by holding still for 2
to 3 seconds and averaging the reading. Then re-estimate it whenever the rover
is stationary, which this firmware already arranges: every move ends at a
deadline and Explorer sweeps standing still. At those moments the true turn
rate is zero, so whatever the gyro reports is bias. These are zero-velocity
updates (ZUPTs).

An extended Kalman filter (EKF) ties it together. Its state is
`[x, y, heading, gyro bias]`. It predicts from the gyro rate and the
velocity from optical flow or encoders, and updates the bias on every ZUPT.
The BNO085 fuses its own yaw and tracks its own bias, but knows nothing about
position.

Be honest about the limit: without an absolute reference, **position error
still grows without bound**. Bias tracking slows heading drift; nothing
on board stops position drift. Only something outside the rover does: LiDAR
scan matching against walls, or recognising the same wall again. IMU plus flow
gives good motion over seconds to a minute; a map that stays consistent needs
the LiDAR.

**Mapping belongs off-board, in Python.** Use a log-odds occupancy grid of
about 5 cm cells, with an inverse sensor model for the sonar: each ping is a
cone of 15 to 30 degrees. Cells inside the cone short of the reading become
more likely free; cells on the arc at the reading become more likely occupied,
spread across the arc because a sonar cannot tell where in its cone the echo
came from. A no-echo reading marks free space only out to about 1 to 1.5 m,
and counts for less, because a wall met at a glancing angle also returns no
echo.

It belongs off-board because the ESP32's heap is small and shared with WiFi,
because a map needs a screen, and because logged runs can be replayed to tune
the sensor model without driving the rover again. The ESP32 keeps the reactive
safety layer either way.

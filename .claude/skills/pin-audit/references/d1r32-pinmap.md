# Wemos D1 R32 (`wemos_d1_uno32`) pin reference

ESP32-WROOM-32 on an Arduino UNO R3 footprint. The silkscreen uses UNO labels;
the firmware uses ESP32 GPIO numbers. These are not the same numbers.

## Header label -> ESP32 GPIO

| UNO label | GPIO | Notes |
|-----------|------|-------|
| D0 / RX   | 3    | UART0 RX — used by the serial monitor |
| D1 / TX   | 1    | UART0 TX — used by the serial monitor |
| D2        | 26   | DAC2 |
| D3        | 25   | DAC1 |
| D4        | 17   | |
| D5        | 16   | |
| D6        | 27   | |
| D7        | 14   | |
| D8        | 12   | **STRAPPING (MTDI)** — see below |
| D9        | 13   | |
| D10 / SS  | 5    | **STRAPPING** |
| D11 / MOSI| 23   | |
| D12 / MISO| 19   | |
| D13 / SCK | 18   | |
| A0        | 2    | **STRAPPING** |
| A1        | 4    | |
| A2        | 35   | **input only** |
| A3        | 34   | **input only** |
| A4        | 36   | **input only** |
| A5        | 39   | **input only** |
| SDA       | 21   | I2C — Adafruit MotorShield V2 |
| SCL       | 22   | I2C — Adafruit MotorShield V2 |

Verify A4/A5 against the actual board silkscreen before relying on them — some
D1 R32 revisions route the I2C pair to the A4/A5 positions.

## Unusable — do not assign

**GPIO 6, 7, 8, 9, 10, 11** are wired to the on-board SPI flash. Using any of
them crashes the chip. They are not broken out on this board, but a literal
pin number in code can still reach them.

## Strapping pins — hazardous

Read at reset to configure boot behaviour. Safe as outputs the firmware drives
*after* boot. Dangerous as inputs, because whatever is wired to them holds a
level during reset.

| GPIO | Function at reset | Failure mode if held wrong |
|------|-------------------|----------------------------|
| 0    | Boot mode select  | Held low -> enters bootloader instead of running firmware |
| 2    | Boot mode select  | Must be low/floating to enter download mode |
| 5    | SDIO timing       | Affects boot timing; usually tolerable |
| 12   | **MTDI / flash voltage** | Held **high** at reset -> VDD_SDIO set to 1.8 V -> flash browns out, board does not boot |
| 15   | MTDO / debug log  | Held low -> suppresses boot log |

GPIO12 is the dangerous one on this board. It is exposed as **D8**, so it looks
like an ordinary digital pin on the silkscreen. An HC-SR04 ECHO line on D8 sits
high whenever the sensor is mid-pulse at the moment of reset, which produces an
intermittent, seemingly random boot failure that reads like a power problem.

## Input-only pins

**GPIO 34, 35, 36, 39** (A3, A2, A4, A5) have no output driver and no internal
pull-up or pull-down.

- Cannot be used for: ultrasonic TRIG, servo signal, motor enable, LEDs.
- Ideal for: ultrasonic ECHO, analog sense lines, anything read-only.

Preferring 34/35 for ECHO lines frees the strapping and SPI pins for outputs.

## Currently claimed in this project

Every assignment lives in `namespace pins` in `src/Pins.h`.

| GPIO | Symbol | Role |
|------|--------|------|
| 21, 22 | (library) | I2C — Adafruit MotorShield V2, on the `Wire` defaults |
| 27 | `pins::SERVO` | Scanner servo signal (output) |
| 14 | `pins::SCAN_TRIG` | Scanner sonar trigger (output) |
| 12 | `pins::SCAN_ECHO` | Scanner sonar echo — **on a strapping pin, see above** |
| 18 | `pins::BOTTOM_TRIG` | Second sonar trigger (output, shares header SCK) |
| 19 | `pins::BOTTOM_ECHO` | Second sonar echo (shares header MISO) |

The second sonar is wired and powered, but where it points is undocumented, so
the firmware does not read it yet. The HCSR04 library still sets both of its
pin modes at construction, so its TRIG line is driven low rather than left
floating.

`pins::MOTOR_TERMINAL` is not a GPIO: it maps each wheel to a Motor Shield
terminal (M1..M4), and all four motors are driven over I2C.

`pins::SCAN_ECHO` on GPIO12 is a known, unfixed boot hazard. GPIO34 (A3) is
the recommended replacement — input-only, no strapping role. It is left as-is
because moving it means moving a wire on the robot, which is the operator's
decision. Flag it, do not change it.

GPIO18/19 double as the header's SCK/MISO. That is fine while nothing uses SPI
— the motor shield is I2C — but it forecloses adding an SPI peripheral later.
GPIO35 (A2) is the natural home for `pins::BOTTOM_ECHO` if SPI is ever needed.

## 5 V tolerance

The ESP32 is **not** 5 V tolerant on any pin. HC-SR04 modules are 5 V parts and
drive ECHO to 5 V. Every ECHO line needs a resistor divider (1 kΩ / 2 kΩ is the
common choice) or a level shifter. TRIG is an output from the ESP32 and is
generally accepted by the HC-SR04 at 3.3 V.

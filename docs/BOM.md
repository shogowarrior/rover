## BOM

What the rover is built from, as far as the photos in [images/](../images/)
and the firmware show. **Source** says where each line comes from; anything
marked *unverified* is a best reading that nobody has confirmed on the robot.

### Mechanical

| Component | Qty | Description | Source |
| --------- | --- | ----------- | ------ |
| Aluminium chassis | 1 | Two-deck plate kit, 255 x 160 x 85 mm, about 482 g, with brass standoffs and screws | photo: `images/mechanical/chassis-size.jpeg`, `build-parts.jpeg` |
| TT gear motor | 4 | Yellow plastic gearbox, rated about 3-6 V | photo: `build-parts.jpeg` |
| Mecanum wheel, 60 mm | 4 | Two A and two B wheels. Diagonally opposite wheels must be the same type or strafing fails | photo: `build-parts.jpeg`; diameter *unverified* |
| Wheel coupler | 4 | TT shaft to wheel hub | photo: `build-parts.jpeg` |
| Micro servo | 1 | SG90-class, turns the scanning sonar on the top deck (GPIO27) | code: `src/Pins.h`; model *unverified* |

### Electronic Components

| Component | Qty | Description | Source |
| --------- | --- | ----------- | ------ |
| Wemos D1 R32 | 1 | ESP32-WROOM-32 on an Arduino UNO footprint (PlatformIO board `wemos_d1_uno32`) | code: `platformio.ini` |
| Adafruit Motor Shield V2 | 1 | PCA9685 PWM plus TB6612 H-bridges, four DC motor channels at 1.2 A each, I2C address 0x60, motors 4.5-13.5 V | code: `src/DriveTrain.cpp`; photo: `images/electronics/motor-shield.png` |
| HC-SR04 ultrasonic sensor | 2 | One on the servo (GPIO14/12). The second (GPIO18/19) is wired but unread; where it points is *unverified* | code: `src/Pins.h` |
| 18650 Li-ion cell | 3 | In series (3S): 11.1 V nominal, 12.6 V full | photo: `images/bms/top.jpeg` |
| 3S BMS with cell holder | 1 | Balancing and protection board: 40 A continuous, 12.6 V charge, 2.5 V per cell cut-off | photo: `images/bms/specs.jpeg` |
| Echo level shifting | 2 | A divider or level shifter channel per HC-SR04 ECHO line (5 V to 3.3 V). Needed; whether it is fitted is *unverified* | photo: `images/electronics/level shifter/` |

The TT motors are rated for about half the pack voltage. At full PWM they see
roughly twice their rating; see `MOTOR_SPEED_LIMIT` in
[src/Tuning.h](../src/Tuning.h) and the [roadmap](ROADMAP.md).

### Bench and test equipment

Parts marked *TEST* are for trying things out on the bench, not part of the
rover.

| Component | Qty | Description |
| --------- | --- | ----------- |
| Arduino UNO | 1 | *TEST*: drives the Motor Shield on its own, away from the ESP32 |
| 12 V DC PSU | 1 | *TEST*: bench supply in place of the battery pack; a current-limited one is kinder to a stalled motor |
| Stand or box | 1 | *TEST*: holds the rover with all four wheels off the ground ([bench-checklist.md](bench-checklist.md)) |

### Photographed, not used by the current firmware

| Component | Qty | Description |
| --------- | --- | ----------- |
| PCA9685 16-channel PWM board | 1 | `images/electronics/PCA965/`. The Motor Shield already contains a PCA9685 |
| TB6612FNG driver breakout | 2 | The older direct-wired design in [extra.md](extra.md), superseded by the Motor Shield |

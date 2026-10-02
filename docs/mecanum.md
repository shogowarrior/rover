# Mecanum movements

Which way each wheel turns for every move code the rover accepts.

**[`src/MovePatterns.cpp`](../src/MovePatterns.cpp) is authoritative.** This
page is a readable copy of its table. If the two ever disagree, the code is
what runs and this page is wrong. The code lists its columns as front-left,
front-right, **rear-right, rear-left**; this page puts the rear wheels in
left-right order, so copy between them with care.

**The reference is [DroneBot Workshop's mecanum
article](https://dronebotworkshop.com/mecanum/).** Every row matches its
constants, and `test/test_move_patterns` decodes them byte by byte, so a row
cannot drift from it unnoticed. The four-wheel moves and the diagonals were
transcribed from the per-move methods the table replaced, which agree with
it; the pivots come from DroneBot, because those methods had them wrong (see
[below](#four-wheel-and-two-wheel-moves)).

**None of this is bench-verified yet.** [bench-checklist.md](bench-checklist.md)
says how to check it, with the wheels off the ground and then on the floor.

The tables that used to be on this page contradicted the code and each other:
the four-wheel table gave "Right" and "Rotate C" identical wheel directions
(front pair forward, rear pair backward, which on mecanum wheels only fights
itself), and two of its "Pivot Side" rows drove three wheels. They are gone.

## The table

Forward and Backward are the direction a wheel turns (the way that would roll
the rover forward or backward). Free means the motor is released and the wheel
coasts.

| Code | Name | Intended motion | Front left | Front right | Rear left | Rear right |
|---:|---|---|---|---|---|---|
| 0 | `STOP` | Stop | Free | Free | Free | Free |
| 1 | `MOVE_FORWARD` | Forward | Forward | Forward | Forward | Forward |
| 2 | `MOVE_BACKWARD` | Backward | Backward | Backward | Backward | Backward |
| 3 | `MOVE_RIGHT` | Strafe right | Forward | Backward | Backward | Forward |
| 4 | `MOVE_LEFT` | Strafe left | Backward | Forward | Forward | Backward |
| 5 | `MOVE_DIAGONAL45` | Diagonal, forward-right | Forward | Free | Free | Forward |
| 6 | `MOVE_DIAGONAL135` | Diagonal, forward-left | Free | Forward | Forward | Free |
| 7 | `MOVE_DIAGONAL225` | Diagonal, backward-left | Backward | Free | Free | Backward |
| 8 | `MOVE_DIAGONAL315` | Diagonal, backward-right | Free | Backward | Backward | Free |
| 9 | `PIVOT_RIGHT_FORWARD` | Forward about the right wheels, nose turning right | Forward | Free | Forward | Free |
| 10 | `PIVOT_RIGHT_BACKWARD` | Backward about the right wheels, nose turning left | Backward | Free | Backward | Free |
| 11 | `PIVOT_LEFT_FORWARD` | Forward about the left wheels, nose turning left | Free | Forward | Free | Forward |
| 12 | `PIVOT_LEFT_BACKWARD` | Backward about the left wheels, nose turning right | Free | Backward | Free | Backward |
| 13 | `PIVOT_SIDEWAYS_FORWARD_RIGHT` | Front swings right about the rear axle | Forward | Backward | Free | Free |
| 14 | `PIVOT_SIDEWAYS_FORWARD_LEFT` | Front swings left about the rear axle | Backward | Forward | Free | Free |
| 15 | `PIVOT_SIDEWAYS_BACKWARD_RIGHT` | Rear swings right about the front axle | Free | Free | Backward | Forward |
| 16 | `PIVOT_SIDEWAYS_BACKWARD_LEFT` | Rear swings left about the front axle | Free | Free | Forward | Backward |
| 17 | `ROTATE_CLOCKWISE` | Rotate right on the spot | Forward | Backward | Forward | Backward |
| 18 | `ROTATE_COUNTERCLOCKWISE` | Rotate left on the spot | Backward | Forward | Backward | Forward |

Code 19, `RESUME_AUTONOMOUS`, is not a motion: it hands control back to
autonomous exploration (or restarts exploration that has halted) and has no
row.

The diagonal codes are named by the stick angle that produces them, measured
counter-clockwise from "right" (the panel and the gamepad map the stick the
same way): 45 is forward-right, 135 forward-left, 225 backward-left, 315
backward-right.

## Four-wheel and two-wheel moves

The **four-wheel moves** (codes 1 to 4, 17 and 18) drive every wheel. Forward
and backward turn all four the same way; strafing turns each diagonal pair
(front-left with rear-right, front-right with rear-left) opposite to the
other; rotating turns the left side opposite to the right. These only work if
the A and B wheels are fitted in the right places, which the bench checklist
also covers.

The **two-wheel moves** (codes 5 to 16) drive one pair and let the other two
coast. The diagonals drive one diagonal pair the same way, which on mecanum
wheels moves the rover at 45 degrees without turning it.

Each pivot is half of a four-wheel move: one pair turns exactly as in that
move, and the rover swings about the pair that coasts.

- **Pivots (9 to 12)** drive one side as `MOVE_FORWARD` or `MOVE_BACKWARD`
  would. The name gives the side the rover pivots about and the way it
  travels: `PIVOT_RIGHT_FORWARD` drives the left pair forward, so the rover
  moves forward with its nose turning right, about its right wheels.
- **Sideways pivots (13 to 16)** drive one axle as `MOVE_RIGHT` or
  `MOVE_LEFT` would. `FORWARD` swings the front and `BACKWARD` the rear
  (DroneBot's `FRONT` and `REAR`), toward the side named:
  `PIVOT_SIDEWAYS_BACKWARD_RIGHT` strafes the rear axle right, about the
  front one.

The per-move methods the table replaced had the pivots wrong. Every
`PIVOT_*_FORWARD` code drove a pair backward and every `PIVOT_*_BACKWARD`
code forward, using the pair the rover should pivot about: code 9 turned the
nose right as it should, but moved the rover backward, where nothing
watches. So under ADVANCED a stick pushed forward with L1 held backed the
rover up, and one pulled back drove it forward. Code 14 drove the rear axle,
and codes 15 and 16 a diagonal pair in opposite directions, which gives no
net push, only a turning couple: they spun the rover on the spot instead of
swinging it. The rows now follow DroneBot's constants, and
`test_move_patterns` checks both the constants and each pivot's direction
against its name.

How far a pivot really swings depends on how freely a released TT gearbox
coasts, which only the bench can show. Autonomous exploration and the
keyboard client never send codes 9 to 16, and neither do the panel and the
gamepad under the NORMAL control scheme. Run the pivot step in
[bench-checklist.md](bench-checklist.md) (section 2) before switching to
ADVANCED (below).

## Control schemes

The rover holds one control scheme for every controller, so the gamepad and
the panel always drive the same way. It starts as `DEFAULT_CONTROL_SCHEME` in
[`src/Features.h`](../src/Features.h); the gamepad's SELECT button and the
panel's toggle change it until the next reset, and telemetry reports it as
`scheme`.

| | NORMAL | ADVANCED |
|---|---|---|
| Stick | Eight-way translation (codes 1 to 8) | The same, unless a family is picked |
| Rotate | L2 / R2, the panel's rotate buttons (17, 18) | The same |
| Pivot (9 to 12) | -- | Hold L1, or pick Pivot on the panel |
| Pivot sideways (13 to 16) | -- | Hold R1, or pick Pivot sideways on the panel |
| Gamepad LEDs | Player 1 | Player 2 |

A scheme change never redirects a held stick: whatever a controller was
driving stops, and it drives again only from a fresh push. The scheme is
shared, so otherwise a toggle on one controller would turn the diagonal
under another operator's thumb into a pivot.

In a pivot family the stick's quadrant picks the move by its name: up and
right is `PIVOT_RIGHT_FORWARD` (or `PIVOT_SIDEWAYS_FORWARD_RIGHT`), down and
left `PIVOT_LEFT_BACKWARD` (`PIVOT_SIDEWAYS_BACKWARD_LEFT`), and a push
exactly along an axis counts as right and forward. So in the pivot family
(L1, or Pivot on the panel) up drives forward and down backward, about the
side pushed; in the sideways family (R1, or Pivot sideways) up swings the
front and down the rear, toward the side pushed. If the bench shows a row's
wheels do not match its name, fix the row in `MovePatterns.cpp`, with its
test, and the stick follows. `kinematics::moveForStick` does the mapping for
the gamepad, the panel carries a copy, and both are tested against
[`test/vectors/stick_moves.json`](../test/vectors/stick_moves.json).

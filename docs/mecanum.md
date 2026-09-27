# Mecanum movements

Which way each wheel turns for every move code the rover accepts.

**[`src/MovePatterns.cpp`](../src/MovePatterns.cpp) is authoritative.** This
page is a readable copy of its table. If the two ever disagree, the code is
what runs and this page is wrong. The code lists its columns as front-left,
front-right, **rear-right, rear-left**; this page puts the rear wheels in
left-right order, so copy between them with care.

**None of this is bench-verified yet.** The rows were transcribed from the
per-move methods the table replaced. [bench-checklist.md](bench-checklist.md)
says how to check them with the wheels off the ground.

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
| 9 | `PIVOT_RIGHT_FORWARD` | Pivot right | Free | Backward | Free | Backward |
| 10 | `PIVOT_RIGHT_BACKWARD` | Pivot right | Free | Forward | Free | Forward |
| 11 | `PIVOT_LEFT_FORWARD` | Pivot left | Backward | Free | Backward | Free |
| 12 | `PIVOT_LEFT_BACKWARD` | Pivot left | Forward | Free | Forward | Free |
| 13 | `PIVOT_SIDEWAYS_FORWARD_RIGHT` | Swing sideways | Forward | Backward | Free | Free |
| 14 | `PIVOT_SIDEWAYS_FORWARD_LEFT` | Swing sideways | Free | Free | Forward | Backward |
| 15 | `PIVOT_SIDEWAYS_BACKWARD_RIGHT` | Swing sideways | Free | Forward | Backward | Free |
| 16 | `PIVOT_SIDEWAYS_BACKWARD_LEFT` | Swing sideways | Forward | Free | Free | Backward |
| 17 | `ROTATE_CLOCKWISE` | Rotate right on the spot | Forward | Backward | Forward | Backward |
| 18 | `ROTATE_COUNTERCLOCKWISE` | Rotate left on the spot | Backward | Forward | Backward | Forward |

Code 19, `RESUME_AUTONOMOUS`, is not a motion: it hands control back to
autonomous exploration and has no row.

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
wheels moves the rover at 45 degrees without turning it. The pivots drive one
side (9 to 12), one axle (13 and 14) or one diagonal pair (15 and 16).

What a pivot actually does depends on how freely a released TT gearbox
coasts, so treat the names of codes 9 to 16 as intent, not fact. Two rows in
particular need a look on the bench:

- The `PIVOT_*_FORWARD` codes turn their wheels backward, and the
  `PIVOT_*_BACKWARD` codes forward. Code 9 drives the right-hand pair
  backward; the old table drove the left-hand pair forward instead. Both turn
  the nose right, but the old version moves the rover forward and the code's
  version moves it backward.
- Codes 15 and 16 drive a diagonal pair in opposite directions. With the
  wheels in the pattern that makes code 3 strafe right, that produces no net
  push, only a turning couple, so the rover should spin rather than swing
  sideways as 13 and 14 do.

The panel, the keyboard client, the gamepad and autonomous exploration never
send codes 9 to 16, so these rows only matter to a client that asks for them.

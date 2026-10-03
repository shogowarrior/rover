Make the rover (github.com/shogowarrior/rover) a four-wheel mecanum robot that is safe and fun to drive and can explore a room on its own. Keep its code (firmware in src/, the browser panel in extras/joystick/, the Python clients in client/) clean, modular and easy to read, and keep improving it without breaking a feature or regressing behaviour.

What the rover is for:
- Driving it every way it can move, all 18 moves (translate, rotate, pivot), from the PS3 pad and the browser panel, which share one stick mapping and behave alike; the terminal client covers the basic moves. Normal keeps the simple moves; Advanced adds the pivots.
- Exploring on its own: it sweeps its sonar, picks the open way, and never drives into something it can see or moves on a sensor that hears nothing.
- Writing block programs in the panel, previewed on the simulator before they run on the robot.
- Safety first, always: Stop is one press from every controller, every way of losing control stops the wheels, and no change weakens a failsafe in AGENTS.md.
- Working and tested without the robot: the core logic is tested on a computer and the panel against a fake page and the simulator. Nothing counts as working on the robot until it passes the bench checklist (docs/bench-checklist.md).
- Later, not now: the sensors and mapping in docs/ROADMAP.md (an IMU for heading hold, more sonars, Kalman filtering).

Standing goals, for every change:
- "Most important is code hygiene, modularity and easy to read. Review to improve, not break features and regressions, and make it better."
- Neat, clean object-oriented design. Highly modular, with reuse: modular functions and good templates shared by production and tests, everywhere they apply.
- Clean and efficient code: nothing redundant, no dead code, no unnecessary bloat, no AI slop.
- Never delete a feature. Work on a branch.
- When a piece of work is done: review it thoroughly and judge it against the design, code quality, modularity and reuse. Run adversarial reviews for defects, bugs, redundant and dead code, bloat and AI slop, and /code-review in rounds, fixing everything a round finds before the next, until a round raises no flags. Ask the owner to run /verify. Then commit, merge and push.

What to work on now, and in what order, is in docs/project/handoff.md. Read it first, and keep it current.

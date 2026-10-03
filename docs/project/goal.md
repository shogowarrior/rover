Keep the rover's code (firmware in src/, the browser panel in extras/joystick/, the Python clients in client/) clean, modular and easy to read, and keep improving it without breaking a feature or regressing behaviour.

Standing goals, for every change:
- "Most important is code hygiene, modularity and easy to read. Review to improve, not break features and regressions, and make it better."
- Neat, clean object-oriented design. Highly modular, with reuse: modular functions and good templates shared by production and tests, everywhere they apply.
- Clean and efficient code: nothing redundant, no dead code, no unnecessary bloat, no AI slop.
- Never delete a feature. Work on a branch.
- When a piece of work is done: review it thoroughly and judge it against the design, code quality, modularity and reuse. Run adversarial reviews for defects, bugs, redundant and dead code, bloat and AI slop, and /code-review in rounds, fixing everything a round finds before the next, until a round raises no flags. Ask the owner to run /verify. Then commit, merge and push.

What to work on now, and in what order, is in docs/project/handoff.md. Read it first, and keep it current.

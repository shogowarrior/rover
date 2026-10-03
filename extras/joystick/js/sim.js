/**
 * The simulator: a preview of what a block program would make the rover do,
 * worked out here and drawn by SimView, with nothing sent to the rover.
 *
 *   RoverSim    the chassis: its pose, the command it is carrying out, and
 *               how the four wheels move it
 *   Room        walls and boxes, and where a sonar ping meets them
 *   SimSonar    the servo sweep the firmware runs in manual mode, and what
 *               each bearing last read
 *   SimClock    simulated time, and timers on it
 *   SimTarget   the program runner's Target over all four (see below)
 *
 * It is a preview, not a promise. The wheels follow ideal mecanum kinematics
 * with no slip, inertia or motor lag; the sonar is one ray per ping; contact
 * stops the chassis dead. The numbers that describe this particular rover are
 * estimates, kept together under "calibration" with how to measure each.
 *
 * Frames. The world is in metres, x to the right of the screen and y up it,
 * with headings in radians counter-clockwise from +x. The rover's own frame
 * has x out of its nose and y out of its left side, so a twist (vx, vy, w) is
 * forward speed, leftward speed and counter-clockwise turn rate: MOVE_RIGHT
 * has vy < 0 and ROTATE_CLOCKWISE w < 0.
 *
 * Nothing here touches the DOM, the Link or the Driver: this file also loads
 * in Node, for test/sim.test.js.
 */

// In the page, support.js, protocol.js and mecanum.js have already declared
// what this file reads, and classic scripts share one scope. In Node they are
// loaded onto the global object first, as mecanum.js loads protocol.js.
if (typeof module !== "undefined") {
  if (typeof Listeners === "undefined") Object.assign(globalThis, require("./support.js"));
  if (typeof MOVE_FORWARD === "undefined") Object.assign(globalThis, require("./protocol.js"));
  if (typeof motionFor === "undefined") Object.assign(globalThis, require("./mecanum.js"));
}

/* --- calibration ---------------------------------------------------------- */

// Every number in this block describes the physical rover and is an estimate
// until the bench measures it. Each says how.

// Wheel surface speed at SPEED_MAX, m/s. A TT gear motor is rated about
// 200 rpm at 6 V, which on a 60 mm wheel is 0.63 m/s. At full duty the shield
// gives it about twice that voltage from the 3S pack (docs/BOM.md), but the
// 0.5 kg chassis loads it and mecanum rollers slip, so this takes the rated
// figure rather than double it. To measure: time MOVE_FORWARD at speed 128
// over 1 m of floor, t seconds; then this is (1 / t) x (SPEED_MAX -
// SIM_DEADBAND_PWM) / (128 - SIM_DEADBAND_PWM), which is 2 / t with no
// deadband.
const SIM_WHEEL_MAX_MPS = 0.6;

// The duty below which the wheels do not turn at all. To measure: raise the
// speed of MOVE_FORWARD from 0 in steps of 8 with the wheels on the floor, and
// note the first that moves the rover. 0 means speed maps to wheel speed
// linearly from 0.
const SIM_DEADBAND_PWM = 0;

// How hard a released (FREE) wheel resists turning, 0 to 1. A TT gearbox
// neither spins freely nor locks when the shield lets it go. 0 lets it turn
// as the motion needs; 1 holds it as firmly as a driven wheel holds its
// speed. To judge it: with the motors released, push the rover along the
// floor by hand, and compare the effort with pushing it while the wheels are
// lifted. (No row of today's wheel table needs a released wheel to turn, so
// for now it changes nothing; see RoverSim.twistForWheels.)
const SIM_RELEASED_DRAG = 0.25;

// The chassis plate (docs/BOM.md: 255 x 160 mm, the kit's own figure), which
// is also the footprint the simulator keeps out of walls, and the wheels set
// in its corners. Where the wheels sit is a guess: the kit's photo
// (images/mechanical/chassis-size.jpeg) shows them under the plate, inboard
// of its ends. So is the sensor's place, at the middle of the front edge.
// Measure the axle-to-axle and wheel-to-wheel distances on the rover.
const SIM_CHASSIS = Object.freeze({ lengthM: 0.255, widthM: 0.160 });
const SIM_WHEEL = Object.freeze({
  diameterM: 0.060, // docs/BOM.md, unverified
  widthM: 0.026,
  halfBaseM: 0.0925, // front axle to the centre: 255 / 2 - 30 - 5 mm
  halfTrackM: 0.067, // wheel centre to the centre line: 160 / 2 - 26 / 2 mm
});

// The HC-SR04, from its datasheet: no echo comes back from beyond about 4 m,
// nor from a surface met more than about 60 degrees off its normal (the sound
// glances off it). Either reads as no echo, FAR_CM.
const SIM_SONAR = Object.freeze({ rangeCm: 400, maxIncidenceDeg: 60 });

/* --- the chassis ---------------------------------------------------------- */

class RoverSim {
  // The firmware's wheel table: PATTERNS in src/MovePatterns.cpp, copied row
  // for row and in its column order -- front-left, front-right, REAR-RIGHT,
  // rear-left. FWD and BACK are the way a wheel turns; FREE is released.
  // test/sim.test.js reads that file and fails if a row here drifts from it.
  static WHEELS = (() => {
    const FWD = 1;
    const BACK = -1;
    const FREE = 0;
    return Object.freeze({
      [STOP]: [FREE, FREE, FREE, FREE],
      [MOVE_FORWARD]: [FWD, FWD, FWD, FWD],
      [MOVE_BACKWARD]: [BACK, BACK, BACK, BACK],
      [MOVE_RIGHT]: [FWD, BACK, FWD, BACK],
      [MOVE_LEFT]: [BACK, FWD, BACK, FWD],
      [MOVE_DIAGONAL45]: [FWD, FREE, FWD, FREE],
      [MOVE_DIAGONAL135]: [FREE, FWD, FREE, FWD],
      [MOVE_DIAGONAL225]: [BACK, FREE, BACK, FREE],
      [MOVE_DIAGONAL315]: [FREE, BACK, FREE, BACK],
      [PIVOT_RIGHT_FORWARD]: [FWD, FREE, FREE, FWD],
      [PIVOT_RIGHT_BACKWARD]: [BACK, FREE, FREE, BACK],
      [PIVOT_LEFT_FORWARD]: [FREE, FWD, FWD, FREE],
      [PIVOT_LEFT_BACKWARD]: [FREE, BACK, BACK, FREE],
      [PIVOT_SIDEWAYS_FORWARD_RIGHT]: [FWD, BACK, FREE, FREE],
      [PIVOT_SIDEWAYS_FORWARD_LEFT]: [BACK, FWD, FREE, FREE],
      [PIVOT_SIDEWAYS_BACKWARD_RIGHT]: [FREE, FREE, FWD, BACK],
      [PIVOT_SIDEWAYS_BACKWARD_LEFT]: [FREE, FREE, BACK, FWD],
      [ROTATE_CLOCKWISE]: [FWD, BACK, BACK, FWD],
      [ROTATE_COUNTERCLOCKWISE]: [BACK, FWD, FWD, BACK],
    });
  })();

  // Standard X-configuration mecanum inverse kinematics, in the table's
  // column order. Row i gives wheel i's surface speed from (vx, vy, k*w), where
  // k is half the wheelbase plus half the track:
  //   FL = vx - vy - k*w    FR = vx + vy + k*w
  //   RR = vx - vy + k*w    RL = vx + vy - k*w
  // It is the arrangement in which the table's MOVE_RIGHT strafes right and
  // ROTATE_CLOCKWISE turns clockwise, as docs/mecanum.md says they do.
  static ROWS = Object.freeze([[1, -1, -1], [1, 1, 1], [1, -1, 1], [1, 1, -1]].map(Object.freeze));
  static K = SIM_WHEEL.halfBaseM + SIM_WHEEL.halfTrackM;

  // Where each wheel sits in the rover frame, in the same order.
  static WHEEL_AT = Object.freeze([[1, 1], [1, -1], [-1, -1], [-1, 1]].map(([x, y]) =>
    Object.freeze({ x: x * SIM_WHEEL.halfBaseM, y: y * SIM_WHEEL.halfTrackM })));

  // The sonar, at the middle of the chassis' front edge.
  static SENSOR_AT = Object.freeze({ x: SIM_CHASSIS.lengthM / 2, y: 0 });

  // The most speed a command gets: Rover::drive() clamps every command to
  // tuning::MOTOR_SPEED_LIMIT (protocol.js), and so does the preview. Once the
  // operator lowers the limit, as the README advises, a preview at the raw
  // speed drove half as far again as the rover would. A static, so that the
  // tests can try a lower limit than today's.
  static SPEED_LIMIT = MOTOR_SPEED_LIMIT;

  // So small that with no drag the solution is the driven wheels' own
  // minimum-norm one, and the solve never meets a singular matrix.
  static #TIKHONOV = 1e-9;

  // The twist one unit of wheel surface speed gives a move, as {vx, vy, w}
  // per m/s (w in rad/s), or all zero for STOP and anything that is not a
  // motion.
  static unitTwist(move, releasedDrag = SIM_RELEASED_DRAG) {
    if (!motionFor(move)) return { vx: 0, vy: 0, w: 0 };
    return RoverSim.twistForWheels(RoverSim.WHEELS[move], releasedDrag);
  }

  // The same for any four wheel directions, in the table's column order.
  //
  // Each driven wheel is a constraint "this wheel's speed is +-1", with weight
  // 1; each released wheel is a constraint "this wheel's speed is 0", with
  // weight releasedDrag (on its squared error). The weighted least-squares
  // solution for (vx, vy, k*w) is the motion that best satisfies them all.
  // With releasedDrag 0 the released wheels are ignored, and the motion is the
  // smallest that turns the driven wheels as commanded.
  //
  // Every two-wheel row in the firmware's table turns out to need no turn at
  // all from its released wheels, so for those rows releasedDrag changes
  // nothing. It matters for a row that would make a released wheel turn: one
  // driving a diagonal pair against itself, as code 15 once did, only spins
  // the rover, and drag slows that spin.
  static twistForWheels(wheels, releasedDrag = SIM_RELEASED_DRAG) {
    const drag = Math.min(1, Math.max(0, releasedDrag));
    // Normal equations: (sum weight * r r^T + tiny I) u = sum weight * s * r.
    const m = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    const b = [0, 0, 0];
    wheels.forEach((direction, i) => {
      const weight = direction === 0 ? drag : 1;
      const r = RoverSim.ROWS[i];
      for (let row = 0; row < 3; row++) {
        b[row] += weight * direction * r[row];
        for (let col = 0; col < 3; col++) m[row][col] += weight * r[row] * r[col];
      }
    });
    for (let d = 0; d < 3; d++) m[d][d] += RoverSim.#TIKHONOV;
    const [vx, vy, kw] = RoverSim.#solve3(m, b);
    return { vx: RoverSim.#clean(vx), vy: RoverSim.#clean(vy), w: RoverSim.#clean(kw / RoverSim.K) };
  }

  // Wheel surface speed, m/s, for a speed byte.
  static wheelMps(speed) {
    const usable = SPEED_MAX - SIM_DEADBAND_PWM;
    return (SIM_WHEEL_MAX_MPS * Math.max(0, Math.min(SPEED_MAX, speed) - SIM_DEADBAND_PWM)) / usable;
  }

  // The chassis' corners in the world, for a pose: front-left, front-right,
  // rear-right, rear-left.
  static footprint(pose) {
    const hl = SIM_CHASSIS.lengthM / 2;
    const hw = SIM_CHASSIS.widthM / 2;
    return [[hl, hw], [hl, -hw], [-hl, -hw], [-hl, hw]].map(([x, y]) => RoverSim.toWorld(pose, { x, y }));
  }

  // A point in the rover's frame, in the world.
  static toWorld(pose, { x, y }) {
    const c = Math.cos(pose.heading);
    const s = Math.sin(pose.heading);
    return { x: pose.x + c * x - s * y, y: pose.y + s * x + c * y };
  }

  // The pose after holding a twist for `seconds`, integrated exactly (the
  // twist is constant over a step, so the path is an arc or a line).
  static advance(pose, { vx, vy, w }, seconds) {
    const turn = w * seconds;
    let dx;
    let dy;
    if (Math.abs(turn) < 1e-12) {
      dx = vx * seconds;
      dy = vy * seconds;
    } else {
      const sin = Math.sin(turn);
      const cos = Math.cos(turn);
      dx = (vx * sin + vy * (cos - 1)) / w;
      dy = (vx * (1 - cos) + vy * sin) / w;
    }
    const moved = RoverSim.toWorld(pose, { x: dx, y: dy });
    return { x: moved.x, y: moved.y, heading: RoverSim.#wrap(pose.heading + turn) };
  }

  #pose;
  #releasedDrag;
  #move = STOP;
  #speed = 0;
  #remainingMs = 0;
  #stalled = false; // against something since the command began
  #twist = { vx: 0, vy: 0, w: 0 }; // of the command, at its speed

  constructor({ pose = { x: 0, y: 0, heading: 0 }, releasedDrag = SIM_RELEASED_DRAG } = {}) {
    this.#pose = { ...pose };
    this.#releasedDrag = releasedDrag;
  }

  get pose() {
    return { ...this.#pose };
  }

  set pose(pose) {
    this.#pose = { x: pose.x, y: pose.y, heading: RoverSim.#wrap(pose.heading) };
  }

  get releasedDrag() {
    return this.#releasedDrag;
  }

  set releasedDrag(drag) {
    this.#releasedDrag = Math.min(1, Math.max(0, Number(drag) || 0));
    this.#twist = this.#twistOf(this.#move, this.#speed);
  }

  // What the firmware's telemetry would say: the move while one is running,
  // STOP once it has ended.
  get move() {
    return this.#move;
  }

  get speed() {
    return this.#speed;
  }

  get moving() {
    return this.#move !== STOP;
  }

  // Up against an obstacle: the wheels are driven and the chassis does not
  // move. The firmware cannot tell; it still reports the move.
  get stalled() {
    return this.#stalled;
  }

  // The motion the chassis is making now, {vx, vy, w} in m/s and rad/s.
  get twist() {
    return this.moving && !this.#stalled ? { ...this.#twist } : { vx: 0, vy: 0, w: 0 };
  }

  // Each wheel's direction now, in the table's order: +1, -1 or 0 (FREE).
  get wheels() {
    return [...RoverSim.WHEELS[this.#move]];
  }

  // Rover::drive(): a command runs for its duration and then the wheels are
  // released, unless another arrives first. Its speed is clamped to
  // SPEED_LIMIT. STOP, a speed of 0, a duration of 0 or a code that is not a
  // motion releases them now. A repeat of the command already running only
  // extends it; anything else starts afresh, away from whatever it was
  // stalled against.
  command(move, speed, durationMs) {
    const clamped = Math.min(RoverSim.SPEED_LIMIT, SPEED_MAX, Math.max(0, Math.round(Number(speed) || 0)));
    if (!motionFor(move) || clamped === 0 || !(durationMs > 0)) {
      this.release();
      return;
    }
    if (move !== this.#move || clamped !== this.#speed) this.#stalled = false;
    this.#move = move;
    this.#speed = clamped;
    this.#twist = this.#twistOf(move, clamped);
    this.#remainingMs = durationMs;
  }

  release() {
    this.#move = STOP;
    this.#speed = 0;
    this.#remainingMs = 0;
    this.#stalled = false;
    this.#twist = { vx: 0, vy: 0, w: 0 };
  }

  // Advance by dtMs. The chassis moves only until its command runs out, and
  // never into an obstacle: on contact it stops where it touched and stays
  // stalled there until a different command. Returns {obstacle, at} for a new
  // contact, or null.
  step(dtMs, room) {
    if (!this.moving) return null;
    const ms = Math.min(dtMs, this.#remainingMs);
    let bump = null;
    if (!this.#stalled && ms > 0) {
      const twist = this.#twist;
      const pose = this.#pose;
      const after = (fraction) => RoverSim.advance(pose, twist, (fraction * ms) / 1000);
      const blocked = room.blocks(RoverSim.footprint(after(1)));
      if (!blocked) {
        this.#pose = after(1);
      } else {
        // Find the moment of contact: the last fraction of the step that is
        // still clear, to a 256th of it.
        let clear = 0;
        let hit = 1;
        for (let i = 0; i < 8; i++) {
          const mid = (clear + hit) / 2;
          if (room.blocks(RoverSim.footprint(after(mid)))) hit = mid;
          else clear = mid;
        }
        this.#pose = after(clear);
        this.#stalled = true;
        const touching = after(hit);
        const obstacle = room.blocks(RoverSim.footprint(touching)) || blocked;
        bump = { obstacle: obstacle.name, at: room.contactPoint(RoverSim.footprint(touching), obstacle) };
      }
    }
    this.#remainingMs -= dtMs;
    if (this.#remainingMs <= 0) this.release();
    return bump;
  }

  #twistOf(move, speed) {
    const unit = RoverSim.unitTwist(move, this.#releasedDrag);
    const mps = RoverSim.wheelMps(speed);
    return { vx: unit.vx * mps, vy: unit.vy * mps, w: unit.w * mps };
  }

  // Gaussian elimination with partial pivoting, for the 3x3 normal equations.
  static #solve3(m, b) {
    const a = m.map((row, i) => [...row, b[i]]);
    for (let col = 0; col < 3; col++) {
      let pivot = col;
      for (let row = col + 1; row < 3; row++) if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
      [a[col], a[pivot]] = [a[pivot], a[col]];
      for (let row = col + 1; row < 3; row++) {
        const f = a[row][col] / a[col][col];
        for (let k = col; k < 4; k++) a[row][k] -= f * a[col][k];
      }
    }
    const u = [0, 0, 0];
    for (let row = 2; row >= 0; row--) {
      let sum = a[row][3];
      for (let k = row + 1; k < 3; k++) sum -= a[row][k] * u[k];
      u[row] = sum / a[row][row];
    }
    return u;
  }

  // The regularisation leaves a few parts in a billion behind; round them off
  // so that a zero reads as zero.
  static #clean(value) {
    const rounded = Math.round(value * 1e6) / 1e6;
    return rounded === 0 ? 0 : rounded;
  }

  static #wrap(angle) {
    return Math.atan2(Math.sin(angle), Math.cos(angle));
  }
}

/* --- the room ------------------------------------------------------------- */

// Walls and boxes, in metres from the room's lower-left corner. Every
// obstacle is a chain of segments: a wall is one, a box is a closed loop of
// four. Each has a name for "bumped into ...", with its article.
class Room {
  // The rooms the view offers, by key. Each is a function so that every
  // preview gets a fresh Room.
  static PRESETS = Object.freeze({
    living: Object.freeze({ label: "Living room", build: () => Room.#livingRoom() }),
    corridor: Object.freeze({ label: "Corridor", build: () => Room.#corridor() }),
    box: Object.freeze({ label: "Box", build: () => Room.#box() }),
    course: Object.freeze({ label: "Obstacle course", build: () => Room.#course() }),
  });

  static preset(key) {
    const preset = Room.PRESETS[key];
    if (!preset) throw new RangeError(`No room called ${key}`);
    return preset.build();
  }

  // A box as an obstacle: centre, size and an optional turn in degrees;
  // extra may give it a label to draw on it.
  static box(name, { x, y, w, h, deg = 0 }, extra = {}) {
    const c = Math.cos((deg * Math.PI) / 180);
    const s = Math.sin((deg * Math.PI) / 180);
    const points = [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]]
      .map(([px, py]) => ({ x: x + c * px - s * py, y: y + s * px + c * py }));
    return Object.freeze({ name, points, closed: true, ...extra });
  }

  static wall(name, from, to) {
    return Object.freeze({ name, points: [from, to], closed: false });
  }

  // Drawn but not an obstacle: a table top the rover passes under.
  static outline(name, { x, y, w, h }) {
    return Object.freeze({ name, x, y, w, h });
  }

  #name;
  #width;
  #height;
  #obstacles;
  #outlines;
  #start;

  constructor({ name, width, height, obstacles = [], outlines = [], start }) {
    this.#name = name;
    this.#width = width;
    this.#height = height;
    const corners = [{ x: 0, y: 0 }, { x: width, y: 0 }, { x: width, y: height }, { x: 0, y: height }];
    const perimeter = corners.map((from, i) => Room.wall("the wall", from, corners[(i + 1) % 4]));
    this.#obstacles = Object.freeze([...perimeter, ...obstacles]);
    this.#outlines = Object.freeze([...outlines]);
    this.#start = Object.freeze({ ...start });
  }

  get name() {
    return this.#name;
  }

  get width() {
    return this.#width;
  }

  get height() {
    return this.#height;
  }

  get obstacles() {
    return this.#obstacles;
  }

  get outlines() {
    return this.#outlines;
  }

  get start() {
    return { ...this.#start };
  }

  // Where a ray from `origin` at `angle` (radians, world frame) first meets a
  // surface: {distance (m), incidence (radians off the surface's normal, 0
  // to pi/2), obstacle, point}, or null if it meets none.
  rayCast(origin, angle) {
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    let best = null;
    for (const obstacle of this.#obstacles) {
      for (const [p, q] of Room.#segments(obstacle)) {
        const ex = q.x - p.x;
        const ey = q.y - p.y;
        const denom = dx * ey - dy * ex;
        if (Math.abs(denom) < 1e-12) continue; // parallel: it cannot be met
        const t = ((p.x - origin.x) * ey - (p.y - origin.y) * ex) / denom;
        const u = ((p.x - origin.x) * dy - (p.y - origin.y) * dx) / denom;
        if (t <= 1e-9 || u < 0 || u > 1 || (best && t >= best.distance)) continue;
        const length = Math.hypot(ex, ey);
        const cosine = Math.abs(dx * -ey + dy * ex) / length; // ray against the normal
        best = {
          distance: t,
          incidence: Math.acos(Math.min(1, cosine)),
          obstacle: obstacle.name,
          point: { x: origin.x + dx * t, y: origin.y + dy * t },
        };
      }
    }
    return best;
  }

  // The first obstacle a closed polygon (the chassis' footprint) overlaps, or
  // null when it is clear of all of them.
  blocks(polygon) {
    for (const obstacle of this.#obstacles) {
      if (Room.#overlaps(polygon, obstacle)) return obstacle;
    }
    return null;
  }

  // Whether a footprint could stand here: inside the room and clear of
  // everything in it.
  fits(polygon) {
    const inside = polygon.every((p) => p.x > 0 && p.x < this.#width && p.y > 0 && p.y < this.#height);
    return inside && !this.blocks(polygon);
  }

  // Roughly where a polygon touches an obstacle: the middle of the points
  // where their outlines cross, or of whichever corners lie inside the other.
  contactPoint(polygon, obstacle) {
    const points = [];
    const edges = Room.#loop(polygon);
    for (const [p, q] of Room.#segments(obstacle)) {
      for (const [a, b] of edges) {
        const hit = Room.#crossing(p, q, a, b);
        if (hit) points.push(hit);
      }
      if (Room.#inside(p, polygon)) points.push(p);
    }
    if (obstacle.closed) for (const corner of polygon) if (Room.#inside(corner, obstacle.points)) points.push(corner);
    if (!points.length) points.push(...polygon);
    const n = points.length;
    return { x: points.reduce((sum, p) => sum + p.x, 0) / n, y: points.reduce((sum, p) => sum + p.y, 0) / n };
  }

  static #overlaps(polygon, obstacle) {
    const edges = Room.#loop(polygon);
    for (const [p, q] of Room.#segments(obstacle)) {
      if (Room.#inside(p, polygon)) return true;
      for (const [a, b] of edges) if (Room.#crossing(p, q, a, b)) return true;
    }
    return obstacle.closed && polygon.some((corner) => Room.#inside(corner, obstacle.points));
  }

  static #segments(obstacle) {
    const points = obstacle.points;
    if (!obstacle.closed) return [[points[0], points[1]]];
    return Room.#loop(points);
  }

  static #loop(points) {
    return points.map((p, i) => [p, points[(i + 1) % points.length]]);
  }

  // Where segments pq and ab cross, touching included, or null.
  static #crossing(p, q, a, b) {
    const rx = q.x - p.x;
    const ry = q.y - p.y;
    const sx = b.x - a.x;
    const sy = b.y - a.y;
    const denom = rx * sy - ry * sx;
    if (Math.abs(denom) < 1e-15) return null;
    const t = ((a.x - p.x) * sy - (a.y - p.y) * sx) / denom;
    const u = ((a.x - p.x) * ry - (a.y - p.y) * rx) / denom;
    if (t < 0 || t > 1 || u < 0 || u > 1) return null;
    return { x: p.x + rx * t, y: p.y + ry * t };
  }

  // Even-odd point in polygon.
  static #inside(point, polygon) {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const a = polygon[i];
      const b = polygon[j];
      if ((a.y > point.y) !== (b.y > point.y) &&
          point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
    }
    return inside;
  }

  /* --- the presets --- */

  // About 4 x 3 m: a sofa against the back wall, and a dining table whose top
  // the rover passes under, so only its four legs are obstacles -- thin ones
  // the sonar mostly misses.
  static #livingRoom() {
    const table = { x: 3.0, y: 1.05, w: 1.0, h: 0.7 };
    const leg = (sx, sy) => Room.box("a table leg", {
      x: table.x + sx * (table.w / 2 - 0.05), y: table.y + sy * (table.h / 2 - 0.05), w: 0.045, h: 0.045,
    });
    return new Room({
      name: "Living room",
      width: 4.0,
      height: 3.0,
      obstacles: [
        Room.box("the sofa", { x: 1.35, y: 2.6, w: 1.9, h: 0.8 }, { label: "Sofa" }),
        Room.box("the armrest", { x: 0.3, y: 2.25, w: 0.2, h: 0.5 }),
        leg(-1, -1), leg(1, -1), leg(1, 1), leg(-1, 1),
        Room.box("the plant pot", { x: 3.75, y: 2.75, w: 0.3, h: 0.3 }, { label: "Plant" }),
      ],
      outlines: [Room.outline("Table", table)],
      start: { x: 0.9, y: 0.55, heading: Math.PI / 2 },
    });
  }

  // 6 x 1.2 m, with a doorway partway: a frame narrowing it to 0.7 m.
  static #corridor() {
    return new Room({
      name: "Corridor",
      width: 6.0,
      height: 1.2,
      obstacles: [
        Room.box("the door frame", { x: 3.6, y: 0.125, w: 0.12, h: 0.25 }),
        Room.box("the door frame", { x: 3.6, y: 1.075, w: 0.12, h: 0.25 }, { label: "Door" }),
        Room.box("a box", { x: 5.2, y: 0.95, w: 0.4, h: 0.4 }, { label: "Box" }),
      ],
      start: { x: 0.4, y: 0.6, heading: 0 },
    });
  }

  // 2 x 2 m, empty.
  static #box() {
    return new Room({ name: "Box", width: 2.0, height: 2.0, start: { x: 1.0, y: 1.0, heading: Math.PI / 2 } });
  }

  // 5 x 3 m of staggered walls, a box set at an angle (whose faces glance a
  // ping away) and a narrow pillar.
  static #course() {
    return new Room({
      name: "Obstacle course",
      width: 5.0,
      height: 3.0,
      obstacles: [
        Room.box("a wall", { x: 1.3, y: 0.8, w: 0.1, h: 1.6 }),
        Room.box("a wall", { x: 2.6, y: 2.2, w: 0.1, h: 1.6 }),
        Room.box("the angled box", { x: 3.8, y: 1.0, w: 0.5, h: 0.5, deg: 45 }, { label: "Box" }),
        Room.box("the pillar", { x: 3.9, y: 2.3, w: 0.12, h: 0.12 }, { label: "Pillar" }),
      ],
      start: { x: 0.5, y: 0.5, heading: Math.PI / 2 },
    });
  }
}

/* --- the sonar ------------------------------------------------------------ */

// The sweep the firmware runs while it is not exploring (Explorer::survey in
// src/Explorer.cpp): the servo visits the five bearings in turn, left to
// right and back, and each bearing's reading dates from its own ping. A
// program sees them through telemetry, every 500 ms, so a front reading can
// be over a second old when it acts on it -- 35 cm of travel at half speed --
// as on the rover. A program that works in the preview does not depend on
// fresher readings than the rover gives.
//
// The timing follows Explorer::aim() and readyToPing(). After each ping the
// servo moves to the next bearing and settles for servoBaseMs plus
// servoMsPerDeg per degree of travel, cut to whole milliseconds -- 60 + 87 =
// 147 ms for the 35 degrees between bearings -- and no ping follows another
// within pingIntervalMs. At each end the sweep turns round and pings the same
// bearing again 70 ms later. A ping comes on the first simulated step (5 ms)
// at or after it is due, as the firmware's comes on the first loop pass
// after, so 147 ms becomes 150. One sweep is then 4 x 150 + 70 = 670 ms; an
// end bearing waits up to 1.27 s for its next reading, the centre one 670 ms.
//
// A preview starts with a rover that has been standing where it was put,
// sweeping: every bearing already has a reading, each as old as the last
// sweep left it, and the servo is at the end of that sweep. (A rover just
// powered on has none for 1.1 s, and telemetry carries no distances until it
// has all five; a program on the rover meets that only right after a boot.)
class SimSonar {
  // ExploreParams in src/Explorer.h. test/sim.test.js checks them.
  static TIMING = Object.freeze({ servoBaseMs: 60, servoMsPerDeg: 2.5, pingIntervalMs: 70 });

  // One HC-SR04 ping from the front of a chassis at `pose`, at a bearing in
  // degrees (positive to the rover's left), in cm as the firmware reports it:
  // FAR_CM when no echo would come back. One ray stands for the sensor's
  // cone, so a thin leg the cone would catch at an angle can slip past it.
  static measure(room, pose, bearingDeg) {
    const origin = RoverSim.toWorld(pose, RoverSim.SENSOR_AT);
    const hit = room.rayCast(origin, pose.heading + (bearingDeg * Math.PI) / 180);
    if (!hit) return FAR_CM;
    const cm = hit.distance * 100;
    if (cm > SIM_SONAR.rangeCm || hit.incidence > (SIM_SONAR.maxIncidenceDeg * Math.PI) / 180) return FAR_CM;
    return Math.round(cm * 10) / 10;
  }

  #bearings; // the panel's BEARINGS, left to right
  #readings; // per bearing: {cm, at, from: {x, y, heading}} or null
  #leftToRight = false;
  #step = 0;
  #servoDeg = null; // where the servo points, null until it is first aimed
  #readyAt = 0;
  #lastPingAt = null;

  constructor(bearings) {
    if (!Array.isArray(bearings) || bearings.length < 2) {
      throw new TypeError("SimSonar needs the scan bearings (BEARINGS in scan.js)");
    }
    this.#bearings = bearings;
    this.#readings = bearings.map(() => null);
  }

  // Put the rover down here, as if it had been standing and sweeping: a
  // whole sweep, left to right, that ended `now`, each bearing measured from
  // where the rover stands, and the next sweep starting back the other way.
  settle(now, measure, pose) {
    const { pingIntervalMs } = SimSonar.TIMING;
    const servo = this.#bearings.map((b) => SimSonar.#servo(b.bearing));
    const last = this.#bearings.length - 1;
    this.#leftToRight = true;
    let at = now;
    for (let step = last; step >= 0; step--) {
      this.#readings[step] = { cm: measure(this.#bearings[step].bearing), at, from: pose() };
      if (step > 0) at -= Math.max(pingIntervalMs, SimSonar.#settleMs(servo[step - 1], servo[step]));
    }
    this.#servoDeg = servo[last];
    this.#lastPingAt = now;
    this.restart(now);
  }

  // Explorer::startSweep(): every mode change starts a fresh sweep, the other
  // way from the last. Readings are kept.
  restart(now) {
    this.#leftToRight = !this.#leftToRight;
    this.#step = 0;
    this.#aim(now);
  }

  // Ping if one is due by `now`. measure(bearingDeg) returns the reading in
  // cm at that bearing from where the rover is now, and pose() the pose
  // it is taken from (kept for drawing). Returns the bearing pinged, or null.
  update(now, measure, pose) {
    const ready = now >= this.#readyAt &&
      (this.#lastPingAt === null || now - this.#lastPingAt >= SimSonar.TIMING.pingIntervalMs);
    if (!ready) return null;
    const index = this.#bearingAt(this.#step);
    const bearing = this.#bearings[index].bearing;
    this.#readings[index] = { cm: measure(bearing), at: now, from: pose() };
    this.#lastPingAt = now;
    if (++this.#step < this.#bearings.length) this.#aim(now);
    else this.restart(now);
    return bearing;
  }

  // Telemetry's distances, keyed as the firmware keys them, once every
  // bearing has been read; null until then.
  distances() {
    if (this.#readings.some((reading) => reading === null)) return null;
    const out = {};
    this.#bearings.forEach((b, i) => {
      out[b.key] = this.#readings[i].cm;
    });
    return out;
  }

  // For drawing: each bearing with its last reading (or null), and the
  // bearing the servo points at now.
  get readings() {
    return this.#bearings.map((b, i) => ({ key: b.key, bearing: b.bearing, reading: this.#readings[i] }));
  }

  get aimedBearing() {
    return this.#bearings[this.#bearingAt(this.#step)].bearing;
  }

  #bearingAt(step) {
    return this.#leftToRight ? step : this.#bearings.length - 1 - step;
  }

  // Explorer::aim(): the servo settles for longer the further it swings; an
  // aim from nowhere known assumes a full swing.
  #aim(now) {
    const target = SimSonar.#servo(this.#bearings[this.#bearingAt(this.#step)].bearing);
    this.#readyAt = now + SimSonar.#settleMs(this.#servoDeg, target);
    this.#servoDeg = target;
  }

  // How long the servo takes to settle at `to` from `from` (servo degrees;
  // from null, a full swing), cut to whole milliseconds as the firmware does.
  static #settleMs(from, to) {
    const { servoBaseMs, servoMsPerDeg } = SimSonar.TIMING;
    const travel = from === null ? 180 : Math.abs(to - from);
    return servoBaseMs + Math.trunc(servoMsPerDeg * travel);
  }

  // The servo's angle for a bearing: 90 minus it, within the servo's travel.
  // (The firmware's sign depends on how the servo is mounted; the time a swing
  // takes does not.)
  static #servo(bearing) {
    return Math.min(180, Math.max(0, 90 - bearing));
  }
}

/* --- simulated time ------------------------------------------------------- */

class SimClock {
  #now = 0;
  #timers = new Map(); // id -> {at, fn}
  #nextId = 1;

  get now() {
    return this.#now;
  }

  set(ms, fn) {
    const id = this.#nextId++;
    this.#timers.set(id, { at: this.#now + Math.max(0, ms), fn });
    return id;
  }

  clear(id) {
    this.#timers.delete(id);
  }

  advance(ms) {
    this.#now += ms;
  }

  // How many timers are waiting.
  get pending() {
    return this.#timers.size;
  }

  // Run every timer due by now, earliest first. Returns how many ran.
  fireDue() {
    const due = [...this.#timers].filter(([, t]) => t.at <= this.#now).sort((a, b) => a[1].at - b[1].at || a[0] - b[0]);
    for (const [id, timer] of due) {
      this.#timers.delete(id);
      timer.fn();
    }
    return due.length;
  }
}

/* --- the Target ----------------------------------------------------------- */

/**
 * The program runner's Target, over the simulator: the same calls as the
 * rover's (js/program.js describes the Target), carried out on screen.
 * Nothing here can reach the socket: it holds no Link and no Driver.
 *
 *   new SimTarget({ bearings, room, releasedDrag, scheme })
 *     bearings      the scan bearings: the panel's BEARINGS (scan.js);
 *     room          a key of Room.PRESETS (default "living");
 *     releasedDrag  see SIM_RELEASED_DRAG;
 *     scheme        what telemetry's "scheme" reports (default NORMAL).
 *
 * The Target, in short: hold() carries out a motion and re-commands it every
 * REPEAT_MS, each command lasting MOVE_DURATION_MS, as the Driver does;
 * release() stops only what a program holds, stop() always stops, and
 * explore() only changes the mode (exploring is not simulated); telemetry
 * comes every 500 ms of simulated time with the keys the rover sends, and is
 * always fresh; sleep() waits simulated time; onLost fires, with a reason from
 * SimTarget.LOST, on a reset, a change of room or the rover moved by hand.
 *
 * Beyond the Target, for SimView:
 *   pump(realMs)       advance by a frame of real time (see below)
 *   playback, paused   the speed of simulated time, 1, 2 or 4; and a pause
 *   reset()            put the rover back where it starts
 *   setRoom(key)       change room, and reset
 *   place(pose)        start from pose instead, and reset; false where the
 *                      chassis would not fit
 *   releasedDrag       see SIM_RELEASED_DRAG
 *   setScheme(name)    as the rover takes {"scheme": name}
 *   clearTrail()       forget the path and the bump marks
 *   onLog(fn)          fn(text) when the preview has something to say: a
 *                      bump, or that exploring is not simulated
 *   idle, onWake(fn)   whether the preview needs no time to pass, and fn()
 *                      when something starts that does
 *   state              a snapshot for drawing
 */
class SimTarget {
  // The world advances in fixed steps of simulated time, whatever the frame
  // rate, so a preview is the same every time it is run.
  static STEP_MS = 5;
  // A frame this late comes from a page that stalled: its time runs in one
  // piece, with no re-command and no program reacting inside it. (A hidden
  // page is not stalled; it is not pumped at all.)
  static STALL_MS = 100;
  // A longer gap between frames counts as this much real time.
  static MAX_FRAME_MS = 250;
  // How long one frame may spend letting a program react, in real time,
  // before it leaves the rest of its simulated time to the next frame.
  static FRAME_WORK_MS = 8;
  // tuning::TELEMETRY_INTERVAL_MS in src/Tuning.h. test/sim.test.js checks it.
  static TELEMETRY_MS = 500;
  static PLAYBACKS = Object.freeze([1, 2, 4]);
  static TRAIL_POINTS = 3000;
  static TRAIL_SPACING_M = 0.01;
  static LOG_LINES = 50;
  // A contact this close to a mark already on the same obstacle counts
  // against that mark; and no more marks than this are kept, the oldest
  // going first, as the trail's oldest points do.
  static BUMP_SAME_M = 0.03;
  static BUMP_MARKS = 100;

  kind = "simulator";

  #clock = new SimClock();
  #sim;
  #sonar;
  #room;
  #roomKey;
  #start; // where reset() puts the rover; the room's own start until placed
  #mode = "MANUAL";
  #scheme;
  #held = null; // {move, speed} the program holds
  #lastCommandAt = 0;
  #nextTelemetryAt = 0;
  #latest = null;
  #playback = 1;
  #paused = false;
  #budget = 0; // simulated ms the frames so far have asked for and not yet had
  #draining = null; // the frame still running, a Promise
  #published = false; // telemetry went out since the program last reacted
  #trail = [];
  #bumps = [];
  #contact = null; // what the rover last bumped into, which it is against while stalled
  #log = [];
  #listening = 0; // telemetry listeners: a running program is always one

  #telemetryListeners = new Listeners();
  #lostListeners = new Listeners();
  #logListeners = new Listeners();
  #wakeListeners = new Listeners();

  constructor({ bearings, room = "living", releasedDrag = SIM_RELEASED_DRAG, scheme = SCHEME_NORMAL } = {}) {
    this.#sonar = new SimSonar(bearings);
    this.#sim = new RoverSim({ releasedDrag });
    this.#scheme = scheme;
    this.#useRoom(room);
    this.#resetWorld();
  }

  /* --- the Target --- */

  ready() {
    return { ok: true, why: "" };
  }

  hold(move, speed) {
    if (!motionFor(move)) throw new RangeError(`hold() takes a motion code, 1 to 18, not ${move}`);
    if (typeof speed !== "number" || !Number.isFinite(speed)) {
      throw new RangeError(`hold() takes a speed, 0 to ${SPEED_MAX}, not ${speed}`);
    }
    this.#held = { move, speed: Math.min(SPEED_MAX, Math.max(0, Math.round(speed))) };
    this.#commandRover(this.#held.move, this.#held.speed);
    this.#wakeListeners.emit();
  }

  // Stops only what the program was driving, as the Driver's endProgram().
  release() {
    if (!this.#held) return;
    this.#held = null;
    this.#commandRover(STOP, 0);
  }

  stop() {
    this.#held = null;
    this.#commandRover(STOP, 0);
  }

  // The rover's exploring is C++ in the firmware, and is not simulated: the
  // preview shows the mode change and stands still until the next motion.
  explore() {
    this.#held = null;
    this.#commandRover(RESUME_AUTONOMOUS, 0);
    this.#say("exploring is not simulated: the real rover would start exploring here");
  }

  telemetry() {
    return { data: this.#latest && { ...this.#latest }, fresh: true };
  }

  // Counted, so that the preview knows a program is waiting on it (idle).
  onTelemetry(fn) {
    const remove = this.#telemetryListeners.add(fn);
    this.#listening++;
    this.#wakeListeners.emit();
    let listening = true;
    return () => {
      if (listening) this.#listening--;
      listening = false;
      remove();
    };
  }

  onLost(fn) {
    return this.#lostListeners.add(fn);
  }

  onLog(fn) {
    return this.#logListeners.add(fn);
  }

  // Resolves after `ms` of simulated time: faster at a higher playback,
  // never while paused or while the page is hidden (nothing pumps then). At
  // least one step passes, as even a zero-delay timer takes a few
  // milliseconds on a page: a program loop that only yields still lets time
  // run.
  sleep(ms, signal) {
    return new Promise((resolve, reject) => {
      if (signal && signal.aborted) {
        reject(signal.reason);
        return;
      }
      const onAbort = () => {
        this.#clock.clear(id);
        reject(signal.reason);
      };
      const id = this.#clock.set(Math.max(SimTarget.STEP_MS, Number(ms) || 0), () => {
        if (signal) signal.removeEventListener("abort", onAbort);
        resolve();
      });
      if (signal) signal.addEventListener("abort", onAbort, { once: true });
      this.#wakeListeners.emit();
    });
  }

  /* --- the simulator's own controls --- */

  get playback() {
    return this.#playback;
  }

  set playback(speed) {
    if (!SimTarget.PLAYBACKS.includes(speed)) throw new RangeError(`playback is one of ${SimTarget.PLAYBACKS}`);
    this.#playback = speed;
  }

  get paused() {
    return this.#paused;
  }

  set paused(paused) {
    this.#paused = Boolean(paused);
  }

  get releasedDrag() {
    return this.#sim.releasedDrag;
  }

  set releasedDrag(drag) {
    this.#sim.releasedDrag = drag;
  }

  get scheme() {
    return this.#scheme;
  }

  // As the rover takes {"scheme": name}: a name it does not know is ignored.
  setScheme(name) {
    if (name === SCHEME_NORMAL || name === SCHEME_ADVANCED) this.#scheme = name;
  }

  get roomKey() {
    return this.#roomKey;
  }

  get room() {
    return this.#room;
  }

  // Advance by one frame of real time, times the playback. Returns a Promise
  // that settles once the frame has run.
  //
  // A program reacts to the simulator only once its promises have settled,
  // which takes a turn of the page's event loop. So whenever something it may
  // be waiting for happens -- a sleep coming due, a telemetry frame -- the
  // world waits one such turn before it moves on: the program acts at the
  // simulated moment it asked for, whatever the display's frame rate, and the
  // same program in the same room previews the same on any machine. A frame
  // that has spent FRAME_WORK_MS of real time doing so leaves the rest of its
  // simulated time to the next.
  //
  // The re-command of a held move runs inside that loop, as the Driver's
  // repeat timer runs whenever the page is alive; the command's deadline runs
  // inside the simulated rover. A frame later than STALL_MS comes from a page
  // that stalled, which ran no timers at all: as long a stretch of simulated
  // time as the page was stalled for runs in one piece, with no re-command
  // and no program reacting, so a held move can run out and the rover stop,
  // as the firmware's deadman would stop the real one under a page stalled
  // as long. The stall is real time, so it is not scaled by the playback: at
  // 4x, a 120 ms hitch is 120 ms without a re-command and 360 ms as usual.
  // Scaled, it was 480 ms, and ran out a 400 ms command that the Driver,
  // late by 120 ms, would have renewed in time.
  pump(realMs) {
    if (this.#paused || !(realMs > 0)) return this.#draining || Promise.resolve();
    const frameMs = Math.min(realMs, SimTarget.MAX_FRAME_MS);
    let simMs = frameMs * this.#playback;
    if (realMs > SimTarget.STALL_MS) simMs -= this.#stall(frameMs);
    if (simMs <= 0) return this.#draining || Promise.resolve();
    const most = SimTarget.MAX_FRAME_MS * SimTarget.PLAYBACKS[SimTarget.PLAYBACKS.length - 1];
    this.#budget = Math.min(this.#budget + simMs, most);
    // A frame still running takes this one's time on as well.
    if (!this.#draining) {
      // A fault here is the simulator's own: report it once, and let the next
      // frame carry on.
      this.#draining = this.#drain().catch(reportFault).finally(() => { this.#draining = null; });
    }
    return this.#draining;
  }

  // Whether the preview needs no time to pass: nothing held or still
  // running out, no sleep waiting, and nobody listening to telemetry, as a
  // running program always is. SimView stops asking for frames while the
  // preview is idle and out of sight. (A frame still draining finishes on
  // its own; it only moves the sweep on.)
  get idle() {
    return !this.#held && !this.#sim.moving && this.#clock.pending === 0 && this.#listening === 0;
  }

  // fn() when something starts that needs simulated time to pass: a held
  // motion, a sleep, or a listener to telemetry.
  onWake(fn) {
    return this.#wakeListeners.add(fn);
  }

  // Each of these is a loss to a program running on the simulator, which
  // the runner reports with the reason given here.
  static LOST = Object.freeze({
    reset: "the preview was reset.",
    room: "the room was changed.",
    placed: "the rover was moved by hand.",
  });

  reset() {
    this.#resetWorld();
    this.#lostListeners.emit(SimTarget.LOST.reset);
  }

  setRoom(key) {
    this.#useRoom(key);
    this.#resetWorld();
    this.#lostListeners.emit(SimTarget.LOST.room);
  }

  // Set where the rover starts, and put it there: dragging the rover in the
  // view. Refused, returning false, where it would not fit.
  place(pose) {
    if (!this.#room.fits(RoverSim.footprint(pose))) return false;
    this.#start = { x: pose.x, y: pose.y, heading: pose.heading };
    this.#resetWorld();
    this.#lostListeners.emit(SimTarget.LOST.placed);
    return true;
  }

  clearTrail() {
    this.#trail = [this.#trailPoint()];
    this.#bumps = [];
  }

  // A snapshot for drawing. Arrays are the target's own: read, do not change.
  // atStart: the rover stands where reset() would put it. contact: what it
  // last bumped into, and so is against while stalled; not always the
  // newest mark, since pushing again at an old one adds none.
  get state() {
    const sim = this.#sim;
    const pose = sim.pose;
    const start = this.#start;
    return {
      now: this.#clock.now,
      pose,
      atStart: Math.hypot(pose.x - start.x, pose.y - start.y) < 0.002 &&
        Math.abs(Math.atan2(Math.sin(pose.heading - start.heading), Math.cos(pose.heading - start.heading))) < 0.002,
      move: sim.move,
      speed: sim.speed,
      moving: sim.moving,
      stalled: sim.stalled,
      wheels: sim.wheels,
      twist: sim.twist,
      mode: this.#mode,
      held: this.#held && { ...this.#held },
      readings: this.#sonar.readings,
      aimedBearing: this.#sonar.aimedBearing,
      trail: this.#trail,
      bumps: this.#bumps,
      contact: this.#contact,
      log: this.#log,
    };
  }

  /* --- inside --- */

  // Spend the frames' budget a step at a time, stopping for the program to
  // react whenever there is something it may react to.
  async #drain() {
    const began = performance.now();
    while (!this.#paused) {
      const happened = this.#clock.fireDue() > 0 || this.#published;
      this.#published = false;
      if (happened) {
        await SimTarget.#yieldToPage();
        if (performance.now() - began > SimTarget.FRAME_WORK_MS) return;
        continue; // look again: reacting may have made something else due
      }
      if (this.#budget < SimTarget.STEP_MS) return;
      this.#budget -= SimTarget.STEP_MS;
      if (this.#held && this.#clock.now - this.#lastCommandAt >= REPEAT_MS) {
        this.#commandRover(this.#held.move, this.#held.speed);
      }
      this.#step();
    }
  }

  // A stalled page's frame: the world moves on, and nothing else does. A
  // sleep that came due meanwhile resolves after it, late, as a stalled
  // page's timers fire late. Returns the simulated ms it ran, in whole steps.
  #stall(ms) {
    const steps = Math.floor(ms / SimTarget.STEP_MS);
    for (let i = 0; i < steps; i++) this.#step();
    return steps * SimTarget.STEP_MS;
  }

  // One turn of the page's event loop, so that every promise a program has
  // waiting settles first: a message on a fresh channel, which a browser
  // delivers at once, where a zero-delay timer may wait 4 ms.
  static #yieldToPage() {
    if (typeof MessageChannel !== "function") return new Promise((resolve) => setTimeout(resolve, 0));
    return new Promise((resolve) => {
      const channel = new MessageChannel();
      channel.port1.onmessage = () => {
        channel.port1.close();
        resolve();
      };
      channel.port2.postMessage(null);
    });
  }

  // The firmware's Rover::command(), as far as a preview needs it. Every
  // command but RESUME_AUTONOMOUS takes the rover out of autonomous mode, and
  // any change of mode starts a fresh sweep.
  #commandRover(move, speed) {
    const now = this.#clock.now;
    this.#lastCommandAt = now;
    if (move === RESUME_AUTONOMOUS) {
      if (this.#mode !== "AUTONOMOUS") {
        this.#mode = "AUTONOMOUS";
        this.#sim.release();
        this.#sonar.restart(now);
      }
      return;
    }
    if (this.#mode !== "MANUAL") {
      this.#mode = "MANUAL";
      this.#sim.release();
      this.#sonar.restart(now);
    }
    this.#sim.command(move, speed, MOVE_DURATION_MS);
  }

  // One fixed step of the world.
  #step() {
    const bump = this.#sim.step(SimTarget.STEP_MS, this.#room);
    this.#clock.advance(SimTarget.STEP_MS);
    const now = this.#clock.now;
    if (bump) this.#bumped(bump, now);
    this.#sonar.update(now, (bearing) => SimSonar.measure(this.#room, this.#sim.pose, bearing), () => this.#sim.pose);
    this.#extendTrail();
    if (now < this.#nextTelemetryAt) return;
    this.#nextTelemetryAt += SimTarget.TELEMETRY_MS;
    this.#publish();
    this.#published = true;
  }

  // A new contact is marked and said once. Pushing again where any mark on
  // the same obstacle already is only counts against that mark: a program
  // wedged in a corner pushes into one wall and then the other, and when
  // only the last mark was compared, each push added a mark, a log line and
  // a spoken announcement, without end.
  #bumped({ obstacle, at }, now) {
    this.#contact = obstacle;
    const same = this.#bumps.find((b) => b.obstacle === obstacle && Math.hypot(b.x - at.x, b.y - at.y) < SimTarget.BUMP_SAME_M);
    if (same) {
      same.times++;
      return;
    }
    this.#bumps.push({ x: at.x, y: at.y, obstacle, at: now, times: 1 });
    if (this.#bumps.length > SimTarget.BUMP_MARKS) this.#bumps.splice(0, this.#bumps.length - SimTarget.BUMP_MARKS);
    this.#say(`bumped into ${obstacle}`);
  }

  // The keys src/Protocol.cpp writes, with these exceptions: no
  // "temperature", since there is no chip to measure, and no "phase" or
  // "halt", since exploring is not simulated. "scheme" is whatever
  // setScheme() last took: app.js passes on the real rover's, once known.
  // The distances are the sonar's last reading at each bearing, never a
  // fresh measurement: a program sees them as old as the rover's would be.
  #publish() {
    const sim = this.#sim;
    const frame = {
      mode: this.#mode,
      move: sim.moving ? motionFor(sim.move).name : "STOP",
      moving: sim.moving,
      motorsReady: true,
      scheme: this.#scheme,
    };
    const distances = this.#sonar.distances();
    if (distances) Object.assign(frame, distances);
    this.#latest = frame;
    this.#telemetryListeners.emit({ ...frame });
  }

  #extendTrail() {
    const last = this.#trail[this.#trail.length - 1];
    const pose = this.#sim.pose;
    if (last && Math.hypot(pose.x - last.x, pose.y - last.y) < SimTarget.TRAIL_SPACING_M) return;
    this.#trail.push(this.#trailPoint());
    if (this.#trail.length > SimTarget.TRAIL_POINTS) this.#trail.splice(0, this.#trail.length - SimTarget.TRAIL_POINTS);
  }

  #trailPoint() {
    const { x, y } = this.#sim.pose;
    return { x, y, at: this.#clock.now };
  }

  #useRoom(key) {
    this.#room = Room.preset(key);
    this.#roomKey = key;
    this.#start = this.#room.start;
  }

  // Back to the start: stopped, in manual mode, as a rover put down there and
  // left sweeping. Simulated time runs on, so a sleep in progress is neither
  // lost nor cut short.
  #resetWorld() {
    const now = this.#clock.now;
    this.#held = null;
    this.#mode = "MANUAL";
    this.#sim.release();
    this.#sim.pose = this.#start;
    this.#sonar.settle(now, (bearing) => SimSonar.measure(this.#room, this.#sim.pose, bearing), () => this.#sim.pose);
    this.#latest = null;
    this.#nextTelemetryAt = now;
    this.#trail = [this.#trailPoint()];
    this.#bumps = [];
    this.#contact = null;
  }

  #say(text) {
    this.#log.push({ text, at: this.#clock.now });
    if (this.#log.length > SimTarget.LOG_LINES) this.#log.shift();
    this.#logListeners.emit(text);
  }
}

if (typeof module !== "undefined") {
  module.exports = { SIM_WHEEL_MAX_MPS, SIM_DEADBAND_PWM, SIM_CHASSIS, RoverSim, Room, SimSonar, SimTarget };
}

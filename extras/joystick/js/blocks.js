/**
 * The rover's blocks for Google Blockly, and the editor that holds them.
 *
 * Blockly comes from cdn.jsdelivr.net (joystick.html loads it deferred), so it
 * can be missing: offline, blocked, or refused by its integrity check. Driving
 * never depends on it, and nothing in this file touches it as the file loads:
 * a BlockEditor installs the blocks when app.js builds one, which it does only
 * once Blockly is there. RoverBlocks.TYPES, EXAMPLES, sanitize() and
 * tooltip() need no Blockly, and load in Node for the tests.
 *
 * A block's code only ever awaits methods of `api`, the one argument the
 * compiled program is given by ProgramRunner (program.js). Every statement is
 * preceded by `await api.step(id)`, which lights the block up and checks the
 * program has not been stopped, and every loop iteration by
 * `await api.tick()`, which yields, so a loop with no wait in it can neither
 * freeze the page nor outlive Stop.
 *
 *   RoverBlocks   the block definitions, their code, the theme, the toolbox
 *                 and the examples.
 *   BlockEditor   one Blockly workspace with those blocks, saved as it
 *                 changes.
 */
if (typeof module !== "undefined") {
  // program.js puts protocol.js and mecanum.js on the global object too.
  if (typeof ProgramRunner === "undefined") Object.assign(globalThis, require("./program.js"));
  if (typeof BEARINGS === "undefined") Object.assign(globalThis, require("./scan.js"));
}

class RoverBlocks {
  // More blocks than any hand-built program needs; a file with more is
  // refused rather than allowed to stall the page.
  static MAX_BLOCKS = 2000;

  // Every block type a program may hold. Anything else in a file is refused
  // on import rather than half-loaded.
  static TYPES = Object.freeze(new Set([
    "rover_drive_for", "rover_drive_until", "rover_stop", "rover_explore",
    "rover_distance", "rover_clear", "rover_exploring",
    "rover_wait", "rover_forever", "rover_say",
    "controls_repeat_ext", "controls_whileUntil", "controls_if", "controls_flow_statements",
    "logic_compare", "logic_operation", "logic_negate", "logic_boolean",
    "math_number", "math_arithmetic", "math_round", "math_random_int", "math_modulo", "math_constrain",
    "variables_get", "variables_set", "math_change",
    "text", "text_join",
  ]));

  // The blocks that drive a motion, named by their MOVE field.
  static DRIVES = Object.freeze(["rover_drive_for", "rover_drive_until"]);
  // The blocks with a BEARING menu: sanitize() needs each to name one.
  static #READS_BEARING = Object.freeze(["rover_distance", "rover_clear"]);

  // The block colours, one per toolbox category. Mid-tones that hold the
  // blocks' white 12 px text at 4.5:1 or better and still read on the
  // panel's near-black. Red is the panel's stop red (--stop in
  // css/panel.css; panel.test.js checks the copy), and only the stop block
  // wears it: anywhere else it would stop meaning anything.
  static PALETTE = Object.freeze({
    motion: "#237d70",
    sensors: "#3674b5",
    control: "#a6651b",
    logic: "#7462d4",
    math: "#2f7d4e",
    variables: "#b8508a",
    output: "#66758a",
    stop: "#d23c37",
  });

  // The motions in the order the motion menu lists them: the eight
  // translations, the two rotations, then the eight pivots, which are not
  // bench-verified (docs/mecanum.md).
  static MOTION_MENU = Object.freeze([
    "MOVE_FORWARD", "MOVE_BACKWARD", "MOVE_LEFT", "MOVE_RIGHT",
    "MOVE_DIAGONAL135", "MOVE_DIAGONAL45", "MOVE_DIAGONAL225", "MOVE_DIAGONAL315",
    "ROTATE_COUNTERCLOCKWISE", "ROTATE_CLOCKWISE",
    "PIVOT_LEFT_FORWARD", "PIVOT_RIGHT_FORWARD", "PIVOT_LEFT_BACKWARD", "PIVOT_RIGHT_BACKWARD",
    "PIVOT_SIDEWAYS_FORWARD_LEFT", "PIVOT_SIDEWAYS_FORWARD_RIGHT",
    "PIVOT_SIDEWAYS_BACKWARD_LEFT", "PIVOT_SIDEWAYS_BACKWARD_RIGHT",
  ]);

  // Words for the scan's bearings (BEARINGS in scan.js, by label), front
  // first: the distance blocks start on it.
  static BEARING_WORDS = Object.freeze([["F", "front"], ["FL", "front-left"], ["FR", "front-right"], ["L", "left"], ["R", "right"]]);

  // Blockly draws its zoom controls and trashcan from its media folder; this
  // one ships with the same pinned release as the script.
  static MEDIA = "https://cdn.jsdelivr.net/npm/blockly@13.3.0/media/";

  static PIVOT_NOTE = " Pivots are not bench-verified yet (docs/mecanum.md): watch the rover the first time.";

  static #installed = null; // the theme, once the blocks are defined

  // A number input holding n, as a shadow block: for the examples and the
  // toolbox.
  static #number(n) {
    return { shadow: { type: "math_number", fields: { NUM: n } } };
  }

  /* --- the examples ------------------------------------------------------ */

  // Serialised workspaces, as Blockly.serialization.workspaces.save() writes
  // them, built by a few helpers so each reads like the program it is.
  static EXAMPLES = (() => {
    const number = RoverBlocks.#number;
    const drive = (move, speed, seconds) => ({
      type: "rover_drive_for", fields: { MOVE: move }, inputs: { SPEED: number(speed), SECONDS: number(seconds) },
    });
    const chain = (blocks) => blocks.reduceRight((next, block) => (next ? { ...block, next: { block: next } } : block), null);
    const repeat = (times, body) => ({ type: "controls_repeat_ext", inputs: { TIMES: number(times), DO: { block: chain(body) } } });
    const forever = (body) => ({ type: "rover_forever", inputs: { DO: { block: chain(body) } } });
    const ifElse = (condition, yes, no) => ({
      type: "controls_if", extraState: { hasElse: true },
      inputs: { IF0: { block: condition }, DO0: { block: chain(yes) }, ELSE: { block: chain(no) } },
    });
    const driveUntil = (move, speed, condition) => ({
      type: "rover_drive_until", fields: { MOVE: move }, inputs: { SPEED: number(speed), UNTIL: { block: condition } },
    });
    const clear = (key, cm) => ({ type: "rover_clear", fields: { BEARING: key }, inputs: { LIMIT: number(cm) } });
    const and = (a, b) => ({ type: "logic_operation", fields: { OP: "AND" }, inputs: { A: { block: a }, B: { block: b } } });
    const not = (a) => ({ type: "logic_negate", inputs: { BOOL: { block: a } } });
    // The front clear beyond `front` cm, and the bearings either side of it
    // beyond `sides`: they see what the chassis' corners would meet.
    const wayAhead = (front, sides) =>
      and(and(clear("distanceFront", front), clear("distanceFrontLeft", sides)), clear("distanceFrontRight", sides));
    const program = (blocks) => ({ blocks: { languageVersion: 0, blocks: [{ ...chain(blocks), x: 40, y: 40 }] } });

    return Object.freeze([
      {
        id: "square",
        name: "Square",
        state: program([repeat(4, [drive("MOVE_FORWARD", 50, 1), drive("ROTATE_CLOCKWISE", 50, 0.6)])]),
      },
      {
        id: "strafe-box",
        name: "Strafe box",
        state: program([
          drive("MOVE_FORWARD", 50, 1), drive("MOVE_RIGHT", 50, 1),
          drive("MOVE_BACKWARD", 50, 1), drive("MOVE_LEFT", 50, 1),
        ]),
      },
      // Wander without touching anything: the one example that reads the
      // sonar, and so the one that must be safe on the real rover. An earlier
      // Patrol read the front alone and drove in half-second bursts at 50 %;
      // it bumped into things in every simulator room. The front ray misses
      // what the chassis' corners clip, so it looks either side too; a
      // reading can be over a second old when the program acts on it (the
      // sweep, then telemetry), so it drives slowly; and it starts only
      // beyond 60 cm and stops at 50, so it does not stutter at the edge.
      // test/sim.test.js previews it in every room and fails on a bump.
      {
        id: "patrol",
        name: "Patrol",
        state: program([forever([
          ifElse(wayAhead(60, 40),
            [driveUntil("MOVE_FORWARD", 30, not(wayAhead(50, 35)))],
            [drive("ROTATE_CLOCKWISE", 40, 0.4)]),
        ])]),
      },
      {
        id: "mecanum-tour",
        name: "Mecanum tour",
        state: program(RoverBlocks.MOTION_MENU.map((name) => drive(name, 40, 0.5))),
      },
    ].map((example) => Object.freeze(example)));
  })();

  /* --- the toolbox ------------------------------------------------------- */

  static toolbox() {
    const number = RoverBlocks.#number;
    const block = (type, extra = {}) => ({ kind: "block", type, ...extra });
    const category = (name, key, contents) => ({
      kind: "category",
      name,
      categorystyle: `${key}_category`,
      // A pill with a dot of the category's colour (program.css): the class
      // says which, as Blockly paints the row's own colour inline.
      cssConfig: { row: `blocklyToolboxCategory roverCategory roverCategory-${key}` },
      ...contents,
    });

    return {
      kind: "categoryToolbox",
      contents: [
        category("Motion", "motion", { contents: [
          block("rover_drive_for", { inputs: { SPEED: number(50), SECONDS: number(1) } }),
          // Ready to stop short of an obstacle. "Not clear" rather than
          // "distance < 30": no echo is not clear, so a dead sensor stops it
          // instead of driving it blind for 30 s.
          block("rover_drive_until", { inputs: {
            SPEED: number(40),
            UNTIL: { block: { type: "logic_negate", inputs: { BOOL: { block: {
              type: "rover_clear", fields: { BEARING: "distanceFront" }, inputs: { LIMIT: number(30) },
            } } } } },
          } }),
          block("rover_stop"),
          block("rover_explore"),
        ] }),
        category("Sensors", "sensors", { contents: [
          block("rover_distance"),
          block("rover_clear", { inputs: { LIMIT: number(40) } }),
          block("rover_exploring"),
        ] }),
        category("Control", "control", { contents: [
          block("rover_wait", { inputs: { SECONDS: number(1) } }),
          block("rover_forever"),
          block("controls_repeat_ext", { inputs: { TIMES: number(4) } }),
          block("controls_whileUntil"),
          block("controls_if"),
          block("controls_if", { extraState: { hasElse: true } }),
          block("controls_flow_statements"),
        ] }),
        category("Logic", "logic", { contents: [
          block("logic_compare"),
          block("logic_operation"),
          block("logic_negate"),
          block("logic_boolean"),
        ] }),
        category("Math", "math", { contents: [
          block("math_number"),
          block("math_arithmetic", { inputs: { A: number(1), B: number(1) } }),
          block("math_round", { inputs: { NUM: number(3.1) } }),
          block("math_random_int", { inputs: { FROM: number(1), TO: number(10) } }),
          block("math_modulo", { inputs: { DIVIDEND: number(10), DIVISOR: number(3) } }),
          block("math_constrain", { inputs: { VALUE: number(50), LOW: number(0), HIGH: number(100) } }),
        ] }),
        category("Variables", "variables", { custom: "VARIABLE" }),
        category("Output", "output", { contents: [
          block("rover_say", { inputs: { TEXT: { shadow: { type: "text", fields: { TEXT: "Hello" } } } } }),
          block("text"),
          block("text_join"),
        ] }),
      ],
    };
  }

  /* --- the blocks -------------------------------------------------------- */

  // Define the blocks and their code, and the theme, once. Returns the theme.
  static install(Blockly, generator) {
    if (RoverBlocks.#installed) return RoverBlocks.#installed;

    RoverBlocks.#defineBlocks(Blockly);
    RoverBlocks.#defineCode(generator);

    // Before every statement, and in every loop: see the head of this file.
    generator.STATEMENT_PREFIX = "await api.step(%1);\n";
    generator.INFINITE_LOOP_TRAP = "await api.tick();\n";
    generator.addReservedWords("api");
    RoverBlocks.harden(generator);

    // Without this, "break out of loop" is disabled inside forever, the
    // natural way out of one: Blockly enables it only inside the loop types
    // it knows.
    Blockly.libraryBlocks.loops.loopTypes.add("rover_forever");

    RoverBlocks.#installed = RoverBlocks.#defineTheme(Blockly);
    return RoverBlocks.#installed;
  }

  // The compiled program runs with the page's globals in reach (`link`,
  // `driver`), so nothing a program file holds may reach its code except
  // through a block's own generator. These are the three ways Blockly's
  // JavaScript generator writes text of the file's into the code besides,
  // each closed here. Public so that the tests can check it against a
  // stand-in generator, as Blockly does not load in Node.
  static harden(generator) {
    // Blockly writes each block's id into the code between quotes as it is:
    // an id holding a quote would run as code (`a');link.send(...);//`).
    // Blockly's own ids never hold one, and every program loaded is stripped
    // of the ids it brought (sanitize), but should one ever get past both, it
    // is written here as a string literal (JSON's are JavaScript's), exactly
    // as it is.
    generator.injectId = (msg, block) => msg.replace(/%1/g, () => JSON.stringify(block.id));

    // Blockly writes a block's comment into the code as `// ...` lines,
    // splitting it only at \n. A carriage return, U+2028 or U+2029 also ends
    // a line of JavaScript, so a comment holding one ran the rest as code: an
    // imported file's comment could start a timer that drove the rover past
    // every rule of the Driver, and even a preview ran it. Nobody reads the
    // code, so no comment is written into it at all; what Blockly's own
    // scrub_ does besides is go on to the next block, and so does this.
    generator.scrub_ = (block, code, thisOnly = false) => {
      const next = block.nextConnection && block.nextConnection.targetBlock();
      return code + (thisOnly ? "" : generator.blockToCode(next));
    };

    // A text block's words go into the code as a string literal. Blockly
    // escapes the backslash, the quote and \n, but not a carriage return,
    // which ends the literal mid-way, so the program would not compile.
    // U+2028 and U+2029 are legal in a string literal today; escaped too, so
    // that the code holds no line break but \n.
    const quote = generator.quote_.bind(generator);
    generator.quote_ = (text) =>
      quote(String(text)).replace(/\r/g, "\\r").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
    return generator;
  }

  static #defineBlocks(Blockly) {
    const motions = RoverBlocks.MOTION_MENU.map((name) => {
      const motion = motionNamed(name);
      return [`${motion.glyph}  ${motion.label}`, name];
    });
    // Separators between the translations, the rotations and the pivots.
    const menu = [...motions.slice(0, 8), "separator", ...motions.slice(8, 10), "separator", ...motions.slice(10)];
    const bearings = RoverBlocks.#bearingMenu();
    const motionField = { type: "field_dropdown", name: "MOVE", options: menu };
    const statement = { previousStatement: null, nextStatement: null };

    // Each drive block's tooltip names the motion chosen, and warns about a
    // pivot.
    for (const type of RoverBlocks.DRIVES) {
      Blockly.Extensions.register(`${type}_tooltip`, function () {
        this.setTooltip(() => RoverBlocks.tooltip(this.type, this.getFieldValue("MOVE")));
      });
    }

    Blockly.common.defineBlocks(Blockly.common.createBlockDefinitionsFromJsonArray([
      {
        type: "rover_drive_for",
        message0: "drive %1 at %2 %% for %3 s",
        args0: [
          motionField,
          { type: "input_value", name: "SPEED", check: "Number" },
          { type: "input_value", name: "SECONDS", check: "Number" },
        ],
        inputsInline: true,
        ...statement,
        style: "motion_blocks",
        extensions: ["rover_drive_for_tooltip"],
      },
      {
        type: "rover_drive_until",
        message0: "drive %1 at %2 %% until %3",
        args0: [
          motionField,
          { type: "input_value", name: "SPEED", check: "Number" },
          { type: "input_value", name: "UNTIL", check: "Boolean" },
        ],
        inputsInline: true,
        ...statement,
        style: "motion_blocks",
        extensions: ["rover_drive_until_tooltip"],
      },
      {
        type: "rover_stop",
        message0: "stop",
        ...statement,
        style: "stop_blocks",
        tooltip: "Stop the rover, even one exploring on its own. The program carries on.",
      },
      {
        type: "rover_explore",
        message0: "start exploring",
        ...statement,
        style: "motion_blocks",
        tooltip: "Let the rover explore on its own, as the Autonomous button does. " +
          "The program carries on, and its next drive takes control back.",
      },
      {
        type: "rover_distance",
        message0: "distance %1 cm",
        args0: [{ type: "field_dropdown", name: "BEARING", options: bearings }],
        output: "Number",
        style: "sensor_blocks",
        tooltip: `What the rover measures at this bearing, in cm. ${FAR_CM} means no echo: nothing within ` +
          "about 4 m, or a sensor that is not answering. A program stops if the readings go out of date.",
      },
      {
        type: "rover_clear",
        message0: "%1 clear beyond %2 cm",
        args0: [
          { type: "field_dropdown", name: "BEARING", options: bearings },
          { type: "input_value", name: "LIMIT", check: "Number" },
        ],
        inputsInline: true,
        output: "Boolean",
        style: "sensor_blocks",
        tooltip: "True when the rover hears an echo at this bearing from farther away than this. " +
          "No echo is not clear: a dead sensor sounds the same as open space.",
      },
      {
        type: "rover_exploring",
        message0: "rover is exploring",
        output: "Boolean",
        style: "sensor_blocks",
        tooltip: RoverBlocks.tooltip("rover_exploring"),
      },
      {
        type: "rover_wait",
        message0: "wait %1 s",
        args0: [{ type: "input_value", name: "SECONDS", check: "Number" }],
        inputsInline: true,
        ...statement,
        style: "loop_blocks",
        tooltip: RoverBlocks.tooltip("rover_wait"),
      },
      {
        // No bottom connection: nothing after a forever would ever run.
        type: "rover_forever",
        message0: "forever %1 %2",
        args0: [{ type: "input_dummy" }, { type: "input_statement", name: "DO" }],
        previousStatement: null,
        style: "loop_blocks",
        tooltip: "Repeat these blocks until the program is stopped.",
      },
      {
        type: "rover_say",
        message0: "say %1",
        args0: [{ type: "input_value", name: "TEXT" }],
        inputsInline: true,
        ...statement,
        style: "text_blocks",
        tooltip: "Print this in the program's console.",
      },
    ]));

    // The standard if/else sits in Control with the loops, as in Scratch, so
    // it wears Control's colour rather than Logic's.
    const ifBlock = Blockly.Blocks.controls_if;
    const init = ifBlock.init;
    ifBlock.init = function () {
      init.call(this);
      this.setStyle("loop_blocks");
    };
  }

  // The tooltip of a block whose words depend on something: the drive
  // blocks name the motion chosen (move, a motion's name) and warn about a
  // pivot. The limits quoted are the runner's own (program.js), so a tooltip
  // cannot promise one the runner does not keep.
  static tooltip(type, move) {
    const R = ProgramRunner;
    if (type === "rover_wait") return `Wait this long, up to ${R.WAIT_SECONDS_MAX} s. A drive has already stopped by now.`;
    if (type === "rover_exploring") {
      return "True while the rover is exploring on its own. Right after a drive, a stop or start exploring, it " +
        `waits until the rover has reported ${R.MODE_FRAMES} more times (twice a second), so the answer comes from after the command.`;
    }
    const motion = motionNamed(move);
    const label = motion ? motion.label.toLowerCase() : "in this direction";
    const text = type === "rover_drive_for"
      ? `Drive ${label} at a share of full speed (0 to 100 %) for this long (up to ${R.DRIVE_SECONDS_MAX} s), then stop.`
      : `Drive ${label} at a share of full speed until the condition is true, checked at each new reading ` +
        `(twice a second). It stops after ${R.UNTIL_MAX_MS / 1000} s even if the condition never comes true, and the program goes on.`;
    return motion && motion.advanced ? text + RoverBlocks.PIVOT_NOTE : text;
  }

  static #bearingMenu() {
    return RoverBlocks.BEARING_WORDS.map(([label, words]) => {
      const bearing = BEARINGS.find((b) => b.label === label);
      if (!bearing) throw new Error(`scan.js has no ${label} bearing`);
      return [words, bearing.key];
    });
  }

  /* --- their code -------------------------------------------------------- */

  static #defineCode(generator) {
    const { Order } = javascript;
    const value = (block, name, fallback) => generator.valueToCode(block, name, Order.NONE) || fallback;
    const forBlock = generator.forBlock;

    forBlock.rover_drive_for = (block) =>
      `await api.drive(${RoverBlocks.#moveCode(block)}, ${value(block, "SPEED", "0")}, ${value(block, "SECONDS", "0")});\n`;

    forBlock.rover_drive_until = (block) => {
      const until = generator.valueToCode(block, "UNTIL", Order.NONE);
      if (!until) {
        throw Object.assign(new Error('A "drive until" block has nothing to wait for: give it a condition.'), { blockId: block.id });
      }
      return `await api.driveUntil(${RoverBlocks.#moveCode(block)}, ${value(block, "SPEED", "0")}, async () => (${until}));\n`;
    };

    forBlock.rover_stop = () => "await api.stop();\n";
    forBlock.rover_explore = () => "await api.explore();\n";

    forBlock.rover_distance = (block) =>
      [`(await api.distance(${RoverBlocks.#bearing(block, generator)}))`, Order.ATOMIC];
    forBlock.rover_clear = (block) =>
      [`(await api.clearBeyond(${RoverBlocks.#bearing(block, generator)}, ${value(block, "LIMIT", "0")}))`, Order.ATOMIC];
    forBlock.rover_exploring = () => ["(await api.isExploring())", Order.ATOMIC];

    forBlock.rover_wait = (block) => `await api.wait(${value(block, "SECONDS", "0")});\n`;

    forBlock.rover_forever = (block) => {
      const body = generator.addLoopTrap(generator.statementToCode(block, "DO"), block);
      return `while (true) {\n${body}}\n`;
    };

    forBlock.rover_say = (block) => `await api.log(${value(block, "TEXT", "''")});\n`;
  }

  // The move code, a number, for the motion a block names. A name that is not
  // a motion (an edited file) stops the program being built, not run.
  static #moveCode(block) {
    const name = block.getFieldValue("MOVE");
    const motion = motionNamed(name);
    if (!motion) throw Object.assign(new Error(`A drive block names no motion the rover knows: ${name}`), { blockId: block.id });
    return String(motion.move);
  }

  static #bearing(block, generator) {
    const key = block.getFieldValue("BEARING");
    if (!BEARINGS.some((b) => b.key === key)) {
      throw Object.assign(new Error(`A sensor block names no bearing the rover measures: ${key}`), { blockId: block.id });
    }
    return generator.quote_(key);
  }

  /* --- checking a program before it is loaded ------------------------------ */

  // A deep copy of state, a workspace as Blockly.serialization saves it,
  // checked to be a rover program, with every block id dropped and every
  // comment's line breaks made plain \n; state itself is left as it was.
  // Throws an Error saying why when it is not one. The ids are written into
  // the program's code (STATEMENT_PREFIX), so a file must not choose them;
  // Blockly makes new ones. Every load goes through here: an import, an
  // example, the autosave.
  static sanitize(state) {
    const isObject = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
    const notProgram = (why) => new Error(`This is not a rover program: ${why}`);
    if (!isObject(state)) throw notProgram("it is not a JSON object.");
    let copy;
    try {
      copy = JSON.parse(JSON.stringify(state));
    } catch {
      throw notProgram("it cannot be read.");
    }
    const top = copy.blocks;
    if (top !== undefined && (!isObject(top) || !Array.isArray(top.blocks))) {
      throw notProgram('its "blocks" are not a list of blocks.');
    }
    if (copy.variables !== undefined && !Array.isArray(copy.variables)) throw notProgram('its "variables" are not a list.');

    const pending = top ? [...top.blocks] : [];
    let count = 0;
    while (pending.length) {
      const block = pending.pop();
      if (!isObject(block) || typeof block.type !== "string") throw notProgram("it has a block with no type.");
      if (!RoverBlocks.TYPES.has(block.type)) throw notProgram(`it has a "${block.type}" block, which this editor does not have.`);
      if (++count > RoverBlocks.MAX_BLOCKS) throw notProgram(`it has more than ${RoverBlocks.MAX_BLOCKS} blocks.`);
      // Blockly would quietly put a menu's first choice in place of a value it
      // does not offer, or of one missing: a drive it does not know, or a
      // drive naming none, would become a drive forward.
      const fields = isObject(block.fields) ? block.fields : {};
      if (RoverBlocks.DRIVES.includes(block.type) && !("MOVE" in fields)) {
        throw notProgram(`it has a "${block.type}" block that names no motion.`);
      }
      if ("MOVE" in fields && !motionNamed(fields.MOVE)) {
        throw notProgram(`it drives "${fields.MOVE}", which is not a motion the rover knows.`);
      }
      if (RoverBlocks.#READS_BEARING.includes(block.type) && !("BEARING" in fields)) {
        throw notProgram(`it has a "${block.type}" block that names no bearing.`);
      }
      if ("BEARING" in fields && !BEARINGS.some((b) => b.key === fields.BEARING)) {
        throw notProgram(`it reads "${fields.BEARING}", which is not a bearing the rover measures.`);
      }
      delete block.id;
      // A comment is never written into the code (harden), but a carriage
      // return, U+2028 or U+2029 in one is what once ran as code there. Each
      // is kept as the plain line break it stands for.
      const comment = isObject(block.icons) && isObject(block.icons.comment) ? block.icons.comment : null;
      if (comment && typeof comment.text === "string") comment.text = comment.text.replace(/\r\n?|[\u2028\u2029]/g, "\n");
      const links = [...(isObject(block.inputs) ? Object.values(block.inputs) : []), block.next];
      for (const link of links) {
        if (link === undefined) continue;
        if (!isObject(link)) throw notProgram("it has a block joined to something that is not a block.");
        if (link.block !== undefined) pending.push(link.block);
        if (link.shadow !== undefined) pending.push(link.shadow);
      }
    }
    return copy;
  }

  /* --- the theme --------------------------------------------------------- */

  // Dark, on the panel's own palette (css/panel.css), with the blocks in
  // PALETTE. Blockly paints the workspace from these; program.css styles the
  // rest (the toolbox pills, menus, tooltips, the running block's glow).
  static #defineTheme(Blockly) {
    // Every name read here is declared on :root, which panel.test.js checks:
    // no fallback, and so no second copy of a colour to drift.
    const token = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    const ink = token("--readout");
    const style = (colour) => ({
      colourPrimary: colour,
      colourSecondary: RoverBlocks.#mix(colour, "#ffffff", 0.25),
      colourTertiary: RoverBlocks.#mix(colour, "#000000", 0.3),
    });
    const P = RoverBlocks.PALETTE;

    return Blockly.Theme.defineTheme("rover-dark", {
      base: Blockly.Themes.Classic,
      blockStyles: {
        motion_blocks: style(P.motion),
        sensor_blocks: style(P.sensors),
        loop_blocks: style(P.control),
        logic_blocks: style(P.logic),
        math_blocks: style(P.math),
        variable_blocks: style(P.variables),
        variable_dynamic_blocks: style(P.variables),
        text_blocks: style(P.output),
        stop_blocks: style(P.stop),
      },
      categoryStyles: Object.fromEntries(Object.entries(P).map(([key, colour]) => [`${key}_category`, { colour }])),
      componentStyles: {
        workspaceBackgroundColour: token("--case"),
        toolboxBackgroundColour: token("--panel"),
        toolboxForegroundColour: ink,
        flyoutBackgroundColour: token("--raised"),
        flyoutForegroundColour: ink,
        flyoutOpacity: 1,
        scrollbarColour: token("--dim"),
        scrollbarOpacity: 0.35,
        insertionMarkerColour: "#ffffff",
        insertionMarkerOpacity: 0.25,
        markerColour: token("--live"),
        cursorColour: token("--live"),
      },
      fontStyle: { family: token("--sans"), weight: "600", size: 12 },
      startHats: false,
    });
  }

  // colour mixed toward other by amount (0..1), both #rrggbb.
  static #mix(colour, other, amount) {
    const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    const [a, b] = [rgb(colour), rgb(other)];
    return `#${a.map((c, i) => Math.round(c + (b[i] - c) * amount).toString(16).padStart(2, "0")).join("")}`;
  }
}

/**
 * One Blockly workspace with the rover's blocks, injected into a container
 * and saved to storage as it changes.
 *
 *   new BlockEditor(container, { Blockly, generator, storageKey })
 *     container   an empty element with a size: the workspace fills it.
 *     Blockly     the Blockly global; generator, javascript.javascriptGenerator.
 *     storageKey  where the program is saved between visits.
 *
 *   compile()          the program as an async function of api. Throws an
 *                      Error (with blockId, when one block is to blame) if a
 *                      block cannot be turned into code.
 *   empty              true when the workspace has no blocks.
 *   stacks             how many separate stacks of blocks will run: Run runs
 *                      every enabled one, top to bottom, loose blocks included.
 *   pivots             the pivot motions (codes 9 to 16) its enabled drive
 *                      blocks name, each once, as MOTIONS labels them: what
 *                      the NORMAL scheme keeps off the stick and the pad.
 *   save() / load(state)
 *                      the program in Blockly's JSON form. load() checks the
 *                      shape first and throws, keeping the current program,
 *                      when it is not a rover program.
 *   clear()            remove every block (undo brings them back).
 *   highlight(id)      light up the running block; null for none.
 *   select(id)         select a block and bring it into view.
 *   setReadOnly(on)    lock editing while a program runs.
 *   resize()           fit the container again, after it is shown.
 *   onChange(fn)       fn() after the program changes.
 *
 * Under 600 px of screen the toolbox runs across the top, as a row of pills,
 * and the workspace is rebuilt when the screen crosses that width.
 */
class BlockEditor {
  static NARROW = "(max-width: 600px)";
  static SAVE_DELAY_MS = 400;

  static #AsyncFunction = (async () => {}).constructor;

  #Blockly;
  #generator;
  #theme;
  #container;
  #storageKey;
  #narrow;
  #workspace = null;
  #readOnly = false;
  #placed = false; // the program has been scrolled into a view with a size
  #saveTimer = null;
  #changeListeners = new Listeners();

  constructor(container, { Blockly, generator, storageKey }) {
    this.#Blockly = Blockly;
    this.#generator = generator;
    this.#theme = RoverBlocks.install(Blockly, generator);
    this.#container = container;
    this.#storageKey = storageKey;
    this.#narrow = window.matchMedia(BlockEditor.NARROW);
    // The toolbox's category dots take their colours from here (program.css),
    // so the palette is written once.
    for (const [key, colour] of Object.entries(RoverBlocks.PALETTE)) container.style.setProperty(`--block-${key}`, colour);

    let saved = null;
    try {
      const text = memory.recall(storageKey);
      saved = text ? RoverBlocks.sanitize(JSON.parse(text)) : null;
    } catch {
      saved = null; // a damaged save is dropped, not fatal
    }
    this.#inject(saved);

    // The toolbox's layout is fixed when Blockly is injected, so a change of
    // width across NARROW rebuilds the workspace around the same program.
    this.#narrow.addEventListener("change", () => {
      const state = this.save();
      this.#workspace.dispose();
      this.#inject(state);
    });
  }

  get empty() {
    return this.#workspace.getTopBlocks(false).length === 0;
  }

  // A disabled stack never runs (Blockly writes no code for it), so it is not
  // counted: Run asks about loose stacks only when more than one will run.
  get stacks() {
    return this.#workspace.getTopBlocks(false).filter((block) => block.isEnabled()).length;
  }

  // A disabled block never runs, so its pivot is not counted.
  get pivots() {
    const labels = new Set();
    for (const block of this.#workspace.getAllBlocks(false)) {
      if (!block.isEnabled() || !RoverBlocks.DRIVES.includes(block.type)) continue;
      const motion = motionNamed(block.getFieldValue("MOVE"));
      if (motion && motion.advanced) labels.add(motion.label);
    }
    return [...labels];
  }

  onChange(fn) {
    return this.#changeListeners.add(fn);
  }

  compile() {
    return new BlockEditor.#AsyncFunction("api", `"use strict";\n${this.#generator.workspaceToCode(this.#workspace)}`);
  }

  save() {
    return this.#Blockly.serialization.workspaces.save(this.#workspace);
  }

  load(state) {
    const clean = RoverBlocks.sanitize(state);
    const before = this.save();
    const { workspaces } = this.#Blockly.serialization;
    try {
      workspaces.load(clean, this.#workspace);
    } catch (err) {
      // Blockly clears the workspace before it loads, so put back what was
      // there.
      workspaces.load(before, this.#workspace);
      throw new Error(`It could not be loaded: ${err.message}`);
    }
    this.#showTopLeft();
  }

  clear() {
    this.#workspace.clear();
  }

  highlight(id) {
    const block = id ? this.#workspace.getBlockById(id) : null;
    this.#workspace.highlightBlock(block ? id : null);
    if (block) this.#reveal(block);
  }

  select(id) {
    const block = id ? this.#workspace.getBlockById(id) : null;
    if (!block) return;
    block.select();
    this.#reveal(block);
  }

  setReadOnly(on) {
    this.#readOnly = on;
    this.#workspace.setIsReadOnly(on);
  }

  resize() {
    this.#Blockly.svgResize(this.#workspace);
    // Built in a hidden tab, the workspace had no view to scroll the program
    // into; it has one now.
    if (!this.#placed) this.#showTopLeft();
  }

  #inject(state) {
    const narrow = this.#narrow.matches;
    const workspace = this.#Blockly.inject(this.#container, {
      toolbox: RoverBlocks.toolbox(),
      theme: this.#theme,
      renderer: "zelos",
      media: RoverBlocks.MEDIA,
      sounds: false,
      trashcan: true,
      horizontalLayout: narrow,
      toolboxPosition: "start",
      // --raised-hi in css/panel.css, which panel.test.js checks.
      grid: { spacing: 24, length: 2, colour: "#2b323c", snap: true },
      zoom: { controls: true, wheel: true, startScale: narrow ? 0.72 : 0.85, maxScale: 2, minScale: 0.4, scaleSpeed: 1.15, pinch: true },
      move: { scrollbars: true, drag: true, wheel: false },
      maxTrashcanContents: 16,
    });
    this.#workspace = workspace;

    if (state) {
      try {
        this.#Blockly.serialization.workspaces.load(state, workspace);
      } catch {
        workspace.clear(); // an old save this release cannot read
      }
    }
    if (this.#readOnly) workspace.setIsReadOnly(true);
    this.#showTopLeft();

    workspace.addChangeListener((event) => {
      if (event.isUiEvent) return;
      this.#scheduleSave();
      this.#changeListeners.emit();
    });
  }

  // Scroll a block into view, if there is a view: on the Drive tab the
  // workspace has no size, and a program running there is followed by the
  // highlight alone.
  #reveal(block) {
    if (this.#container.clientWidth > 0) this.#workspace.scrollBoundsIntoView(block.getBoundingRectangleWithoutChildren(), 24);
  }

  #scheduleSave() {
    clearTimeout(this.#saveTimer);
    this.#saveTimer = setTimeout(() => {
      memory.remember(this.#storageKey, JSON.stringify(this.save()));
    }, BlockEditor.SAVE_DELAY_MS);
  }

  // Scroll the program's top-left corner into view, rather than wherever the
  // workspace was left.
  #showTopLeft() {
    const workspace = this.#workspace;
    this.#placed = this.#container.clientWidth > 0;
    if (!this.#placed) return;
    const blocks = workspace.getTopBlocks(true);
    if (blocks.length) workspace.scrollBoundsIntoView(blocks[0].getBoundingRectangleWithoutChildren(), 32);
  }
}

if (typeof module !== "undefined") module.exports = { RoverBlocks };

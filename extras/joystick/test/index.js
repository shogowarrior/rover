// Makes `node --test extras/joystick/test/` run every test here.
//
// Since Node 21, node --test takes its arguments as globs, and a directory is
// no longer searched: it is run as a module, which resolves to this file. So
// this loads each *.test.js beside it, in one process. A glob such as
// `node --test 'extras/joystick/test/*.test.js'` runs the same tests, one
// process per file, without this file.
"use strict";
const fs = require("node:fs");
const path = require("node:path");

for (const file of fs.readdirSync(__dirname).filter((name) => name.endsWith(".test.js")).sort()) {
  require(path.join(__dirname, file));
}

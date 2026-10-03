// The time limit the panel's tests run under, set once. Not a test itself:
// index.js runs only *.test.js.
//
// A regression that leaves a test waiting for good -- an abort that never
// lands, a run whose end never settles, a script that failed to load and
// left a promise unsettled -- then fails by name, instead of holding up the
// run. index.js runs every *.test.js in one process, so one test that never
// ends would hang them all, and CI sets no limit of its own: the job would
// run to GitHub's six hours, and the build hook to its own timeout, neither
// naming the test.
"use strict";
const nodeTest = require("node:test");

const TIMEOUT_MS = 20000;

// node:test's test(name, fn), with the limit.
function test(name, fn, { timeout = TIMEOUT_MS } = {}) {
  return nodeTest.test(name, { timeout }, fn);
}

module.exports = { test, TIMEOUT_MS };

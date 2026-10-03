// The panel's stylesheets, read as the tests check them. Not a test itself:
// index.js runs only *.test.js.
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { PANEL_ROOT } = require("./fake-dom.js");

// css/<file>, as written.
function stylesheet(file) {
  return fs.readFileSync(path.join(PANEL_ROOT, "css", file), "utf8");
}

// Every rule in a stylesheet, { selector, body }, with comments gone. A rule
// inside @media or @container is read as a rule of its own: the at-rule's
// braces are skipped over, not taken for a rule's.
function cssRules(css) {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, "");
  return [...text.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector, body]) => ({ selector: selector.trim(), body }));
}

// The rules inside one @media or @container block, found by its opening as
// written, or null when there is no such block.
function blockRules(css, opening) {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const start = text.indexOf(opening);
  if (start < 0) return null;
  let end = start + opening.length;
  for (let depth = 1; depth > 0 && end < text.length; end++) depth += text[end] === "{" ? 1 : text[end] === "}" ? -1 : 0;
  return cssRules(text.slice(start + opening.length, end - 1));
}

module.exports = { stylesheet, cssRules, blockRules };

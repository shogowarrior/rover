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

// The stylesheet, comments gone, without every block an at-rule of that
// name opens ("@media"), however deep: what applies outside them all.
// cssRules() and blockRules() take what it returns.
function outside(css, atRule) {
  let text = css.replace(/\/\*[\s\S]*?\*\//g, "");
  for (let at = text.indexOf(atRule); at >= 0; at = text.indexOf(atRule, at)) {
    let end = text.indexOf("{", at) + 1;
    for (let depth = 1; depth > 0 && end < text.length; end++) depth += text[end] === "{" ? 1 : text[end] === "}" ? -1 : 0;
    text = text.slice(0, at) + text.slice(end);
  }
  return text;
}

// css/looks.css, and then extra (CSS in its shape), block by block: its
// selector, the look it is for (the default block's is its second
// selector, after :root), and what it declares, name to value.
function lookBlocks(extra = "") {
  return cssRules(stylesheet("looks.css") + extra).map(({ selector, body }) => ({
    selector,
    id: (selector.match(/\[data-look="([\w-]+)"\]$/) || [])[1],
    declared: new Map([...body.matchAll(/([\w-]+)\s*:\s*([^;]+);/g)].map(([, name, value]) => [name, value.trim()])),
  }));
}

// A look's tokens: what it declares but color-scheme.
const tokensOf = (look) => [...look.declared.keys()].filter((name) => name.startsWith("--"));

module.exports = { stylesheet, cssRules, blockRules, outside, lookBlocks, tokensOf };

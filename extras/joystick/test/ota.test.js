// A firmware update over the link: md5.js against node:crypto and RFC 1321,
// the Link keeping the rover's answers out of telemetry, and the Firmware
// section (firmware.js) driven through whole updates, run as the page runs
// it, against a fake rover that answers as the rover's core does.
//
// Every password here is made up for the test.
"use strict";
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
// Time-limited: a file is read and a program run through promises, which a
// regression could leave unsettled (harness.js).
const { test } = require("./harness.js");
const { loadPage, all, flush, connectOpen } = require("./fake-dom.js");
const { telemetry } = require("./firmware.js");
const { md5 } = require("../js/md5.js");

const hex = (bytes) => crypto.createHash("md5").update(bytes).digest("hex");
const HEX32 = /^[0-9a-f]{32}$/;
const ANSWER_MS = 10000; // FirmwareUpdate.ANSWER_MS, which the timeout test reads

// An ESP32 app image as far as the panel and the rover look at one: the
// image's magic byte, chip 0 (the ESP32), and the app description's magic
// word at 32. The rest is made up, and not a multiple of a piece.
function appImage(size = 4321) {
  const bytes = new Uint8Array(size);
  for (let i = 0; i < size; i++) bytes[i] = (i * 151 + 7) & 0xff;
  bytes[0] = 0xe9;
  bytes[12] = 0;
  bytes[13] = 0;
  bytes.set([0x32, 0x54, 0xcd, 0xab], 32);
  return bytes;
}
const RUNNING = hex("the build the rover runs now");

// The rover's side of an update, as src/FirmwareUpdate.cpp keeps it, over
// the page's fake socket, from what the panel sends once it is built.
// answer() answers each message in turn, and each answer may draw another,
// until the panel sends nothing more, or `pieces` pieces have been answered.
class FakeRover {
  constructor(ws, { password = null } = {}) {
    this.ws = ws;
    this.secret = password === null ? null : hex(password);
    this.state = "idle";
    this.text = ws.sent.length; // how many of each the rover has read
    this.pieces = ws.binary.length;
    this.received = [];
    this.heard = []; // every message about an update, in order
  }

  answer({ pieces = Infinity } = {}) {
    for (let answered = 0; ;) {
      if (this.text < this.ws.sent.length) {
        const message = JSON.parse(this.ws.sent[this.text++]);
        if (typeof message.ota === "string") this.#message(message);
      } else if (this.pieces < this.ws.binary.length && answered++ < pieces) {
        this.#piece(this.ws.binary[this.pieces++]);
      } else {
        return;
      }
    }
  }

  get image() {
    return Uint8Array.from(this.received.flatMap((piece) => [...piece]));
  }

  #reply(message) {
    this.ws.serverMsg(message);
  }

  #fail(reason) {
    this.state = "idle";
    this.#reply({ ota: "failed", reason });
  }

  #message(message) {
    this.heard.push(message);
    if (message.ota === "begin") {
      if (this.state === "done") return this.#fail("The rover is about to restart into new firmware.");
      if (this.state !== "idle") return this.#fail("Another update is under way.");
      this.size = message.size;
      this.md5 = message.md5;
      if (this.secret === null) return this.#receive();
      this.state = "auth";
      this.nonce = hex(String(Math.random()));
      return this.#reply({ ota: "auth", nonce: this.nonce });
    }
    if (message.ota === "auth" && this.state === "auth") {
      if (message.response === hex(`${this.secret}:${this.nonce}:${message.cnonce}`)) return this.#receive();
      return this.#fail("Wrong OTA password.");
    }
    if (message.ota === "cancel" && this.state !== "idle" && this.state !== "done") return this.#fail("Cancelled.");
  }

  #receive() {
    this.state = "receiving";
    this.received = [];
    this.#reply({ ota: "next", offset: 0 });
  }

  #piece(piece) {
    if (this.state !== "receiving") return;
    const have = this.received.reduce((sum, each) => sum + each.length, 0);
    if (piece.length === 0 || piece.length > 1000 || have + piece.length > this.size) return this.#fail("A piece did not fit.");
    this.received.push(piece);
    if (have + piece.length < this.size) return this.#reply({ ota: "next", offset: have + piece.length });
    if (hex(this.image) !== this.md5) return this.#fail("MD5 Check Failed");
    this.state = "done";
    this.#reply({ ota: "done" });
  }
}

// A page linked to a rover that takes updates, with its first frame.
function linked(frame = {}) {
  const page = loadPage();
  const ws = connectOpen(page);
  ws.serverMsg(telemetry({ firmware: RUNNING, ...frame }));
  return { page, ws };
}

// Pick a file through the Choose button, as the operator would; resolves
// once the panel has read it.
async function choose(page, bytes, name = "firmware.bin") {
  page.fire(page.$("firmwareChoose"), "click");
  const input = page.$("firmwareFile");
  input.files = [{ name, size: bytes.length, arrayBuffer: async () => bytes.slice().buffer }];
  page.fire(input, "change");
  await flush();
}

const ota = (ws) => ws.moves().filter((m) => typeof m.ota === "string");
const status = (page) => page.$("firmwareStatus");
const start = (page) => page.$("firmwareStart");
const cancel = (page) => page.$("firmwareCancel");
const progress = (page) => page.$("firmwareProgress");

/* --- md5.js ------------------------------------------------------------- */

test("md5: RFC 1321's test suite", () => {
  const suite = {
    "": "d41d8cd98f00b204e9800998ecf8427e",
    a: "0cc175b9c0f1b6a831c399e269772661",
    abc: "900150983cd24fb0d6963f7d28e17f72",
    "message digest": "f96b697d7cb7938d525a2f31aaf161d0",
    abcdefghijklmnopqrstuvwxyz: "c3fcd3d76192e4007dfb496cca67e13b",
    ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789: "d174ab98d277d9f5a5611c2c9f419d9f",
    "12345678901234567890123456789012345678901234567890123456789012345678901234567890": "57edf4a22be3c955ac49da2e2107b67a",
  };
  for (const [text, digest] of Object.entries(suite)) assert.equal(md5(text), digest, JSON.stringify(text));
});

test("md5: node:crypto's, at every length round a block's padding, for a whole image, and for text as UTF-8", () => {
  for (let length = 0; length <= 200; length++) {
    const bytes = crypto.randomBytes(length);
    assert.equal(md5(bytes), hex(bytes), `${length} bytes`);
  }
  const image = crypto.randomBytes(0x1d0000); // a whole app slot (partition.csv)
  assert.equal(md5(image), hex(image));
  assert.equal(md5(image.buffer.slice(image.byteOffset, image.byteOffset + 1000)), hex(image.subarray(0, 1000)), "an ArrayBuffer");
  assert.equal(md5(image.subarray(100, 1100)), hex(image.subarray(100, 1100)), "a view hashes its own bytes only");
  assert.equal(md5("pässwörd ✓"), hex(Buffer.from("pässwörd ✓", "utf8")));
});

test("md5: the page's is the same, on bytes from another realm", () => {
  const page = loadPage();
  const image = appImage();
  assert.equal(page.evalIn("md5")(image), hex(image));
  assert.equal(page.evalIn("md5")(image.buffer), hex(image));
});

/* --- the Link ----------------------------------------------------------- */

test("link: the rover's word about an update goes to onOta, never to telemetry: the scan, the motor warning and the scheme stay", () => {
  const { page, ws } = linked({ scheme: "ADVANCED", motorsReady: false });
  const shown = () => JSON.stringify([
    all(page.$("scan")).filter((n) => /wedge|reading/.test(n.getAttribute("class") || "")).map((n) => [n.attributes, n.textContent]),
    page.$("motorsFault").hidden, page.$("motorsFault").dataset.ready,
    all(page.$("schemeChoice")).map((n) => n.getAttribute("aria-pressed")), page.$("mode").textContent,
  ]);
  const before = shown();
  page.evalIn("globalThis.__ota = []; globalThis.__frames = 0; link.onOta((m) => __ota.push(m)); link.onTelemetry(() => __frames++);");
  for (const message of [{ ota: "next", offset: 0 }, { ota: "auth", nonce: "0".repeat(32) }, { ota: "done" }, { ota: "failed", reason: "Cancelled." }]) {
    ws.serverMsg(message);
  }
  assert.equal(shown(), before);
  assert.equal(page.evalIn("__frames"), 0);
  assert.deepEqual(page.evalIn("JSON.stringify(__ota.map((m) => m.ota))"), JSON.stringify(["next", "auth", "done", "failed"]));
  assert.equal(page.$("motorsFault").hidden, false, "the warning still up");
  // A frame that only mentions "ota" without naming an action is telemetry.
  ws.serverMsg(telemetry({ firmware: RUNNING, ota: 1 }));
  assert.equal(page.evalIn("__frames"), 1);
  assert.equal(ws.sent.length, 0, `sent ${ws.sent}`);
  assert.deepEqual(page.errors, []);
});

test("link: sendBinary sends the bytes as they are, and nothing without an open socket", () => {
  const page = loadPage();
  assert.equal(page.evalIn("link.sendBinary(new Uint8Array([1, 2, 3]))"), false);
  page.$("host").value = "10.0.0.7";
  page.fire(page.$("connect"), "click");
  const ws = page.sockets[0];
  assert.equal(page.evalIn("link.sendBinary(new Uint8Array([1, 2, 3]))"), false, "still connecting");
  ws.serverOpen();
  assert.equal(page.evalIn("link.sendBinary(new Uint8Array([9, 1, 2, 3, 4]).subarray(1, 4))"), true);
  assert.deepEqual(ws.binary.map((piece) => [...piece]), [[1, 2, 3]]);
  assert.equal(ws.sent.length, 0, "no text frame");
  page.fire(page.$("connect"), "click"); // Disconnect
  assert.equal(page.evalIn("link.sendBinary(new Uint8Array([1]))"), false);
  assert.equal(ws.binary.length, 1);
  assert.deepEqual(page.errors, []);
});

/* --- when Update can start ---------------------------------------------- */

test("Update stays off, saying why, until the link is up, the rover reports its firmware and a file is chosen; a press then sends nothing", async () => {
  const page = loadPage();
  const pressSends = (ws) => {
    page.fire(start(page), "click");
    return ws ? ota(ws).length : 0;
  };
  const off = (why) => start(page).disabled && start(page).title === why;
  assert.ok(off("Connect to the rover first."), start(page).title);
  assert.equal(page.$("firmwareBuild").textContent, "—");
  assert.equal(pressSends(null), 0);
  await choose(page, appImage());
  assert.ok(off("Connect to the rover first."), "a file is not enough");

  page.$("host").value = "10.0.0.7";
  page.fire(page.$("connect"), "click");
  const ws = page.sockets.at(-1);
  assert.ok(off("Waiting for the rover to answer."), start(page).title);
  ws.serverOpen();
  assert.ok(off("Waiting for the rover's first report."), start(page).title);
  assert.equal(pressSends(ws), 0);

  // Firmware from before updates over the link reads {"ota": ...} as a STOP
  // that takes control: nothing goes to it.
  ws.serverMsg(telemetry({ firmware: undefined }));
  const tooOld = page.evalIn("FirmwareUpdate.WHY_NOT.tooOld");
  assert.ok(off(tooOld), start(page).title);
  assert.equal(status(page).textContent, tooOld, "said where a touch screen shows it, which has no titles");
  assert.equal(page.$("firmwareBuild").textContent, "an older firmware");
  assert.equal(pressSends(ws), 0);

  ws.serverMsg(telemetry({ firmware: RUNNING }));
  assert.equal(status(page).textContent, "", "and gone with the old firmware");
  assert.equal(page.$("firmwareBuild").textContent, RUNNING.slice(0, 8));
  assert.ok(!start(page).disabled && start(page).title === "", start(page).title);
  assert.ok(cancel(page).disabled && cancel(page).title === "No update to cancel.");
  assert.ok(progress(page).hidden, "no bar before an update");

  page.clock.advance(2000); // telemetry stops
  assert.ok(off("The rover has stopped sending telemetry."), start(page).title);
  ws.serverDrop();
  assert.ok(off("Connect to the rover first."), start(page).title);
  assert.equal(page.$("firmwareBuild").textContent, "—", "what the rover ran belongs to its link");
  assert.equal(ws.sent.length, 0, `sent ${ws.sent}`);
  assert.deepEqual(page.errors, []);
});

test("choosing: Choose opens the picker; only an ESP32 app image is offered, with its size and build", async () => {
  const { page } = linked();
  const notFirmware = page.evalIn("FirmwareUpdate.NOT_FIRMWARE");
  const bootloader = appImage(); // an image, but not an app's
  bootloader.set([0, 0, 0, 0], 32);
  const partitions = new Uint8Array(3072).fill(0xff);
  partitions.set([0xaa, 0x50]);
  const s3 = appImage(); // an app, for another chip
  s3[12] = 9;
  for (const [what, bytes] of [["bootloader.bin", bootloader], ["partitions.bin", partitions], ["s3.bin", s3], ["tiny.bin", appImage().slice(0, 35)]]) {
    await choose(page, bytes, what);
    assert.equal(status(page).textContent, notFirmware, what);
    assert.equal(status(page).dataset.tone, "bad");
    assert.ok(start(page).disabled && start(page).title === "Choose the firmware file to send first.", `${what}: ${start(page).title}`);
    assert.equal(page.$("firmwareChosen").textContent, `${what}, ${Math.ceil(bytes.length / 1024)}\u00a0KB`);
  }
  const image = appImage(100000);
  await choose(page, image);
  assert.equal(page.$("firmwareFile").pickerOpened, 5, "one picker per press of Choose");
  assert.equal(page.$("firmwareFile").value, "", "cleared, so the same file can be picked again");
  assert.equal(page.$("firmwareChosen").textContent, `firmware.bin, 98\u00a0KB, build\u00a0${hex(image).slice(0, 8)}`);
  assert.equal(status(page).textContent, "");
  assert.ok(!start(page).disabled);
  assert.deepEqual(page.errors, []);
});

test("choosing: a read that ends after a later pick does not replace it, and a file that cannot be read says so", async () => {
  const { page } = linked();
  const input = page.$("firmwareFile");
  let finishFirst;
  const first = appImage(2000);
  input.files = [{ name: "old.bin", size: first.length, arrayBuffer: () => new Promise((resolve) => { finishFirst = () => resolve(first.slice().buffer); }) }];
  page.fire(input, "change");
  assert.ok(start(page).disabled, "nothing to send while the file is read");
  const second = appImage(3000);
  await choose(page, second, "new.bin");
  finishFirst();
  await flush();
  assert.equal(page.$("firmwareChosen").textContent, `new.bin, 3\u00a0KB, build\u00a0${hex(second).slice(0, 8)}`);

  input.files = [{ name: "gone.bin", size: 10, arrayBuffer: async () => { throw new Error("The file was moved."); } }];
  page.fire(input, "change");
  await flush();
  assert.equal(status(page).textContent, "Could not read gone.bin: The file was moved.");
  assert.ok(start(page).disabled);
  assert.deepEqual(page.errors, []);
});

/* --- whole updates -------------------------------------------------------- */

test("an update: begin with the file's size and MD5, then one piece per answer from where the rover asks, done, and the rover back on the new firmware", async () => {
  const { page, ws } = linked();
  const image = appImage();
  await choose(page, image);
  page.evalIn("globalThis.__started = 0; firmwareUpdate.onStart(() => { __started = link.state === 'up' && __started + 1; })");
  const rover = new FakeRover(ws);
  page.fire(start(page), "click");
  assert.equal(page.evalIn("__started"), 1, "onStart, before anything is sent");
  assert.deepEqual(ota(ws), [{ ota: "begin", size: image.length, md5: hex(image) }]);
  assert.equal(status(page).textContent, "Starting the update…");
  assert.ok(start(page).disabled && start(page).title === "An update is under way.");
  assert.ok(page.$("firmwareChoose").disabled && page.$("firmwareChoose").title === "An update is under way.");
  assert.ok(!cancel(page).disabled);
  assert.ok(!progress(page).hidden && progress(page).value === 0 && progress(page).max === image.length);

  // Stop and wait: one piece per "next", none before it.
  rover.answer({ pieces: 0 });
  assert.equal(ws.binary.length, 1, "the first piece, on the first next");
  assert.equal(status(page).textContent, "Sending the firmware: keep the rover still and this page open.");
  page.clock.advance(5000);
  assert.equal(ws.binary.length, 1, "nothing more until the rover asks");
  rover.answer({ pieces: 2 });
  assert.equal(ws.binary.length, 3);
  assert.equal(progress(page).value, 2000, "the bar shows what the rover has");
  rover.answer();
  assert.ok(ws.binary.every((piece) => piece.length >= 1 && piece.length <= 1000), ws.binary.map((piece) => piece.length).join());
  assert.equal(ws.binary.length, Math.ceil(image.length / 1000));
  assert.deepEqual(rover.image, image, "the rover has the file, byte for byte");
  assert.equal(rover.state, "done");

  assert.equal(status(page).textContent, "Updated. The rover is restarting: connect again in a few seconds.");
  assert.equal(status(page).dataset.tone, "good");
  assert.equal(progress(page).value, image.length);
  assert.ok(cancel(page).disabled);
  assert.ok(start(page).disabled && /restarting/.test(start(page).title), start(page).title);
  assert.ok(!page.$("firmwareChoose").disabled, "a file can be chosen meanwhile");

  // The old firmware's last frames, before it restarts, do not count.
  ws.serverMsg(telemetry({ firmware: RUNNING }));
  assert.match(status(page).textContent, /^Updated/);
  // The rover restarts: the link goes, and a new one finds the new firmware.
  ws.serverDrop();
  assert.match(status(page).textContent, /^Updated/, "the restart is no failure");
  const again = connectOpen(page);
  again.serverMsg(telemetry({ firmware: hex(image) }));
  assert.equal(status(page).textContent, "The rover is running the firmware you sent.");
  assert.equal(status(page).dataset.tone, "good");
  assert.equal(page.$("firmwareBuild").textContent, hex(image).slice(0, 8));
  assert.ok(progress(page).hidden && !start(page).disabled, start(page).title);
  assert.equal(ota(ws).length, 1, "only begin went as text");
  assert.deepEqual(page.errors, []);
});

test("a rover back on the build it had is looked at again on the next link; one on another build says so", async () => {
  const { page, ws } = linked();
  const image = appImage();
  await choose(page, image);
  const rover = new FakeRover(ws);
  page.fire(start(page), "click");
  rover.answer();
  // Not restarted yet (driven since done), or gone back to its old build.
  page.fire(page.$("connect"), "click"); // Disconnect
  connectOpen(page).serverMsg(telemetry({ firmware: RUNNING }));
  assert.equal(status(page).textContent, "The rover still runs the firmware it had: it has not restarted yet, or went back to it. Connect again to look again.");
  assert.equal(status(page).dataset.tone, "");
  assert.ok(!start(page).disabled && progress(page).hidden, start(page).title);
  // A press now reaches a rover still about to restart, which says so.
  const ws2 = page.sockets.at(-1);
  const again = new FakeRover(ws2);
  again.state = "done";
  page.fire(start(page), "click");
  again.answer();
  assert.equal(status(page).textContent, "Not updated. The rover is about to restart into new firmware.");
  // It restarts: the next link finds the file sent.
  ws2.serverDrop();
  connectOpen(page).serverMsg(telemetry({ firmware: hex(image) }));
  assert.equal(status(page).textContent, "The rover is running the firmware you sent.");

  // Another update, and a rover back on neither build.
  const ws3 = page.sockets.at(-1);
  const third = new FakeRover(ws3);
  page.fire(start(page), "click");
  third.answer();
  ws3.serverDrop();
  connectOpen(page).serverMsg(telemetry({ firmware: RUNNING }));
  assert.equal(status(page).textContent, "The rover is back, but runs other firmware than the file you sent.");
  assert.equal(status(page).dataset.tone, "bad");
  assert.deepEqual(page.errors, []);
});

test("every piece sent but no done (lost as the rover restarted): the next link says whether it took", async () => {
  for (const ending of ["timeout", "drop"]) {
    const { page, ws } = linked();
    const image = appImage(2500);
    await choose(page, image);
    page.fire(start(page), "click");
    for (const offset of [0, 1000, 2000]) ws.serverMsg({ ota: "next", offset });
    assert.equal(ws.binary.length, 3, ending);
    if (ending === "timeout") {
      page.clock.advance(ANSWER_MS);
      assert.equal(status(page).textContent, "The rover stopped answering as the update ended: connect again to see whether it took.");
      assert.deepEqual(ota(ws).at(-1), { ota: "cancel" });
      page.clock.advance(ANSWER_MS);
    }
    ws.serverDrop();
    if (ending === "drop") assert.equal(status(page).textContent, "The link to the rover was lost as the update ended: connect again to see whether it took.");
    connectOpen(page).serverMsg(telemetry({ firmware: hex(image) }));
    assert.equal(status(page).textContent, "The rover is running the firmware you sent.", ending);
    assert.deepEqual(page.errors, []);
  }
});

test("a press that disables its own button hands the focus on, never to the page, where the drive keys would end the update", async () => {
  const { page, ws } = linked();
  await choose(page, appImage());
  page.fire(page.$("options"), "click");
  const focused = () => page.doc.activeElement.id || page.doc.activeElement.tagName;
  start(page).focus();
  assert.equal(focused(), "firmwareStart");
  page.fire(start(page), "click");
  assert.equal(focused(), "firmwareCancel", "Update, then Cancel");
  page.fire(cancel(page), "click");
  assert.equal(focused(), "firmwarePassword", "every button off while the rover's last word is awaited");
  ws.serverMsg({ ota: "failed", reason: "Cancelled." });
  assert.ok(!start(page).disabled);
  assert.deepEqual(page.errors, []);
});

test("a password: answered as ArduinoOTA's is, and never stored, logged or sent", async () => {
  const password = "made-up pässword";
  const { page, ws } = linked();
  page.evalIn("globalThis.__logged = []; globalThis.console = new Proxy({}, { get: () => (...a) => __logged.push(a.join(' ')) });");
  const image = appImage();
  await choose(page, image);
  page.$("firmwarePassword").value = password;
  const rover = new FakeRover(ws, { password });
  page.fire(start(page), "click");
  rover.answer();
  const auth = rover.heard.find((m) => m.ota === "auth");
  assert.ok(auth && HEX32.test(auth.cnonce) && HEX32.test(auth.response), JSON.stringify(auth));
  assert.deepEqual(Object.keys(auth).sort(), ["cnonce", "ota", "response"]);
  assert.equal(auth.response, hex(`${hex(password)}:${rover.nonce}:${auth.cnonce}`));
  assert.equal(rover.state, "done");
  assert.deepEqual(rover.image, image);

  const everything = JSON.stringify([page.store, ws.sent, page.evalIn("__logged")]);
  for (const secret of [password, hex(password)]) assert.ok(!everything.includes(secret), `found ${secret}`);
  assert.deepEqual(page.errors, []);

  // A second update draws a fresh cnonce.
  ws.serverDrop();
  const again = connectOpen(page);
  again.serverMsg(telemetry({ firmware: hex(image) }));
  const second = new FakeRover(again, { password });
  page.fire(start(page), "click");
  second.answer();
  assert.notEqual(second.heard.find((m) => m.ota === "auth").cnonce, auth.cnonce);
});

test("a wrong password, and a rover that refuses, end the update with the rover's reason", async () => {
  const { page, ws } = linked();
  await choose(page, appImage());
  page.$("firmwarePassword").value = "not the one";
  const rover = new FakeRover(ws, { password: "the made-up one" });
  page.fire(start(page), "click");
  rover.answer();
  assert.equal(status(page).textContent, "Not updated. Wrong OTA password.");
  assert.equal(status(page).dataset.tone, "bad");
  assert.ok(!start(page).disabled && cancel(page).disabled && progress(page).hidden);

  page.fire(start(page), "click");
  ws.serverMsg({ ota: "failed", reason: "Another update is under way." });
  assert.equal(status(page).textContent, "Not updated. Another update is under way.");
  page.fire(start(page), "click");
  ws.serverMsg({ ota: "failed" });
  assert.equal(status(page).textContent, "Not updated. The rover gave no reason.");
  assert.deepEqual(page.errors, []);
});

test("no password typed for a rover that asks: the panel cancels, says so, and waits for the rover's last word", async () => {
  const { page, ws } = linked();
  await choose(page, appImage());
  const rover = new FakeRover(ws, { password: "made up" });
  page.fire(start(page), "click");
  rover.answer({ pieces: 0 });
  assert.deepEqual(ota(ws).map((m) => m.ota), ["begin", "cancel"]);
  assert.equal(status(page).textContent, "Not updated. This rover has an OTA password: type it in, then press Update again.");
  assert.equal(rover.state, "idle");
  assert.ok(!start(page).disabled, "the rover's failed came, so another can start");
  assert.equal(status(page).textContent, "Not updated. This rover has an OTA password: type it in, then press Update again.", "the panel's words stay");
  assert.deepEqual(page.errors, []);
});

test("Cancel: the rover is told, an answer that crossed it is not acted on, and Update waits for the rover's last word", async () => {
  const { page, ws } = linked();
  await choose(page, appImage());
  const rover = new FakeRover(ws);
  page.fire(start(page), "click");
  rover.answer({ pieces: 2 });
  const sent = ws.binary.length;
  page.fire(cancel(page), "click");
  assert.deepEqual(ota(ws).at(-1), { ota: "cancel" });
  assert.equal(status(page).textContent, "Cancelled. The rover keeps the firmware it had.");
  assert.equal(status(page).dataset.tone, "");
  assert.ok(cancel(page).disabled && start(page).disabled && start(page).title === "An update is under way.");
  ws.serverMsg({ ota: "next", offset: sent * 1000 }); // sent before the cancel arrived
  assert.equal(ws.binary.length, sent, "no piece after Cancel");
  rover.answer();
  assert.ok(!start(page).disabled && progress(page).hidden, "the rover's failed ends it");
  assert.equal(status(page).textContent, "Cancelled. The rover keeps the firmware it had.");
  // A done that crossed the cancel is still done.
  const next = new FakeRover(ws);
  page.fire(start(page), "click");
  next.answer({ pieces: 4 });
  page.fire(cancel(page), "click");
  ws.serverMsg({ ota: "done" });
  assert.match(status(page).textContent, /^Updated/);
  assert.deepEqual(page.errors, []);
});

test("a rover that stops answering: the panel cancels after ANSWER_MS, and gives up waiting ANSWER_MS later; a stale link alone ends nothing", async () => {
  const { page, ws } = linked();
  assert.equal(page.evalIn("FirmwareUpdate.ANSWER_MS"), ANSWER_MS);
  await choose(page, appImage());
  const rover = new FakeRover(ws);
  page.fire(start(page), "click");
  rover.answer({ pieces: 1 });
  // An erase stalls the rover's loop, telemetry and all: the link goes
  // stale, and the update goes on.
  page.clock.advance(3000);
  assert.equal(page.doc.body.dataset.link, "stale");
  assert.ok(!cancel(page).disabled, "still under way");
  rover.answer({ pieces: 1 });
  assert.equal(page.doc.body.dataset.link, "up");
  page.clock.advance(ANSWER_MS - 1);
  assert.ok(!cancel(page).disabled, "each answer gives the next ANSWER_MS");
  page.clock.advance(1);
  assert.deepEqual(ota(ws).at(-1), { ota: "cancel" });
  assert.equal(status(page).textContent, "Not updated. The rover stopped answering.");
  assert.ok(start(page).disabled, "waiting for the rover's last word");
  page.clock.advance(ANSWER_MS);
  ws.serverMsg(telemetry({ firmware: RUNNING }));
  assert.ok(!start(page).disabled && progress(page).hidden, start(page).title);
  assert.equal(status(page).textContent, "Not updated. The rover stopped answering.");
  assert.deepEqual(page.errors, []);
});

test("the link lost before done ends the update; after done it is the restart", async () => {
  const { page, ws } = linked();
  await choose(page, appImage());
  const rover = new FakeRover(ws);
  page.fire(start(page), "click");
  rover.answer({ pieces: 1 });
  ws.serverDrop();
  assert.equal(status(page).textContent, "Not updated. The link to the rover was lost.");
  assert.equal(status(page).dataset.tone, "bad");
  assert.ok(progress(page).hidden && cancel(page).disabled);
  assert.ok(start(page).disabled && start(page).title === "Connect to the rover first.");
  page.clock.advance(3 * ANSWER_MS);
  assert.equal(status(page).textContent, "Not updated. The link to the rover was lost.", "no timer outlives it");
  const again = connectOpen(page);
  again.serverMsg(telemetry({ firmware: RUNNING }));
  assert.ok(!start(page).disabled);
  assert.equal(again.sent.length, 0, "nothing goes over the new link by itself");

  // Disconnecting from the panel while ending finishes it too.
  page.fire(start(page), "click");
  page.fire(cancel(page), "click");
  page.fire(page.$("connect"), "click");
  assert.ok(progress(page).hidden);
  assert.equal(status(page).textContent, "Cancelled. The rover keeps the firmware it had.");
  assert.deepEqual(page.errors, []);
});

test("a rover that asks for the wrong part of the file: the panel cancels", async () => {
  const { page, ws } = linked();
  await choose(page, appImage(2500));
  page.fire(start(page), "click");
  for (const [answer, sentBefore] of [[{ ota: "next", offset: 5 }, 0], [{ ota: "next", offset: 2500 }, 3], [{ ota: "next" }, 1]]) {
    if (sentBefore > 0) {
      ws.serverMsg({ ota: "failed", reason: "Cancelled." });
      page.fire(start(page), "click");
      for (let i = 0; i < sentBefore; i++) ws.serverMsg({ ota: "next", offset: i * 1000 });
    }
    const pieces = ws.binary.length;
    ws.serverMsg(answer);
    assert.equal(ws.binary.length, pieces, JSON.stringify(answer));
    assert.deepEqual(ota(ws).at(-1), { ota: "cancel" }, JSON.stringify(answer));
    assert.equal(status(page).textContent, "Not updated. The rover asked for the wrong part of the file.");
  }
  assert.deepEqual(page.errors, []);
});

test("starting an update ends a program running on the rover first", async () => {
  const { page, ws } = linked({ mode: "MANUAL" });
  await choose(page, appImage());
  page.evalIn("globalThis.__end = null; runner.run(async (api) => { await api.drive(MOVE_FORWARD, 50, 10); }, targets.rover).then((end) => { __end = end; });");
  await flush();
  page.clock.advance(300);
  assert.equal(page.evalIn("runner.state"), "running");
  page.fire(start(page), "click");
  await flush();
  assert.deepEqual(page.evalIn("JSON.stringify(__end)"), JSON.stringify({ outcome: "stopped", reason: "the rover's firmware is being updated." }));
  const sent = ws.moves();
  const begin = sent.findIndex((m) => m.ota === "begin");
  assert.ok(begin > 0 && sent.slice(0, begin).at(-1).move === 0, "the program's STOP, then begin");
  assert.ok(sent.slice(begin + 1).every((m) => m.move === undefined), "and no drive after it");
  assert.deepEqual(page.errors, []);
});

test("a preview on the simulator carries on through an update: it sends the rover nothing", async () => {
  const { page, ws } = linked({ mode: "MANUAL" });
  await choose(page, appImage());
  page.evalIn("runner.run(async (api) => { await api.drive(MOVE_FORWARD, 50, 10); }, targets.simulator);");
  await flush();
  page.clock.advance(300);
  assert.equal(page.evalIn("runner.state"), "running");
  page.fire(start(page), "click");
  await flush();
  assert.equal(page.evalIn("runner.state"), "running");
  assert.deepEqual(ota(ws).at(-1).ota, "begin");
  assert.ok(ws.moves().every((m) => m.move === undefined), "no drive, nor a STOP, reached the rover");
  page.evalIn("runner.abort('done looking')");
  await flush();
  assert.deepEqual(page.errors, []);
});

test("the update carries on with the Options popover closed, which shows how it went when it opens", async () => {
  const { page, ws } = linked();
  await choose(page, appImage());
  const rover = new FakeRover(ws);
  page.fire(page.$("options"), "click");
  assert.equal(page.$("optionsPanel").hidden, false);
  page.fire(start(page), "pointerdown");
  page.fire(start(page), "click");
  page.fire(page.$("scan"), "pointerdown");
  assert.equal(page.$("optionsPanel").hidden, true);
  rover.answer();
  page.fire(page.$("options"), "click");
  assert.match(status(page).textContent, /^Updated/);
  assert.deepEqual(page.errors, []);
});

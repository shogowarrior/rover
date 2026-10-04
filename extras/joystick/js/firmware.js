/**
 * A firmware update over the link, from the Options popover's Firmware
 * section. The operator picks a build's firmware.bin and the panel sends it
 * to the rover a piece at a time; the rover writes it into its other app
 * slot, checks it whole and restarts into it. Until then, and whenever an
 * update fails, the rover runs the firmware it had.
 *
 *   new FirmwareUpdate({ link, ui })
 *     link  the Link: send(obj), sendBinary(bytes) and state.
 *     ui    the section's elements, by name: build (the firmware the rover
 *           runs), choose and file (a button, and the hidden file input it
 *           opens), chosen (the file's name, size and build), password,
 *           start (Update), cancel, progress, and status (a live line).
 *
 *   show(data)        a telemetry frame (Link.onTelemetry).
 *   linkState(state)  the link's state, on every change (Link.onState).
 *   reply(message)    the rover's word about the update (Link.onOta).
 *   onStart(fn)       fn() as an update starts, before anything is sent for
 *                     it.
 *
 * Update needs the link up, a file that is an ESP32 app (#isApp), and
 * telemetry that names the firmware the rover runs: a rover from before
 * updates over the link reads {"ota": ...} as a STOP that takes control, so
 * nothing is sent to one. The panel sends "begin" with the file's size and
 * MD5, answers the rover's password question if it asks one, then sends the
 * bytes from wherever each "next" says, OTA_CHUNK_BYTES at most, and nothing
 * more until the next reply: the rover drops the link over a piece that
 * arrives split (src/Protocol.h says why).
 *
 * An update ends when the rover says "done" or "failed", when it says
 * nothing for ANSWER_MS, on Cancel, or when the link goes. A stale link alone
 * does not end it: the rover's loop, telemetry and all, stalls while it
 * erases flash. Once done, the rover restarts and the link goes with it;
 * on a link made since, telemetry says whether it runs the file sent. So it
 * does after an update that ended with every piece sent but no "done" (one
 * lost as the rover restarted, say), and again on each new link while the
 * rover still runs the build it had: one driven since "done" restarts only
 * once at rest, and a new build reset within its trial goes back to the old.
 *
 * The update carries on with the popover closed, which shows how it went
 * when it opens again. The password is never remembered or logged, and
 * never sent: only an answer made from it goes to the rover.
 */
class FirmwareUpdate {
  // How long the rover may take to answer. A piece costs it one pass of its
  // loop, and erasing flash on the way some hundreds of ms (2 s at worst);
  // it gives up itself on a panel silent for 5 s (tuning::OTA_SILENCE_MS).
  static ANSWER_MS = 10000;

  // Why Update cannot start now, for its title (F3f: disabled, with a title
  // that says why).
  static WHY_NOT = Object.freeze({
    busy: "An update is under way.",
    restarting: "The rover is restarting: connect again to see the firmware it runs.",
    down: "Connect to the rover first.",
    connecting: "Waiting for the rover to answer.",
    stale: "The rover has stopped sending telemetry.",
    unreported: "Waiting for the rover's first report.",
    tooOld: "This rover's firmware is too old to update from here: flash it over USB once, and it can be updated here from then on.",
    noFile: "Choose the firmware file to send first.",
  });

  static NOT_FIRMWARE = "Not firmware the rover can run: pick firmware.bin from the build's folder under .pio/build/.";

  #link;
  #ui;
  #startListeners = new Listeners();
  // Telemetry's "firmware" on this link: undefined before its first frame,
  // null from a rover that reports none.
  #running = undefined;
  #file = null; // the chosen file, once it passed: { bytes, md5 }
  #picks = 0; // so that a slow read cannot outlast a later pick
  // The update under way: the image and its MD5, the build the rover ran
  // before (from), how much of the image the rover has (acked) and the panel
  // has sent (sent), and its phase: "sending", or "ending" (the panel ended
  // it, and waits for the rover's last word).
  #job = null;
  #timer = null;
  // A file the rover may run now, its update over: { md5, from, size,
  // restarting (after "done", until the link goes), relinked (the link has
  // gone since, so the next frame is a new link's) }.
  #check = null;

  constructor({ link, ui }) {
    this.#link = link;
    this.#ui = ui;
    // The file picker opens only from the press itself (user activation).
    ui.choose.addEventListener("click", () => ui.file.click());
    ui.file.addEventListener("change", () => this.#pick().catch(reportFault));
    ui.start.addEventListener("click", () => this.#start());
    ui.cancel.addEventListener("click", () => {
      if (this.#job && this.#job.phase === "sending") this.#end("Cancelled. The rover keeps the firmware it had.", "");
      this.#update();
    });
    this.#update();
  }

  onStart(fn) {
    return this.#startListeners.add(fn);
  }

  show(data) {
    this.#running = typeof data.firmware === "string" ? data.firmware : null;
    const check = this.#check;
    if (check && check.relinked) {
      if (this.#running === check.md5) {
        this.#say("The rover is running the firmware you sent.", "good");
        this.#check = null;
      } else if (this.#running === check.from) {
        this.#say("The rover still runs the firmware it had: it has not restarted yet, or went back to it. Connect again to look again.");
        check.restarting = false;
        check.relinked = false;
      } else {
        this.#say("The rover is back, but runs other firmware than the file you sent.", "bad");
        this.#check = null;
      }
    }
    this.#update();
  }

  linkState(state) {
    const job = this.#job;
    if (state === "down") {
      this.#running = undefined;
      if (this.#check) this.#check.relinked = true;
      // Ending, the panel has already said why.
      if (job && job.phase === "sending") {
        const check = FirmwareUpdate.#allSent(job);
        if (check) {
          this.#check = check;
          check.relinked = true;
          this.#say("The link to the rover was lost as the update ended: connect again to see whether it took.");
        } else {
          this.#say("Not updated. The link to the rover was lost.", "bad");
        }
      }
      if (job) this.#finish();
    }
    this.#update();
  }

  reply(message) {
    const job = this.#job;
    if (!job) return;
    if (message.ota === OTA_DONE) {
      this.#done();
    } else if (message.ota === OTA_FAILED) {
      if (job.phase === "sending") this.#say(`Not updated. ${message.reason || "The rover gave no reason."}`, "bad");
      this.#finish();
    } else if (job.phase === "sending") {
      // Ending, an answer that crossed the panel's cancel is not acted on.
      if (message.ota === OTA_AUTH) this.#answer(message.nonce);
      else if (message.ota === OTA_NEXT) this.#sendFrom(message.offset);
    }
    this.#update();
  }

  get #busy() {
    return Boolean(this.#job);
  }

  /* --- the steps of an update --------------------------------------------- */

  async #pick() {
    const input = this.#ui.file;
    const file = input.files && input.files[0];
    input.value = ""; // so that the same file, rebuilt, can be picked again
    if (!file || this.#busy) return;
    const pick = ++this.#picks;
    // No-break spaces ( ) keep the size and the build whole where the
    // line beside Choose wraps.
    const about = `${file.name}, ${Math.ceil(file.size / 1024)} KB`;
    this.#file = null;
    this.#ui.chosen.textContent = about;
    this.#say("");
    this.#update();
    let bytes;
    try {
      bytes = new Uint8Array(await file.arrayBuffer());
    } catch (err) {
      if (pick === this.#picks) this.#say(`Could not read ${file.name}: ${err.message}`, "bad");
      return;
    }
    // The page lived on meanwhile: only the latest pick counts. Update stayed
    // off while there was no file, so nothing has started.
    if (pick !== this.#picks) return;
    if (FirmwareUpdate.#isApp(bytes)) {
      this.#file = { bytes, md5: md5(bytes) };
      this.#ui.chosen.textContent = `${about}, build ${this.#file.md5.slice(0, 8)}`;
    } else {
      this.#say(FirmwareUpdate.NOT_FIRMWARE, "bad");
    }
    this.#update();
  }

  #start() {
    if (this.#whyNot()) return;
    const { bytes, md5: digest } = this.#file;
    this.#startListeners.emit();
    if (!this.#link.send({ ota: OTA_BEGIN, size: bytes.length, md5: digest })) return;
    this.#job = { bytes, md5: digest, from: this.#running, acked: 0, sent: 0, phase: "sending" };
    this.#say("Starting the update…");
    this.#await();
    this.#update();
  }

  // The rover's password question, answered as ArduinoOTA's is, so that one
  // OTA password serves both: the MD5 of the password's MD5, the rover's
  // nonce and a fresh one of the panel's.
  #answer(nonce) {
    const password = this.#ui.password.value;
    if (!password) {
      this.#end("Not updated. This rover has an OTA password: type it in, then press Update again.");
      return;
    }
    const cnonce = Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, "0")).join("");
    this.#link.send({ ota: OTA_AUTH, cnonce, response: md5(`${md5(password)}:${nonce}:${cnonce}`) });
    this.#await();
  }

  // The rover asks for the bytes after those it has, which are all the panel
  // has sent: anything else, and the two have lost count.
  #sendFrom(offset) {
    const job = this.#job;
    if (offset !== job.sent || offset >= job.bytes.length) {
      this.#end("Not updated. The rover asked for the wrong part of the file.");
      return;
    }
    if (offset === 0) this.#say("Sending the firmware: keep the rover still and this page open.");
    const piece = job.bytes.subarray(offset, offset + OTA_CHUNK_BYTES);
    job.acked = offset;
    job.sent = offset + piece.length;
    this.#link.sendBinary(piece);
    this.#await();
  }

  #done() {
    this.#check = FirmwareUpdate.#checkFor(this.#job, true);
    this.#finish();
    this.#say("Updated. The rover is restarting: connect again in a few seconds.", "good");
  }

  // What to look for on a later link, if the rover could have the whole
  // file: every piece sent, though its "done" may be lost. Else null.
  static #allSent(job) {
    return job.sent < job.bytes.length ? null : FirmwareUpdate.#checkFor(job, false);
  }

  static #checkFor(job, restarting) {
    return { md5: job.md5, from: job.from, size: job.bytes.length, restarting, relinked: false };
  }

  // The panel ends the update. The rover is told, and its last word is waited
  // for, so that a late one is never taken for the next update's.
  #end(text, tone = "bad") {
    this.#link.send({ ota: OTA_CANCEL });
    this.#job.phase = "ending";
    this.#say(text, tone);
    this.#await();
  }

  #finish() {
    clearTimeout(this.#timer);
    this.#job = null;
  }

  // One answer at a time, each awaited for ANSWER_MS; while ending, the last.
  #await() {
    clearTimeout(this.#timer);
    this.#timer = setTimeout(() => {
      const job = this.#job;
      if (job.phase === "sending") {
        const check = FirmwareUpdate.#allSent(job);
        if (check) this.#check = check;
        if (check) this.#end("The rover stopped answering as the update ended: connect again to see whether it took.", "");
        else this.#end("Not updated. The rover stopped answering.");
      } else {
        this.#finish();
      }
      this.#update();
    }, FirmwareUpdate.ANSWER_MS);
  }

  /* --- what the section shows --------------------------------------------- */

  #whyNot() {
    const why = FirmwareUpdate.WHY_NOT;
    if (this.#job) return why.busy;
    if (this.#check && this.#check.restarting && !this.#check.relinked) return why.restarting;
    const state = this.#link.state;
    if (state !== "up") return why[state];
    if (this.#running === undefined) return why.unreported;
    if (this.#running === null) return why.tooOld;
    return this.#file ? "" : why.noFile;
  }

  #update() {
    const ui = this.#ui;
    const job = this.#job;
    const check = this.#check;
    const running = this.#running;
    const focused = [ui.choose, ui.start, ui.cancel].find((button) => button === document.activeElement);
    ui.build.textContent = running === undefined ? "—" : running === null ? "an older firmware" : running.slice(0, 8);
    ui.choose.disabled = this.#busy;
    ui.choose.title = this.#busy ? FirmwareUpdate.WHY_NOT.busy : "";
    const why = this.#whyNot();
    ui.start.disabled = why !== "";
    ui.start.title = why;
    ui.cancel.disabled = !job || job.phase !== "sending";
    ui.cancel.title = ui.cancel.disabled ? "No update to cancel." : "Stop the update. The rover keeps the firmware it had.";
    // A disabled button drops the focus to the page, where the drive keys
    // are live again, and a key typed next would drive the rover and end
    // the update: the focus moves to the section's next live control, the
    // password's field at the last, which keeps the keys to itself.
    if (focused && focused.disabled) [ui.cancel, ui.start, ui.choose, ui.password].find((control) => !control.disabled).focus();
    // Touch shows no title, and the only way past an old firmware is one
    // the operator has to be told: a USB flash.
    const tooOld = FirmwareUpdate.WHY_NOT.tooOld;
    if (!job && !check && running === null && !ui.status.textContent) this.#say(tooOld);
    else if (running !== null && running !== undefined && ui.status.textContent === tooOld) this.#say("");
    const shown = job ? job.acked : check && check.restarting && !check.relinked ? check.size : null;
    ui.progress.hidden = shown === null;
    if (shown !== null) {
      ui.progress.max = job ? job.bytes.length : check.size;
      ui.progress.value = shown;
    }
  }

  #say(text, tone = "") {
    this.#ui.status.textContent = text;
    this.#ui.status.dataset.tone = tone;
  }

  // An ESP32 app image, by the bytes the rover checks too: the image's magic
  // byte, the chip it is for (0, the ESP32), and the magic word of the app's
  // description, which opens its first segment. A bootloader.bin from the
  // same folder passes the first two.
  static #isApp(bytes) {
    return bytes.length >= 36 && bytes[0] === 0xe9 && bytes[12] === 0 && bytes[13] === 0 &&
      bytes[32] === 0x32 && bytes[33] === 0x54 && bytes[34] === 0xcd && bytes[35] === 0xab;
  }
}

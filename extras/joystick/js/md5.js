/**
 * md5(input): the MD5 of some bytes or text (RFC 1321), as 32 lowercase hex
 * digits, which is how the rover writes one.
 *
 *   input  a Uint8Array or any other view of bytes, an ArrayBuffer, or a
 *          string, which counts as its UTF-8 bytes.
 *
 * A firmware update (firmware.js) needs it three times over: the rover checks
 * the image it receives against the MD5 the panel sends first, it reports
 * the image it runs by that image's MD5, and its OTA password check is
 * ArduinoOTA's, built on MD5. The browser's crypto.subtle has no MD5.
 *
 * A whole image is about 1.9 MB at most, so the blocks are read straight out
 * of the input, with nothing allocated per byte. Only the last block or two,
 * which carry the padding and the length, are copied.
 */
const md5 = (() => {
  // RFC 1321's table, the integer part of 2^32 * |sin(i + 1)|, written out
  // rather than computed: Math.sin need not round alike in every browser.
  const K = new Int32Array([
    0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee, 0xf57c0faf, 0x4787c62a, 0xa8304613, 0xfd469501,
    0x698098d8, 0x8b44f7af, 0xffff5bb1, 0x895cd7be, 0x6b901122, 0xfd987193, 0xa679438e, 0x49b40821,
    0xf61e2562, 0xc040b340, 0x265e5a51, 0xe9b6c7aa, 0xd62f105d, 0x02441453, 0xd8a1e681, 0xe7d3fbc8,
    0x21e1cde6, 0xc33707d6, 0xf4d50d87, 0x455a14ed, 0xa9e3e905, 0xfcefa3f8, 0x676f02d9, 0x8d2a4c8a,
    0xfffa3942, 0x8771f681, 0x6d9d6122, 0xfde5380c, 0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70,
    0x289b7ec6, 0xeaa127fa, 0xd4ef3085, 0x04881d05, 0xd9d4d039, 0xe6db99e5, 0x1fa27cf8, 0xc4ac5665,
    0xf4292244, 0x432aff97, 0xab9423a7, 0xfc93a039, 0x655b59c3, 0x8f0ccc92, 0xffeff47d, 0x85845dd1,
    0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1, 0xf7537e82, 0xbd3af235, 0x2ad7d2bb, 0xeb86d391,
  ]);
  // Each round's four rotations, in turn.
  const SHIFTS = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
  const words = new Int32Array(16); // the block being mixed in, as little-endian words
  const HEX = "0123456789abcdef";

  // Mix the 64 bytes of `bytes` from `at` into the state.
  function mix(state, bytes, at) {
    for (let i = 0; i < 16; i++, at += 4) {
      words[i] = bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16) | (bytes[at + 3] << 24);
    }
    let a = state[0];
    let b = state[1];
    let c = state[2];
    let d = state[3];
    for (let i = 0; i < 64; i++) {
      let f;
      let g;
      if (i < 16) {
        f = (b & c) | (~b & d);
        g = i;
      } else if (i < 32) {
        f = (b & d) | (c & ~d);
        g = (5 * i + 1) & 15;
      } else if (i < 48) {
        f = b ^ c ^ d;
        g = (3 * i + 5) & 15;
      } else {
        f = c ^ (b | ~d);
        g = (7 * i) & 15;
      }
      const sum = (a + f + K[i] + words[g]) | 0;
      const shift = SHIFTS[((i >> 4) << 2) | (i & 3)];
      a = d;
      d = c;
      c = b;
      b = (b + ((sum << shift) | (sum >>> (32 - shift)))) | 0;
    }
    state[0] += a;
    state[1] += b;
    state[2] += c;
    state[3] += d;
  }

  return function md5(input) {
    const bytes = typeof input === "string" ? new TextEncoder().encode(input)
      : ArrayBuffer.isView(input) ? new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
      : new Uint8Array(input);
    const state = new Int32Array([0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476]);
    const whole = bytes.length - (bytes.length % 64);
    for (let at = 0; at < whole; at += 64) mix(state, bytes, at);

    // The rest, a 1 bit, zeros, and the length in bits as 64 bits, little
    // end first: one block, or two when the length no longer fits the first.
    const rest = bytes.length - whole;
    const tail = new Uint8Array(rest < 56 ? 64 : 128);
    tail.set(bytes.subarray(whole));
    tail[rest] = 0x80;
    const bits = bytes.length * 8;
    const end = tail.length - 8;
    for (let i = 0; i < 4; i++) tail[end + i] = (bits >>> (8 * i)) & 0xff;
    const high = Math.floor(bits / 2 ** 32);
    for (let i = 0; i < 4; i++) tail[end + 4 + i] = (high >>> (8 * i)) & 0xff;
    for (let at = 0; at < tail.length; at += 64) mix(state, tail, at);

    let hex = "";
    for (let i = 0; i < 16; i++) {
      const byte = (state[i >> 2] >>> (8 * (i & 3))) & 0xff;
      hex += HEX[byte >> 4] + HEX[byte & 15];
    }
    return hex;
  };
})();

if (typeof module !== "undefined") module.exports = { md5 };

// 16-bit PCM WAV, the render's format. Pure, like edits.ts.

import { frames, type Audio } from "./edits";

/** Audio as a 16-bit PCM WAV file. Samples past -1 to 1 are clipped. */
export function encodeWav(a: Audio): Uint8Array {
  const n = frames(a);
  const ch = a.channels.length;
  const data = n * ch * 2;
  const buf = new ArrayBuffer(44 + data);
  const v = new DataView(buf);
  const text = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
  };
  text(0, "RIFF");
  v.setUint32(4, 36 + data, true);
  text(8, "WAVE");
  text(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, ch, true);
  v.setUint32(24, a.sampleRate, true);
  v.setUint32(28, a.sampleRate * ch * 2, true);
  v.setUint16(32, ch * 2, true);
  v.setUint16(34, 16, true);
  text(36, "data");
  v.setUint32(40, data, true);
  let o = 44;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < ch; c++) {
      const s = Math.max(-1, Math.min(1, a.channels[c][i]));
      v.setInt16(o, s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff), true);
      o += 2;
    }
  }
  return new Uint8Array(buf);
}

/** A 16-bit PCM WAV file as audio; for the tests and for files the page cannot decode. */
export function decodeWav(bytes: Uint8Array): Audio {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (o: number) => String.fromCharCode(bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3]);
  if (tag(0) !== "RIFF" || tag(8) !== "WAVE") throw new Error("Not a WAV file");
  let o = 12;
  let ch = 0;
  let rate = 0;
  let bits = 0;
  while (o + 8 <= bytes.length) {
    const id = tag(o);
    const size = v.getUint32(o + 4, true);
    if (id === "fmt ") {
      if (v.getUint16(o + 8, true) !== 1) throw new Error("Only PCM WAV is read here");
      ch = v.getUint16(o + 10, true);
      rate = v.getUint32(o + 12, true);
      bits = v.getUint16(o + 22, true);
    } else if (id === "data") {
      if (bits !== 16) throw new Error(`Only 16-bit WAV is read here, not ${bits}-bit`);
      const n = Math.floor(Math.min(size, bytes.length - o - 8) / (2 * ch));
      const channels = Array.from({ length: ch }, () => new Float32Array(n));
      for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) channels[c][i] = v.getInt16(o + 8 + (i * ch + c) * 2, true) / 0x8000;
      return { sampleRate: rate, channels };
    }
    o += 8 + size + (size & 1);
  }
  throw new Error("The WAV file has no data");
}

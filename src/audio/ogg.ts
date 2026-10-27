// Ogg Vorbis to WAV, for the hidden player (src/player.ts), which plays only WAV: REDcode gives a voice line's
// or a streamed sound's .wem as Ogg Vorbis. libvorbis compiled to WebAssembly, from
// @wasm-audio-decoders/ogg-vorbis (MIT; libvorbis is BSD): its wasm module and, adapted below, its Decoder.
// The Ogg pages are split here instead of through its codec-parser dependency, which is LGPL-3.0, so nothing
// LGPL is bundled. Notices in THIRD-PARTY-NOTICES.txt.

import { WASMAudioDecoderCommon } from "edgewave-vorbis-common";
import EmscriptenWASM from "edgewave-vorbis-wasm";
import type { Samples } from "./edits";
import { encodeWav } from "./wav";

/** The packets of an Ogg file's first stream, and its length in samples (the last page's granule position). */
export function oggPackets(b: Uint8Array): { packets: Uint8Array[]; samples: number } {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const packets: Uint8Array[] = [];
  let partial: Uint8Array[] = [];
  let serial: number | undefined;
  let samples = 0;
  let o = 0;
  while (o + 27 <= b.length) {
    if (b[o] !== 0x4f || b[o + 1] !== 0x67 || b[o + 2] !== 0x67 || b[o + 3] !== 0x53) throw new Error("Not an Ogg file");
    const segments = b[o + 26];
    let p = o + 27 + segments;
    const mine = (serial ??= v.getUint32(o + 14, true)) === v.getUint32(o + 14, true);
    const granule = v.getBigInt64(o + 6, true);
    if (mine && granule >= 0n) samples = Number(granule); // -1: no packet ends on this page
    for (let i = 0; i < segments; i++) {
      const len = b[o + 27 + i];
      if (mine) {
        partial.push(b.subarray(p, Math.min(p + len, b.length)));
        // A segment under 255 bytes ends a packet; 255 goes on in the next segment, perhaps on the next page.
        if (len < 255) {
          packets.push(partial.length === 1 ? partial[0] : concat(partial));
          partial = [];
        }
      }
      p += len;
    }
    o = p;
  }
  return { packets, samples };
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, x) => n + x.length, 0));
  let at = 0;
  for (const x of parts) {
    out.set(x, at);
    at += x.length;
  }
  return out;
}

interface Typed<T> {
  ptr: number;
  buf: T;
}

/**
 * libvorbis in WebAssembly, fed packets. Adapted from the Decoder in @wasm-audio-decoders/ogg-vorbis
 * (src/OggVorbisDecoder.js, MIT, Copyright Ethan Halsall), without its web worker parts.
 */
class VorbisDecoder {
  private common: any;
  private decoder = 0;
  private input!: Typed<Uint8Array>;
  private inputLen!: Typed<Uint32Array>;
  private outputPtr!: Typed<Uint32Array>;
  private channels!: Typed<Uint32Array>;
  private rate!: Typed<Uint32Array>;
  private decoded!: Typed<Uint32Array>;
  private errors!: Typed<Uint32Array>;
  private errorsLength!: Typed<Int32Array>;
  private first = true;
  readonly ready: Promise<void>;

  constructor() {
    this.ready = new WASMAudioDecoderCommon().instantiate(EmscriptenWASM, undefined).then((common: unknown) => {
      const c = (this.common = common as { allocateTypedArray: <T>(n: number, type: unknown) => Typed<T>; wasm: Record<string, (...a: number[]) => number> });
      this.input = c.allocateTypedArray(128 * 1024, Uint8Array);
      this.inputLen = c.allocateTypedArray(1, Uint32Array);
      this.outputPtr = c.allocateTypedArray(1, Uint32Array);
      this.channels = c.allocateTypedArray(1, Uint32Array);
      this.rate = c.allocateTypedArray(1, Uint32Array);
      this.decoded = c.allocateTypedArray(1, Uint32Array);
      this.errors = c.allocateTypedArray(256, Uint32Array);
      this.errorsLength = c.allocateTypedArray(1, Int32Array);
      this.decoder = c.wasm.create_decoder(this.input.ptr, this.inputLen.ptr, this.outputPtr.ptr, this.channels.ptr, this.rate.ptr, this.decoded.ptr, this.errors.ptr, this.errorsLength.ptr, 256);
    });
  }

  private put(packet: Uint8Array): void {
    if (packet.length > this.input.buf.length) throw new Error("A Vorbis packet is too big");
    this.input.buf.set(packet);
    this.inputLen.buf[0] = packet.length;
  }

  /** The identification header, then the setup header (the comment header is not needed). */
  setup(packet: Uint8Array): void {
    this.put(packet);
    this.common.wasm.send_setup(this.decoder, this.first ? 1 : 0);
    this.first = false;
  }

  initDsp(): void {
    this.common.wasm.init_dsp(this.decoder);
  }

  decode(packets: Uint8Array[]): { channels: Float32Array[]; sampleRate: number; errors: number } {
    const out: Float32Array[][] = [];
    let errors = 0;
    for (const packet of packets) {
      this.put(packet);
      this.common.wasm.decode_packets(this.decoder);
      const n = this.decoded.buf[0];
      const ch = this.channels.buf[0];
      const ptrs = new Uint32Array(this.common.wasm.HEAP, this.outputPtr.buf[0], ch);
      out.push(Array.from({ length: ch }, (_, c) => (n ? new Float32Array(this.common.wasm.HEAP, ptrs[c], n).slice() : new Float32Array(0))));
      errors += this.errorsLength.buf[0] / 2;
      this.errorsLength.buf[0] = 0;
    }
    const ch = this.channels.buf[0];
    const total = out.reduce((n, p) => n + (p[0]?.length ?? 0), 0);
    const channels = Array.from({ length: ch }, () => new Float32Array(total));
    let at = 0;
    for (const p of out) {
      for (let c = 0; c < ch; c++) channels[c].set(p[c], at);
      at += p[0]?.length ?? 0;
    }
    return { channels, sampleRate: this.rate.buf[0], errors };
  }

  free(): void {
    if (!this.common) return;
    this.common.wasm.destroy_decoder(this.decoder);
    this.common.free();
  }
}

export async function oggToWav(bytes: Uint8Array): Promise<Uint8Array> {
  const { packets, samples } = oggPackets(bytes);
  const vorbis = (p: Uint8Array | undefined, type: number) => p && p[0] === type && String.fromCharCode(...p.subarray(1, 7)) === "vorbis";
  if (!vorbis(packets[0], 1) || !vorbis(packets[2], 5)) throw new Error("Not an Ogg Vorbis file");
  const decoder = new VorbisDecoder();
  await decoder.ready;
  try {
    decoder.setup(packets[0]);
    decoder.setup(packets[2]);
    decoder.initDsp();
    const r = decoder.decode(packets.slice(3));
    // The last page says how long the stream is; samples decoded past it are padding.
    const length = samples > 0 ? Math.min(samples, r.channels[0]?.length ?? 0) : (r.channels[0]?.length ?? 0);
    if (!r.channels.length || !length) throw new Error("No audio in the Ogg file");
    return encodeWav({ sampleRate: r.sampleRate, channels: r.channels.map((c) => c.subarray(0, length)) as Samples[] });
  } finally {
    decoder.free();
  }
}

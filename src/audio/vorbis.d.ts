// The parts of @wasm-audio-decoders that src/audio/ogg.ts uses, by the names esbuild.mjs aliases: the shared
// wasm loader, and ogg-vorbis's wasm module (a file its package does not export).
declare module "edgewave-vorbis-common" {
  export const WASMAudioDecoderCommon: new () => { instantiate(wasm: unknown, module: unknown): Promise<unknown> };
}
declare module "edgewave-vorbis-wasm" {
  const EmscriptenWASM: unknown;
  export default EmscriptenWASM;
}

// What other packages call: `const voice = await service.connect('edgewave-voice')`, then
// `await voice.speak(text, 'judy')`. The engine is mod.mjs's (one instance for the window and the service).
// https://edgemodders.github.io/EDGEwave/rednode-voice.html

import { service } from 'rednode';
import { voice as engine } from './mod.mjs';

/**
 * Speaks a line of text in a voice, through ElevenLabs with the player's key, on the game's Dialogue volume. Resolves once the line starts playing. A new line spends the player's ElevenLabs credits and takes a second or more; the same text in the same voice plays again from the cache at once. Listen for the `ended` event to know when it finished.
 * @tool
 * @param {string} text The words to speak, up to 2,500 characters. Speak a conversation line by line.
 * @param {string} [voice] A voice name from `voices`, or an ElevenLabs voice id. Without it, the default voice.
 * @param {{ model?: string, volume?: number, pan?: number, category?: 'dialogue' | 'sfx' | 'music' }} [options] An ElevenLabs model id (eleven_flash_v2_5 unless set up otherwise), the volume (1 as made), pan (-1 left to 1 right), and the volume slider it follows (dialogue unless given).
 * @returns {{ id: number, seconds: number, cached: boolean, voice: string }} The playing line's id (for `stop` and the `ended` event), its length, whether it came from the cache, and the voice's name.
 * @timeout 60000
 */
export function speak(text, voice, options) {
  return engine.speak(text, voice, options ?? {}, service.caller());
}

/**
 * Makes a line ahead of time without playing it, so `speak` with the same text and voice starts at once. Use it for the next line while the current one plays.
 * @param {string} text The words, as `speak` will get them.
 * @param {string} [voice] As for `speak`.
 * @param {{ model?: string }} [options] As for `speak`.
 * @returns {{ seconds: number, cached: boolean, voice: string }} Its length, whether it was already made, and the voice's name.
 * @timeout 60000
 */
export function prepare(text, voice, options) {
  return engine.prepare(text, voice, options ?? {});
}

/**
 * Stops a line by its id, or every line EDGEwave Voice is playing.
 * @tool
 * @param {number} [id] The id `speak` answered. Without it, all of them.
 * @param {number} [fadeOut=0] Milliseconds to fade out.
 * @returns {{ stopped: number }} How many lines it stopped.
 */
export function stop(id, fadeOut = 0) {
  return engine.stop(id, fadeOut);
}

/**
 * The voices a mod may name, set up in VS Code with EDGEwave (EDGEwave: Voices for REDnode…).
 * @tool
 * @readonly
 * @returns {{ name: string, label: string, default: boolean }[]} Each voice's name, what it is, and whether it is the one used when none is named.
 */
export function voices() {
  return engine.voices();
}

/**
 * Whether EDGEwave Voice can speak: the provider, whether the player's key is set, how many voices are set up, the model, and the last error.
 * @tool
 * @readonly
 * @returns {{ provider: string, key: boolean, voices: number, model: string, lastError?: string }} Its state.
 */
export function status() {
  return engine.status();
}

/** @event ended {{ id: number, why: 'ended' | 'stopped' | 'error', caller?: { id: string, name: string } }} A line finished, was stopped, or could not play. */

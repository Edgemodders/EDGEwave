// EDGEwave Voice's window: the ElevenLabs key, the voices EDGEwave set up, and a line to try. The engine is
// core.mjs (built from EDGEwave's src/voicePackage/core.ts); service.mjs offers it to other packages.
// https://edgemodders.github.io/EDGEwave/rednode-voice.html

import { audio, pkg, secrets, service, ui } from 'rednode';
import { createVoice } from './core.mjs';

export const voice = createVoice({
  dir: pkg.dir,
  secrets,
  audio,
  emit: (event, data) => service.emit(event, data),
  log: (line) => console.log(line),
});

const keyLine = ui.text('', { tone: 'dim' });
const voicesLine = ui.text('', { tone: 'dim' });
const errorLine = ui.text('', { tone: 'danger' });
const keyInput = ui.input({
  label: 'ElevenLabs API key',
  placeholder: 'Paste it here and press Enter',
  onSubmit: async (value) => {
    await voice.setKey(value);
    keyInput.set({ value: '' });
  },
});
let tryText = 'Wake up, samurai. We have a city to burn.';
const tryInput = ui.input({ label: 'Try a line', value: tryText, onChange: (v) => (tryText = v), onSubmit: (v) => { tryText = v; void tryIt(); } });

async function tryIt() {
  try {
    const r = await voice.speak(tryText);
    errorLine.set({ text: '' });
    voicesLine.set({ text: `${r.voice}: ${r.seconds} s${r.cached ? ', from the cache' : ''}` });
  } catch (err) {
    errorLine.set({ text: err.message });
  }
}

async function refresh() {
  const s = await voice.status();
  keyLine.set({ text: s.key ? 'Key set. Each new line spends your ElevenLabs credits.' : 'No key yet: paste your ElevenLabs API key below.', tone: s.key ? 'dim' : 'accent' });
  const names = voice.voices().map((v) => v.name);
  voicesLine.set({ text: names.length ? `Voices: ${names.join(', ')}` : 'No voices set up: in VS Code, EDGEwave: Voices for REDnode…' });
  errorLine.set({ text: s.lastError ?? '' });
  return s;
}

const win = ui.window({
  title: 'EDGEwave Voice',
  width: 420,
  height: 360,
  anchor: 'right',
  x: -40,
  children: [
    keyLine,
    keyInput,
    ui.row(ui.button('Forget the key', () => voice.clearKey(), { variant: 'ghost' })),
    voicesLine,
    tryInput,
    ui.row(ui.button('Speak', () => tryIt()), ui.button('Stop', () => voice.stop(), { variant: 'ghost' })),
    errorLine,
  ],
});

voice.onChange(() => void refresh());
// With a key set, the window waits closed: the launcher shows it again.
const first = await refresh();
if (first.key) win.close();
console.log(`EDGEwave Voice ready: ${first.voices} voice${first.voices === 1 ? '' : 's'}, ${first.key ? 'key set' : 'no key yet'}`);

// What both pages show when ElevenLabs has no API key, or refuses the one set: a button that asks for it
// (the host's input box, into VS Code's secret storage) and one to the page that says where to make one.
// The host answers Set with keySet; the page then tries again what failed.

/** An error from the host that a new API key may fix. */
export const keyError = (message: string): Error => Object.assign(new Error(message), { key: true });
export const isKeyError = (e: unknown): boolean => !!(e && typeof e === "object" && (e as { key?: boolean }).key);

/** The two buttons, sending setKey and keyHelp to the host. */
export function keyFix(send: (m: unknown) => void): HTMLElement {
  const set = document.createElement("button");
  set.type = "button";
  set.className = "primary";
  set.textContent = "Set ElevenLabs API Key…";
  set.addEventListener("click", () => send({ type: "setKey" }));
  const help = document.createElement("button");
  help.type = "button";
  help.textContent = "Where to make one";
  help.title = "ElevenLabs' help: Developers > API Keys. A new key needs the features EDGEwave uses turned on (text to speech, voices, sound effects, voice changer).";
  help.addEventListener("click", () => send({ type: "keyHelp" }));
  const box = document.createElement("span");
  box.className = "keyfix";
  box.append(set, help);
  return box;
}

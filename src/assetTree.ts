// The Game Assets view's pure parts (src/gameAssets.ts): the filter typed into it, and the grouping that
// keeps a folder of 78,026 voice lines browsable. No VS Code imports, for the unit tests.
//
// The filter, as REDcode's Game Assets view takes it (its own code is not used):
//   judy            "judy" anywhere in the name or path
//   judy q307       both words, in any order
//   *_f_*.wem       a wildcard pattern: * any run of characters, ? one character, over the whole path
// Case does not matter; / and \ are the same.

export interface AssetFilter {
  pattern: string;
  test(text: string): boolean;
  /** The longest plain fragment, for the bridge's substring search before test() narrows it. */
  seed: string;
}

const norm = (s: string) => s.toLowerCase().replace(/\//g, "\\");

export function compileFilter(pattern: string): AssetFilter | undefined {
  const words = pattern.trim().split(/\s+/).filter(Boolean).map(norm);
  if (!words.length) return undefined;
  const tests = words.map((w) => {
    if (!/[*?]/.test(w)) return (p: string) => p.includes(w);
    const body = w.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
    const re = new RegExp(`${w.startsWith("*") ? "" : "(^|\\\\)"}${body}${w.endsWith("*") ? "" : "$"}`);
    return (p: string) => re.test(p);
  });
  const seed = words.flatMap((w) => w.split(/[*?]+/)).reduce((a, b) => (b.length > a.length ? b : a), "");
  return { pattern: pattern.trim(), test: (p) => tests.every((t) => t(norm(p))), seed };
}

/** A name's parts for grouping: split at _, without a voice line's trailing gender and id (_f_ + 16 hex). */
export function nameParts(name: string): string[] {
  const base = name.replace(/\.[^.\\/]+$/, "").split(/[\\/]/).pop() ?? name;
  const parts = base.toLowerCase().split("_").filter(Boolean);
  if (parts.length >= 2 && /^[0-9a-f]{16}$/.test(parts[parts.length - 1]) && /^[fm]$/.test(parts[parts.length - 2])) parts.length -= 2;
  return parts;
}

export interface Grouped<T> {
  /** Groups by a longer prefix of name parts, with how many items each holds. */
  groups: { prefix: string; count: number }[];
  /** Items shown here: few enough, or with no further part to group by. */
  items: T[];
}

/**
 * Items under a prefix of name parts (empty: all), grouped by one more part when there are more than
 * `most`. A group of one is shown as its item; when every item would land in one group, it goes a part
 * deeper by itself, so no level holds a single group.
 */
export function groupByParts<T>(all: readonly T[], nameOf: (t: T) => string, prefix: string, most = 400): Grouped<T> {
  const p = prefix ? prefix.split("_") : [];
  const under = all.filter((t) => {
    const parts = nameParts(nameOf(t));
    return p.every((x, i) => parts[i] === x);
  });
  if (under.length <= most) return { groups: [], items: under };
  for (let depth = p.length; ; depth++) {
    const by = new Map<string, T[]>();
    const loose: T[] = [];
    for (const t of under) {
      const parts = nameParts(nameOf(t));
      if (parts.length <= depth) loose.push(t);
      else {
        const key = parts.slice(0, depth + 1).join("_");
        (by.get(key) ?? by.set(key, []).get(key)!).push(t);
      }
    }
    if (by.size === 0) return { groups: [], items: under };
    if (by.size === 1 && loose.length === 0) continue;
    const groups: { prefix: string; count: number }[] = [];
    const items = [...loose];
    for (const [key, list] of [...by].sort(([a], [b]) => a.localeCompare(b))) {
      if (list.length === 1) items.push(list[0]);
      else groups.push({ prefix: key, count: list.length });
    }
    return { groups, items };
  }
}

/** A size for a description: 512 B, 41 KB, 4.7 MB. */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** The voice folders of a language: vo, vo_holocall, vo_helmet, vo_rewinded (doc.ts's looksLikeVoice). */
export const isVoiceFolder = (name: string) => /^vo(_[a-z]+)?$/i.test(name);

/** The game's audio files that play on their own: Wwise .wem (voice lines, streamed sounds and music). */
export const isAudioFile = (name: string) => /\.wem$/i.test(name);

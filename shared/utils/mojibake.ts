export function maybeFixMojibake(input: string): string {
  // Fixes common UTF-8 -> Windows-1252 mojibake caused by charset mismatches.
  // The idea: treat the current string as Windows-1252 bytes, then decode as UTF-8.
  // This is intentionally conservative to avoid touching normal text.
  if (!input) return input;
  if (!/[\u00E2\u00C3\u00F0\u00C2]/.test(input)) return input;
  if (typeof TextDecoder === 'undefined') return input;

  const win1252Map: Record<number, number> = {
    0x20ac: 0x80,
    0x201a: 0x82,
    0x0192: 0x83,
    0x201e: 0x84,
    0x2026: 0x85,
    0x2020: 0x86,
    0x2021: 0x87,
    0x02c6: 0x88,
    0x2030: 0x89,
    0x0160: 0x8a,
    0x2039: 0x8b,
    0x0152: 0x8c,
    0x017d: 0x8e,
    0x2018: 0x91,
    0x2019: 0x92,
    0x201c: 0x93,
    0x201d: 0x94,
    0x2022: 0x95,
    0x2013: 0x96,
    0x2014: 0x97,
    0x02dc: 0x98,
    0x2122: 0x99,
    0x0161: 0x9a,
    0x203a: 0x9b,
    0x0153: 0x9c,
    0x017e: 0x9e,
    0x0178: 0x9f,
  };

  const bytes = new Uint8Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const cp = input.charCodeAt(i);
    if (cp <= 0xff) {
      bytes[i] = cp;
      continue;
    }
    const mapped = win1252Map[cp];
    if (typeof mapped !== 'number') return input;
    bytes[i] = mapped;
  }

  let decoded = '';
  try {
    decoded = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  } catch {
    return input;
  }

  // If decode produced replacement chars, keep original.
  if (decoded.includes('\uFFFD')) return input;

  // Prefer decoded only when it looks less broken.
  const score = (s: string) => (s.match(/[\u00E2\u00C3\u00F0\u00C2]/g) || []).length;
  return score(decoded) < score(input) ? decoded : input;
}

export function fixMojibakeDeep<T>(value: T): T {
  const seen = new Map<any, any>();
  const visit = (v: any): any => {
    if (typeof v === 'string') return maybeFixMojibake(v);
    if (!v || typeof v !== 'object') return v;
    if (seen.has(v)) return seen.get(v);

    if (Array.isArray(v)) {
      const arr = v.map(visit);
      seen.set(v, arr);
      return arr;
    }

    // Only process plain objects; leave Dates/Errors/etc untouched.
    const proto = Object.getPrototypeOf(v);
    if (proto !== Object.prototype && proto !== null) return v;

    const out: any = {};
    seen.set(v, out);
    for (const [k, child] of Object.entries(v)) out[k] = visit(child);
    return out;
  };
  return visit(value) as T;
}

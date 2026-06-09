// Slug parts for share URLs. Produces 3 mathematician/geometer words plus a
// random base36 suffix. The UI displays just the words; the suffix is kept in
// the actual URL for entropy (~3 words from 70 + 5 base36 chars ≈ 44 bits —
// unguessable for an online lookup, the only access control on a sketch).

import WORDS from '../data/slug-words.json';

const SUFFIX_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'; // base36, url-safe
const NUM_WORDS = 3;
const SUFFIX_LEN = 5;

function randomInt(max) {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] % max;
}

export function generateSlugParts() {
  const words = [];
  const used = new Set();
  while (words.length < NUM_WORDS) {
    const w = WORDS[randomInt(WORDS.length)];
    if (used.has(w)) continue; // no repeats within one slug
    used.add(w);
    words.push(w);
  }
  let suffix = '';
  for (let i = 0; i < SUFFIX_LEN; i++) {
    suffix += SUFFIX_ALPHABET[randomInt(SUFFIX_ALPHABET.length)];
  }
  return { words, suffix };
}

export function slugFromParts(parts) {
  return [...parts.words, parts.suffix].join('-');
}

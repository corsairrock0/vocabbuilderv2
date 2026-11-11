// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
// Reader for a Morfologik CFSA2 dictionary (polish.dict + polish.info from morfologik/morfologik-stemming).
// Own implementation of the documented binary format; none of Morfologik's code is used.
//
//   header   "\fsa", version 0xc6, flags (2 bytes, big-endian), label-table size, label table, then the arcs
//   arc      flag byte N|L|F|M5 (target is the next node, last arc, final arc, 5-bit label index where 0 means
//            an explicit label byte follows), then a v-coded target address unless the N bit is set
//   entries  inflected form <sep> encoded lemma <sep> tags, with the PREFIX encoder: byte 'A'+n (letters cut from
//            the start of the form), byte 'A'+m (letters cut from its end), then the letters to append
import { readFileSync } from 'node:fs';

const TARGET_NEXT = 0x80;
const LAST_ARC = 0x40;
const FINAL_ARC = 0x20;
const LABEL_MASK = 0x1f;

function readInfo(file) {
  const info = {};
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#') || !t.includes('=')) continue;
    const i = t.indexOf('=');
    info[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
  return info;
}

/**
 * Every entry whose lemma is wanted → Map<lemma, [form, tags][]>. `wanted` holds lemmas exactly as the
 * dictionary spells them (lower case for common words).
 */
export function readMorfologik(dictFile, infoFile, wanted) {
  const info = readInfo(infoFile);
  if ((info['fsa.dict.encoder'] ?? 'SUFFIX').toUpperCase() !== 'PREFIX') throw new Error(`${infoFile}: only the PREFIX encoder is supported`);
  const sep = Buffer.from(info['fsa.dict.separator'] ?? '+', 'utf8')[0];
  const data = readFileSync(dictFile);
  if (data.toString('latin1', 0, 4) !== '\\fsa' || data[4] !== 0xc6) throw new Error(`${dictFile} is not a CFSA2 automaton`);
  const flags = data.readUInt16BE(5);
  if (flags & 0x100) throw new Error(`${dictFile}: automata with NUMBERS are not supported`);
  const nLabels = data[7];
  const labels = data.subarray(8, 8 + nLabels);
  const arcs = data.subarray(8 + nLabels);

  const vint = (off) => {
    let b = arcs[off];
    let value = b & 0x7f;
    let shift = 7;
    while (b & 0x80) {
      b = arcs[++off];
      value |= (b & 0x7f) << shift;
      shift += 7;
    }
    return value;
  };
  const skipArc = (off) => {
    const flag = arcs[off++];
    if ((flag & LABEL_MASK) === 0) off++;
    if (!(flag & TARGET_NEXT)) {
      while (arcs[off] & 0x80) off++;
      off++;
    }
    return off;
  };
  const label = (arc) => {
    const i = arcs[arc] & LABEL_MASK;
    return i ? labels[i] : arcs[arc + 1];
  };
  const target = (arc) => {
    if (arcs[arc] & TARGET_NEXT) {
      while (!(arcs[arc] & LAST_ARC)) arc = skipArc(arc);
      return skipArc(arc);
    }
    return vint(arc + ((arcs[arc] & LABEL_MASK) === 0 ? 2 : 1));
  };

  const out = new Map();
  const buf = Buffer.alloc(1024);
  // Depth-first walk with an explicit stack of [node, depth, label of the arc into it]; buf holds the bytes of the
  // current path. A popped node restores its own byte; the bytes before it are still its ancestors'.
  const stack = [[target(0), 0, -1]];
  while (stack.length) {
    const [node, depth, into] = stack.pop();
    if (depth > 0) buf[depth - 1] = into;
    let arc = node;
    for (;;) {
      const lab = label(arc);
      buf[depth] = lab;
      if (arcs[arc] & FINAL_ARC) emit(depth + 1);
      const dest = target(arc);
      if (dest) stack.push([dest, depth + 1, lab]);
      if (arcs[arc] & LAST_ARC) break;
      arc = skipArc(arc);
    }
  }
  return out;

  function emit(len) {
    const s1 = buf.indexOf(sep, 0);
    if (s1 < 0 || s1 >= len) return;
    const s2 = buf.indexOf(sep, s1 + 1);
    if (s2 < 0 || s2 >= len) return;
    const form = buf.subarray(0, s1);
    const coded = buf.subarray(s1 + 1, s2);
    let cutStart = (coded[0] - 65) & 0xff;
    let cutEnd = (coded[1] - 65) & 0xff;
    if (cutStart === 255 || cutEnd === 255) {
      cutStart = form.length;
      cutEnd = 0;
    }
    const lemma = Buffer.concat([form.subarray(cutStart, form.length - cutEnd), coded.subarray(2)]).toString('utf8');
    if (!wanted.has(lemma)) return;
    const list = out.get(lemma) ?? [];
    list.push([form.toString('utf8'), buf.toString('utf8', s2 + 1, len)]);
    out.set(lemma, list);
  }
}

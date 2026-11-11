// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
// Minimal MessagePack decoder, enough for wordfreq's cBpack files (arrays, maps, strings, ints, floats, nil, bools).
export function decode(buf) {
  let i = 0;
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const str = (n) => { const s = buf.toString('utf8', i, i + n); i += n; return s; };
  const arr = (n) => { const a = new Array(n); for (let k = 0; k < n; k++) a[k] = read(); return a; };
  const map = (n) => { const o = {}; for (let k = 0; k < n; k++) { const key = read(); o[key] = read(); } return o; };
  function read() {
    const b = buf[i++];
    if (b <= 0x7f) return b;
    if (b >= 0x80 && b <= 0x8f) return map(b & 0x0f);
    if (b >= 0x90 && b <= 0x9f) return arr(b & 0x0f);
    if (b >= 0xa0 && b <= 0xbf) return str(b & 0x1f);
    if (b >= 0xe0) return b - 0x100;
    switch (b) {
      case 0xc0: return null;
      case 0xc2: return false;
      case 0xc3: return true;
      case 0xca: { const v = dv.getFloat32(i); i += 4; return v; }
      case 0xcb: { const v = dv.getFloat64(i); i += 8; return v; }
      case 0xcc: return buf[i++];
      case 0xcd: { const v = dv.getUint16(i); i += 2; return v; }
      case 0xce: { const v = dv.getUint32(i); i += 4; return v; }
      case 0xd0: { const v = dv.getInt8(i); i += 1; return v; }
      case 0xd1: { const v = dv.getInt16(i); i += 2; return v; }
      case 0xd2: { const v = dv.getInt32(i); i += 4; return v; }
      case 0xd9: { const n = buf[i++]; return str(n); }
      case 0xda: { const n = dv.getUint16(i); i += 2; return str(n); }
      case 0xdb: { const n = dv.getUint32(i); i += 4; return str(n); }
      case 0xdc: { const n = dv.getUint16(i); i += 2; return arr(n); }
      case 0xdd: { const n = dv.getUint32(i); i += 4; return arr(n); }
      case 0xde: { const n = dv.getUint16(i); i += 2; return map(n); }
      case 0xdf: { const n = dv.getUint32(i); i += 4; return map(n); }
      default: throw new Error(`unsupported msgpack byte 0x${b.toString(16)} at ${i - 1}`);
    }
  }
  return read();
}

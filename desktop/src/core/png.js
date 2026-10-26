// PNG minimal : encodeur (aperçu de secours du téléphone simulé sans Electron) et
// décodeur (lecture de la couleur du cœur J'aime sur une capture d'écran).

import zlib from 'node:zlib';

const CRC = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function crc32(buf) {
  let c = -1;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

const hex = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));

/** @param {{x:number,y:number,w:number,h:number,color:string}[]} rects coordonnées déjà à l'échelle */
/**
 * Décode un PNG 8 bits RVB ou RVBA non entrelacé (format de `screencap -p`).
 * @returns {{width:number, height:number, channels:number, data:Buffer}}
 */
export function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('Pas un PNG.');
  let pos = 8;
  let width = 0, height = 0, depth = 0, type = 0, interlace = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const t = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (t === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); depth = data[8]; type = data[9]; interlace = data[12]; }
    if (t === 'IDAT') idat.push(data);
    if (t === 'IEND') break;
    pos += 12 + len;
  }
  const channels = type === 6 ? 4 : type === 2 ? 3 : 0;
  if (depth !== 8 || !channels || interlace) throw new Error('Format PNG non pris en charge.');
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const o = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? out[o + x - channels] : 0;
      const b = y > 0 ? out[o - stride + x] : 0;
      const c = x >= channels && y > 0 ? out[o - stride + x - channels] : 0;
      let v = line[x];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      out[o + x] = v & 0xff;
    }
  }
  return { width, height, channels, data: out };
}

/**
 * Le cœur J'aime est-il rouge sur la capture ? Part des pixels rouge Instagram dans `bounds`
 * (coordonnées de l'écran, `screenWidth` px de large ; la capture peut être réduite).
 * @returns {boolean|null} true = rouge (liké), false = blanc (pas liké), null = impossible à dire
 */
export function heartIsRed(png, bounds, screenWidth) {
  const img = decodePng(png);
  const k = img.width / screenWidth;
  const [x1, y1, x2, y2] = bounds.map((v) => Math.round(v * k));
  let red = 0, white = 0, n = 0;
  for (let y = Math.max(0, y1); y < Math.min(img.height, y2); y++) {
    for (let x = Math.max(0, x1); x < Math.min(img.width, x2); x++) {
      const i = (y * img.width + x) * img.channels;
      const r = img.data[i], g = img.data[i + 1], b = img.data[i + 2];
      if (r > 200 && g < 100 && b < 120) red++;
      else if (r > 215 && g > 215 && b > 215) white++;
      n++;
    }
  }
  if (!n) return null;
  if (red / n > 0.06) return true;
  if (white / n > 0.03) return false;
  return null;
}

export function rectsToPng(width, height, rects, bg = '#000000') {
  const px = Buffer.alloc(width * height * 3);
  const fill = (x0, y0, w, h, [r, g, b]) => {
    const x1 = Math.max(0, Math.floor(x0)), y1 = Math.max(0, Math.floor(y0));
    const x2 = Math.min(width, Math.ceil(x0 + w)), y2 = Math.min(height, Math.ceil(y0 + h));
    for (let y = y1; y < y2; y++) for (let x = x1; x < x2; x++) {
      const i = (y * width + x) * 3;
      px[i] = r; px[i + 1] = g; px[i + 2] = b;
    }
  };
  fill(0, 0, width, height, hex(bg));
  for (const r of rects) fill(r.x, r.y, r.w, r.h, hex(r.color));
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) px.copy(raw, y * (width * 3 + 1) + 1, y * width * 3, (y + 1) * width * 3);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

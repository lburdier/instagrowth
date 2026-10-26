// Encodeur PNG minimal (rectangles pleins) : sert d'aperçu de secours du
// téléphone simulé quand l'app tourne sans Electron (tests en ligne de commande).

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

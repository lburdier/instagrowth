// Génère build/icon.png (512 × 512) à partir de assets/icon.svg, pour l'icône du .exe.
//   npx electron scripts/make-icon.mjs

import { app, BrowserWindow } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

app.whenReady().then(async () => {
  const svg = fs.readFileSync(path.join(root, 'assets', 'icon.svg'), 'utf8');
  const win = new BrowserWindow({ show: false, width: 512, height: 512, useContentSize: true, frame: false, transparent: true, webPreferences: { offscreen: true } });
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`<body style="margin:0;background:transparent;overflow:hidden">${svg}</body>`)}`);
  const img = await new Promise((resolve) => {
    win.webContents.on('paint', (_e, _d, image) => { if (!image.isEmpty()) resolve(image); });
    win.webContents.invalidate();
  });
  fs.mkdirSync(path.join(root, 'build'), { recursive: true });
  fs.writeFileSync(path.join(root, 'build', 'icon.png'), img.toPNG());
  console.log(`build/icon.png : ${img.getSize().width} × ${img.getSize().height}`);
  app.exit(0);
});

// Copia os ícones para dist/ (o tsc só emite .js).
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
for (const dir of ['nodes/Utalks', 'nodes/UtalksTrigger']) {
  const src = path.join(root, dir);
  const dst = path.join(root, 'dist', dir);
  fs.mkdirSync(dst, { recursive: true });
  for (const f of fs.readdirSync(src)) {
    if (f.endsWith('.svg') || f.endsWith('.json')) fs.copyFileSync(path.join(src, f), path.join(dst, f));
  }
}

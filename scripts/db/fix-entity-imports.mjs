#!/usr/bin/env node
// One-off fixup: recomputes the `import { ... } from 'typeorm'` line in
// already-generated entity files based on which decorators the file body
// actually uses — needed because generate-entities.mjs used to always import
// PrimaryColumn + PrimaryGeneratedColumn regardless of usage. Doesn't need
// DB access, unlike re-running generate-entities.mjs.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ENTITIES_DIR = join(import.meta.dirname, '..', '..', 'server', 'src', 'database', 'entities');
const CANDIDATES = ['Entity', 'Column', 'PrimaryColumn', 'PrimaryGeneratedColumn'];

let fixed = 0;
for (const domain of readdirSync(ENTITIES_DIR)) {
  const domainDir = join(ENTITIES_DIR, domain);
  for (const file of readdirSync(domainDir)) {
    if (!file.endsWith('.entity.ts') || file === 'base.entity.ts' || file === 'tenant-base.entity.ts') continue;
    const path = join(domainDir, file);
    const content = readFileSync(path, 'utf8');
    const [importLine, ...rest] = content.split('\n');
    if (!importLine.startsWith('import {') || !importLine.includes("from 'typeorm'")) continue;

    const body = rest.join('\n');
    const used = CANDIDATES.filter((d) => d === 'Entity' || body.includes(`@${d}(`));
    const newImportLine = `import { ${used.join(', ')} } from 'typeorm';`;
    if (newImportLine !== importLine) {
      writeFileSync(path, [newImportLine, ...rest].join('\n'));
      fixed++;
    }
  }
}
console.log(`Fixed imports in ${fixed} entity files`);

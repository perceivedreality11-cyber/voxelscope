import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
let count = 0;
for (const dir of ['src', 'server', 'scripts', 'tests']) {
  for (const file of await readdir(dir)) if (/\.(js|mjs)$/.test(file)) {
    const result = spawnSync(process.execPath, ['--check', join(dir, file)], { stdio: 'inherit' });
    if (result.status !== 0) process.exit(result.status || 1); count++;
  }
}
console.log(`Syntax checked ${count} JavaScript modules.`);

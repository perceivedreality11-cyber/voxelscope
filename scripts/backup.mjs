import { DatabaseSync, backup } from 'node:sqlite';
import { mkdir, copyFile, writeFile } from 'node:fs/promises';
import { resolve, join, relative, dirname } from 'node:path';
const source = resolve(process.env.DATA_DIR || 'data');
const target = resolve(process.argv[2] || `backups/${new Date().toISOString().replace(/[:.]/g, '-')}`);
const rel = relative(source, target);
if (!rel || (!rel.startsWith('..') && !rel.includes(':'))) throw new Error('Backup destination must be outside DATA_DIR.');
await mkdir(dirname(target), { recursive: true });
await mkdir(target, { recursive: false });
const db = new DatabaseSync(join(source, 'voxelscope.sqlite'), { readOnly: true });
try { await backup(db, join(target, 'voxelscope.sqlite')); } finally { db.close(); }
// Read the snapshot, not a changing live database. Volume/result files are immutable.
const snapshot = new DatabaseSync(join(target, 'voxelscope.sqlite'), { readOnly: true });
try {
  await mkdir(join(target, 'volumes'));
  for (const row of snapshot.prepare('SELECT id FROM datasets WHERE ready=1').all()) await copyFile(join(source, 'volumes', `${row.id}.bin`), join(target, 'volumes', `${row.id}.bin`));
  await mkdir(join(target, 'results'));
  for (const row of snapshot.prepare("SELECT id FROM jobs WHERE state='succeeded'").all()) {
    await mkdir(join(target, 'results', row.id));
    for (const file of ['report.json', 'labels.bin', 'roi.bin', 'vertices.bin']) await copyFile(join(source, 'results', row.id, file), join(target, 'results', row.id, file));
  }
  await writeFile(join(target, 'BACKUP.json'), JSON.stringify({ version: 1, createdAt: new Date().toISOString(), complete: true, note: 'Revoke sessions on restore. Interrupted jobs become failures. Pending jobs resume.' }, null, 2));
  console.log(`Backup complete: ${target}`);
} finally { snapshot.close(); }

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  exportSqlite,
  encodeSnapshot,
} from '../apps/api/dist/database/snapshot.js';

process.chdir(fileURLToPath(new URL('..', import.meta.url)));
try {
  process.loadEnvFile('.env');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
const repository = 'sjbangre/nourish-board';
function secret(name, value) {
  // stdin keeps secret values out of the process argument list and logs.
  const result = spawnSync(
    'gh',
    ['secret', 'set', name, '--repo', repository],
    { input: value, encoding: 'utf8' },
  );
  if (result.status !== 0)
    throw new Error(`Unable to configure ${name}. Check gh auth status.`);
  console.log(`Configured encrypted GitHub secret: ${name}`);
}
for (const name of ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET']) {
  if (!process.env[name])
    throw new Error(`Missing ${name} in the private local .env file.`);
  secret(name, process.env[name]);
}
if (process.argv.includes('--include-local-data')) {
  const file = path.resolve(process.env.DATA_DIR || 'data', 'nourish.sqlite');
  const encoded = encodeSnapshot(exportSqlite(file));
  if (Buffer.byteLength(encoded) > 60_000)
    throw new Error(
      'Initial data exceeds the GitHub secret size limit. Use a private migration channel instead.',
    );
  secret('INITIAL_SQLITE_SNAPSHOT', encoded);
}
console.log(
  'Deployment inputs configured. No Azure resources or cloud database were changed.',
);

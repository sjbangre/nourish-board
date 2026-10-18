import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('..', import.meta.url));
process.chdir(root);
try { process.loadEnvFile(path.join(root, '.env')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
const dev = process.argv[2] === 'dev';
const children = new Set();
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill();
  process.exit(code);
}
const launch = args => {
  const child = spawn(process.execPath, ['--use-system-ca', ...args], { stdio: 'inherit', env: { ...process.env, NODE_ENV: dev ? 'development' : 'production' } });
  children.add(child);
  child.once('error', error => { console.error(error.message); stop(1); });
  child.once('exit', () => children.delete(child));
  return child;
};
const supervise = child => child.once('exit', code => stop(code ?? 1));
if (dev) {
  const build = launch(['node_modules/typescript/bin/tsc', '-p', 'apps/api/tsconfig.json']);
  const code = await new Promise(resolve => build.on('exit', resolve));
  if (code !== 0) process.exit(1);
  supervise(launch(['node_modules/typescript/bin/tsc', '-p', 'apps/api/tsconfig.json', '--watch', '--preserveWatchOutput']));
}
// Watch our compiled code only. Dependency files can be touched during lazy
// loading on Windows; watching the import graph can interrupt OAuth callbacks.
supervise(launch([...(dev ? ['--watch', '--watch-path=apps/api/dist'] : []), 'apps/api/dist/main.js']));
supervise(launch(['node_modules/next/dist/bin/next', dev ? 'dev' : 'start', 'apps/web', ...(dev ? ['--webpack'] : []), '--hostname', dev ? '127.0.0.1' : '0.0.0.0', '--port', process.env.PORT || '4318']));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => stop());

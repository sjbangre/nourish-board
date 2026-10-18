import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('..', import.meta.url));
process.chdir(root);
try { process.loadEnvFile(path.join(root, '.env')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
const dev = process.argv[2] === 'dev';
const children = [];
const launch = (args, extra = {}) => {
  const child = spawn(process.execPath, ['--use-system-ca', ...args], { stdio: 'inherit', env: { ...process.env, NODE_ENV: dev ? 'development' : 'production', ...extra } });
  children.push(child); return child;
};
if (dev) {
  const build = launch(['node_modules/typescript/bin/tsc', '-p', 'apps/api/tsconfig.json']);
  const code = await new Promise(resolve => build.on('exit', resolve));
  if (code !== 0) process.exit(1);
  launch(['node_modules/typescript/bin/tsc', '-p', 'apps/api/tsconfig.json', '--watch', '--preserveWatchOutput']);
}
// Watch our compiled code only. Dependency files can be touched during lazy
// loading on Windows; watching the import graph can interrupt OAuth callbacks.
launch([...(dev ? ['--watch', '--watch-path=apps/api/dist'] : []), 'apps/api/dist/main.js']);
launch(['node_modules/next/dist/bin/next', dev ? 'dev' : 'start', 'apps/web', ...(dev ? ['--webpack'] : []), '--hostname', dev ? '127.0.0.1' : '0.0.0.0', '--port', process.env.PORT || '4318']);
function stop() { for (const child of children) if (child.exitCode === null) child.kill(); }
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { stop(); process.exit(0); });
for (const child of children.slice(-2)) child.on('exit', code => { stop(); process.exit(code || 0); });

// Serve the built app through the actual Go handler, including its CSP.
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const dataDir = mkdtempSync(join(tmpdir(), 'cf-admin-e2e-'));
const executable = join(dataDir, 'live-backend');
const build = spawnSync('go', ['build', '-o', executable, '.'], {cwd:new URL('../../backend/', import.meta.url), stdio:'inherit'});
if (build.status !== 0) { rmSync(dataDir, {recursive:true,force:true}); process.exit(build.status || 1); }
const server = spawn(executable, [], {
 cwd: new URL('../../backend/', import.meta.url), stdio: 'inherit',
 env: {...process.env, DATA_DIR:dataDir, ADMIN_DEV_MODE:'true',
 ADMIN_ORIGIN:'http://127.0.0.1:4321', ADMIN_LISTEN_ADDR:'127.0.0.1:4321',
 LISTEN_ADDR:'127.0.0.1:14320', METRICS_LISTEN_ADDR:'127.0.0.1:14321',
 CF_API_BASE_URL:'http://127.0.0.1:1/'},
});
server.on('error', error => { console.error(error); process.exitCode = 1; });
server.on('exit', code => { rmSync(dataDir, {recursive:true, force:true}); process.exit(code || 0); });
for (const signal of ['SIGTERM','SIGINT']) process.on(signal,()=>server.kill(signal));

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
const root = process.cwd();
await mkdir('.local', { recursive: true, mode: 0o700 });
try { await readFile('.local/secrets.json'); } catch {
  await writeFile('.local/secrets.json', JSON.stringify({ secretKey: randomBytes(48).toString('hex'), guestKey: randomBytes(48).toString('hex'), adminPassword: randomBytes(24).toString('base64url'), servicePassword: randomBytes(24).toString('base64url') }), { mode: 0o600 });
}
const env = { ...process.env, FLASK_APP: 'superset', SUPERSET_CONFIG_PATH: path.join(root, 'superset/superset_config.py'), SUPERSET_HOME: path.join(root, '.local') };
for (const args of [['.venv/bin/superset', 'db', 'upgrade'], ['.venv/bin/superset', 'init'], ['.venv/bin/python', 'scripts/seed.py']]) {
  const result = spawnSync(args[0], args.slice(1), { env, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log('Ready. Run npm run superset and npm run dev in separate terminals.');

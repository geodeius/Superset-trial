import { spawn } from 'node:child_process';
import path from 'node:path';
const child = spawn('.venv/bin/superset', ['run', '-h', '127.0.0.1', '-p', '8088', '--with-threads'], { stdio: 'inherit', env: { ...process.env, FLASK_APP: 'superset', SUPERSET_CONFIG_PATH: path.resolve('superset/superset_config.py'), SUPERSET_HOME: path.resolve('.local') } });
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => child.kill(signal));
child.on('exit', code => process.exit(code || 0));

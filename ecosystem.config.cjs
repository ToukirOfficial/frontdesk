// PM2 processes for a server deploy (see deploy.sh). Each runs from the `current` release and listens on
// 127.0.0.1 only. Ports and addresses come from the release's .env (a link to the server's shared env file), so
// nothing server-specific lives in this repository.
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const env = {};
for (const line of readFileSync(join(__dirname, '.env'), 'utf8').split('\n')) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m) env[m[1]] = m[2].replace(/^"(.*)"$/, '$1');
}

module.exports = {
  apps: [
    {
      // The web app needs no secrets: only its port and where the API is.
      name: 'frontdesk-web',
      cwd: join(__dirname, 'web/apps/web'),
      script: 'server.js',
      env: { NODE_ENV: 'production', HOSTNAME: '127.0.0.1', PORT: env.WEB_PORT, API_URL: env.API_URL },
      max_memory_restart: '350M',
    },
    {
      name: 'frontdesk-api',
      cwd: join(__dirname, 'api'),
      script: 'dist/main.js',
      node_args: '--env-file=../.env',
      env: { NODE_ENV: 'production', API_HOST: '127.0.0.1' },
      max_memory_restart: '450M',
    },
    {
      // Embedding knowledge (a small local model), website import, file parsing, email, nightly jobs.
      name: 'frontdesk-worker',
      cwd: join(__dirname, 'api'),
      script: 'dist/worker.js',
      node_args: '--env-file=../.env',
      env: { NODE_ENV: 'production' },
      max_memory_restart: '900M',
    },
  ],
};

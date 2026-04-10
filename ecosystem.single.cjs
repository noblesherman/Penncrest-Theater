const path = require('path');

const rootDir = __dirname;
const backendPort = process.env.BACKEND_PORT || process.env.PORT || '6000';
const cloudflaredBin = process.env.CLOUDFLARED_BIN || 'cloudflared';
const cloudflaredConfig = process.env.CLOUDFLARED_CONFIG || path.join(rootDir, 'cloudflared', 'config.yml');

module.exports = {
  apps: [
    {
      name: 'theater-backend',
      cwd: path.join(rootDir, 'backend'),
      script: 'dist/src/server.js',
      interpreter: 'node',
      autorestart: true,
      watch: false,
      max_restarts: 10,
      restart_delay: 5000,
      env: {
        NODE_ENV: 'production',
        PORT: backendPort,
        ENABLE_IN_PROCESS_CHECKOUT_QUEUE_WORKER: 'true',
        ENABLE_IN_PROCESS_HOLD_CLEANUP_SCHEDULER: 'true'
      }
    },
    {
      name: 'theater-tunnel',
      cwd: rootDir,
      script: cloudflaredBin,
      args: `tunnel --config "${cloudflaredConfig}" run`,
      interpreter: 'none',
      autorestart: true,
      watch: false,
      max_restarts: 10,
      restart_delay: 5000
    }
  ]
};

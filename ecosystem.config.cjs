const path = require('path');

const rootDir = __dirname;
const backendPort = process.env.BACKEND_PORT || process.env.PORT || '6000';
const parsedCheckoutWorkerInstances = Number.parseInt(process.env.CHECKOUT_WORKER_INSTANCES || '2', 10);
const checkoutWorkerInstances = Number.isFinite(parsedCheckoutWorkerInstances) && parsedCheckoutWorkerInstances > 0
  ? parsedCheckoutWorkerInstances
  : 2;
const cloudflaredBin = process.env.CLOUDFLARED_BIN || 'cloudflared';
const cloudflaredConfig = process.env.CLOUDFLARED_CONFIG || path.join(rootDir, 'cloudflared', 'config.yml');

module.exports = {
  apps: [
    {
      name: 'theater-backend',
      cwd: path.join(rootDir, 'backend'),
      script: 'node',
      args: 'dist/src/server.js',
      autorestart: true,
      watch: false,
      max_restarts: 10,
      restart_delay: 5000,
      env: {
        NODE_ENV: 'production',
        PORT: backendPort,
        ENABLE_IN_PROCESS_CHECKOUT_QUEUE_WORKER: 'false',
        ENABLE_IN_PROCESS_HOLD_CLEANUP_SCHEDULER: 'false'
      }
    },
    {
      name: 'theater-checkout-worker',
      cwd: path.join(rootDir, 'backend'),
      script: 'node',
      args: 'dist/src/checkout-worker.js',
      instances: checkoutWorkerInstances,
      exec_mode: checkoutWorkerInstances > 1 ? 'cluster' : 'fork',
      autorestart: true,
      watch: false,
      max_restarts: 10,
      restart_delay: 5000,
      env: {
        NODE_ENV: 'production'
      }
    },
    {
      name: 'theater-hold-cleanup',
      cwd: path.join(rootDir, 'backend'),
      script: 'node',
      args: 'dist/src/hold-cleanup-worker.js',
      autorestart: true,
      watch: false,
      max_restarts: 10,
      restart_delay: 5000,
      env: {
        NODE_ENV: 'production'
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

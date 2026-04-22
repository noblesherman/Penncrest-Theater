/*
Handoff note for Mr. Smith:
- File: `ecosystem.quick-tunnel.config.cjs`
- What this is: Build/deploy/runtime config file.
- What it does: Defines tool/process behavior outside direct app UI logic.
- Connections: Read by Vite/PM2/tunnel tooling during local or production runtime.
- Main content type: Configuration and environment wiring.
- Safe edits here: Inline docs and carefully scoped config notes.
- Be careful with: Ports/process names/env interpolation assumptions.
- Useful context: If code seems fine but runtime is weird, config drift here is a common reason.
- Practical note: For simple copy/layout edits, this file is usually safe as long as you keep data contracts intact.
*/

const path = require('path');

const rootDir = __dirname;
const backendPort = process.env.BACKEND_PORT || process.env.PORT || '6000';
const parsedCheckoutWorkerInstances = Number.parseInt(process.env.CHECKOUT_WORKER_INSTANCES || '2', 10);
const checkoutWorkerInstances = Number.isFinite(parsedCheckoutWorkerInstances) && parsedCheckoutWorkerInstances > 0
  ? parsedCheckoutWorkerInstances
  : 2;

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
        ENABLE_IN_PROCESS_CHECKOUT_QUEUE_WORKER: 'false',
        ENABLE_IN_PROCESS_HOLD_CLEANUP_SCHEDULER: 'false'
      }
    },
    {
      name: 'theater-checkout-worker',
      cwd: path.join(rootDir, 'backend'),
      script: 'dist/src/checkout-worker.js',
      interpreter: 'node',
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
      script: 'dist/src/hold-cleanup-worker.js',
      interpreter: 'node',
      autorestart: true,
      watch: false,
      max_restarts: 10,
      restart_delay: 5000,
      env: {
        NODE_ENV: 'production'
      }
    },
    {
      name: 'theater-quick-tunnel',
      cwd: rootDir,
      script: '/bin/sh',
      args: [path.join(rootDir, 'scripts', 'run-quick-tunnel.sh'), backendPort],
      interpreter: 'none',
      autorestart: true,
      watch: false,
      max_restarts: 10,
      restart_delay: 5000
    }
  ]
};

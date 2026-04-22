/*
Handoff note for Mr. Smith:
- File: `ecosystem.single.cjs`
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

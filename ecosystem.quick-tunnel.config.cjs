const path = require('path');

const rootDir = __dirname;
const backendPort = process.env.BACKEND_PORT || process.env.PORT || '6000';

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
        PORT: backendPort
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

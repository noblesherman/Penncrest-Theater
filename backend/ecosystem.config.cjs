const backendPort = process.env.PORT || '6000';

module.exports = {
  apps: [
    {
      name: 'theater-backend',
      cwd: __dirname,
      script: 'node',
      args: 'dist/src/server.js',
      env: {
        NODE_ENV: 'production',
        PORT: backendPort
      },
      autorestart: true,
      watch: false,
      max_restarts: 10,
      restart_delay: 5000
    }
  ]
};

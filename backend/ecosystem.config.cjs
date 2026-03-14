module.exports = {
  apps: [
    {
      name: 'theater-backend',
      cwd: __dirname,
      script: 'npm',
      args: 'run start',
      interpreter: 'none',
      env: {
        NODE_ENV: 'production'
      },
      autorestart: true,
      watch: false,
      max_restarts: 10,
      restart_delay: 5000
    }
  ]
};

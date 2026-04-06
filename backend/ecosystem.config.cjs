const backendPort = process.env.PORT || '6000';
const parsedCheckoutWorkerInstances = Number.parseInt(process.env.CHECKOUT_WORKER_INSTANCES || '2', 10);
const checkoutWorkerInstances = Number.isFinite(parsedCheckoutWorkerInstances) && parsedCheckoutWorkerInstances > 0
  ? parsedCheckoutWorkerInstances
  : 2;

module.exports = {
  apps: [
    {
      name: 'theater-backend',
      cwd: __dirname,
      script: 'node',
      args: 'dist/src/server.js',
      env: {
        NODE_ENV: 'production',
        PORT: backendPort,
        ENABLE_IN_PROCESS_CHECKOUT_QUEUE_WORKER: 'false',
        ENABLE_IN_PROCESS_HOLD_CLEANUP_SCHEDULER: 'false'
      },
      autorestart: true,
      watch: false,
      max_restarts: 10,
      restart_delay: 5000
    },
    {
      name: 'theater-checkout-worker',
      cwd: __dirname,
      script: 'node',
      args: 'dist/src/checkout-worker.js',
      instances: checkoutWorkerInstances,
      exec_mode: checkoutWorkerInstances > 1 ? 'cluster' : 'fork',
      env: {
        NODE_ENV: 'production'
      },
      autorestart: true,
      watch: false,
      max_restarts: 10,
      restart_delay: 5000
    },
    {
      name: 'theater-hold-cleanup',
      cwd: __dirname,
      script: 'node',
      args: 'dist/src/hold-cleanup-worker.js',
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

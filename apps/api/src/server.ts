const message = [
  'Legacy apps/api server is decommissioned.',
  'Use `npm --prefix backend run dev` or `npm run dev:backend` for the canonical backend service.',
].join(' ');

console.error(message);
process.exit(1);

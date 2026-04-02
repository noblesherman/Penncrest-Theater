const message = [
  'Legacy root server entrypoint is disabled.',
  'Use `npm run dev:backend` for the maintained backend service instead.',
].join(' ');

console.error(message);
process.exit(1);

import { main } from './server.js';

main().catch((err: unknown) => {
  process.stderr.write(`[is-it-real] fatal: ${String(err)}\n`);
  process.exit(1);
});

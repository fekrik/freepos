// Runs a real PostgreSQL 16 server for local development via npm-provided binaries.
// Production uses managed Postgres (DATABASE_URL); this script is dev-only.
import EmbeddedPostgres from 'embedded-postgres';
import { existsSync } from 'node:fs';

const dir = new URL('../.pgdata', import.meta.url).pathname;
const pg = new EmbeddedPostgres({ databaseDir: dir, user: 'postgres', password: 'postgres', port: 5433, persistent: true });

if (!existsSync(`${dir}/PG_VERSION`)) await pg.initialise();
await pg.start();
console.log('Postgres running on localhost:5433 (Ctrl+C to stop)');

const stop = async () => { await pg.stop(); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

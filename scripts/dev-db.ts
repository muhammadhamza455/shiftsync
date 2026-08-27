import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';

const DATA_DIR = resolve(process.cwd(), '.pgdata');
const PORT = Number(process.env.DEV_DB_PORT ?? 5433);
const USER = 'shiftsync';
const PASSWORD = 'shiftsync';
const DATABASE = 'shiftsync';

async function main() {
  const alreadyInitialised = existsSync(resolve(DATA_DIR, 'PG_VERSION'));

  const pg = new EmbeddedPostgres({
    databaseDir: DATA_DIR,
    user: USER,
    password: PASSWORD,
    port: PORT,
    persistent: true,
    initdbFlags: ['--encoding=UTF8', '--locale=C'],
    onLog: () => {},
    onError: (message) => process.stderr.write(String(message)),
  });

  if (!alreadyInitialised) {
    process.stdout.write('Initialising a fresh cluster in .pgdata …\n');
    await pg.initialise();
  }

  await pg.start();
  process.stdout.write(`PostgreSQL listening on 127.0.0.1:${PORT}\n`);

  if (!alreadyInitialised) {
    await pg.createDatabase(DATABASE);
    process.stdout.write(`Created database "${DATABASE}"\n`);
  }

  process.stdout.write(
    `DATABASE_URL=postgresql://${USER}:${PASSWORD}@127.0.0.1:${PORT}/${DATABASE}\n` +
      'Ready. Press Ctrl-C to stop.\n',
  );

  const shutdown = async () => {
    process.stdout.write('\nStopping PostgreSQL …\n');
    await pg.stop().catch(() => {});
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await new Promise(() => {});
}

main().catch((error) => {
  process.stderr.write(`${error?.stack ?? error}\n`);
  process.exit(1);
});

import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

export default function globalSetup() {
  const tsxCli = resolve(process.cwd(), 'node_modules/tsx/dist/cli.mjs');
  execFileSync(process.execPath, [tsxCli, 'prisma/seed.ts'], {
    stdio: 'inherit',
  });
}

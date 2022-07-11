import chalk from 'chalk';
import execa from 'execa';
import { copyFile, stat, unlink } from 'fs/promises';
import { resolve } from 'path';

const rootDir = process.argv[2] || '.';
const packageJson = resolve(rootDir, 'package.json');
const backupFileName = 'package.json.pub-backup';
const backupFile = resolve(rootDir, backupFileName);

const saveBackup = async () => {
  debug(`$ cp package.json ${backupFileName}`);
  await copyFile(packageJson, backupFile);
};

const restoreBackup = async () => {
  debug(`$ cp ${backupFileName} package.json`);
  await copyFile(backupFile, packageJson);
};

const deleteBackup = async () => {
  debug(`$ rm ${backupFileName}`);
  await unlink(backupFile);
};

const debug = (...args: unknown[]) => console.debug(chalk.blue(...args));
const info = (...args: unknown[]) => console.info(chalk.green(...args));
// const warn = (...args: unknown[]) => console.warn(chalk.yellow(...args));
// const error = (...args: unknown[]) => console.error(chalk.red(...args));

const pnpm = (args: string[], output = true) => {
  const file = 'pnpm';
  debug('$', file, ...args);
  const subprocess = execa(file, args, { stdio: output ? 'inherit' : 'pipe' });
  return subprocess;
};

const up = (packages: string[], latest: boolean) =>
  pnpm(['up'].concat(packages, latest ? ['--latest'] : []), false);

const outdated = async (latest = true) => {
  const outdated = await pnpm(
    ['outdated', '--no-table'].concat(latest ? [] : ['--compatible']),
    false
  ).catch((e) => e);
  if (outdated.stderr) throw outdated;
  return outdated.stdout
    .split('\n')
    .filter((p, i) => p && i % 3 == 0)
    .map((p) => p.replace(/\s+\(dev\)$/, ''));
};

const test = async (): Promise<boolean> =>
  (await pnpm(['test'], false).catch((e) => e)).exitCode === 0;

const preChecks = async () => {
  if (await stat(backupFile).catch(() => undefined)) {
    throw new Error(chalk`{red ${backupFileName} already exists, probably from a failed previous run}
{yellow To restore the backup, run:} {green mv ${backupFileName} package.json}
{yellow To discard it, run:} {green rm ${backupFileName}}`);
  }
  await pnpm(['install-test']).catch(async () => {
    throw new Error(chalk.red('Failed before we even started!'));
  });
};

const smartUpdateAll = async () => {
  await saveBackup();
  const packages = await outdated(true);
  if (!packages.length) return;

  type Status = 'green' | 'yellow' | 'red' | 'magenta' | undefined;
  const statuses: Map<string, Status> = new Map();
  const withStatus = (s: Status) => packages.filter((p) => statuses.get(p) === s);
  const printStatuses = () =>
    console.info(
      'Upgrading:',
      ...packages.map((p) => chalk[statuses.get(p) || 'white'](p))
    );

  const tryUpdate = async (suspects: string[], latest = true): Promise<boolean> => {
    await up(suspects, latest);
    const passed = await test();
    passed ? await saveBackup() : await restoreBackup();
    return passed;
  };

  while (withStatus(undefined).length || withStatus('yellow').length) {
    const suspects = withStatus('yellow');
    if (suspects.length) {
      // test half of the suspects at a time
      const others = suspects.splice(Math.floor(suspects.length / 2));
      // const others = suspects.filter((_, i) => i % 2 === 1);
      if (await tryUpdate(suspects)) {
        suspects.forEach((p) => statuses.set(p, 'green'));
      } else {
        others.forEach((p) => statuses.delete(p));
      }
    } else {
      const unknowns = withStatus(undefined);
      const newStatus = (await tryUpdate(unknowns)) ? 'green' : 'yellow';
      unknowns.forEach((p) => statuses.set(p, newStatus));
    }
    // if only one package is suspected it must be the culprit
    const remainingSuspects = withStatus('yellow');
    if (remainingSuspects.length === 1) {
      debug(
        remainingSuspects[0],
        'cannot be updated to latest version. Attempting compatible version update.'
      );
      statuses.set(
        remainingSuspects[0],
        // check if we can at least update it to a compatible version
        (await tryUpdate(remainingSuspects, false)) ? 'magenta' : 'red'
      );
    }
    printStatuses();
  }

  await pnpm(['install-test']);
  await deleteBackup();
};

info('Making sure dependencies are installed and tests work before we start');
await preChecks();

info('Attempting to update all packages to latest version');
await smartUpdateAll();

info('Update complete');

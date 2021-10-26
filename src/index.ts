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

const up = (packages: string[], latest = true) =>
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

const smartUpdateLatest = async () => {
  const packages = await outdated(true);
  if (!packages.length) return;

  type Status = 'green' | 'yellow' | 'red' | undefined;
  const statuses: Map<string, Status> = new Map();
  const withStatus = (s: Status) => packages.filter((p) => statuses.get(p) === s);
  const printStatuses = () =>
    console.info(
      'Upgrading:',
      ...packages.map((p) => chalk[statuses.get(p) || 'white'](p))
    );

  const testPkgs = async (suspects: string[]): Promise<boolean> => {
    await up(withStatus('green').concat(suspects), true);
    const result = await test();
    await restoreBackup();
    return result;
  };

  while (withStatus(undefined).length || withStatus('yellow').length) {
    const suspects = withStatus('yellow');
    if (suspects.length) {
      // test half of the suspects at a time
      const others = suspects.splice(Math.floor(suspects.length / 2));
      // const others = suspects.filter((_, i) => i % 2 === 1);
      if (await testPkgs(suspects)) {
        suspects.forEach((p) => statuses.set(p, 'green'));
      } else {
        others.forEach((p) => statuses.delete(p));
      }
    } else {
      const unknowns = withStatus(undefined);
      const newStatus = (await testPkgs(unknowns)) ? 'green' : 'yellow';
      unknowns.forEach((p) => statuses.set(p, newStatus));
    }
    // if only one package is suspected it must be the culprit
    if (withStatus('yellow').length === 1) {
      statuses.set(withStatus('yellow')[0], 'red');
    }
    printStatuses();
  }

  const good = withStatus('green');
  good.length ? await up(good, true) : await pnpm(['install'], false);
};

const smartUpdateCompatible = async () => {
  // pnpm outdated --compatible doesn't show any upgrades (maybe a pnpm bug?)
  // but pnpm update (without --latest) does install them, so this is the best
  // that we can do for now
  await up([], false);
  if (!(await test())) {
    // we can't selectively do minor updates so we have to roll back them all
    await restoreBackup();
    await pnpm(['install'], false);
  }
};

const smartUpdate = async (latest = true) => {
  await saveBackup();
  latest ? await smartUpdateLatest() : await smartUpdateCompatible();
  await deleteBackup();
};

info('Making sure dependencies are installed and tests work before we start');
await preChecks();
info('Attempting to update all packages to latest version');
await smartUpdate();
info('Attempting to update all packages to compatible versions');
await smartUpdate(false);

info('Update complete');

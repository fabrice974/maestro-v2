/**
 * Orchestration de l'écosystème multi-dépôts (voir ecosysteme.yaml).
 *
 *   npm run ecosysteme -- statut                    état de chaque dépôt voisin (+ services démarrés)
 *   npm run ecosysteme -- cloner                    clone les dépôts absents depuis GitHub
 *   npm run ecosysteme -- installer                 npm install / dotnet build dans chaque dépôt
 *   npm run ecosysteme -- demarrer [--sans-passerelle] [--sauf deal-flow,debourse]
 *   npm run ecosysteme -- contrat                   propage contrats/openapi.yaml au SDK et à l'app .NET,
 *                                                   régénère leurs clients et affiche ce qui a changé
 *
 * Les dépôts sont cherchés à côté de maestro-v2 (MAESTRO_ECOSYSTEME_DIR pour un autre dossier).
 */
import { execSync, spawn, type ChildProcess } from 'node:child_process';
import { copyFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chargerEnv, RACINE } from '@maestro/commun';
import { cheminDepot, depots, DOSSIER_ECOSYSTEME, eco } from './ecosysteme-config.ts';

chargerEnv();

const sh = (cmd: string, cwd: string) => execSync(cmd, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const git = (cwd: string, args: string) => {
  try {
    return sh(`git ${args}`, cwd);
  } catch {
    return '';
  }
};

async function enEcoute(port?: number) {
  if (!port) return false;
  try {
    await fetch(`http://localhost:${port}/`, { signal: AbortSignal.timeout(800), redirect: 'manual' });
    return true;
  } catch {
    return false;
  }
}

function versionSdk(chemin: string): string {
  try {
    const p = JSON.parse(readFileSync(join(chemin, 'package.json'), 'utf8')) as { dependencies?: Record<string, string> };
    return p.dependencies?.['@maestro/sdk']?.split('#')[1] ?? '—';
  } catch {
    return '—';
  }
}

async function statut() {
  console.log(`Écosystème (${DOSSIER_ECOSYSTEME})\n`);
  const lignes: string[][] = [['dépôt', 'présent', 'branche', 'commit', 'modifs', 'SDK', 'service']];
  lignes.push(['maestro-v2 (backbone)', 'oui', git(RACINE, 'branch --show-current'), git(RACINE, 'rev-parse --short HEAD'), git(RACINE, 'status --porcelain').split('\n').filter(Boolean).length.toString(), '—', (await enEcoute(4000)) ? ':4000 ✔' : ':4000 —']);
  for (const d of depots()) {
    const c = cheminDepot(d.nom);
    if (!existsSync(c)) {
      lignes.push([d.nom, 'NON', '', '', '', '', '']);
      continue;
    }
    const modifs = git(c, 'status --porcelain').split('\n').filter(Boolean).length;
    lignes.push([
      d.nom,
      'oui',
      git(c, 'branch --show-current'),
      git(c, 'describe --tags --always'),
      String(modifs),
      d.type === 'node' ? versionSdk(c) : d === eco.sdk ? git(c, 'describe --tags --abbrev=0') || '—' : 'contrat figé',
      d.port ? ((await enEcoute(d.port)) ? `:${d.port} ✔` : `:${d.port} —`) : '',
    ]);
  }
  const largeurs = lignes[0]!.map((_, i) => Math.max(...lignes.map((l) => (l[i] ?? '').length)));
  for (const l of lignes) console.log('  ' + l.map((x, i) => (x ?? '').padEnd(largeurs[i]!)).join('  '));
}

function cloner() {
  for (const d of depots()) {
    const c = cheminDepot(d.nom);
    if (existsSync(c)) {
      console.log(`✔ ${d.nom} déjà présent`);
      continue;
    }
    console.log(`→ clonage de ${eco.organisation}/${d.nom}`);
    execSync(`git clone ${eco.organisation}/${d.nom}.git "${c}"`, { stdio: 'inherit' });
  }
}

function installer() {
  for (const d of eco.applications) {
    const c = cheminDepot(d.nom);
    if (!existsSync(c) || !d.installer) {
      console.log(`✖ ${d.nom} absent (npm run ecosysteme -- cloner)`);
      continue;
    }
    console.log(`→ ${d.nom} : ${d.installer}`);
    execSync(d.installer, { cwd: c, stdio: 'inherit' });
  }
}

function demarrer(options: Set<string>, sauf: Set<string>) {
  const couleurs = ['\x1b[36m', '\x1b[34m', '\x1b[32m', '\x1b[33m', '\x1b[35m', '\x1b[31m'];
  const procs: ChildProcess[] = [];
  const lancer = (nom: string, commande: string, cwd: string, i: number, env: NodeJS.ProcessEnv = {}) => {
    const p = spawn(commande, { cwd, shell: true, env: { ...process.env, ...env } });
    const prefixe = `${couleurs[i % couleurs.length]}[${nom}]\x1b[0m `;
    const relayer = (b: Buffer) =>
      b
        .toString()
        .split(/\r?\n/)
        .filter((l) => l.trim() && !l.includes('[camunda-sdk][info]'))
        .forEach((l) => console.log(prefixe + l));
    p.stdout.on('data', relayer);
    p.stderr.on('data', relayer);
    procs.push(p);
  };
  if (!options.has('--sans-passerelle')) lancer('passerelle :4000', 'npx tsx passerelle/src/main.ts', RACINE, 0);
  eco.applications
    .filter((d) => !sauf.has(d.id ?? '') && !sauf.has(d.nom))
    .forEach((d, i) => {
      const c = cheminDepot(d.nom);
      if (!existsSync(c)) return console.log(`✖ ${d.nom} absent — ignoré (npm run ecosysteme -- cloner)`);
      if (d.type === 'node' && !existsSync(join(c, 'node_modules'))) return console.log(`✖ ${d.nom} non installé — ignoré (npm run ecosysteme -- installer)`);
      setTimeout(() => lancer(`${d.id} :${d.port}`, d.demarrer!, c, i + 1, { PORT: String(d.port), PASSERELLE_URL: process.env.PASSERELLE_URL ?? 'http://localhost:4000' }), 3000);
    });
  process.on('SIGINT', () => {
    procs.forEach((p) => p.kill());
    process.exit(0);
  });
}

function contrat() {
  const source = join(RACINE, 'contrats', 'openapi.yaml');
  for (const d of depots().filter((x) => x.contrat)) {
    const c = cheminDepot(d.nom);
    if (!existsSync(c)) {
      console.log(`✖ ${d.nom} absent`);
      continue;
    }
    copyFileSync(source, join(c, d.contrat!));
    console.log(`→ ${d.nom} : contrat copié, ${d.generer}`);
    if (d.generer) execSync(d.generer, { cwd: c, stdio: 'inherit' });
    const diff = git(c, 'status --short');
    console.log(diff ? `  changements à revoir puis commiter (PR dans ${d.nom}) :\n${diff.replace(/^/gm, '    ')}` : '  aucun changement (contrat identique)');
  }
  console.log("\nSi le SDK change : nouvelle étiquette (ex. v1.1.0) dans maestro-sdk-ts, puis chaque application monte de version à son rythme.");
}

const [commande, ...reste] = process.argv.slice(2);
const options = new Set(reste.filter((x) => x.startsWith('--')));
const saufIdx = reste.indexOf('--sauf');
const sauf = new Set(saufIdx >= 0 ? (reste[saufIdx + 1] ?? '').split(',') : []);

switch (commande) {
  case 'statut':
    await statut();
    break;
  case 'cloner':
    cloner();
    break;
  case 'installer':
    installer();
    break;
  case 'demarrer':
    demarrer(options, sauf);
    break;
  case 'contrat':
    contrat();
    break;
  default:
    console.log('Usage : npm run ecosysteme -- <statut|cloner|installer|demarrer|contrat>');
    process.exit(commande ? 1 : 0);
}

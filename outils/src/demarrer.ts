/**
 * Lance toute la démo : passerelle + 4 applications TypeScript (+ l'application .NET si --dotnet).
 * Usage : npm run demarrer [-- --dotnet] [-- --sans-passerelle]
 * Ctrl+C arrête tout.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { chargerEnv, RACINE } from '@maestro/commun';

chargerEnv();
const args = new Set(process.argv.slice(2));
const couleurs = ['\x1b[36m', '\x1b[34m', '\x1b[32m', '\x1b[33m', '\x1b[31m', '\x1b[35m'];
const procs: ChildProcess[] = [];

function lancer(nom: string, commande: string, i: number) {
  const p = spawn(commande, { cwd: RACINE, shell: true, env: process.env });
  const prefixe = `${couleurs[i % couleurs.length]}[${nom}]\x1b[0m `;
  const relayer = (d: Buffer) =>
    d
      .toString()
      .split(/\r?\n/)
      .filter((l) => l.trim() && !l.includes('[camunda-sdk][info]'))
      .forEach((l) => console.log(prefixe + l));
  p.stdout.on('data', relayer);
  p.stderr.on('data', relayer);
  procs.push(p);
}

const liste: [string, string][] = [];
if (!args.has('--sans-passerelle')) liste.push(['passerelle', 'npx tsx passerelle/src/main.ts']);
liste.push(
  ['deal-flow :4101', 'npx tsx apps/deal-flow/src/main.ts'],
  ['revue-diligente :4102', 'npx tsx apps/revue-diligente/src/main.ts'],
  ['suivi-periodique :4104', 'npx tsx apps/suivi-periodique/src/main.ts'],
  ['desinvestissement :4105', 'npx tsx apps/desinvestissement/src/main.ts'],
);
if (args.has('--dotnet')) liste.push(['debourse .NET :4103', 'dotnet run --project apps/debourse-dotnet']);
liste.forEach(([n, c], i) => setTimeout(() => lancer(n, c, i), n === 'passerelle' ? 0 : 3000));

process.on('SIGINT', () => {
  procs.forEach((p) => p.kill());
  process.exit(0);
});

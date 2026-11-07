/**
 * Exporte la piste d'audit d'un mois en JSONL vers SharePoint (POC-Maestro-Camunda/_archives-audit/),
 * avec un manifeste (nombre d'entrées, premier/dernier hash, empreinte du fichier) pour la conservation
 * longue durée. Cible : stockage immuable (WORM) avec rétention réglementaire.
 *
 *   npm run audit:exporter [-- 2026-11]   (défaut : mois courant)
 */
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { chargerEnv, RACINE } from '@maestro/commun';

chargerEnv();
const { Journal } = await import('../../passerelle/src/audit/journal.ts');
const { creerDepot } = await import('../../passerelle/src/documents/index.ts');

const mois = process.argv[2] ?? new Date().toISOString().slice(0, 7);
if (!/^\d{4}-\d{2}$/.test(mois)) throw new Error('Mois attendu au format AAAA-MM');
const db = new DatabaseSync(process.env.PASSERELLE_DB ?? join(RACINE, 'donnees', 'passerelle.sqlite'), { readOnly: true });
const journal = new Journal(db);
const verification = journal.verifier();
if (!verification.valide) throw new Error(`Chaîne rompue à l'entrée #${verification.rompueA} : export refusé`);

const entrees = journal.lister().filter((e) => e.horodatage.startsWith(mois));
if (!entrees.length) {
  console.log(`Aucune entrée pour ${mois}.`);
  process.exit(0);
}
const jsonl = Buffer.from(entrees.map((e) => JSON.stringify(e)).join('\n') + '\n', 'utf8');
const manifeste = {
  mois,
  entrees: entrees.length,
  premiereSeq: entrees[0]!.seq,
  derniereSeq: entrees.at(-1)!.seq,
  hashPrecedentPremiere: entrees[0]!.hashPrecedent,
  dernierHash: entrees.at(-1)!.hash,
  sha256Fichier: createHash('sha256').update(jsonl).digest('hex'),
  exporteLe: new Date().toISOString(),
};
const depot = creerDepot();
await depot.creerDossier(['_archives-audit']);
const horodatage = new Date().toISOString().replace(/[:.]/g, '-');
const ref = await depot.deposer(['_archives-audit'], `audit-${mois}__${horodatage}.jsonl`, jsonl);
await depot.deposer(['_archives-audit'], `audit-${mois}__${horodatage}.manifeste.json`, Buffer.from(JSON.stringify(manifeste, null, 2)));
console.log(`${entrees.length} entrées exportées (${mois}) → ${ref.url}`);
console.log(`Manifeste : dernier hash ${manifeste.dernierHash.slice(0, 16)}…, sha256 fichier ${manifeste.sha256Fichier.slice(0, 16)}…`);

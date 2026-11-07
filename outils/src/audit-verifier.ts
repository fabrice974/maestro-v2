/** Vérifie l'intégrité de la chaîne d'audit de la passerelle. Usage : npm run audit:verifier */
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { chargerEnv, RACINE } from '@maestro/commun';
import { Journal } from '../../passerelle/src/audit/journal.ts';

chargerEnv();
const db = new DatabaseSync(process.env.PASSERELLE_DB ?? join(RACINE, 'donnees', 'passerelle.sqlite'), { readOnly: true });
const v = new Journal(db).verifier();
if (v.valide) {
  console.log(`Chaîne d'audit VALIDE — ${v.entrees} entrées — dernier hash ${v.dernierHash}`);
} else {
  console.error(`Chaîne d'audit ROMPUE à l'entrée #${v.rompueA} (${v.entrees} entrées).`);
  process.exit(1);
}

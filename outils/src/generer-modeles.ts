/**
 * Génère modeles/bpmn/*.bpmn depuis outils/src/bpmn/processus.ts, avec mise en page automatique.
 * Usage : npx tsx outils/src/generer-modeles.ts [id...]
 * ⚠ Écrase les fichiers générés : après une retouche dans Camunda Modeler, ne plus régénérer ce fichier.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { layoutProcess } from 'bpmn-auto-layout';
import { RACINE } from '@maestro/commun';
import { TOUS } from './bpmn/processus.ts';
import { TABLES, versDmn } from './dmn/tables.ts';

const filtre = process.argv.slice(2);
for (const fabrique of TOUS) {
  const p = fabrique();
  if (filtre.length && !filtre.includes(p.id)) continue;
  const xml = await layoutProcess(p.xml());
  if (!xml.includes('zeebe:taskDefinition') && !xml.includes('zeebe:calledElement')) throw new Error(`${p.id} : extensions Zeebe perdues par la mise en page`);
  const fichier = join(RACINE, 'modeles', 'bpmn', `${p.id}.bpmn`);
  writeFileSync(fichier, xml);
  console.log(`généré ${p.id}.bpmn (${xml.length} octets)`);
}
for (const t of TABLES) {
  if (filtre.length && !filtre.includes(t.id)) continue;
  writeFileSync(join(RACINE, 'modeles', 'dmn', `${t.id}.dmn`), versDmn(t));
  console.log(`généré ${t.id}.dmn`);
}

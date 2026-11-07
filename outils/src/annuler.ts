/**
 * Annule l'instance backbone d'un dossier (et ses sous-processus), puis marque le dossier « abandonné »
 * dans le registre de la passerelle (audité). Usage : npm run annuler -- INV-2026-0001 [--registre-seulement]
 */
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { chargerEnv, RACINE } from '@maestro/commun';
import { Journal } from '../../passerelle/src/audit/journal.ts';
import { Registre } from '../../passerelle/src/registre.ts';

chargerEnv();
const [dossierId, option] = process.argv.slice(2);
if (!dossierId) throw new Error('dossierId requis');
const db = new DatabaseSync(process.env.PASSERELLE_DB ?? join(RACINE, 'donnees', 'passerelle.sqlite'));
const registre = new Registre(db);
const d = registre.dossier(dossierId);
if (!d?.cleInstance) throw new Error(`Instance introuvable pour ${dossierId}`);
if (option !== '--registre-seulement') {
  const { default: createCamundaClient } = await import('@camunda8/orchestration-cluster-api');
  await createCamundaClient().cancelProcessInstance({ processInstanceKey: d.cleInstance } as never);
  console.log(`Instance ${d.cleInstance} (${dossierId}) annulée.`);
}
registre.majDossier(dossierId, { statut: 'abandonne' });
new Journal(db).ajouter({ acteur: 'operateur', application: 'outils', action: 'dossier.annule', dossierId, cleInstance: d.cleInstance });
console.log(`Dossier ${dossierId} marqué « abandonné » dans le registre.`);

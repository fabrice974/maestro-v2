/** Annule l'instance backbone d'un dossier (et ses sous-processus). Usage : npx tsx outils/src/annuler.ts INV-2026-0001 */
import { chargerEnv } from '@maestro/commun';

chargerEnv();
const dossierId = process.argv[2];
if (!dossierId) throw new Error('dossierId requis');
const r = await fetch(`${process.env.PASSERELLE_URL ?? 'http://localhost:4000'}/dossiers/${dossierId}`, {
  headers: { Authorization: 'Bearer demo-jeton-deal-flow' },
});
const d = (await r.json()) as { cleInstance?: string };
if (!d.cleInstance) throw new Error(`Instance introuvable pour ${dossierId}`);
const { default: createCamundaClient } = await import('@camunda8/orchestration-cluster-api');
await createCamundaClient().cancelProcessInstance({ processInstanceKey: d.cleInstance } as never);
console.log(`Instance ${d.cleInstance} (${dossierId}) annulée.`);

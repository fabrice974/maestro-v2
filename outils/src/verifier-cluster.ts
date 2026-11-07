/**
 * Vérifie ce qui est RÉELLEMENT déployé et en cours sur le cluster du .env :
 * topologie, définitions BPMN/DMN attendues, instances backbone. Usage : npm run verifier:cluster
 *
 * À lancer après un réveil de cluster d'essai : une mise en pause automatique peut effacer les données
 * (constaté le 2026-11-07 sur dev-cl 8.11.0-alpha1) → npm run deployer.
 */
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { chargerEnv, RACINE } from '@maestro/commun';

chargerEnv();
const { default: createCamundaClient } = await import('@camunda8/orchestration-cluster-api');
const c = createCamundaClient();
const opts = { consistency: { waitUpToMs: 0 } } as never;

console.log(`Cluster : ${process.env.CAMUNDA_REST_ADDRESS}`);
const topo = (await c.getTopology()) as { brokers?: unknown[]; gatewayVersion?: string };
console.log(`Topologie : ${topo.brokers?.length ?? 0} broker(s), version ${topo.gatewayVersion}`);

const attendus = (dir: string, ext: string) =>
  readdirSync(join(RACINE, 'modeles', dir)).filter((f) => f.endsWith(ext) && !f.includes('.v2-')).map((f) => f.slice(0, -ext.length));

const procs = ((await c.searchProcessDefinitions({ page: { limit: 200 } } as never, opts)) as { items: { processDefinitionId: string; version: number }[] }).items;
const decs = ((await c.searchDecisionDefinitions({ page: { limit: 200 } } as never, opts)) as { items: { decisionDefinitionId: string; version: number }[] }).items;
const derniere = (items: { version: number }[], id: (x: any) => string, cle: string) =>
  Math.max(0, ...items.filter((x) => id(x) === cle).map((x) => x.version));

let manquants = 0;
console.log('\nProcessus :');
for (const id of attendus('bpmn', '.bpmn')) {
  const v = derniere(procs, (x) => x.processDefinitionId, id);
  console.log(`  ${v ? '✔' : '✖'} ${id}${v ? ` v${v}` : ' — NON DÉPLOYÉ'}`);
  if (!v) manquants++;
}
console.log('Décisions :');
for (const id of attendus('dmn', '.dmn')) {
  const v = derniere(decs, (x) => x.decisionDefinitionId, id);
  console.log(`  ${v ? '✔' : '✖'} ${id}${v ? ` v${v}` : ' — NON DÉPLOYÉE'}`);
  if (!v) manquants++;
}
const inst = ((await c.searchProcessInstances({ filter: { processDefinitionId: 'backbone' }, page: { limit: 50 } } as never, opts)) as { items: Record<string, unknown>[] }).items;
console.log(`\nInstances backbone (${inst.length}) :`);
for (const i of inst) console.log(`  ${i.businessId}  ${i.state}  instance ${i.processInstanceKey}`);
if (manquants) {
  console.log(`\n${manquants} modèle(s) absent(s) : lancer « npm run deployer ».`);
  process.exit(1);
}

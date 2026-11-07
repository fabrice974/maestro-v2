/** Liste les incidents ouverts sur le cluster (diagnostic). Usage : npm run incidents */
import { chargerEnv } from '@maestro/commun';

chargerEnv();
const { default: createCamundaClient } = await import('@camunda8/orchestration-cluster-api');
const camunda = createCamundaClient();
const r = await camunda.searchIncidents({ filter: { state: 'ACTIVE' }, page: { limit: 50 } } as never, { consistency: { waitUpToMs: 0 } } as never);
const items = (r as { items?: Record<string, unknown>[] }).items ?? [];
if (!items.length) console.log('Aucun incident actif.');
for (const i of items) {
  console.log(`- [${i.processDefinitionId}] ${i.elementId} (${i.errorType}) instance ${i.processInstanceKey}\n    ${i.errorMessage}`);
}

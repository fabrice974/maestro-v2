/**
 * Déploie tous les modèles BPMN/DMN de `modeles/` sur le cluster décrit par `.env`.
 * Usage : npm run deployer [-- fichier1 fichier2]   (sans argument : tout `modeles/`)
 */
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { chargerEnv, RACINE } from '@maestro/commun';

chargerEnv();
const { default: createCamundaClient } = await import('@camunda8/orchestration-cluster-api');

function lister(dir: string): string[] {
  return readdirSync(dir).flatMap((nom) => {
    const p = join(dir, nom);
    if (statSync(p).isDirectory()) return lister(p);
    return /\.(bpmn|dmn)$/.test(nom) && !nom.includes('.v2-') ? [p] : [];
  });
}

const fichiers = process.argv.length > 2 ? process.argv.slice(2).map((f) => join(process.cwd(), f)) : lister(join(RACINE, 'modeles'));
const camunda = createCamundaClient();
const resultat = await camunda.deployResourcesFromFiles(fichiers);
console.log(`Déploiement ${resultat.deploymentKey} — ${fichiers.length} fichier(s)`);
for (const p of resultat.processes ?? []) console.log(`  processus ${p.processDefinitionId} → v${p.processDefinitionVersion}`);
for (const d of resultat.decisions ?? []) console.log(`  décision  ${d.decisionDefinitionId} → v${d.version}`);
for (const f of fichiers) console.log(`  · ${relative(RACINE, f)}`);

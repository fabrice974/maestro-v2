import { join } from 'node:path';
import { RACINE } from '@maestro/commun';
import type { DepotDocuments } from './depot.ts';
import { DepotGraph, jetonAzureCli } from './graph.ts';
import { DepotLocal } from './local.ts';

export * from './depot.ts';

export function creerDepot(env: NodeJS.ProcessEnv = process.env): DepotDocuments {
  const racine = env.SHAREPOINT_ROOT_FOLDER || 'POC-Maestro-Camunda';
  if (env.SHAREPOINT_MODE === 'graph') {
    if (!env.SHAREPOINT_GROUP_ID) throw new Error('SHAREPOINT_GROUP_ID requis en mode graph');
    return new DepotGraph(env.SHAREPOINT_GROUP_ID, racine, jetonAzureCli());
  }
  return new DepotLocal(join(RACINE, 'donnees', 'documents'), racine);
}

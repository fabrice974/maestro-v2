import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { chargerEnv, RACINE } from '@maestro/commun';

chargerEnv();

const { Journal } = await import('./audit/journal.ts');
const { creerDepot } = await import('./documents/index.ts');
const { chargerGouvernance } = await import('./gouvernance/charger.ts');
const { MoteurCamunda } = await import('./moteur.ts');
const { Registre } = await import('./registre.ts');
const { Services } = await import('./services.ts');
const { creerApp } = await import('./app.ts');
const { enregistrerWorkers } = await import('./workers.ts');

mkdirSync(join(RACINE, 'donnees'), { recursive: true });
const db = new DatabaseSync(process.env.PASSERELLE_DB ?? join(RACINE, 'donnees', 'passerelle.sqlite'));
const gouvernance = chargerGouvernance();
const moteur = new MoteurCamunda();

const services = new Services(gouvernance, new Registre(db), new Journal(db), creerDepot(), moteur, {
  facteurSla: Number(process.env.DEMO_FACTEUR_SLA ?? 1),
  delaiSuivi: process.env.DEMO_DELAI_SUIVI ?? 'P1M',
  notifier: async (url, jeton, corps) => {
    await fetch(`${url}/webhooks/taches`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jeton}` },
      body: JSON.stringify(corps),
      signal: AbortSignal.timeout(2_000),
    });
  },
});

const types = enregistrerWorkers(moteur, services);
const app = creerApp(services, { operateUrl: process.env.CAMUNDA_OPERATE_URL });
const port = Number(process.env.PASSERELLE_PORT ?? 4000);
await app.listen({ port, host: '127.0.0.1' });
console.log(`Passerelle prête sur http://localhost:${port} — cockpit : http://localhost:${port}/cockpit/`);
console.log(`Documents : ${services.depot.mode} — workers : ${types.join(', ')}`);

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, async () => {
    await moteur.arreter();
    await app.close();
    process.exit(0);
  });
}

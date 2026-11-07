import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, watch } from 'node:fs';
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

// Rechargement à chaud de la gouvernance : un changement organisationnel ou de sécurité prend effet
// sans redéploiement ni redémarrage ; chaque version de configuration est auditée (empreintes).
const dirConfig = join(RACINE, 'config');
const empreintesConfig = () =>
  Object.fromEntries(
    readdirSync(dirConfig)
      .filter((f) => f.endsWith('.yaml'))
      .map((f) => [f, createHash('sha256').update(readFileSync(join(dirConfig, f))).digest('hex').slice(0, 16)]),
  );
services.journal.ajouter({ acteur: 'passerelle', application: 'passerelle', action: 'gouvernance.chargee', details: empreintesConfig() });
let minuterie: NodeJS.Timeout | undefined;
watch(dirConfig, () => {
  clearTimeout(minuterie);
  minuterie = setTimeout(() => {
    try {
      services.g = chargerGouvernance();
      services.journal.ajouter({ acteur: 'passerelle', application: 'passerelle', action: 'gouvernance.rechargee', details: empreintesConfig() });
      console.log('Gouvernance rechargée (config/*.yaml).');
    } catch (e) {
      services.journal.ajouter({ acteur: 'passerelle', application: 'passerelle', action: 'gouvernance.rejetee', details: { erreur: (e as Error).message } });
      console.error('Configuration invalide — ancienne version conservée :\n', (e as Error).message);
    }
  }, 400);
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

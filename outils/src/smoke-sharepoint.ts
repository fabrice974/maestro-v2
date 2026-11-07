/** Vérifie l'accès SharePoint réel : crée _smoke/ sous la racine de la PoC et y dépose un fichier. */
import { chargerEnv } from '@maestro/commun';

chargerEnv();
const { creerDepot } = await import('../../passerelle/src/documents/index.ts');
const depot = creerDepot();
console.log('mode :', depot.mode, '— racine :', await depot.urlRacine());
await depot.creerDossier(['_smoke']);
const ref = await depot.deposer(['_smoke'], 'test.txt', Buffer.from(`Test de dépôt PoC Maestro — ${new Date().toISOString()}\n`));
console.log('déposé :', ref.url, ref.sha256.slice(0, 12));

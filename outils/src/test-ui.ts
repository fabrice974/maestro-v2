/**
 * Test de fumée des applications TS via leurs écrans HTML (comme un utilisateur) :
 * crée une occasion dans Deal flow, ouvre la tâche de qualification, dépose la pièce,
 * tente une complétion par une personne non habilitée (refus attendu), puis complète.
 * Prérequis : passerelle + applications démarrées (npm run demarrer).
 */
const BASE = 'http://localhost:4101';
const attendre = (ms: number) => new Promise((r) => setTimeout(r, ms));
let echecs = 0;
const verifier = (ok: boolean, libelle: string) => {
  console.log(`${ok ? '✔' : '✖'} ${libelle}`);
  if (!ok) echecs++;
};

async function pret(url: string) {
  for (let i = 0; i < 30; i++) {
    try {
      if ((await fetch(url)).ok) return true;
    } catch {}
    await attendre(1000);
  }
  return false;
}

for (const port of [4101, 4102, 4104, 4105]) verifier(await pret(`http://localhost:${port}/`), `application :${port} répond`);

const form = new URLSearchParams({ nom: 'Test UI — Terminal portuaire', contrepartie: 'Port Saint-Laurent S.E.C.', classeActif: 'infrastructure', montant: '60000000', secteur: 'transport' });
const creation = await (await fetch(`${BASE}/occasions?u=alice`, { method: 'POST', body: form })).text();
const dossierId = /INV-\d{4}-\d{4}/.exec(creation)?.[0];
verifier(!!dossierId, `occasion enregistrée depuis l'écran (${dossierId})`);

let tacheId: string | undefined;
for (let i = 0; i < 30 && !tacheId; i++) {
  await attendre(1000);
  const accueil = await (await fetch(`${BASE}/?u=yanis`)).text();
  const bloc = accueil.split('<tr>').find((l) => l.includes(dossierId!) && l.includes('/taches/'));
  tacheId = bloc ? /\/taches\/([0-9a-f-]{36})/.exec(bloc)?.[1] : undefined;
}
verifier(!!tacheId, 'la tâche de qualification apparaît dans « Mes tâches »');

const pageTache = await (await fetch(`${BASE}/taches/${tacheId}?u=yanis&prerempli=1`)).text();
verifier(pageTache.includes('type="date"') && pageTache.includes('Déposer dans SharePoint'), 'formulaire généré depuis la définition (date, dépôt)');

const fd = new FormData();
fd.append('type', 'teaser');
fd.append('fichier', new Blob(['Teaser — test UI']), 'teaser.txt');
const depot = await (await fetch(`${BASE}/taches/${tacheId}/documents?u=yanis`, { method: 'POST', body: fd })).text();
verifier(depot.includes('déposée dans SharePoint'), 'pièce déposée via l’application');

const champs = new URLSearchParams({ 'champs.dateReceptionTeaser': new Date().toLocaleDateString('sv-SE'), 'champs.sourceOccasion': 'direct', 'champs.resumeThese': 'Actif portuaire essentiel' });
const refus = await (await fetch(`${BASE}/taches/${tacheId}/completer?u=chloe`, { method: 'POST', body: champs })).text();
verifier(refus.includes('ROLE_ABSENT'), 'refus ROLE_ABSENT affiché pour une analyste d’une autre équipe');

const ok = await fetch(`${BASE}/taches/${tacheId}/completer?u=yanis`, { method: 'POST', body: champs, redirect: 'manual' });
verifier(ok.status === 302, 'complétion acceptée pour l’analyste infrastructure');

console.log(echecs ? `\n${echecs} échec(s)` : `\nTous les contrôles UI sont passés (dossier ${dossierId}).`);
process.exit(echecs ? 1 : 0);

/**
 * Robot de démonstration : joue le rôle des 5 applications via l'API de la passerelle (jamais Camunda)
 * et fait traverser un dossier tout le processus.
 *
 *   npm run bot -- [--classe credit-prive|placement-prive|infrastructure] [--montant 40000000]
 *                  [--jusqua assigne|post|fin] [--sortie rembourse|desinvestir] [--mois 2]
 *                  [--dossier INV-2026-0001]   (reprendre un dossier existant)
 *
 * Prérequis : passerelle démarrée (npm run passerelle), idéalement avec DEMO_DELAI_SUIVI=PT1M.
 */
import { parseArgs } from 'node:util';
import { reponseSimulee } from '@maestro/commun/simulation';
import { chargerEnv } from '@maestro/commun';

chargerEnv();
const { values: a } = parseArgs({
  options: {
    classe: { type: 'string', default: 'credit-prive' },
    montant: { type: 'string', default: '40000000' },
    jusqua: { type: 'string', default: 'fin' },
    sortie: { type: 'string', default: 'rembourse' },
    mois: { type: 'string', default: '2' },
    dossier: { type: 'string' },
    delai: { type: 'string', default: '900' },
    /** Applications que le robot laisse aux humains (ex. --sauf debourse), séparées par des virgules. */
    sauf: { type: 'string', default: '' },
  },
});
const SAUF = new Set(a.sauf!.split(',').filter(Boolean));

const URL_PASSERELLE = process.env.PASSERELLE_URL ?? 'http://localhost:4000';
const APPS: Record<string, string> = {
  'deal-flow': 'demo-jeton-deal-flow',
  'revue-diligente': 'demo-jeton-revue-diligente',
  debourse: 'demo-jeton-debourse',
  'suivi-periodique': 'demo-jeton-suivi-periodique',
  desinvestissement: 'demo-jeton-desinvestissement',
};

async function api<T = any>(app: string, chemin: string, init: RequestInit & { utilisateur?: string } = {}): Promise<{ statut: number; corps: T }> {
  const r = await fetch(`${URL_PASSERELLE}${chemin}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${APPS[app]}`,
      ...(init.utilisateur ? { 'X-Utilisateur': init.utilisateur } : {}),
      ...(init.body && typeof init.body === 'string' ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers ?? {}),
    },
  });
  const texte = await r.text();
  return { statut: r.status, corps: texte ? JSON.parse(texte) : undefined };
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
const t0 = Date.now();
const log = (m: string) => console.log(`[${String(Math.round((Date.now() - t0) / 1000)).padStart(4)}s] ${m}`);

let moisSuivi = 0;

async function traiterTache(app: string, tacheId: string) {
  const { corps: t } = await api(app, `/taches/${tacheId}`);
  const def = t.definition;
  const contexte = t.contexte ?? {};
  if (t.typeTache === 'suivi.collecte-mensuelle') moisSuivi++;
  const rep = reponseSimulee(t.typeTache, { montant: Number(contexte.montant ?? a.montant), chantier: contexte.chantier, mois: moisSuivi });
  const candidats: { id: string; nom: string }[] = t.candidats.filter(Boolean);
  for (const personne of candidats) {
    // Dépôt des pièces requises (fichiers texte de démonstration).
    for (const d of def.documents as { type: string; libelle: string; obligatoire: boolean }[]) {
      if (t.documents.some((x: { type: string }) => x.type === d.type)) continue;
      const form = new FormData();
      form.append('type', d.type);
      form.append('fichier', new Blob([`${d.libelle}\nDossier ${t.dossierId}\nProduit par la simulation le ${new Date().toISOString()}\n`]), `${d.type}.txt`);
      const r = await api(app, `/taches/${tacheId}/documents`, { method: 'POST', body: form, utilisateur: personne.id });
      if (r.statut !== 200) throw new Error(`dépôt ${d.type} : ${r.statut} ${JSON.stringify(r.corps)}`);
      t.documents.push({ type: d.type });
    }
    const r = await api(app, `/taches/${tacheId}/completer`, { method: 'POST', body: JSON.stringify(rep), utilisateur: personne.id });
    if (r.statut === 200) {
      log(`✔ ${def.titre}${contexte.chantier ? ` [${contexte.chantier}]` : ''} — ${personne.nom} (${t.roleRequis})${rep.decision ? ` → ${rep.decision}` : ''}`);
      return;
    }
    if (r.corps?.code === 'SEPARATION_TACHES') {
      log(`  ✖ refus attendu (${r.corps.code}) pour ${personne.nom} : on passe au candidat suivant`);
      continue;
    }
    throw new Error(`complétion ${t.typeTache} : ${r.statut} ${JSON.stringify(r.corps)}`);
  }
  throw new Error(`Aucun candidat ne peut compléter ${t.typeTache}`);
}

async function main() {
  let dossierId = a.dossier;
  if (!dossierId) {
    const r = await api('deal-flow', '/dossiers', {
      method: 'POST',
      utilisateur: 'alice',
      body: JSON.stringify({
        nom: a.classe === 'infrastructure' ? 'Parc éolien Mékinac' : a.classe === 'placement-prive' ? 'Groupe Agroalimentaire Laurentien' : 'Prêt à terme — Logistique Boréale',
        contrepartie: a.classe === 'infrastructure' ? 'Énergie Boréale S.E.C.' : 'Logistique Boréale inc.',
        classeActif: a.classe,
        montant: Number(a.montant),
        secteur: a.classe === 'infrastructure' ? 'energie-renouvelable' : 'transport-logistique',
      }),
    });
    if (r.statut !== 201) throw new Error(`création du dossier : ${r.statut} ${JSON.stringify(r.corps)}`);
    dossierId = r.corps.dossierId as string;
    log(`Dossier ${dossierId} créé (${a.classe}, ${Number(a.montant).toLocaleString('fr-CA')} $) — documents : ${r.corps.urlDocuments}`);
  }
  const limite = Date.now() + Number(a.delai) * 1000;
  let evenementEnvoye = false;
  while (Date.now() < limite) {
    let travail = false;
    for (const app of Object.keys(APPS).filter((x) => !SAUF.has(x))) {
      const { corps: taches } = await api(app, `/taches?statut=ouverte&dossierId=${dossierId}`);
      for (const t of taches) {
        await traiterTache(app, t.tacheId);
        travail = true;
      }
    }
    const { corps: d } = await api('deal-flow', `/dossiers/${dossierId}`);
    if (a.jusqua === 'assigne' && d.taches.some((t: { typeTache: string }) => t.typeTache.startsWith('debourse.'))) break;
    if (a.jusqua === 'post' && d.phase === 'suivi-periodique') break;
    if (d.statut !== 'actif') {
      log(`Dossier ${dossierId} : statut final « ${d.statut} » (phase ${d.phase})`);
      break;
    }
    if (d.phase === 'suivi-periodique' && moisSuivi >= Number(a.mois) && !evenementEnvoye && !d.taches.some((t: { statut: string }) => t.statut === 'ouverte')) {
      const type = a.sortie === 'desinvestir' ? 'decision-desinvestir' : 'remboursement-complet';
      const r = await api('suivi-periodique', `/dossiers/${dossierId}/evenements/${type}`, {
        method: 'POST',
        utilisateur: 'kevin',
        body: JSON.stringify({ evenementId: `${dossierId}-${type}`, donnees: { date: new Date().toISOString().slice(0, 10) } }),
      });
      log(`→ événement ${type} émis par l'application suivi-periodique (${r.statut})`);
      evenementEnvoye = true;
    }
    if (!travail) await pause(1500);
  }
  const { corps: verif } = await api('deal-flow', '/audit/verification');
  const { corps: d } = await api('deal-flow', `/dossiers/${dossierId}`);
  log(`Audit : ${d.audit.length} entrées pour ${dossierId} ; chaîne globale ${verif.valide ? 'VALIDE' : 'ROMPUE'} (${verif.entrees} entrées)`);
  log(`phase: ${d.phase} — statut: ${d.statut}`);
}

main().catch((e) => {
  console.error('ÉCHEC :', e.message);
  process.exit(1);
});

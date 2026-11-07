/**
 * Test de l'application .NET « Déboursé » via SES écrans (pas via l'API) : pour chaque tâche debourse.*
 * ouverte sur le dossier, dépose les pièces et complète le formulaire, comme un utilisateur.
 * Vérifie au passage le refus de séparation des tâches affiché par l'application.
 *
 *   npx tsx outils/src/test-dotnet.ts INV-2026-0006
 * Prérequis : passerelle + application .NET (:4103) démarrées, dossier rendu au déboursé
 * (npm run bot -- --sauf debourse --jusqua post).
 */
import { reponseSimulee } from '@maestro/commun/simulation';

const NET = 'http://localhost:4103';
const PASSERELLE = 'http://localhost:4000';
const dossierId = process.argv[2];
if (!dossierId) throw new Error('dossierId requis');
const attendre = (ms: number) => new Promise((r) => setTimeout(r, ms));
let echecs = 0;
const verifier = (ok: boolean, t: string) => {
  console.log(`${ok ? '✔' : '✖'} ${t}`);
  if (!ok) echecs++;
};

const api = async (chemin: string) =>
  (await (await fetch(`${PASSERELLE}${chemin}`, { headers: { Authorization: 'Bearer demo-jeton-debourse' } })).json()) as any;

const traitees = new Set<string>();
let refusVerifie = false;
const limite = Date.now() + 180_000;
while (Date.now() < limite) {
  const d = await api(`/dossiers/${dossierId}`);
  if (['suivi-periodique', 'cloture'].includes(d.phase) || d.statut !== 'actif') break;
  const ouvertes = (await api(`/taches?statut=ouverte&dossierId=${dossierId}`)) as any[];
  const t = ouvertes.find((x) => !traitees.has(x.tacheId));
  if (!t) {
    await attendre(1500);
    continue;
  }
  const detail = await api(`/taches/${t.tacheId}`);
  const historique = d.taches.filter((x: any) => x.statut === 'completee');
  // Pour l'approbation : tenter d'abord avec le préparateur (refus attendu affiché par l'app .NET).
  const preparateur = historique.find((x: any) => x.typeTache === 'debourse.preparer-instruction')?.completeePar;
  const candidats: string[] = detail.candidats.map((p: any) => p.id);
  const ordre = t.typeTache === 'debourse.approuver' && preparateur && !refusVerifie ? [preparateur, ...candidats.filter((c) => c !== preparateur)] : candidats;

  const pageTache = await (await fetch(`${NET}/taches/${t.tacheId}?u=${ordre[0]}&prerempli=1`)).text();
  const titreHtml = detail.definition.titre.replace(/'/g, '&#39;');
  verifier(pageTache.includes(detail.definition.titre) || pageTache.includes(titreHtml),`[.NET] page « ${detail.definition.titre} » affichée`);

  for (const u of ordre) {
    for (const doc of detail.definition.documents) {
      const fd = new FormData();
      fd.append('type', doc.type);
      fd.append('fichier', new Blob([`${doc.libelle} — déposé via l'application .NET`]), `${doc.type}.txt`);
      const r = await fetch(`${NET}/taches/${t.tacheId}/documents?u=${u}`, { method: 'POST', body: fd });
      verifier(r.ok, `[.NET] pièce ${doc.type} déposée par ${u}`);
    }
    detail.definition.documents = [];
    const rep = reponseSimulee(t.typeTache, { montant: d.montant });
    const corps = new URLSearchParams();
    for (const [k, v] of Object.entries(rep.champs)) corps.append(`champs.${k}`, String(v));
    if (rep.decision) corps.append('decision', rep.decision);
    const r = await fetch(`${NET}/taches/${t.tacheId}/completer?u=${u}`, { method: 'POST', body: corps, redirect: 'manual' });
    if (r.status >= 300 && r.status < 400) {
      verifier(true, `[.NET] ${t.typeTache} complétée par ${u}`);
      break;
    }
    const html = await r.text();
    if (html.includes('SEPARATION_TACHES')) {
      verifier(true, `[.NET] refus SEPARATION_TACHES affiché pour ${u} (préparateur) — on passe à un autre approbateur`);
      refusVerifie = true;
      continue;
    }
    verifier(false, `[.NET] ${t.typeTache} par ${u} : HTTP ${r.status} ${html.match(/<strong>[^<]*<\/strong>[^<]*/)?.[0] ?? ''}`);
    break;
  }
  traitees.add(t.tacheId);
}
const d = await api(`/dossiers/${dossierId}`);
verifier(d.phase === 'suivi-periodique', `dossier ${dossierId} passé en post-investissement (phase ${d.phase})`);
verifier(refusVerifie, 'séparation des tâches démontrée dans l’application .NET');
const paiement = d.audit.find((x: any) => x.action === 'paiement.execute');
verifier(!!paiement, `paiement simulé audité (${paiement?.details?.reference ?? '—'}) avec avis déposé dans SharePoint`);
console.log(echecs ? `\n${echecs} échec(s)` : '\nApplication .NET validée de bout en bout.');
process.exit(echecs ? 1 : 0);

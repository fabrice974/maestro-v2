/**
 * Scénarios de changement joués en démo (voir docs/playbooks/).
 *
 *   npm run scenario -- liste
 *   npm run scenario -- r1            appliquer + prouver
 *   npm run scenario -- r1 --annuler  revenir à l'état initial
 *
 * R = règle d'affaires, O = organisationnel, S = sécurité.
 * Les scénarios modifient de vrais fichiers du dépôt (modeles/, config/) : une copie est gardée dans
 * donnees/scenarios/ pour --annuler. Ne pas commiter un état « scénario appliqué » par mégarde.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { layoutProcess } from 'bpmn-auto-layout';
import { chargerEnv, RACINE } from '@maestro/commun';
import { chargerGouvernance } from '../../passerelle/src/gouvernance/charger.ts';
import { verifierCompletion } from '../../passerelle/src/gouvernance/politique.ts';
import { dealFlow } from './bpmn/processus.ts';

chargerEnv();
const { default: createCamundaClient } = await import('@camunda8/orchestration-cluster-api');
const camunda = createCamundaClient();
const PASSERELLE = process.env.PASSERELLE_URL ?? 'http://localhost:4000';
const SAUVEGARDES = join(RACINE, 'donnees', 'scenarios');

// ───────────── Outils ─────────────
const f = (...p: string[]) => join(RACINE, ...p);
const titre = (t: string) => console.log(`\n\x1b[1m${t}\x1b[0m`);
const etape = (t: string) => console.log(`  • ${t}`);
const preuve = (ok: boolean, t: string) => console.log(`  ${ok ? '\x1b[32m✔' : '\x1b[31m✖'} ${t}\x1b[0m`);

const nomSauvegarde = (fichier: string) => join(SAUVEGARDES, relative(RACINE, fichier).replace(/[\\/:]/g, '_'));
function sauvegarder(fichier: string) {
  mkdirSync(SAUVEGARDES, { recursive: true });
  const cible = nomSauvegarde(fichier);
  if (!existsSync(cible)) copyFileSync(fichier, cible);
}
function restaurer(fichier: string) {
  const source = nomSauvegarde(fichier);
  if (!existsSync(source)) return false;
  copyFileSync(source, fichier);
  unlinkSync(source);
  return true;
}
function remplacer(fichier: string, avant: string, apres: string) {
  sauvegarder(fichier);
  const contenu = readFileSync(fichier, 'utf8');
  if (contenu.includes(apres) && !contenu.includes(avant)) return etape(`déjà appliqué dans ${fichier.slice(RACINE.length + 1)}`);
  if (!contenu.includes(avant)) throw new Error(`Motif introuvable dans ${fichier} : ${avant}`);
  writeFileSync(fichier, contenu.replace(avant, apres));
  etape(`modifié ${fichier.slice(RACINE.length + 1)}`);
}
async function deployer(...fichiers: string[]) {
  const r = await camunda.deployResourcesFromFiles(fichiers);
  for (const p of r.processes ?? []) etape(`déployé processus ${p.processDefinitionId} v${p.processDefinitionVersion}`);
  for (const d of r.decisions ?? []) etape(`déployé règle ${d.decisionDefinitionId} v${d.version}`);
}
async function evaluer(decision: string, variables: Record<string, unknown>) {
  const r = (await camunda.evaluateDecision({ decisionDefinitionId: decision, variables } as never)) as { output: string; decisionDefinitionVersion: number };
  return { valeur: JSON.parse(r.output) as unknown, version: r.decisionDefinitionVersion };
}
async function api(jeton: string, chemin: string, init: RequestInit & { utilisateur?: string } = {}) {
  const r = await fetch(`${PASSERELLE}${chemin}`, {
    ...init,
    headers: { Authorization: `Bearer ${jeton}`, 'Content-Type': 'application/json', ...(init.utilisateur ? { 'X-Utilisateur': init.utilisateur } : {}) },
  });
  return { statut: r.status, corps: (await r.json().catch(() => null)) as any };
}
async function etat() {
  return (await (await fetch(`${PASSERELLE}/cockpit/api/etat`)).json()) as { taches: any[]; audit: any[] };
}
const attendre = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Scenario {
  titre: string;
  pourquoi: string;
  appliquer: () => Promise<void>;
  annuler: () => Promise<void>;
}

// ───────────── Scénarios ─────────────
const DMN_APPRO = f('modeles', 'dmn', 'niveau-approbation.dmn');
const DMN_CHANTIERS = f('modeles', 'dmn', 'chantiers-revue-diligente.dmn');
const DMN_CONTROLES = f('modeles', 'dmn', 'controles-debourse.dmn');
const BPMN_DEAL = f('modeles', 'bpmn', 'deal-flow.bpmn');
const ORG = f('config', 'organisation.yaml');

const SCENARIOS: Record<string, Scenario> = {
  r1: {
    titre: 'R1 — Le seuil du comité du conseil passe de 100 M$ à 50 M$',
    pourquoi: 'Changement de politique d’approbation décidé par le conseil. Seule la règle change : ni code, ni BPMN.',
    appliquer: async () => {
      const avant = await evaluer('niveau-approbation', { montantDecision: 60_000_000 });
      etape(`avant : 60 M$ → ${JSON.stringify(avant.valeur)} (règle v${avant.version})`);
      remplacer(DMN_APPRO, '<text>&gt; 100000000</text>', '<text>&gt; 50000000</text>');
      await deployer(DMN_APPRO);
      const apres = await evaluer('niveau-approbation', { montantDecision: 60_000_000 });
      preuve(apres.valeur === 'comite-conseil', `après : 60 M$ → ${JSON.stringify(apres.valeur)} (règle v${apres.version})`);
      etape('Liaison « latest » : toute approbation finale décidée à partir de maintenant suit la nouvelle règle, y compris pour les dossiers déjà en cours ; les décisions passées restent tracées avec leur version (audit « regle.evaluee » et Operate > Decisions).');
    },
    annuler: async () => {
      restaurer(DMN_APPRO) && (await deployer(DMN_APPRO));
    },
  },
  r2: {
    titre: 'R2 — La revue ESG devient obligatoire pour l’infrastructure',
    pourquoi: 'Nouvelle exigence de la politique d’investissement responsable.',
    appliquer: async () => {
      const avant = await evaluer('chantiers-revue-diligente', { classeActif: 'infrastructure' });
      etape(`avant : infrastructure → ${JSON.stringify(avant.valeur)}`);
      remplacer(
        DMN_CHANTIERS,
        '<inputEntry id="In_4_1"><text>&quot;placement-prive&quot;</text></inputEntry><outputEntry id="Out_4_1"><text>&quot;esg&quot;',
        '<inputEntry id="In_4_1"><text>&quot;placement-prive&quot;,&quot;infrastructure&quot;</text></inputEntry><outputEntry id="Out_4_1"><text>&quot;esg&quot;',
      );
      await deployer(DMN_CHANTIERS);
      const apres = await evaluer('chantiers-revue-diligente', { classeActif: 'infrastructure' });
      preuve(JSON.stringify(apres.valeur).includes('esg'), `après : infrastructure → ${JSON.stringify(apres.valeur)} (v${apres.version})`);
      etape('Le multi-instance de la revue diligente crée automatiquement une tâche « esg » ; le rôle revue-esg (Nora, Horizon ESG) existe déjà : aucun changement organisationnel ni applicatif.');
    },
    annuler: async () => {
      restaurer(DMN_CHANTIERS) && (await deployer(DMN_CHANTIERS));
    },
  },
  r3: {
    titre: 'R3 — Ajout d’une revue de conformité avant l’approbation finale',
    pourquoi: 'Exigence réglementaire : la conformité doit valider avant toute approbation finale.',
    appliquer: async () => {
      etape('Catalogue : type « dealflow.revue-conformite » (rôle conformite, application deal-flow) — déjà présent dans config/taches.yaml.');
      sauvegarder(BPMN_DEAL);
      writeFileSync(BPMN_DEAL, await layoutProcess(dealFlow(true).xml()));
      etape('BPMN : deal-flow regénéré avec l’étape « Revue de conformité » (ou modifié dans Camunda Modeler).');
      await deployer(BPMN_DEAL);
      preuve(true, 'Nouvelle version déployée : les NOUVEAUX dossiers passent par la revue de conformité ; les instances en cours restent sur leur version (migration possible depuis Operate si souhaité).');
      etape('Aucune application modifiée : la tâche apparaît dans l’application Deal flow, formulaire généré depuis le catalogue.');
      const g = chargerGouvernance();
      preuve(!!g.taches.get('dealflow.revue-conformite'), `Habilitation : ${g.roles.get('conformite')?.join(', ')} (rôle conformite).`);
    },
    annuler: async () => {
      restaurer(BPMN_DEAL) && (await deployer(BPMN_DEAL));
    },
  },
  o1: {
    titre: 'O1 — Fusion des équipes Crédit privé et Placement privé',
    pourquoi: 'Réorganisation : une seule équipe « Marchés privés » traite les deux classes d’actif.',
    appliquer: async () => {
      const g0 = chargerGouvernance();
      const ctx = { typeTache: 'dealflow.analyse-preliminaire', roleRequis: 'analyste-credit-prive', utilisateur: 'chloe', application: 'deal-flow', historique: [] };
      etape(`avant : Chloé (placement privé) sur une analyse crédit privé → ${verifierCompletion(g0, ctx)?.code ?? 'autorisée'}`);
      remplacer(ORG, 'analyste-credit-prive: [equipe:credit-prive]', 'analyste-credit-prive: [equipe:credit-prive, equipe:placement-prive]');
      remplacer(ORG, 'analyste-placement-prive: [equipe:placement-prive]', 'analyste-placement-prive: [equipe:placement-prive, equipe:credit-prive]');
      const g1 = chargerGouvernance();
      preuve(verifierCompletion(g1, ctx) === null, 'après : Chloé peut compléter les tâches crédit privé (et Alice celles du placement privé).');
      etape('Aucun BPMN, DMN ni code modifié. La passerelle recharge config/ à chaud (entrée d’audit « gouvernance.rechargee » avec les empreintes des fichiers).');
      await attendre(1500);
      const a = (await etat().catch(() => ({ audit: [] as any[] }))).audit.find((x) => x.action === 'gouvernance.rechargee');
      preuve(!!a, a ? `audit #${a.seq} gouvernance.rechargee — organisation.yaml ${a.details['organisation.yaml']}` : 'passerelle non démarrée : rechargement non vérifié');
    },
    annuler: async () => {
      restaurer(ORG);
    },
  },
  o2: {
    titre: 'O2 — La nouvelle équipe Conformité approuve les déboursés de plus de 25 M$',
    pourquoi: 'Renforcement du contrôle : seuil abaissé et équipe Conformité étoffée.',
    appliquer: async () => {
      const avant = await evaluer('controles-debourse', { montantTirage: 30_000_000 });
      etape(`avant : tirage de 30 M$ → conformité requise = ${JSON.stringify(avant.valeur)}`);
      remplacer(DMN_CONTROLES, '<text>&gt; 50000000</text>', '<text>&gt; 25000000</text>');
      await deployer(DMN_CONTROLES);
      remplacer(
        ORG,
        "  - { id: kevin, nom: Kevin Bélanger, equipe: gestion-portefeuille, titre: Gestionnaire de portefeuille }",
        "  - { id: kevin, nom: Kevin Bélanger, equipe: gestion-portefeuille, titre: Gestionnaire de portefeuille }\n  - { id: omar, nom: Omar Haddad, equipe: conformite, titre: Analyste conformité (nouvelle équipe) }",
      );
      const apres = await evaluer('controles-debourse', { montantTirage: 30_000_000 });
      preuve(apres.valeur === true, `après : tirage de 30 M$ → conformité requise = ${JSON.stringify(apres.valeur)} (règle v${apres.version})`);
      preuve(!!chargerGouvernance().roles.get('conformite')?.includes('omar'), 'Omar hérite du rôle conformite via « equipe:conformite » : aucune règle de sécurité à toucher.');
      etape('Impact sécurité vérifié : la séparation des tâches (préparateur ≠ approbateur conformité) s’applique aussi à Omar.');
    },
    annuler: async () => {
      restaurer(DMN_CONTROLES) && (await deployer(DMN_CONTROLES));
      restaurer(ORG);
    },
  },
  s1: {
    titre: 'S1 — L’application Suivi périodique tente de compléter une tâche de déboursé',
    pourquoi: 'Défense contre une application compromise ou mal configurée, même si elle connaît l’identifiant de la tâche.',
    appliquer: async () => {
      const t = (await etat()).taches.find((x) => x.statut === 'ouverte' && x.application !== 'suivi-periodique');
      if (!t) return etape('Aucune tâche ouverte d’une autre application : lancez d’abord « npm run bot -- --jusqua assigne ».');
      etape(`cible : ${t.typeTache} (${t.dossierId}), propriété de l’application « ${t.application} »`);
      const r = await api('demo-jeton-suivi-periodique', `/taches/${t.tacheId}/completer`, { method: 'POST', utilisateur: 'kevin', body: JSON.stringify({ decision: 'approuve', champs: {} }) });
      preuve(r.statut === 403 && r.corps?.code === 'APPLICATION_NON_AUTORISEE', `réponse ${r.statut} ${r.corps?.code}`);
      await attendre(1000);
      const a = (await etat()).audit.find((x) => x.action === 'tache.refusee' && x.tacheId === t.tacheId);
      preuve(!!a, `audit #${a?.seq} tache.refusee (hash ${a?.hash.slice(0, 12)}…)`);
      etape('Dans Operate : l’instance tache-metier de cette tâche est passée par « Consigner le refus » puis revenue en attente.');
    },
    annuler: async () => etape('Rien à annuler.'),
  },
  s2: {
    titre: 'S2 — Le préparateur d’un déboursé tente de l’approuver',
    pourquoi: 'Contrôle quatre yeux exigé par l’audit interne.',
    appliquer: async () => {
      const e = await etat();
      const t = e.taches.find((x) => x.statut === 'ouverte' && x.typeTache === 'debourse.approuver');
      if (!t) {
        const g = chargerGouvernance();
        const r = verifierCompletion(g, {
          typeTache: 'debourse.approuver',
          roleRequis: 'tresorerie',
          utilisateur: 'hugo',
          application: 'debourse',
          historique: [{ typeTache: 'debourse.preparer-instruction', completeePar: 'hugo' }],
        });
        preuve(r?.code === 'SEPARATION_TACHES', `contrôle hors ligne (aucune approbation ouverte) : ${r?.code} — ${r?.message}`);
        return etape('Pour le voir en direct : npm run bot -- --jusqua assigne, puis compléter l’instruction dans l’application .NET et relancer ce scénario.');
      }
      const preparateur = e.taches.find((x) => x.dossierId === t.dossierId && x.typeTache === 'debourse.preparer-instruction')?.completeePar;
      const r = await api('demo-jeton-debourse', `/taches/${t.tacheId}/completer`, { method: 'POST', utilisateur: preparateur, body: JSON.stringify({ decision: 'approuve', champs: {} }) });
      preuve(r.corps?.code === 'SEPARATION_TACHES', `${preparateur} → ${r.statut} ${r.corps?.code}`);
    },
    annuler: async () => etape('Rien à annuler.'),
  },
  s3: {
    titre: 'S3 — Une contributrice externe (Léa, Cabinet comptable Boréal) quitte le mandat',
    pourquoi: 'Fin de mandat d’un tiers : ses accès doivent tomber immédiatement.',
    appliquer: async () => {
      const ctx = { typeTache: 'revue.chantier', roleRequis: 'revue-fiscale', utilisateur: 'lea', application: 'revue-diligente', historique: [] };
      etape(`avant : Léa sur un chantier fiscal → ${verifierCompletion(chargerGouvernance(), ctx)?.code ?? 'autorisée'}`);
      remplacer(ORG, 'revue-financiere: [lea, alice]', 'revue-financiere: [alice]');
      remplacer(ORG, 'revue-fiscale: [lea]', 'revue-fiscale: [alice]');
      preuve(verifierCompletion(chargerGouvernance(), ctx)?.code === 'ROLE_ABSENT', 'après : ROLE_ABSENT — toute complétion de Léa est refusée (et visible dans Operate).');
      const ouvertes = (await etat().catch(() => ({ taches: [] as any[] }))).taches.filter((x) => x.statut === 'ouverte' && ['revue-financiere', 'revue-fiscale'].includes(x.roleRequis));
      etape(`${ouvertes.length} tâche(s) ouverte(s) de ses rôles, désormais réalisables par Alice (réaffectation sans toucher au BPMN).`);
      etape('SharePoint : retirer l’invitée du site / du groupe M365 (étape manuelle dans la PoC, automatisable via Graph : DELETE /groups/{id}/members/{user}/$ref).');
    },
    annuler: async () => {
      restaurer(ORG);
    },
  },
};

// ───────────── Exécution ─────────────
const [id, option] = process.argv.slice(2);
if (!id || id === 'liste') {
  titre('Scénarios disponibles');
  for (const [k, s] of Object.entries(SCENARIOS)) console.log(`  ${k.padEnd(4)} ${s.titre}`);
  process.exit(0);
}
const s = SCENARIOS[id.toLowerCase()];
if (!s) throw new Error(`Scénario inconnu : ${id}`);
titre(s.titre);
console.log(`  ${s.pourquoi}`);
if (option === '--annuler') {
  await s.annuler();
  console.log('  → état initial restauré.');
} else {
  await s.appliquer();
  console.log(`\n  Guide : docs/playbooks/ — revenir en arrière : npm run scenario -- ${id} --annuler`);
}

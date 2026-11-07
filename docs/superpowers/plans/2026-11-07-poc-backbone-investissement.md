# PoC backbone d'investissement — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** un dossier d'investissement fictif traverse deal flow → revue diligente → déboursé → suivi
mensuel → désinvestissement sur Camunda 8 SaaS, piloté par des applications simulées (4 TS + 1 .NET)
qui ne parlent qu'à la passerelle.

**Architecture :** monorepo npm workspaces. La passerelle TypeScript est l'unique client Camunda
(REST v2 via `@camunda8/orchestration-cluster-api`) ; elle expose un contrat OpenAPI, tient le
registre des tâches, la politique de sécurité, le journal d'audit chaîné et l'adaptateur SharePoint.
Le catalogue des tâches, l'organisation et la sécurité sont des fichiers YAML sous `config/`.

**Tech stack :** Node 24, TypeScript 5, Fastify 5, zod, `yaml`, `node:sqlite`, vitest,
openapi-typescript + openapi-fetch, `@camunda8/orchestration-cluster-api@10.0.1`, .NET 10 ASP.NET
Core + NSwag, Microsoft Graph (jeton Azure CLI pour la PoC).

**Spec :** `docs/superpowers/specs/2026-11-07-backbone-investissement-design.md`

## Global Constraints

- Aucune application sous `apps/` ne dépend d'un paquet `@camunda8/*` ni ne manipule une clé d'instance.
- Les BPMN/DMN ne contiennent que des rôles abstraits, jamais un nom de personne ou de groupe.
- Aucun contenu de document dans une variable de processus : seulement `{ id, nom, url, sha256 }`.
- Clé de corrélation métier `dossierId` au format `INV-AAAA-NNNN` ; tâches corrélées par `tacheId`.
- Toute écriture SharePoint reste sous `SHAREPOINT_ROOT_FOLDER` (`POC-Maestro-Camunda`) ; tout autre chemin est refusé.
- Business rule tasks en liaison `latest`. Minuterie du suivi : variable `cycleSuivi` (défaut `R/P1M`, démo `DEMO_CYCLE_SUIVI`).
- Ports : passerelle 4000 ; deal-flow 4101, revue-diligente 4102, déboursé (.NET) 4103, suivi-periodique 4104, desinvestissement 4105.
- Secrets uniquement dans `.env` (ignoré) ; `.env.example` documente chaque variable.

## Review Focus

1. Une même complétion envoyée deux fois (double clic, réessai réseau) → une seule corrélation, la seconde répond 409 sans nouvelle entrée d'audit « complétée ».
2. Une complétion avec une date mal formée ou passée là où le catalogue exige `>= aujourd'hui` → 422 détaillé + message `tache.refusee`, jamais d'exception 500.
3. La passerelle redémarre pendant qu'une tâche est ouverte → le registre SQLite la retrouve et la complétion fonctionne encore.
4. Un nom de fichier ou un `dossierId` contenant `../` ou `/` → refusé par l'adaptateur documents avant tout appel Graph.
5. Graph indisponible ou jeton expiré au dépôt d'un document → 503 explicite côté application, la tâche reste ouverte, rien n'est corrélé.

---

### Task 1 : socle du monorepo et déploiement sur `dev-cl`

**Files :** create `package.json` (workspaces `passerelle`, `packages/*`, `apps/*`, `outils`), `tsconfig.base.json`, `.env.example`, `outils/package.json`, `outils/src/env.ts`, `outils/src/deployer.ts`, `modeles/bpmn/bonjour.bpmn`.

**Interfaces — produit :** `chargerEnv(chemin = '.env'): void` (remplit `process.env` sans écraser) ; `npm run deployer` déploie tous les `modeles/**/*.{bpmn,dmn}` et affiche `id → version`.

- [ ] Créer les fichiers ; `npm install`.
- [ ] `npm run deployer` → sortie contient `bonjour → 1`.
- [ ] Commit `chore: socle monorepo et déploiement Camunda`.

### Task 2 : configuration de gouvernance (catalogue, organisation, sécurité)

**Files :** create `config/taches.yaml`, `config/organisation.yaml`, `config/securite.yaml`, `config/applications.yaml`, `passerelle/src/gouvernance/{schemas,charger,politique}.ts`, test `passerelle/test/politique.test.ts`.

**Interfaces — produit :**
- `DefinitionTache { typeTache; application; roleRequis /* peut contenir {{var}} */; titre; delaiSla /* ISO-8601 */; champs: Champ[]; documents: {type; obligatoire}[]; separationAvec?: string[] }`, `Champ { nom; libelle; type: 'texte'|'date'|'montant'|'booleen'|'choix'; obligatoire; choix?: string[]; regle?: 'futur'|'passe' }`.
- `Gouvernance { taches: Map<string, DefinitionTache>; personnes: Personne[]; roles: Map<string, string[] /* idPersonne */>; applications: Map<string, {url; jeton; typesTache: string[]; evenements: string[]}> }`, `chargerGouvernance(dir = 'config'): Gouvernance` (zod ; erreur lisible si invalide).
- `verifierCompletion(g, { tache, utilisateur, application, historique }): Refus | null` où `Refus { code: 'APPLICATION_NON_AUTORISEE'|'ROLE_ABSENT'|'SEPARATION_TACHES'; message }` ; `validerDonnees(def, champs, documents, aujourdhui): { champ; erreur }[]`.

- [ ] Tests (échouent d'abord) : `refuse APPLICATION_NON_AUTORISEE quand suivi-periodique complète debourse.approuver` ; `refuse SEPARATION_TACHES quand le préparateur approuve` ; `refuse ROLE_ABSENT` ; `accepte un approbateur valide` ; `validerDonnees signale date manquante, date passée avec regle futur, date mal formée, document obligatoire absent`.
- [ ] Implémenter ; `npx vitest run passerelle/test/politique.test.ts` → PASS.
- [ ] Commit.

### Task 3 : journal d'audit chaîné

**Files :** create `passerelle/src/audit/journal.ts`, `outils/src/audit-verifier.ts`, test `passerelle/test/journal.test.ts`.

**Interfaces — produit :** `class Journal { constructor(db: DatabaseSync); ajouter(e: EntreeAudit): EntreeAuditScellee; lister(filtre?: { dossierId?: string }): EntreeAuditScellee[]; verifier(): { valide: boolean; rompueA?: number } }`. `EntreeAudit { acteur; application; dossierId?; tacheId?; action; details?: object; document?: { nom; url; sha256 }; versionModele?: string; cleInstance?: string }`. Scellée = + `seq`, `horodatage`, `hashPrecedent`, `hash` (SHA-256 du JSON canonique + `hashPrecedent`). Table en ajout seul (triggers SQLite qui bloquent UPDATE/DELETE).

- [ ] Tests : `chaîne valide après 3 ajouts` ; `verifier détecte une ligne altérée` (désactive le trigger dans le test) ; `UPDATE est refusé par la base`.
- [ ] Implémenter ; tests PASS ; commit.

### Task 4 : adaptateur documents SharePoint

**Files :** create `passerelle/src/documents/{depot,local,graph,jeton}.ts`, test `passerelle/test/depot.test.ts`.

**Interfaces — produit :** `interface DepotDocuments { creerDossier(chemin: string[]): Promise<{ url }>; deposer(chemin: string[], nom: string, contenu: Buffer): Promise<RefDocument>; existe(chemin: string[], nom: string): Promise<boolean> }`, `RefDocument { id; nom; url; sha256 }`. `creerDepot(env): DepotDocuments` (`SHAREPOINT_MODE=graph|local`). Graph : `/groups/{SHAREPOINT_GROUP_ID}/drive/root:/{racine}/{chemin}` ; jeton via `az account get-access-token` mis en cache jusqu'à expiration. `segmentSur(s)` refuse `..`, `/`, `\`, vide.

- [ ] Tests (mode local, dossier temporaire) : dépôt + `sha256` attendu ; `existe` ; rejet `../x` et `a/b` ; Graph en échec → `ErreurDepotIndisponible`.
- [ ] Smoke manuel : `npx tsx outils/src/smoke-sharepoint.ts` crée `POC-Maestro-Camunda/_smoke/test.txt` et affiche l'URL.
- [ ] Commit.

### Task 5 : passerelle — registre des tâches, workers, API, contrat

**Files :** create `contrats/openapi.yaml`, `modeles/bpmn/tache-metier.bpmn`, `passerelle/src/{main,app,camunda,registre,dossiers,notifications}.ts`, `passerelle/src/workers/taches.ts`, tests `passerelle/test/api.test.ts`.

**Interfaces — produit (REST, en-têtes `Authorization: Bearer <jeton app>` + `X-Utilisateur: <idPersonne>`) :**
- `POST /dossiers` `{ nom, contrepartie, classeActif: 'credit-prive'|'placement-prive'|'infrastructure', montant, secteur }` → 201 `{ dossierId }` (démarre `backbone`, crée l'arborescence SharePoint `{dossierId}/{01-deal-flow,02-revue-diligente,03-debourse,04-suivi,05-desinvestissement}`).
- `GET /dossiers`, `GET /dossiers/{dossierId}` (phase, tâches, documents, audit).
- `GET /taches?application=&statut=ouverte` ; `GET /taches/{tacheId}` (inclut la `DefinitionTache` résolue).
- `POST /taches/{tacheId}/documents` (multipart `type`, `fichier`) → `RefDocument`.
- `POST /taches/{tacheId}/completer` `{ champs, decision? }` → 200 | 403 `Refus` | 409 déjà complétée | 422 `{ erreurs }`.
- `POST /dossiers/{dossierId}/evenements/{type}` `{ evenementId, donnees }` → 202 (idempotent sur `evenementId`).
- `GET /organisation/personnes`, `GET /audit?dossierId=`, `GET /audit/verification`.
- Webhook sortant `POST {app.url}/webhooks/taches` `{ tacheId, typeTache, dossierId }` (échec toléré : l'app peut aussi interroger `GET /taches`).
- Workers : `tache.ouvrir` (sortie `tacheId`, `delaiSla`, `roleRequis`), `tache.clore`, `tache.consigner-refus`, `tache.escalader`. Messages : `tache.completee` / `tache.refusee` (clé `tacheId`, `messageId` = `tacheId:completee` pour l'idempotence).
- `tache-metier.bpmn` : entrée `typeTache` (+ variables de contexte) ; sortie `resultat` `{ champs, decision, documents, completeePar }`.

- [ ] Tests `fastify.inject` avec un faux client Camunda : `POST /dossiers démarre backbone avec dossierId` ; `completer → correlateMessage tache.completee` ; `seconde complétion → 409` ; `rôle absent → 403 + publishMessage tache.refusee + audit` ; `date invalide → 422`.
- [ ] Implémenter ; tests PASS ; déployer `tache-metier.bpmn`.
- [ ] Commit.

### Task 6 : client TS généré et kit d'application simulée

**Files :** create `packages/client-backbone/` (script `generer` : openapi-typescript → `src/schema.d.ts` ; `creerClient({ url, jeton })` via openapi-fetch), `packages/kit-app/` (`demarrerApp({ id, port, titre, ecrans? })` : Fastify, réception webhook, page « Mes tâches » qui génère le formulaire à partir de `DefinitionTache`, sélecteur « Agir en tant que », dépôt de fichiers).

- [ ] Test `packages/kit-app/test/formulaire.test.ts` : un champ `date` obligatoire produit `<input type="date" required>` ; un document obligatoire produit un `<input type="file">`.
- [ ] Commit.

### Task 7 : pré-investissement TS (backbone, deal flow, revue diligente)

**Files :** create `modeles/bpmn/{backbone,deal-flow,revue-diligente}.bpmn`, `modeles/dmn/{admissibilite-mandat,chantiers-revue-diligente,niveau-approbation}.dmn`, `apps/deal-flow/`, `apps/revue-diligente/`, `outils/src/bot-demo.ts`.

Stades du deal flow, chantiers et seuils : spec §5 et §4.3. Seuils initiaux : comité du conseil si montant > 100 000 000 ; ESG requis pour `infrastructure` = non (R2 le rend oui).

- [ ] `npm run deployer` ; `npx tsx outils/src/bot-demo.ts --jusqua assigne` crée un dossier et joue chaque tâche via l'API → affiche `phase: debourse`.
- [ ] Commit.

### Task 8 : déboursé .NET

**Files :** create `modeles/bpmn/debourse.bpmn`, `modeles/dmn/controles-debourse.dmn`, `apps/debourse-dotnet/` (ASP.NET Core minimal + Razor Pages, `OpenApiReference` NSwag sur `contrats/openapi.yaml`), worker `debourse.executer-paiement` (paiement simulé + audit).

Contrôles initiaux : 1 approbateur ; conformité requise si montant > 50 000 000 (O2 abaisse à 25 000 000).

- [ ] `dotnet build apps/debourse-dotnet` → 0 erreur ; l'app liste ses tâches et complète une approbation.
- [ ] Bot jusqu'à `post-investissement` ; commit.

### Task 9 : post-investissement TS

**Files :** create `modeles/bpmn/{suivi-periodique,desinvestissement}.bpmn`, `modeles/dmn/alerte-covenants.dmn`, `apps/suivi-periodique/`, `apps/desinvestissement/`.

Covenants : dette/BAIIA ≤ 4,0 et couverture ≥ 1,5 → conforme ; dépassement ≤ 10 % → surveillance ; sinon bris. Événements : `demande-tirage`, `remboursement-complet`, `decision-desinvestir`.

- [ ] Bot de bout en bout (`--jusqua fin`) avec `DEMO_CYCLE_SUIVI=R3/PT1M` → dossier clôturé ; commit.

### Task 10 : gouvernance visible — cockpit, impact, scénarios, playbooks

**Files :** create `passerelle/public/cockpit.html`, `outils/src/impact.ts`, `outils/src/scenarios/{r1,r2,r3,o1,o2,s1,s2,s3}.ts`, `docs/playbooks/{changement-regle-affaires,changement-organisationnel,impact-securite}.md`, `modeles/bpmn/deal-flow.v2-conformite.bpmn` (R3).

`npm run impact -- <terme>` : liste fichier + ligne de chaque occurrence dans `modeles/`, `config/`, `apps/`. Chaque scénario applique son changement, le prouve (sortie console + audit) puis indique comment revenir en arrière.

- [ ] `npm run scenario -- s1` → affiche `403 APPLICATION_NON_AUTORISEE` et l'entrée d'audit ; idem pour chaque scénario ; commit.

### Task 11 : démo et documentation

**Files :** modify `README.md` (runbook : prérequis, `.env`, `npm run deployer`, `npm run demarrer`, démo pas à pas, redéploiement sur un nouveau cluster), `CLAUDE.md` (commandes réelles), `docs/architecture.md` (aligner sur la spec).

- [ ] Suite complète `npm test` verte + bot de bout en bout ; commit.

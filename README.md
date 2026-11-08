# maestro-v2 — PoC backbone Camunda pour une caisse d'investissement

Un **backbone Camunda 8** orchestre le processus d'investissement de bout en bout :

- **pré-investissement** : deal flow (à venir → assigné), dont la revue diligente, puis le premier
  déboursé ;
- **post-investissement** : suivi mensuel, tirages additionnels, désinvestissement.

Les étapes sont réalisées par **cinq applications de sous-processus** (quatre en TypeScript, une en
.NET), chacune dans **son propre dépôt**. Aucune d'elles ne connaît Camunda : elles parlent toutes à
une **passerelle**, au travers d'un contrat OpenAPI.

```
Camunda 8 SaaS (BPMN + DMN) ◄──► Passerelle TS (seul client Camunda) ◄──► Applications TS / .NET
                                   · registre des tâches · sécurité · audit chaîné · SharePoint
```

Trois documents détaillent l'écosystème :

- **vue métier** : [`docs/presentation-metier.html`](docs/presentation-metier.html), le parcours d'un
  dossier, avec les rôles, les règles d'affaires et ce que le backbone garantit à chaque étape (à
  ouvrir dans un navigateur) ;
- **vue technique** : [`docs/architecture.md`](docs/architecture.md), avec le schéma
  [`docs/architecture-ecosysteme.svg`](docs/architecture-ecosysteme.svg) ;
- **choix du moteur** : [`docs/choix-moteur.html`](docs/choix-moteur.html), le principe de
  découplage étendu aux agents IA, transposé sur dix options (suites low-code, moteurs BPMN
  ouverts, orchestrateurs par le code, maison) et comparé de façon adversariale, sources à l'appui
  (à ouvrir dans un navigateur).

## Les dépôts de l'écosystème

Ce dépôt est le **backbone** : passerelle, modèles BPMN/DMN, gouvernance, contrat, outils et
orchestration. Les applications vivent dans des dépôts voisins (clonés à côté de `maestro-v2`),
décrits dans [`ecosysteme.yaml`](ecosysteme.yaml) :

| Dépôt | Rôle | Dépend de |
|-------|------|-----------|
| `maestro-v2` | backbone | Camunda, SharePoint |
| `maestro-sdk-ts` | SDK TypeScript : client du contrat, kit d'application, simulation | copie figée du contrat |
| `maestro-app-deal-flow` (:4101) | origination et deal flow | `maestro-sdk-ts#v1.0.0` |
| `maestro-app-revue-diligente` (:4102) | portail des contributeurs de la revue diligente | `maestro-sdk-ts#v1.0.0` |
| `maestro-app-debourse` (:4103) | déboursé, .NET 10 | copie figée du contrat + client NSwag |
| `maestro-app-suivi-periodique` (:4104) | suivi mensuel et événements de sortie | `maestro-sdk-ts#v1.0.0` |
| `maestro-app-desinvestissement` (:4105) | désinvestissement | `maestro-sdk-ts#v1.0.0` |

Chaque équipe est maîtresse de son dépôt et de son rythme. Elle épingle une version du SDK ou du
contrat, et le backbone peut évoluer sans la casser. Le seul couplage est le contrat de la passerelle
(`contrats/openapi.yaml`), aussi publié par la passerelle en marche :
`GET http://localhost:4000/contrat/openapi.yaml`.

- Conception : [docs/superpowers/specs/2026-11-07-backbone-investissement-design.md](docs/superpowers/specs/2026-11-07-backbone-investissement-design.md)
- Architecture : [docs/architecture.md](docs/architecture.md)
- Guides de changement : [règle d'affaires](docs/playbooks/changement-regle-affaires.md) ·
  [organisation](docs/playbooks/changement-organisationnel.md) · [sécurité](docs/playbooks/impact-securite.md)

## Prérequis

- Node 24+, .NET SDK 10, Azure CLI (pour SharePoint).
- Un cluster Camunda 8 SaaS et un client API ayant la portée « Orchestration Cluster API ».
- `az login` sur le tenant SharePoint (compte ayant accès au site cible). Sans cela, mettre
  `SHAREPOINT_MODE=local` : les documents sont alors rangés dans `donnees/documents/`.

## Installation

```bash
npm install
cp .env.example .env        # puis compléter (identifiants Camunda, groupe SharePoint)
npm run deployer            # déploie tous les BPMN et DMN de modeles/
npm run ecosysteme -- cloner      # clone les dépôts voisins absents depuis GitHub
npm run ecosysteme -- installer   # npm install / dotnet build dans chaque dépôt d'application
```

## Lancer la démo

```bash
npm run ecosysteme -- demarrer    # passerelle + les 5 applications, chacune depuis son dépôt
npm run ecosysteme -- statut      # état de chaque dépôt (branche, modifications, version du SDK, service)
```

Options : `--sans-passerelle`, `--sauf deal-flow,debourse`. Une application peut aussi se lancer
seule depuis son dépôt (`npm start` ou `dotnet run`).

Pour accélérer, mettre dans `.env` : `DEMO_DELAI_SUIVI=PT1M` (un « mois » de suivi dure une minute)
et `DEMO_FACTEUR_SLA=0.01` (délais SLA divisés par 100).

| Écran | URL |
|-------|-----|
| Cockpit du backbone (dossiers, tâches, audit) | http://localhost:4000/cockpit/ |
| Deal flow | http://localhost:4101 |
| Revue diligente (portail des contributeurs) | http://localhost:4102 |
| Déboursé (.NET) | http://localhost:4103 |
| Suivi périodique | http://localhost:4104 |
| Désinvestissement | http://localhost:4105 |
| BPMN en exécution | Operate (lien dans le cockpit) |

Chaque application propose un sélecteur **« Agir en tant que »** : les personnes fictives et leurs
rôles sont dans `config/organisation.yaml`. Le bouton **« Pré-remplir (simulation) »** saisit des
valeurs plausibles.

### Déroulé de démo suggéré (environ 20 minutes)

1. **Deal flow** (en tant qu'Alice) : enregistrer une occasion. Le dossier SharePoint
   `POC-Maestro-Camunda/INV-…` est créé. Dans Operate, l'instance `backbone` démarre (recherche par
   *business id* = numéro de dossier).
2. Qualifier l'occasion : déposer le teaser, compléter. Dans Operate, la tâche `tache-metier` se termine
   et la règle d'admissibilité s'évalue.
3. Montrer une **tentative refusée** : compléter en tant que Chloé (autre équipe), ce qui donne
   `ROLE_ABSENT`. Dans Operate, l'étape « Consigner le refus » apparaît ; dans le cockpit, une ligne
   rouge s'ajoute à l'audit.
4. Laisser le robot avancer le dossier sans toucher au déboursé :
   `npm run bot -- --dossier INV-… --sauf debourse --jusqua post`.
5. **Déboursé (.NET)** : réaliser les tâches dans l'application .NET. Le préparateur qui tente
   d'approuver est refusé (`SEPARATION_TACHES`). Le paiement simulé dépose un avis d'exécution dans
   SharePoint.
6. Ouvrir la page **Audit du dossier** dans l'application .NET, puis `npm run audit:verifier`.
7. Jouer un **changement** : `npm run scenario -- r1` (règle), `o1` (organisation), `s1` (sécurité).
   Chacun se défait avec `--annuler`.

### Robot de bout en bout (sans interface)

```bash
npm run bot -- --classe infrastructure --montant 120000000 --sortie desinvestir --mois 1
```

Le robot joue toutes les applications via l'API : comité du conseil, 4 chantiers, approbation
conformité, désinvestissement.

## Commandes utiles

| Commande | Rôle |
|----------|------|
| `npm test` | tests unitaires et API (vitest) |
| `npm run typecheck` | vérification TypeScript |
| `npm run test:ui` | test des écrans des applications TS (passerelle et applications démarrées) |
| `npx tsx outils/src/test-dotnet.ts INV-…` | test des écrans de l'application .NET sur un dossier arrivé au déboursé |
| `npm run deployer [-- fichier…]` | déployer des modèles |
| `npm run impact -- <terme>` | analyse d'impact (rôle, type de tâche, règle, personne, équipe) |
| `npm run scenario -- liste` | scénarios de changement R1–R3, O1–O2, S1–S3 |
| `npm run incidents` | incidents Camunda actifs |
| `npm run annuler -- INV-…` | annuler l'instance d'un dossier |
| `npm run audit:verifier` / `audit:exporter` | intégrité de la chaîne / export mensuel vers SharePoint |
| `npm run ecosysteme -- statut\|cloner\|installer\|demarrer\|contrat` | orchestration des dépôts voisins |
| `npm run verifier:cluster` | ce qui est réellement déployé sur le cluster |

## Faire évoluer le contrat

1. Modifier `contrats/openapi.yaml` (et la passerelle) dans ce dépôt ; PR ici.
2. `npm run ecosysteme -- contrat` : copie le contrat dans `maestro-sdk-ts` et `maestro-app-debourse`,
   régénère leurs clients et liste les changements.
3. PR dans `maestro-sdk-ts`, puis nouvelle étiquette (`v1.1.0` si compatible, `v2.0.0` sinon) ;
   PR dans `maestro-app-debourse`.
4. Chaque application TS monte la version du SDK dans son `package.json` quand elle le décide.

Tant qu'un changement est compatible (ajout de champ ou d'opération), les applications existantes
continuent de fonctionner sans rien changer.

## Ajouter une application (en minutes)

1. Déclarer l'application et ses types de tâches dans `config/securite.yaml`, et le dépôt dans
   `ecosysteme.yaml`.
2. TypeScript : créer un dépôt sur le modèle de `maestro-app-desinvestissement` (15 lignes et une
   dépendance `@maestro/sdk`). Autre langage : générer un client depuis le contrat (voir
   `maestro-app-debourse`).
3. Aucun changement dans Camunda.

## Après une mise en pause du cluster d'essai

Un cluster d'essai est mis en pause automatiquement par Camunda, et son disque est **effacé** à
chaque pause (documenté : [SaaS clusters](https://docs.camunda.io/docs/components/saas/clusters/)).
L'étiquette `dev` déclenche la pause 8 h après la création ou le réveil, même en pleine activité ;
`dev-cl` porte donc l'étiquette `test` depuis le 2026-11-07, ce qui laisse la seule règle des 48 h
d'inactivité. Les clients API et les secrets survivent ; les processus et les instances, non.

La passerelle s'en protège : au démarrage puis toutes les 10 minutes, elle redéploie les modèles
absents du cluster (audit `modeles.redeployes`). Les instances en cours, elles, sont perdues. Pour
vérifier à la main :

```bash
npm run verifier:cluster    # ✔/✖ pour chaque modèle attendu + instances en cours
npm run deployer            # si des modèles manquent
```

Les dossiers du registre local dont l'instance a disparu se marquent avec
`npm run annuler -- INV-… --registre-seulement`.

## Redéployer sur un nouveau cluster (fin de l'essai)

1. Créer le cluster et un client API (portée Orchestration), puis mettre à jour `CAMUNDA_*` dans
   `.env`.
2. `npm run deployer`.
3. Supprimer `donnees/passerelle.sqlite` : le registre local référence les instances de l'ancien
   cluster.

## Limites connues de la PoC

Voir le tableau « Écarts PoC → cible » dans [impact-securite.md](docs/playbooks/impact-securite.md) :
jetons de démonstration, utilisateur déclaratif, jeton Graph via Azure CLI, autorisations Camunda
désactivées, signature électronique non traitée.

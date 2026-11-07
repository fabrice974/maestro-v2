# maestro-v2 — PoC backbone Camunda pour une caisse d'investissement

Un **backbone Camunda 8** orchestre le processus d'investissement de bout en bout :

- **pré-investissement** : deal flow (à venir → assigné), dont la revue diligente, puis le premier
  déboursé ;
- **post-investissement** : suivi mensuel, tirages additionnels, désinvestissement.

Les étapes sont réalisées par **cinq applications de sous-processus** (quatre en TypeScript, une en
.NET). Aucune d'elles ne connaît Camunda : elles parlent toutes à une **passerelle**, au travers d'un
contrat OpenAPI.

```
Camunda 8 SaaS (BPMN + DMN) ◄──► Passerelle TS (seul client Camunda) ◄──► Applications TS / .NET
                                   · registre des tâches · sécurité · audit chaîné · SharePoint
```

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
```

## Lancer la démo

```bash
# Terminal 1 : passerelle + 4 applications TS + application .NET
npm run demarrer -- --dotnet
```

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
| `npm run generer:client` | régénérer le client TS depuis `contrats/openapi.yaml` |

## Ajouter une application (en minutes)

1. Déclarer l'application et ses types de tâches dans `config/securite.yaml`.
2. TypeScript : copier `apps/desinvestissement` (15 lignes) et changer l'identifiant, le port et le
   jeton. Autre langage : générer un client depuis `contrats/openapi.yaml` (voir
   `apps/debourse-dotnet/README.md`).
3. Aucun changement dans Camunda.

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

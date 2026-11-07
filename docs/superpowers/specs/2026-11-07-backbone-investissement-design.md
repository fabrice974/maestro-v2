# Conception — PoC backbone Camunda pour une caisse d'investissement

Date : 2026-11-07 · Statut : **à approuver**

## 1. Intention

Démontrer qu'un backbone Camunda 8 peut porter le processus d'investissement de bout en bout tout en
laissant les équipes applicatives **autonomes et rapides**. La PoC est réussie si, en démo :

1. on voit clairement dans le BPMN (Operate) tout le parcours d'un dossier, avec l'audit, la
   gouvernance et la sécurité de chaque étape ;
2. une application de sous-processus se développe sans rien connaître de Camunda (preuve : une
   application TypeScript **et** une application .NET branchées sur le même contrat) ;
3. on sait dire, pour un changement de **règle d'affaires**, un changement **organisationnel** ou un
   impact **sécurité**, exactement quelles étapes faire — et on les joue en démo.

Contexte : caisse d'investissement, marchés privés (crédit privé, placement privé, infrastructure).

## 2. Objectifs, non-objectifs, anti-objectifs

**Objectifs** : processus de bout en bout exécutable sur le cluster SaaS ; garantie par le backbone
que chaque tâche métier est complétée (ou escaladée) ; documents rangés dans SharePoint par le
backbone ; piste d'audit infalsifiable et conservable des années ; trois scénarios de changement
démontrés avec leurs guides (playbooks).

**Non-objectifs** : signature électronique ; vraie intégration trésorerie/paiement ; politique de
rétention réglementaire détaillée ; haute disponibilité ; UI soignée (les applications sont des
simulations légères).

**Anti-objectifs** (échec même si « ça marche ») : une application qui importe un SDK Camunda ou
connaît une clé d'instance ; une règle d'affaires codée en dur dans une application ; un nom de
personne ou de groupe écrit dans un BPMN ; un document stocké dans une variable de processus.

## 3. Environnement constaté (2026-11-07)

- Cluster `dev-cl`, Camunda **8.11.0-alpha1**, **Trial**, AWS us-east-2. Créé le 2026-11-06 : la
  période d'essai expire vraisemblablement début décembre 2026 → tout doit être redéployable par
  script sur un nouveau cluster en quelques minutes.
- **Aucun client API** créé ; **autorisations désactivées** sur le cluster.
- Poste : Node 24 / npm 11, .NET SDK 10, Docker 29.
- Exécution de la démo (choix du concepteur) : passerelle et applications **en local** ; la
  passerelle ouvre des connexions sortantes vers le cluster SaaS (workers en mode pull), donc aucun
  point d'entrée public ni tunnel n'est nécessaire. Un `docker compose` optionnel lance l'ensemble.

## 4. Architecture

```
 Camunda 8 SaaS ── backbone.bpmn ─call─► deal-flow.bpmn ─call─► revue-diligente.bpmn
                                  ─call─► debourse.bpmn
                                  ─call─► suivi-periodique.bpmn ─► desinvestissement.bpmn
                   tache-metier.bpmn (réutilisée par toutes les tâches humaines)
                   *.dmn (règles d'affaires)
        ▲ messages corrélés          │ jobs
        │                            ▼
 Passerelle backbone (TypeScript) — SEUL client Camunda
   API métier REST (OpenAPI) · registre des tâches · politique de sécurité
   journal d'audit chaîné · adaptateur SharePoint (Graph) · cockpit web
        ▲ REST (jeton par application)      │ webhooks (commandes, tâches)
        │                                   ▼
 apps/deal-flow (TS) · apps/revue-diligente (TS) · apps/debourse (.NET) ·
 apps/suivi-periodique (TS) · apps/desinvestissement (TS)
```

### 4.1 Le patron « tâche métier garantie »

Toute tâche humaine est une *call activity* vers `tache-metier.bpmn`, paramétrée par
`typeTache`, `roleRequis`, `delai`, `documentsRequis`, `champsRequis` :

1. service task `tache.ouvrir` → la passerelle enregistre la tâche (`tacheId`), crée le dossier
   SharePoint cible, notifie l'application propriétaire du `typeTache` par webhook ;
2. passerelle événementielle : message `tache.completee` (clé = `tacheId`) **ou** minuterie SLA ;
3. SLA dépassé → escalade (notification au rôle superviseur, relance) puis retour à l'attente ;
4. à la complétion, la passerelle **valide avant de corréler** : rôle de l'utilisateur, séparation
   des tâches, champs et dates obligatoires, présence des documents dans SharePoint.

5. une tentative refusée (rôle absent, séparation des tâches, pièce manquante, application non
   autorisée) est corrélée comme message `tache.refusee` : le jeton passe par une étape visible
   « Consigner le refus » puis revient en attente. Les refus de sécurité sont ainsi **visibles dans
   Operate**, pas seulement dans le journal d'audit (choix du concepteur).

La tâche *vit* dans l'application (son écran, ses règles d'UX), mais le backbone garantit qu'elle
est faite, par la bonne personne, avec les bonnes pièces — et Operate montre chaque tâche ouverte.

### 4.2 Contrat applications ↔ backbone

Contrat d'abord : `contrats/openapi.yaml` est la source ; un client TS (`packages/client-backbone`)
et un client C# en sont générés. Une application n'a besoin que de :

- recevoir `POST /webhooks/taches` (tâche ouverte) et `POST /webhooks/commandes` ;
- appeler `POST /taches/{tacheId}/completer`, `POST /dossiers/{dossierId}/evenements/{type}`,
  `POST /dossiers/{dossierId}/documents` (dépôt vers SharePoint), `GET /dossiers/{dossierId}`.

Clé de corrélation métier : `dossierId` (ex. `INV-2026-0042`) ; idempotence par `evenementId`.

### 4.3 Règles d'affaires (DMN, modifiables sans code)

| DMN | Décide |
|-----|--------|
| `admissibilite-mandat` | dossier admissible au filtrage (classe d'actif, taille, exclusions ESG) |
| `chantiers-revue-diligente` | chantiers requis selon la classe d'actif (financier, juridique, fiscal, ESG, technique, assurances) |
| `niveau-approbation` | instance d'approbation selon montant et classe (comité d'investissement, comité du conseil) |
| `controles-debourse` | nombre d'approbateurs, approbation conformité requise selon montant |
| `alerte-covenants` | statut mensuel (conforme / surveillance / bris) selon ratios |

*Liaison des DMN (choix du concepteur)* : les business rule tasks utilisent la liaison `latest`.
Une nouvelle version de règle s'applique donc à **toute décision prise après son déploiement**, y
compris pour les dossiers déjà en cours mais pas encore arrivés à cette décision ; une décision déjà
prise reste figée et l'audit enregistre la version DMN utilisée. C'est ce que montrent R1/R2. Un
changement de **BPMN** (R3), lui, ne touche que les nouvelles instances, sauf migration explicite.

### 4.4 Organisation et sécurité

- Les BPMN/DMN ne référencent que des **rôles métier abstraits** : `analyste-investissement`,
  `directeur-investissement`, `comite-investissement`, `juriste`, `contributeur-externe`,
  `gestionnaire-portefeuille`, `tresorerie`, `conformite`.
- `config/organisation.yaml` : rôle → équipes/personnes (cible : groupes Entra ID). Changer
  l'organisation = changer ce fichier, sans redéployer de BPMN.
- `config/securite.yaml` : par application, les `typeTache` qu'elle peut compléter et les
  événements qu'elle peut émettre ; règles de séparation des tâches (préparateur ≠ approbateur).
- Authentification PoC : jeton signé par application et en-tête utilisateur simulé ; cible
  documentée : Entra ID (OAuth2 client credentials + jetons utilisateur).
- Côté Camunda : seule la passerelle possède un client API.
- SharePoint : un dossier par investissement, sous-dossier par sous-processus ; permissions dérivées
  des rôles ; un contributeur externe ne voit que son chantier.
- Outil `npm run impact -- <role|typeTache|regle>` : liste tout ce qui référence l'élément (BPMN,
  DMN, config, applications) → base concrète de l'analyse d'impact.

### 4.5 Audit

Journal en ajout seul dans la passerelle (SQLite pour la PoC) : horodatage, acteur, application,
`dossierId`, `tacheId`, action, référence + empreinte SHA-256 du document, version BPMN/DMN, clé
d'instance. Chaque entrée inclut l'empreinte de la précédente (chaîne vérifiable par
`npm run audit:verifier`). Conservation longue : export mensuel JSONL signé vers une bibliothèque
SharePoint « Archives d'audit » (cible : stockage immuable WORM).

## 5. Processus métier

**Deal flow** (stades) : À venir (origination) → Filtrage (DMN admissibilité) → Analyse
préliminaire + mémo → Approbation de principe → **Revue diligente** → Structuration et négociation
(feuille de modalités) → Approbation finale (DMN niveau d'approbation) → Documentation juridique et
clôture → **Assigné** (mandat assigné au gestionnaire de portefeuille).

**Revue diligente** : DMN donne les chantiers ; multi-instance parallèle, une tâche métier par
chantier pour équipes internes et contributeurs externes (rapport déposé dans SharePoint, constats
validés) ; synthèse et recommandation par l'analyste ; rejet possible → fin du deal.

**Déboursé** (application .NET) : demande de déboursé → vérification des conditions préalables
(liste à cocher, dates de validité) → contrôle KYC / LCB-FT → préparation de l'instruction de
paiement → approbation quatre-yeux (+ conformité si DMN l'exige) → exécution trésorerie simulée →
confirmation et archivage. Chaque pas est audité.

**Suivi périodique** : cycle **mensuel** (minuterie `R/P1M`, paramétrable à quelques minutes pour la
démo) : collecte des états financiers et attestation de conformité → DMN covenants → si bris :
mise sous surveillance et plan d'action → décision de garder ou désinvestir. Décider de « garder »
après un bris laisse le dossier sous surveillance jusqu'à deux mois conformes consécutifs. Le suivi
prend aussi fin à l'**échéance ou au remboursement complet** (message de l'application) : le dossier
est alors clôturé sans passer par le désinvestissement (choix du concepteur).

**Tirages multiples** (choix du concepteur) : le premier déboursé est obligatoire et clôt le
pré-investissement. Les tirages suivants (fréquents en crédit privé) arrivent pendant le
post-investissement par un sous-processus événementiel non interrompant (message `demande-tirage`)
qui rappelle `debourse.bpmn`, en parallèle du suivi mensuel.

**Désinvestissement** : thèse de sortie → évaluation → approbation (DMN) → exécution → clôture du
dossier et archivage.

## 6. Scénarios de démonstration des changements

| # | Scénario | Ce qui change | Ce qui ne change pas |
|---|----------|---------------|----------------------|
| R1 | Le seuil de comité du conseil passe de 100 M$ à 50 M$ | `niveau-approbation.dmn` (nouvelle version) | code, BPMN ; dossiers en cours gardent l'ancienne version |
| R2 | ESG devient obligatoire pour l'infrastructure | `chantiers-revue-diligente.dmn` | applications |
| R3 | Ajout d'une revue conformité avant l'approbation finale | `deal-flow.bpmn` v2 + rôle + politique ; migration optionnelle des instances | applications existantes |
| O1 | Fusion des équipes crédit privé et placement privé | `organisation.yaml` | BPMN, DMN, code |
| O2 | Nouvelle équipe Conformité qui approuve les déboursés > 25 M$ | `controles-debourse.dmn` + `organisation.yaml` + `securite.yaml` | application déboursé |
| S1 | L'app suivi périodique tente de compléter une tâche de déboursé | rien : refus 403 + entrée d'audit | — |
| S2 | Le préparateur d'un déboursé tente de l'approuver | rien : refus séparation des tâches + audit | — |
| S3 | Un contributeur externe quitte le mandat | `organisation.yaml` → révocation SharePoint et tâches réassignées | — |

Chaque famille a un guide dans `docs/playbooks/` (étapes, fichiers, vérifications, impact sécurité).

## 7. Plan de match (jalons, chacun démontrable)

0. **Fondations** — monorepo npm workspaces, `.env` Camunda, script de déploiement, BPMN « bonjour »
   déployé sur `dev-cl`.
1. **Passerelle + contrat** — OpenAPI, workers génériques, corrélation, registre des tâches,
   `tache-metier.bpmn`, journal d'audit chaîné, client TS généré, tests.
2. **Pré-investissement TS** — backbone, deal flow, revue diligente, DMN, apps TS, adaptateur
   SharePoint (repli dossier local tant que Graph n'est pas configuré).
3. **Déboursé .NET** — app ASP.NET Core sur le client C# généré, quatre-yeux, audit.
4. **Post-investissement** — suivi mensuel, covenants, désinvestissement.
5. **Gouvernance** — cockpit, `organisation.yaml`/`securite.yaml`, outil d'impact, playbooks,
   scénarios R/O/S scriptés.
6. **Démo** — script de démo pas à pas, runbook dans le README, redéploiement sur nouveau cluster.

## 8. Choix laissés au constructeur

Framework HTTP Node, ORM/SQLite, moteur de gabarits des apps simulées, génération du client C#
(NSwag ou Kiota), structure interne de la passerelle — du moment que les invariants du §2 tiennent.

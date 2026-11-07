# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## État du projet

Preuve de concept (PoC) au stade du cadrage : aucune application, aucune commande de build ni de test
pour l'instant. Les choix techniques encore ouverts sont dans `docs/questions-ouvertes.md` ; ne pas
trancher à la place de l'utilisateur ce qui y figure. Mettre à jour ce fichier (commandes, structure)
dès que du code arrive.

## Objectif

Un **backbone Camunda** orchestre le processus d'investissement de bout en bout. Les étapes concrètes
sont réalisées par des **applications de sous-processus** distinctes, qui doivent rester découplées du
moteur : elles ne connaissent ni le BPMN, ni Zeebe, ni les identifiants internes de Camunda.
L'utilisateur dispose d'un compte de test Camunda (SaaS).

## Domaine métier (vocabulaire à respecter)

Processus de bout en bout, dans l'ordre :

| Phase | Sous-processus | Rôle |
|-------|----------------|------|
| Pré-investissement | **Deal flow** | Suivi des projets (crédit privé, placement privé, infrastructure) du stade « à venir » jusqu'au stade « assigné ». |
| Pré-investissement | ↳ **Revue diligente** (dans le deal flow) | Étape clé : orchestration d'activités et de documents entre équipes d'investissement et contributeurs. |
| Pré-investissement | **Déboursé** (fin du deal flow) | Même orchestration activités/documents, avec **exigence d'audit forte**. |
| Post-investissement | **Suivi périodique** | Collecte et analyse périodiques des informations post-investissement et des dossiers. |
| Post-investissement | **Désinvestissement** (optionnel, après le suivi) | Sortie de l'investissement. |

Frontière : du deal flow jusqu'au déboursé inclus = **pré-investissement** ; après le déboursé =
**post-investissement**.

Acteurs : **équipes d'investissement** et **contributeurs** (internes ou externes) qui produisent ou
valident des documents.

## Direction d'architecture (proposée, à confirmer)

Détail et justification dans `docs/architecture.md`. Les invariants à ne pas casser :

- Le BPMN du backbone ne contient que le macro-flux et des *call activities* vers les sous-processus ;
  chaque sous-processus est un BPMN séparé, déployable indépendamment.
- Les applications ne parlent jamais directement à Zeebe : elles passent par une **passerelle
  d'intégration** (couche anti-corruption) qui expose un contrat métier (API + événements) et le
  traduit vers Camunda (job workers sortants, corrélation de messages entrants).
- La clé de corrélation est un identifiant métier stable (identifiant du dossier d'investissement),
  jamais la clé d'instance Camunda.
- Les documents ne transitent pas dans les variables de processus : seulement des références vers le
  référentiel documentaire.
- Le déboursé exige une piste d'audit consultable hors de Camunda (qui a fait quoi, quand, sur quelle
  version de document).

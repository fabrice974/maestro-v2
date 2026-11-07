# Guide — évaluer l'impact sécurité d'un changement

## Les quatre contrôles de la passerelle

Toute complétion de tâche passe par ces contrôles, dans cet ordre. Un échec est refusé, audité
(`tache.refusee`) **et rendu visible dans le BPMN** : l'instance `tache-metier` passe par l'étape
« Consigner le refus ».

| # | Contrôle | Source | Code de refus |
|---|----------|--------|---------------|
| 1 | L'application est propriétaire du type de tâche | `securite.yaml` → `typesTache` | `APPLICATION_NON_AUTORISEE` |
| 2 | La personne détient le rôle requis | `organisation.yaml` + `taches.yaml` | `ROLE_ABSENT` |
| 3 | Séparation des tâches sur le dossier | `securite.yaml` → `separationTaches` | `SEPARATION_TACHES` |
| 4 | Données valides (champs, dates, pièces) | `taches.yaml` | `DONNEES_INVALIDES` |

Autres garde-fous :
- Une application ne **voit** que ses tâches (`GET /taches`) et ne peut émettre que ses événements.
- Seule la passerelle détient un client API Camunda : aucune application ne peut démarrer, annuler
  ou modifier une instance.
- Les écritures SharePoint sont confinées au dossier racine de la PoC (chemins validés).
- Le journal d'audit est chaîné (SHA-256) et en ajout seul ; `npm run audit:verifier` détecte toute
  altération.

## Grille d'analyse pour un changement

| Question | Où regarder | Outil |
|----------|-------------|-------|
| Qui gagne ou perd un droit ? | rôles touchés | `npm run impact -- <rôle>` |
| Une même personne peut-elle maintenant enchaîner deux étapes critiques ? | `separationTaches` | `npm run impact -- <typeTache>` |
| Un rôle critique tombe-t-il à une seule personne ? | `organisation.yaml` | `npm run impact -- <rôle>` |
| Une nouvelle étape a-t-elle une règle de séparation ? | nouveau type dans `taches.yaml` | revue du fichier |
| Une nouvelle application reçoit-elle trop de types de tâches ? | `securite.yaml` (éviter `*`) | revue du fichier |
| Des externes accèdent-ils à de nouveaux documents ? | rôles `revue-*`, permissions SharePoint | `npm run impact -- <personne>` |
| Les décisions passées restent-elles traçables ? | audit `regle.evaluee`, versions BPMN/DMN | cockpit, Operate |

## Départ d'une personne (externe ou interne)

1. `npm run impact -- <id>` : rôles détenus, tâches qu'elle peut compléter.
2. La retirer de ses rôles dans `organisation.yaml`. L'effet est immédiat : toute tentative ultérieure
   reçoit `ROLE_ABSENT`.
3. Vérifier ses tâches en cours dans le cockpit : elles restent ouvertes et sont réalisables par les
   autres titulaires du rôle.
4. Retirer son accès au site SharePoint ou au groupe M365 (dans la PoC, étape manuelle ; cible : via
   Graph, `DELETE /groups/{id}/members/{user}/$ref`, ou retrait du groupe Entra).

## Démonstrations

| Scénario | Commande |
|----------|----------|
| S1 — une application tente de compléter la tâche d'une autre | `npm run scenario -- s1` |
| S2 — le préparateur d'un déboursé tente de l'approuver | `npm run scenario -- s2` |
| S3 — une contributrice externe quitte le mandat | `npm run scenario -- s3` |

## Écarts PoC → cible (à traiter avant toute mise en production)

| PoC | Cible |
|-----|-------|
| Jetons d'application statiques dans `securite.yaml` | Entra ID, client credentials par application, secrets dans Key Vault |
| Utilisateur transmis dans `X-Utilisateur` (déclaratif) | jeton utilisateur Entra vérifié par la passerelle (on-behalf-of) |
| Graph via le jeton Azure CLI de `ti@sdaps.re` (droits larges) | inscription d'application dédiée avec `Sites.Selected` limité au site |
| Autorisations Camunda désactivées | autorisations activées : le client de la passerelle limité à ses processus |
| Journal d'audit SQLite local | base gérée + export WORM (stockage immuable), rétention selon la politique |
| Webhooks HTTP non signés (jeton Bearer) | signature HMAC ou bus d'événements (Service Bus) |

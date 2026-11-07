# Guide — préparer un changement organisationnel

Principe : **les processus ne connaissent que des rôles**. Le BPMN dit « l'approbation finale exige le
rôle `comite-investissement` » ; seul `config/organisation.yaml` dit qui détient ce rôle. Une
réorganisation se fait donc surtout dans ce fichier, sans toucher aux processus ni aux applications.

## Typologie

| Changement | Fichier(s) | Effet |
|------------|-----------|-------|
| Arrivée / départ d'une personne | `organisation.yaml` (personnes, rôles) | immédiat (rechargement à chaud) |
| Fusion / scission d'équipes | `organisation.yaml` (équipes, rôles `equipe:<id>`) | immédiat |
| Nouveau rôle exigé par une étape | `organisation.yaml` + `taches.yaml` (roleRequis) | immédiat pour les nouvelles tâches |
| Nouvelle équipe qui intervient dans le processus | `organisation.yaml` + souvent un DMN ou un BPMN | voir le guide règle d'affaires |
| Nouvelle application (ex. une équipe veut son propre outil) | `securite.yaml` (application, types de tâches) | immédiat |

## Étapes

1. **Cartographier** : `npm run impact -- <rôle | équipe | personne>` liste qui détient le rôle, les
   types de tâches qui l'exigent (y compris par gabarit, ex. `analyste-{{classeActif}}`), et les
   règles de séparation des tâches concernées.
2. **Vérifier les tâches ouvertes** dans le cockpit (`http://localhost:4000/cockpit/`) : une tâche
   ouverte n'est pas rattachée à une personne, seulement à un rôle. Après le changement, elle sera
   réalisable par les nouveaux titulaires du rôle, sans réaffectation.
3. **Modifier** `config/organisation.yaml`.
4. **Contrôler la séparation des tâches** : une fusion peut donner à une même personne deux rôles qui
   se succèdent (ex. préparer puis approuver un déboursé). Les règles de `securite.yaml` empêchent
   qu'elle fasse les deux sur le même dossier ; vérifier qu'il reste au moins deux personnes par
   rôle critique.
5. **Constater** : la passerelle recharge la configuration et écrit l'entrée d'audit
   `gouvernance.rechargee` avec l'empreinte de chaque fichier. C'est la preuve de la version de
   l'organisation en vigueur à chaque instant.
6. **SharePoint** : ajuster les membres du site ou du groupe (cible : groupes Entra synchronisés avec les
   rôles, voir le guide sécurité).

## Démonstrations

| Scénario | Commande |
|----------|----------|
| O1 — fusion Crédit privé + Placement privé | `npm run scenario -- o1` |
| O2 — nouvelle équipe Conformité qui approuve les déboursés > 25 M$ | `npm run scenario -- o2` |

## Cible

Dans la cible, `organisation.yaml` est remplacé par des **groupes Entra ID** (un groupe par rôle)
lus par la passerelle. Le mécanisme reste identique : le processus exige un rôle, l'annuaire dit qui
le détient, la passerelle contrôle à chaque complétion.

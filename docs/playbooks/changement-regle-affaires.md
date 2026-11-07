# Guide — changer une règle d'affaires

Une règle d'affaires vit à l'un de trois endroits. Commencer par identifier lequel : c'est lui qui
détermine le travail, le risque et qui doit approuver.

| Ce qui change | Où | Exemple | Redéploiement | Code applicatif |
|---------------|----|---------|---------------|-----------------|
| Une **décision** (seuil, liste, barème) | `modeles/dmn/*.dmn` | seuil du comité du conseil, chantiers requis | DMN seulement | aucun |
| Une **donnée exigée** d'une tâche (champ, pièce, délai, règle de date) | `config/taches.yaml` | rendre un document obligatoire | aucun (rechargement à chaud) | aucun |
| Le **déroulement** (nouvelle étape, ordre, branche) | `modeles/bpmn/*.bpmn` | revue de conformité avant l'approbation finale | BPMN (nouvelle version) | aucun, sauf nouveau type de tâche à afficher |

## 1. Analyser l'impact

```bash
npm run impact -- niveau-approbation      # une règle DMN
npm run impact -- dealflow.structuration  # un type de tâche
```

L'outil liste les BPMN, DMN, fichiers de configuration et applications qui référencent l'élément.

## 2. Modifier

- **DMN** : ouvrir le fichier dans Camunda Modeler (ou le Web Modeler), modifier la table, garder le
  même `id` de décision. Les tables sont générées une première fois par
  `outils/src/dmn/tables.ts`, puis les fichiers `.dmn` font foi : ne pas régénérer après une retouche.
- **Catalogue** : éditer `config/taches.yaml`. La passerelle valide le fichier au rechargement ; un
  fichier invalide est rejeté (audit `gouvernance.rejetee`) et l'ancienne version reste active.
- **BPMN** : ouvrir le fichier dans Camunda Modeler. Pour une tâche humaine, ajouter une *call
  activity* vers `tache-metier` avec l'entrée `typeTache` et une sortie `=resultat` (copier une
  étape existante), puis déclarer le nouveau type dans `config/taches.yaml` et l'attribuer à une
  application dans `config/securite.yaml`.

## 3. Déployer et vérifier

```bash
npm run deployer -- modeles/dmn/niveau-approbation.dmn
```

- La sortie donne la nouvelle version (`niveau-approbation → v2`).
- **DMN, liaison `latest`** : toute décision prise après le déploiement utilise la nouvelle version,
  même pour un dossier déjà en cours. Les décisions déjà prises restent figées : Operate > Decisions
  et l'audit `regle.evaluee` donnent la version utilisée pour chaque dossier.
- **BPMN** : seules les nouvelles instances prennent la nouvelle version. Pour basculer des instances
  en cours, utiliser la migration d'instances d'Operate (à décider au cas par cas).

## 4. Revenir en arrière

Redéployer l'ancienne version du fichier (`git checkout <commit> -- <fichier>` puis
`npm run deployer -- <fichier>`). Camunda crée une nouvelle version au contenu identique à
l'ancienne : l'historique reste complet.

## Démonstrations

| Scénario | Commande |
|----------|----------|
| R1 — seuil du comité du conseil 100 M$ → 50 M$ | `npm run scenario -- r1` |
| R2 — ESG obligatoire pour l'infrastructure | `npm run scenario -- r2` |
| R3 — revue de conformité avant l'approbation finale (BPMN v2) | `npm run scenario -- r3` |

Chaque scénario se défait avec `--annuler`.

## Gouvernance du changement (recommandation pour la cible)

- Une règle DMN = une demande de changement approuvée par son propriétaire métier.
- Revue par paire du fichier (diff lisible : les DMN et BPMN sont du XML versionné dans git).
- Tester la décision avant le déploiement (`evaluateDecision`, comme le fait `outils/src/scenario.ts`).
- Déployer par le pipeline, jamais à la main en production.

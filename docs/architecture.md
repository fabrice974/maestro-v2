# Architecture — backbone Camunda découplé

Statut : **implémentée dans la PoC** (2026-11-07). La conception et ses justifications sont dans
`docs/superpowers/specs/2026-11-07-backbone-investissement-design.md`.

## Vue d'ensemble

![Écosystème Maestro : Camunda 8 SaaS, passerelle, dépôts voisins et outillage](architecture-ecosysteme.svg)

*Cliquer sur l'image pour l'agrandir. Le schéma suit le thème clair ou sombre de GitHub.*

Comment lire le schéma, de haut en bas :

1. **Camunda 8 SaaS** exécute `backbone.bpmn`, qui appelle les cinq sous-processus. Chaque étape
   humaine passe par le patron `tache-metier.bpmn`. Les décisions viennent des cinq tables DMN.
2. **Les échanges avec Camunda passent tous par `moteur.ts`.** La passerelle active les jobs en
   mode pull, publie les messages corrélés (sur `tacheId` ou sur `dossierId`) et déploie les modèles.
   La sentinelle redéploie les modèles qui manqueraient.
3. **La passerelle** fait tourner la même logique (`services.ts`) pour les workers et pour l'API.
   Elle s'appuie sur la gouvernance YAML, le registre, l'audit chaîné et le dépôt de documents
   SharePoint.
4. **Les applications** des dépôts voisins ne connaissent que le contrat REST. Elles reçoivent
   un webhook à l'ouverture d'une tâche. Les quatre applications TS passent par le SDK ; l'application
   .NET a son propre client généré.

Les couleurs relient chaque application à son sous-processus. On retrouve les mêmes couleurs dans
la vue métier, [`presentation-metier.html`](presentation-metier.html) (le parcours d'un dossier,
les rôles et les règles d'affaires, pour un public métier).

## Décisions structurantes

1. **Une seule porte vers Camunda.** Seul `passerelle/src/moteur.ts` importe le SDK. Les
   applications n'ont qu'une dépendance : le client généré depuis `contrats/openapi.yaml`.
2. **Patron « tâche métier garantie »** (`tache-metier.bpmn`). Chaque tâche humaine est une *call
   activity* qui :
   - ouvre la tâche (worker `tache.ouvrir`) ;
   - attend `tache.completee` ou `tache.refusee`, corrélés par `tacheId`, ou l'échéance SLA ;
   - consigne les refus et escalade les retards.

   La tâche vit dans l'application ; le backbone garantit sa complétion.
3. **Le BPMN ne transmet que `typeTache`.** Rôle, champs, pièces, délai et règles de date viennent
   du catalogue `config/taches.yaml`. Modifier une saisie ne redéploie rien.
4. **Rôles abstraits seulement** dans les modèles. Les gabarits (`analyste-{{classeActif}}`,
   `revue-{{chantier}}`, `{{instanceApprobation}}`) sont résolus à l'ouverture de la tâche ;
   l'organisation (`organisation.yaml`) dit qui détient chaque rôle.
5. **Validation avant corrélation.** La passerelle contrôle successivement l'application, le rôle,
   la séparation des tâches puis les données (champs, dates, pièces dans SharePoint), avant de
   publier `tache.completee`. Un refus est publié en `tache.refusee` : il reste visible dans Operate.
6. **Messages publiés avec TTL et `messageId`** (idempotence, mise en tampon). Un fait qui arrive
   pendant une autre étape (ex. remboursement pendant un plan d'action) est traité au point d'attente
   suivant.
7. **Corrélation métier** par `dossierId` (`INV-AAAA-NNNN`), aussi utilisé comme `businessId` Camunda
   (8.10+) : il est hérité par les sous-processus, les jobs et les décisions.
8. **DMN en liaison `latest`**, et un écouteur d'exécution (`regle.consigner`) qui inscrit chaque
   décision et sa valeur dans l'audit.
9. **Documents** : les variables de processus ne contiennent que des références
   `{ type, nom, url, sha256 }`. L'empreinte est auditée.
10. **Audit** : journal en ajout seul (triggers SQLite), chaîné par hash, vérifiable
    (`npm run audit:verifier`), exporté chaque mois en JSONL avec un manifeste dans SharePoint
    (`npm run audit:exporter`).

11. **Échéance SLA absolue** : `tache.ouvrir` renvoie `echeanceSla` (date). Le timer `timeDate` de
    `tache-metier` ne repart donc pas à zéro sur un refus ; seule une escalade repousse l'échéance.
12. **Séparation des tâches par cycle** : chaque déboursé (premier ou tirage) et chaque
    désinvestissement ouvre un `cycle`, et la règle « préparateur ≠ approbateur » s'applique dans le
    cycle. Sans cela, au fil des tirages, plus personne ne pourrait approuver.
13. **Lecture restreinte** : une application ne lit que ses tâches, leurs pièces et l'audit qui la
    concerne, sauf si `securite.yaml` lui accorde `lectureDossierComplete` (deal flow, déboursé).
14. **Robustesse** :
    - si Camunda est injoignable à la complétion, la tâche redevient ouverte (réponse 503) ;
    - un événement dont la publication échoue n'est pas marqué reçu ;
    - le paiement simulé est idempotent ;
    - les noms de pièces incluent l'identifiant de la tâche, pour qu'aucun fichier n'en écrase un autre.

Limite connue : un tirage en cours peut se terminer après la clôture du dossier, car le
remboursement complet ne l'interrompt pas. En cible, il faudra attendre la fin des tirages avant de
clôturer.

## Découpage en dépôts

Un dépôt par application, plus un SDK TypeScript, autour du dépôt backbone. Pourquoi :
- **Autonomie** : chaque équipe a son dépôt, son pipeline et son rythme de livraison.
- **Contrat seul couplage** : les applications TS épinglent une étiquette du SDK (`#v1.0.0`) ;
  l'application .NET garde une copie figée du contrat. Le backbone peut évoluer sans les casser.
- **Contrat publié** : `contrats/openapi.yaml` fait foi ; la passerelle le sert sur
  `GET /contrat/openapi.yaml` ; `npm run ecosysteme -- contrat` le propage au SDK et à l'application
  .NET, avec régénération des clients, pour une PR dans chaque dépôt.
- **Orchestration locale** : `npm run ecosysteme` clone, installe, démarre et inspecte les dépôts
  voisins. `npm run impact` cherche aussi dans les dépôts voisins.

## Les deux sens de communication

| Sens | Mécanisme | Exemple |
|------|-----------|---------|
| Backbone → application | job `tache.ouvrir`, puis registre et webhook `POST {app}/webhooks/taches` ; l'application peut aussi interroger `GET /taches` | « Approuver le déboursé » apparaît dans l'app .NET |
| Application → backbone (tâche) | `POST /taches/{id}/completer`, puis message `tache.completee` | approbation quatre yeux |
| Application → backbone (fait métier) | `POST /dossiers/{id}/evenements/{type}`, puis message corrélé sur `dossierId` | `remboursement-complet`, `decision-desinvestir`, `demande-tirage` |

## Génération des modèles

Les BPMN et DMN ont été générés une première fois par `outils/src/bpmn/processus.ts` et
`outils/src/dmn/tables.ts`, avec mise en page automatique (`npm run generer:modeles`). Ce sont des
fichiers Camunda standard : on les ouvre et on les modifie dans Camunda Modeler. **Après une retouche
manuelle, ne plus régénérer ce fichier**, car la génération écrase.

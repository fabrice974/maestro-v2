# Architecture — backbone Camunda découplé

Statut : **implémentée dans la PoC** (2026-11-07). La conception et ses justifications sont dans
`docs/superpowers/specs/2026-11-07-backbone-investissement-design.md`.

## Vue d'ensemble

```
┌──────────────────────────── Camunda 8 SaaS (cluster dev-cl) ────────────────────────────┐
│ backbone ─► deal-flow ─► revue-diligente        tache-metier (patron réutilisé partout) │
│         ─► debourse (premier déboursé)          DMN : admissibilite-mandat,             │
│         ─► suivi-periodique ⟲ (+ tirages ─► debourse)  chantiers-revue-diligente,       │
│         ─► desinvestissement                    niveau-approbation, controles-debourse, │
│                                                 alerte-covenants                        │
└───────────────▲ messages (tache.completee / tache.refusee / événements métier) ─────────┘
                │                               │ jobs (tache.*, dossier.phase, regle.consigner,
                │                               ▼      debourse.executer-paiement)
┌──────────────────────────── Passerelle (passerelle/, TypeScript) ───────────────────────┐
│ moteur.ts (SEUL import du SDK Camunda) · services.ts (logique) · app.ts (API REST)      │
│ registre SQLite (dossiers, tâches, documents, événements) · audit chaîné (SHA-256)      │
│ gouvernance : config/taches.yaml · organisation.yaml · securite.yaml (rechargés à chaud)│
│ documents : SharePoint (Graph) confiné à POC-Maestro-Camunda/ · cockpit (/cockpit/)     │
└───────────────▲ REST (contrats/openapi.yaml) ───┬ webhooks « tâche ouverte » ───────────┘
                │                                 ▼
  apps/deal-flow · apps/revue-diligente · apps/suivi-periodique · apps/desinvestissement (TS, kit-app)
  apps/debourse-dotnet (.NET 10, client C# généré par NSwag)
```

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

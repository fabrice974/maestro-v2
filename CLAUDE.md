# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Projet

PoC : un **backbone Camunda 8 SaaS** orchestre le processus d'investissement d'une caisse
d'investissement de bout en bout. Des **applications de sous-processus** simulées (4 TypeScript + 1 .NET)
réalisent les étapes sans rien connaître de Camunda : elles ne parlent qu'à une **passerelle**
TypeScript via `contrats/openapi.yaml`. Langue du projet (code métier, UI, docs, commits) : français.

## Commandes

```bash
npm install
npm test                                  # vitest (passerelle + kit-app)
npx vitest run passerelle/test/api.test.ts -t "S2"   # un seul test
npm run typecheck                         # tsc --noEmit sur tout le monorepo
npm run deployer [-- modeles/dmn/x.dmn]   # déploie modeles/** (ou les fichiers donnés) sur le cluster du .env
npm run passerelle                        # passerelle seule (port 4000, cockpit /cockpit/)
npm run demarrer -- --dotnet              # passerelle + 4 apps TS (4101,4102,4104,4105) + app .NET (4103)
dotnet build apps/debourse-dotnet         # app .NET
npm run bot -- --classe infrastructure --montant 120000000 --sortie desinvestir   # parcours e2e réel sur le cluster
npm run test:ui                           # écrans des apps TS (passerelle + apps démarrées)
npx tsx outils/src/test-dotnet.ts INV-…   # écrans de l'app .NET (dossier arrivé au déboursé : bot --sauf debourse --jusqua post)
npm run scenario -- liste | r1 | r1 --annuler     # scénarios de changement R/O/S
npm run impact -- <rôle|typeTache|règle|personne|équipe>
npm run incidents                         # incidents Camunda actifs (premier réflexe si un dossier n'avance plus)
npm run audit:verifier | audit:exporter
npm run generer:client                    # après toute modification de contrats/openapi.yaml (client TS)
```

Démo accélérée : `DEMO_DELAI_SUIVI=PT1M DEMO_FACTEUR_SLA=0.01` (env ou `.env`). Le `.env` (jamais
commité) contient le client API Camunda et la config SharePoint ; modèle : `.env.example`.

## Architecture (détail : docs/architecture.md)

- `passerelle/src/moteur.ts` est le **seul** fichier qui importe `@camunda8/orchestration-cluster-api`.
  `services.ts` porte la logique partagée par l'API (`app.ts`) et les workers (`workers.ts`).
- **Patron tâche métier** : toute tâche humaine = call activity vers `tache-metier.bpmn` avec seulement
  `typeTache` en entrée et `=resultat` en sortie (`propagateAllChildVariables=false`). Rôle, champs,
  pièces, délai SLA viennent de `config/taches.yaml`. Complétion → message `tache.completee` (clé
  `tacheId`) ; refus de sécurité/validation → `tache.refusee` (visible dans Operate).
- Gouvernance = 3 YAML dans `config/` (catalogue, organisation, sécurité), validés par zod et
  **rechargés à chaud** par la passerelle (audit `gouvernance.rechargee`). Les BPMN/DMN ne contiennent
  que des rôles abstraits (gabarits `{{variable}}` résolus à l'ouverture de la tâche).
- Corrélation métier : `dossierId` `INV-AAAA-NNNN`, passé aussi comme `businessId` Camunda.
- Les variables de processus ne portent que des références de documents `{type, nom, url, sha256}` ;
  les fichiers vont dans SharePoint (`passerelle/src/documents/`), confinés au dossier
  `SHAREPOINT_ROOT_FOLDER`. Mode `local` disponible.
- Registre + audit : SQLite (`donnees/passerelle.sqlite`, ignoré par git). Audit en ajout seul, chaîné SHA-256.
- Apps TS : `packages/kit-app` fournit boîte de tâches, formulaire généré depuis la définition, dépôt,
  webhook ; une app = identité + écrans propres. App .NET : client NSwag commité
  (`apps/debourse-dotnet/Passerelle/PasserelleClient.g.cs`, régénération : voir son README).

## Pièges connus

- **DMN à une seule colonne de sortie** : le `resultVariable` contient directement la valeur (pas un
  objet). `controles.conformiteRequise` → incident `CONDITION_ERROR` ; écrire `conformiteRequise = true`.
- Les BPMN/DMN de `modeles/` ont été **générés** par `outils/src/bpmn/processus.ts` et
  `outils/src/dmn/tables.ts` (`npm run generer:modeles` écrase). Si un fichier a été retouché dans
  Camunda Modeler, modifier le fichier, pas le générateur.
- `npm run scenario` modifie de vrais fichiers de `modeles/`/`config/` (sauvegarde dans
  `donnees/scenarios/`) : toujours `--annuler` avant de commiter.
- Clients générés (NSwag) envoient `null` pour les propriétés absentes : les schémas zod de l'API
  utilisent `nullish()`.
- Windows : arrêter une tâche de fond `npm run …` ne tue pas toujours le processus `node` enfant
  (port 4000 encore occupé → `EADDRINUSE`). Retrouver le PID via `Get-NetTCPConnection -LocalPort 4000`.
- Le registre local référence des instances du cluster : après changement de cluster, supprimer
  `donnees/passerelle.sqlite`.
- Le cluster `dev-cl` est un essai (expiration ≈ 2026-12-07) ; « Authorizations disabled » est voulu
  pour l'instant (sécurité appliquée par la passerelle).

## Invariants à ne pas casser

- Aucune app sous `apps/` ne dépend d'un paquet Camunda ni ne manipule une clé d'instance.
- Aucun nom de personne/groupe dans un BPMN/DMN ; aucune règle d'affaires codée dans une app.
- Aucun contenu de document dans une variable de processus.
- Toute écriture SharePoint reste sous le dossier racine de la PoC (site SDAPS TI, dossier
  `POC-Maestro-Camunda`) — ne jamais écrire ailleurs sur ce tenant.

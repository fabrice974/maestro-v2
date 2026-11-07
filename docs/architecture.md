# Architecture proposée — backbone Camunda découplé

Statut : **proposition**, en attente des réponses de `questions-ouvertes.md`.

## 1. Vue d'ensemble

```
                     ┌──────────────────────── Camunda 8 (SaaS) ────────────────────────┐
                     │  BPMN backbone « investissement »                                 │
                     │   [Deal flow] → [Déboursé] → [Suivi périodique] ⟲ → [Désinvest.]  │
                     │       │ call activity    │ call activity                           │
                     │   BPMN deal-flow ──► BPMN revue-diligente                          │
                     │   Tasklist / Operate / Optimize                                    │
                     └──────────────▲──────────────────────────────┬─────────────────────┘
                                    │ messages corrélés            │ jobs (type = contrat)
                                    │ (clé = dossierId)            ▼
                     ┌──────────────┴──────────────────────────────────────────────────┐
                     │  Passerelle d'intégration (couche anti-corruption)               │
                     │   - API métier : POST /dossiers/{id}/evenements/{type}            │
                     │   - Job workers génériques → publient des commandes métier        │
                     │   - Journal d'audit (append-only)                                 │
                     └──────────────▲──────────────────────────────┬─────────────────────┘
                                    │ événements métier            │ commandes métier
                                    │ (REST ou bus)                ▼ (webhook ou bus)
          ┌──────────────┬──────────┴───────┬───────────────────┬───────────────┐
          │ App Deal flow│ App Revue dilig. │ App Déboursé      │ App Suivi pér.│ …
          └──────────────┴──────────────────┴───────────────────┴───────────────┘
                                    │ références seulement
                                    ▼
                          Référentiel documentaire
```

## 2. Pourquoi une passerelle plutôt que des workers Zeebe dans chaque app

- **Découplage du moteur** : les apps restent valides si on change de version de Camunda, de modèle
  BPMN, voire de moteur. Elles ne voient que des concepts métier (dossier, étape, document).
- **Contrat unique** : un seul endroit pour la sécurité, le mapping des variables, les reprises et
  l'idempotence.
- **Audit** : tout ce qui entre et sort du backbone passe par un point où on journalise.

Compromis : un composant de plus à opérer. Pour la PoC, c'est un seul service léger.

## 3. Les deux sens de communication

**Backbone → application (le processus demande un travail)**
1. Un service task BPMN porte un type de job métier (ex. `revue-diligente.demander-documents`).
2. Un job worker de la passerelle le prend, transforme les variables en commande métier et la publie
   à l'application concernée.
3. Pour un travail long (jours, semaines), le job est terminé tout de suite et le BPMN attend un
   *message* de retour (pattern « envoyer puis attendre »), au lieu de garder un job ouvert.

**Application → backbone (un fait métier s'est produit)**
1. L'app appelle l'API de la passerelle : « le dossier X a terminé sa revue diligente ».
2. La passerelle publie un message Zeebe, nom = type d'événement, clé de corrélation = `dossierId`.
3. Le BPMN avance. L'appel est idempotent (identifiant d'événement fourni par l'app).

## 4. Tâches humaines

Deux options, à trancher (voir questions) : Tasklist Camunda pour les validations simples, ou tâches
gérées dans les applications métier (le BPMN n'attend alors qu'un message). La seconde garde le
découplage, la première accélère la PoC.

## 5. Audit du déboursé

- Journal append-only dans la passerelle : événement, acteur, horodatage, référence et empreinte
  (hash) du document, instance BPMN associée.
- Contrôle quatre-yeux modélisé explicitement dans le BPMN du déboursé.
- Operate/Optimize servent au suivi, pas de source d'audit officielle (rétention limitée en SaaS).

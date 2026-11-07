# Questions ouvertes

Les réponses changent ce qui sera construit. Une fois tranchée, reporter la décision dans la
conception (`docs/superpowers/specs/`) et retirer la question d'ici.

Décisions déjà prises (2026-11-07) : Camunda 8 SaaS (`dev-cl`, 8.11.0-alpha1, essai) ; passerelle et
applications en TypeScript, application déboursé en .NET ; sous-processus simulés ; tâches métier
dans les applications, complétion garantie par le backbone ; documents dans SharePoint ; audit simple
mais conservable des années, signature reportée ; suivi mensuel.

1. **SharePoint** : un vrai tenant M365 est-il disponible pour la PoC (site dédié, inscription
   d'application Entra avec `Sites.Selected`, comptes invités pour les externes) ? Sans cela,
   l'adaptateur range les documents dans un dossier local et les permissions/révocations (S3) sont
   simulées.
2. **Date de démo** : l'essai `dev-cl` expire vraisemblablement début décembre 2026 ; à quelle date
   la démo doit-elle être prête ?
3. **Client API Camunda** : à créer par l'utilisateur (onglet API du cluster, portées Zeebe +
   Tasklist + Operate), identifiants copiés dans `.env` — jamais commités.
4. **Autorisations Camunda** : laisser désactivées (la sécurité est appliquée par la passerelle) ou
   les activer pour montrer aussi la défense en profondeur côté moteur ?

# Questions ouvertes

Les réponses changent ce qui sera construit. Une fois tranchée, déplacer la décision dans
`architecture.md` et retirer la question d'ici.

1. **Version de Camunda** : le compte de test est-il Camunda 8 SaaS (Zeebe, Tasklist, Operate) ?
   Région du cluster et version (8.6, 8.7, 8.8…) ?
2. **Langage et pile** des applications et de la passerelle : Java/Spring Boot, .NET, Node/TypeScript ?
3. **Applications de sous-processus** : existent-elles déjà (lesquelles, quelle techno) ou sont-elles
   à simuler dans la PoC ?
4. **Stades du deal flow** : liste exacte des stades entre « à venir » et « assigné », et ce qui fait
   passer de l'un à l'autre. Diffèrent-ils entre crédit privé, placement privé et infrastructure ?
5. **Tâches humaines** : Tasklist Camunda, ou tâches dans les applications métier ?
6. **Documents** : quel référentiel (SharePoint / M365, autre) ?
7. **Audit du déboursé** : exigences précises (quatre-yeux, signature, rétention, conformité visée) ?
8. **Suivi périodique** : fréquence (trimestrielle ?) et déclencheur de fin menant au désinvestissement.
9. **Hébergement de la PoC** : tout en local (Docker) contre le cluster SaaS, ou déploiement Azure ?
10. **Critère de réussite** de la PoC : démo de bout en bout sur un dossier fictif ? Autre ?

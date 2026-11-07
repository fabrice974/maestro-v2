/**
 * Application « Désinvestissement » (simulée) : la plus petite possible.
 * Démontre la rapidité de développement : identité + couleur, le kit fournit le reste.
 */
import { demarrerApp } from '@maestro/kit-app';

await demarrerApp({
  id: 'desinvestissement',
  nom: 'Désinvestissement',
  port: 4105,
  jeton: 'demo-jeton-desinvestissement',
  couleur: '#a33b3b',
  utilisateurParDefaut: 'kevin',
});

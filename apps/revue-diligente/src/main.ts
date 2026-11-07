/**
 * Application « Revue diligente » (simulée) : portail des chantiers pour les équipes internes et les
 * contributeurs externes (cabinet comptable, ingénierie, conseil ESG). Chaque contributeur ne voit
 * que les tâches de son chantier ; le backbone garantit leur complétion et range les rapports dans SharePoint.
 */
import { demarrerApp } from '@maestro/kit-app';

await demarrerApp({
  id: 'revue-diligente',
  nom: 'Revue diligente',
  port: 4102,
  jeton: 'demo-jeton-revue-diligente',
  couleur: '#0f7b6c',
  utilisateurParDefaut: 'lea',
  accueil: async ({ personnes, utilisateur }) => {
    const p = personnes.find((x) => x.id === utilisateur);
    const chantiers = (p?.roles ?? []).filter((r) => r.startsWith('revue-')).map((r) => r.slice(6));
    return `<div class="carte"><h2>Portail des contributeurs</h2>
<p>${p?.externe ? 'Contributeur <strong>externe</strong>' : 'Équipe interne'} — chantiers habilités : ${chantiers.length ? chantiers.map((c) => `<span class="etiquette">${c}</span>`).join(' ') : '<span class="doux">aucun</span>'}.</p>
<p class="doux">Les chantiers requis sont décidés par la règle d'affaires « chantiers-revue-diligente » (DMN) selon la classe d'actif. Les habilitations viennent de config/organisation.yaml.</p></div>`;
  },
});

/**
 * Application « Suivi périodique » (simulée) : collecte mensuelle, plans d'action, et signalement des
 * faits métier qui terminent le suivi (remboursement complet, décision de désinvestir).
 */
import { randomUUID } from 'node:crypto';
import { enTantQue } from '@maestro/client-backbone';
import { demarrerApp, e, msg } from '@maestro/kit-app';

await demarrerApp({
  id: 'suivi-periodique',
  nom: 'Suivi périodique',
  port: 4104,
  jeton: 'demo-jeton-suivi-periodique',
  couleur: '#b36b00',
  utilisateurParDefaut: 'kevin',
  accueil: async ({ client, utilisateur }) => {
    const { data: dossiers = [] } = await client.GET('/dossiers');
    const enSuivi = dossiers.filter((d) => d.phase === 'suivi-periodique' && d.statut === 'actif');
    const u = encodeURIComponent(utilisateur);
    const lignes = enSuivi
      .map(
        (d) => `<tr><td><strong>${e(d.dossierId)}</strong><br>${e(d.nom)}</td><td>${d.montant.toLocaleString('fr-CA')} $</td>
<td><form method="post" action="/evenements/${e(d.dossierId)}/remboursement-complet?u=${u}" style="display:inline"><button class="second">Remboursement complet</button></form>
<form method="post" action="/evenements/${e(d.dossierId)}/decision-desinvestir?u=${u}" style="display:inline"><button class="second">Décider de désinvestir</button></form></td></tr>`,
      )
      .join('');
    return `<div class="carte"><h2>Portefeuille en suivi mensuel (${enSuivi.length})</h2>
${enSuivi.length ? `<table><thead><tr><th>Dossier</th><th>Engagement</th><th>Faits métier à signaler au backbone</th></tr></thead><tbody>${lignes}</tbody></table>` : '<p class="doux">Aucun dossier en post-investissement.</p>'}
<p class="doux">Le statut des clauses (conforme / surveillance / bris) est décidé par la règle « alerte-covenants » à partir de la collecte mensuelle.</p></div>`;
  },
  routes: (app, ctx) => {
    app.post<{ Params: { dossierId: string; type: 'remboursement-complet' | 'decision-desinvestir' } }>('/evenements/:dossierId/:type', async (req, rep) => {
      const c = await ctx(req);
      const { error, response } = await c.client.POST('/dossiers/{dossierId}/evenements/{type}', {
        params: { path: { dossierId: req.params.dossierId, type: req.params.type }, header: enTantQue(c.utilisateur) as never },
        body: { evenementId: randomUUID(), donnees: { date: new Date().toISOString().slice(0, 10), signalePar: c.utilisateur } },
      });
      const message = error
        ? msg(false, `${response.status} — ${e((error as { message: string }).message)}`)
        : msg(true, `Événement « ${e(req.params.type)} » transmis au backbone pour ${e(req.params.dossierId)} (pris en compte à la fin du cycle en cours).`);
      return rep.type('text/html').send(c.rendre('Événement', `<p><a href="/?u=${encodeURIComponent(c.utilisateur)}">← Retour</a></p>`, message));
    });
  },
});

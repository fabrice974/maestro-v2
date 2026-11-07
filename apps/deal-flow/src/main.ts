/**
 * Application « Deal flow » (simulée) : enregistre les occasions et réalise les tâches du deal flow.
 * Elle ne dépend que du client du backbone : aucune notion de Camunda, de BPMN ou d'instance.
 */
import { enTantQue } from '@maestro/client-backbone';
import { demarrerApp, e, msg } from '@maestro/kit-app';

const PHASES: Record<string, string> = {
  'deal-flow': 'Deal flow',
  'revue-diligente': 'Revue diligente',
  debourse: 'Déboursé',
  'suivi-periodique': 'Suivi périodique',
  desinvestissement: 'Désinvestissement',
  cloture: 'Clôturé',
};

await demarrerApp({
  id: 'deal-flow',
  nom: 'Deal flow',
  port: 4101,
  jeton: 'demo-jeton-deal-flow',
  couleur: '#1f5fa8',
  utilisateurParDefaut: 'alice',
  accueil: async ({ client, utilisateur }) => {
    const { data: dossiers = [] } = await client.GET('/dossiers');
    const lignes = dossiers
      .map(
        (d) =>
          `<tr><td><strong>${e(d.dossierId)}</strong><br>${e(d.nom)}</td><td>${e(d.contrepartie)}</td><td>${e(d.classeActif)}</td>
<td>${d.montant.toLocaleString('fr-CA')} $</td><td><span class="etiquette">${e(PHASES[d.phase] ?? d.phase)}</span> ${d.statut !== 'actif' ? e(d.statut) : ''}</td>
<td>${d.urlDocuments ? `<a href="${e(d.urlDocuments)}" target="_blank" rel="noopener">SharePoint</a>` : ''}</td></tr>`,
      )
      .join('');
    return `<div class="carte"><h2>Nouvelle occasion d'investissement</h2>
<form method="post" action="/occasions?u=${encodeURIComponent(utilisateur)}" class="grille">
<div><label for="nom">Nom du projet</label><input id="nom" name="nom" required value="Prêt à terme — Logistique Boréale"></div>
<div><label for="contrepartie">Contrepartie</label><input id="contrepartie" name="contrepartie" required value="Logistique Boréale inc."></div>
<div><label for="classeActif">Classe d'actif</label><select id="classeActif" name="classeActif"><option value="credit-prive">Crédit privé</option><option value="placement-prive">Placement privé</option><option value="infrastructure">Infrastructure</option></select></div>
<div><label for="montant">Montant visé ($)</label><input id="montant" name="montant" type="number" required value="40000000"></div>
<div><label for="secteur">Secteur</label><input id="secteur" name="secteur" required value="transport-logistique"></div>
<div style="align-self:end"><button type="submit">Enregistrer l'occasion</button></div></form>
<p class="doux">L'enregistrement démarre le backbone : le dossier SharePoint est créé et la première tâche (qualification) apparaît ci-dessous.</p></div>
<div class="carte"><h2>Pipeline (${dossiers.length})</h2>${dossiers.length ? `<table><thead><tr><th>Dossier</th><th>Contrepartie</th><th>Classe</th><th>Montant</th><th>Stade</th><th>Documents</th></tr></thead><tbody>${lignes}</tbody></table>` : '<p class="doux">Aucun dossier.</p>'}</div>`;
  },
  routes: (app, ctx) => {
    app.post('/occasions', async (req, rep) => {
      const c = await ctx(req);
      const b = req.body as Record<string, string>;
      const { data, error } = await c.client.POST('/dossiers', {
        params: { header: enTantQue(c.utilisateur) as never },
        body: { nom: b.nom!, contrepartie: b.contrepartie!, classeActif: b.classeActif as 'credit-prive', montant: Number(b.montant), secteur: b.secteur! },
      });
      const message = data
        ? msg(true, `Dossier <strong>${e(data.dossierId)}</strong> créé — <a href="${e(data.urlDocuments)}" target="_blank" rel="noopener">dossier SharePoint</a>. Le backbone ouvre la qualification.`)
        : msg(false, e((error as { message?: string })?.message ?? 'Erreur'));
      return rep.type('text/html').send(c.rendre('Nouvelle occasion', `<p><a href="/?u=${encodeURIComponent(c.utilisateur)}">← Retour</a></p>`, message));
    });
  },
});

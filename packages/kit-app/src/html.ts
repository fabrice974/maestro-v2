import type { Champ, DefinitionTache, Personne } from '@maestro/client-backbone';

export const e = (v: unknown) =>
  String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

export function page(o: { titre: string; app: string; couleur: string; utilisateur: string; personnes: Personne[]; corps: string; message?: string }) {
  const options = o.personnes
    .map((p) => `<option value="${e(p.id)}"${p.id === o.utilisateur ? ' selected' : ''}>${e(p.nom)} — ${e(p.titre ?? p.equipe)}</option>`)
    .join('');
  return `<!doctype html><html lang="fr-CA"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${e(o.titre)}</title>
<style>
:root{--accent:${o.couleur};--fond:#f6f7f9;--carte:#fff;--texte:#1d2430;--doux:#5b6574;--bord:#dfe3ea;--ok:#1b7a43;--ko:#b3261e}
@media (prefers-color-scheme:dark){:root{--fond:#14171c;--carte:#1d2128;--texte:#e8ebf0;--doux:#9aa4b2;--bord:#2e343e}}
*{box-sizing:border-box}body{margin:0;font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;background:var(--fond);color:var(--texte)}
header{background:var(--accent);color:#fff;padding:12px 16px;display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between}
header h1{font-size:18px;margin:0}header small{opacity:.85}header form{display:flex;gap:6px;align-items:center}
main{max-width:980px;margin:0 auto;padding:16px}
.carte{background:var(--carte);border:1px solid var(--bord);border-radius:10px;padding:16px;margin-bottom:16px}
h2{font-size:16px;margin:0 0 12px}table{width:100%;border-collapse:collapse}td,th{text-align:left;padding:8px;border-bottom:1px solid var(--bord);vertical-align:top}
th{color:var(--doux);font-weight:600;font-size:13px}a{color:var(--accent)}
label{display:block;font-weight:600;margin:10px 0 4px}input,select,textarea{width:100%;padding:8px;border:1px solid var(--bord);border-radius:6px;background:var(--carte);color:var(--texte);font:inherit}
input[type=checkbox]{width:auto}button{background:var(--accent);color:#fff;border:0;border-radius:6px;padding:9px 14px;font:inherit;font-weight:600;cursor:pointer}
button.second{background:transparent;color:var(--accent);border:1px solid var(--accent)}
.grille{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:4px 16px}
.etiquette{display:inline-block;padding:2px 8px;border-radius:99px;font-size:12px;background:var(--fond);border:1px solid var(--bord)}
.ok{color:var(--ok)}.ko{color:var(--ko)}.msg{padding:10px 12px;border-radius:8px;margin-bottom:16px;border:1px solid}
.msg.ok{border-color:var(--ok)}.msg.ko{border-color:var(--ko)}.doux{color:var(--doux);font-size:13px}
</style></head><body>
<header><div><h1>${e(o.app)}</h1><small>Application de sous-processus — parle uniquement au contrat de la passerelle</small></div>
<form method="get" action=""><label for="u" style="margin:0;color:#fff">Agir en tant que</label>
<select id="u" name="u" onchange="this.form.submit()" style="width:auto">${options}</select></form></header>
<main>${o.message ?? ''}${o.corps}</main></body></html>`;
}

function valeur(c: Champ, valeurs: Record<string, unknown>) {
  const v = valeurs[c.nom];
  return v === undefined || v === null ? '' : v;
}

/** Génère les champs du formulaire à partir de la définition de la tâche (config/taches.yaml). */
export function rendreChamps(def: DefinitionTache, valeurs: Record<string, unknown> = {}): string {
  const champs = def.champs.map((c) => {
    const req = c.obligatoire ? ' required' : '';
    const lib = `<label for="c_${e(c.nom)}">${e(c.libelle)}${c.obligatoire ? ' *' : ''}${c.regle ? ` <span class="doux">(${c.regle === 'futur' ? "aujourd'hui ou plus tard" : "aujourd'hui ou avant"})</span>` : ''}</label>`;
    const v = valeur(c, valeurs);
    switch (c.type) {
      case 'date':
        return `${lib}<input type="date" id="c_${e(c.nom)}" name="champs.${e(c.nom)}" value="${e(v)}"${req}>`;
      case 'nombre':
      case 'montant':
        return `${lib}<input type="number" step="any" id="c_${e(c.nom)}" name="champs.${e(c.nom)}" value="${e(v)}"${req}>`;
      case 'booleen':
        return `<label><input type="checkbox" name="champs.${e(c.nom)}" value="true"${v === true || v === 'true' ? ' checked' : ''}> ${e(c.libelle)}</label>`;
      case 'choix':
        return `${lib}<select id="c_${e(c.nom)}" name="champs.${e(c.nom)}"${req}><option value=""></option>${(c.choix ?? [])
          .map((x) => `<option${x === v ? ' selected' : ''}>${e(x)}</option>`)
          .join('')}</select>`;
      default:
        return `${lib}<textarea id="c_${e(c.nom)}" name="champs.${e(c.nom)}" rows="2"${req}>${e(v)}</textarea>`;
    }
  });
  if (def.decision?.length) {
    champs.push(
      `<label for="decision">Décision *</label><select id="decision" name="decision" required><option value=""></option>${def.decision
        .map((d) => `<option${d === valeurs.decision ? ' selected' : ''}>${e(d)}</option>`)
        .join('')}</select>`,
    );
  }
  return champs.join('\n');
}

/** Formulaires de dépôt pour chaque document attendu. */
export function rendreDepots(def: DefinitionTache, deposes: { type: string; nom: string; url: string; sha256: string }[], action: string): string {
  if (!def.documents.length) return '<p class="doux">Aucune pièce requise.</p>';
  return def.documents
    .map((d) => {
      const dep = deposes.filter((x) => x.type === d.type);
      const etat = dep.length
        ? dep.map((x) => `<span class="ok">✔</span> <a href="${e(x.url)}" target="_blank" rel="noopener">${e(x.nom)}</a> <span class="doux">sha256 ${e(x.sha256.slice(0, 12))}…</span>`).join('<br>')
        : `<span class="${d.obligatoire ? 'ko' : 'doux'}">${d.obligatoire ? 'Obligatoire — non déposé' : 'Facultatif'}</span>`;
      return `<form method="post" action="${e(action)}" enctype="multipart/form-data" class="grille" style="align-items:end;margin-bottom:8px">
<div><strong>${e(d.libelle)}</strong><br>${etat}</div>
<div><input type="hidden" name="type" value="${e(d.type)}"><input type="file" name="fichier" required></div>
<div><button class="second" type="submit">Déposer dans SharePoint</button></div></form>`;
    })
    .join('');
}

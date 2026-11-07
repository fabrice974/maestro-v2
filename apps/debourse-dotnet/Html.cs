using System.Globalization;
using System.Net;
using System.Text;
using System.Text.Json;
using Debourse.Passerelle;

namespace Debourse;

/// <summary>
/// Rendu HTML côté serveur, calqué sur packages/kit-app/src/html.ts (mêmes variables CSS, même
/// structure de page) pour que l'application .NET ait l'air d'une sœur des applications TypeScript.
/// </summary>
public static class Html
{
    public static readonly CultureInfo FrCa = CultureInfo.GetCultureInfo("fr-CA");

    /// <summary>Échappe une valeur pour l'insérer dans du HTML (texte ou attribut).</summary>
    /// <remarks>Comme e() de html.ts : seuls &amp; &lt; &gt; " ' sont échappés, les accents restent lisibles.</remarks>
    public static string E(object? v) => Echapper(v switch
    {
        null => "",
        JsonElement j => Texte(j),
        double d => d.ToString("#,##0.##", FrCa),
        _ => Convert.ToString(v, CultureInfo.InvariantCulture) ?? "",
    });

    private static string Echapper(string s) =>
        s.Replace("&", "&amp;").Replace("<", "&lt;").Replace(">", "&gt;").Replace("\"", "&quot;").Replace("'", "&#39;");

    public static string Texte(JsonElement j) => j.ValueKind switch
    {
        JsonValueKind.String => j.GetString() ?? "",
        JsonValueKind.Number => j.TryGetDouble(out var d) ? d.ToString("#,##0.##", FrCa) : j.GetRawText(),
        JsonValueKind.True => "oui",
        JsonValueKind.False => "non",
        JsonValueKind.Null or JsonValueKind.Undefined => "",
        _ => j.GetRawText(),
    };

    /// <summary>Date-heure affichée dans le fuseau du serveur, format québécois.</summary>
    public static string Date(DateTimeOffset? d) => d is null ? "" : d.Value.ToLocalTime().ToString("yyyy-MM-dd HH:mm", FrCa);

    public static string DateSec(DateTimeOffset d) => d.ToLocalTime().ToString("yyyy-MM-dd HH:mm:ss", FrCa);

    public static string Hash(string? h, int n = 12) => string.IsNullOrEmpty(h) ? "" : (h.Length > n ? h[..n] + "…" : h);

    public static string Msg(bool ok, string html) => $"<div class=\"msg {(ok ? "ok" : "ko")}\">{html}</div>";

    /// <summary>Ajoute ?u= (ou &amp;u=) à un chemin pour conserver l'utilisateur courant.</summary>
    public static string Lien(string chemin, string u) => $"{chemin}{(chemin.Contains('?') ? '&' : '?')}u={Uri.EscapeDataString(u)}";

    public static string Page(string titre, string app, string couleur, string utilisateur, IEnumerable<Personne> personnes, string corps, string? message = null)
    {
        var options = string.Concat(personnes.Select(p =>
            $"<option value=\"{E(p.Id)}\"{(p.Id == utilisateur ? " selected" : "")}>{E(p.Nom)} — {E(p.Titre ?? p.Equipe)}</option>"));
        if (!personnes.Any(p => p.Id == utilisateur))
            options = $"<option value=\"{E(utilisateur)}\" selected>{E(utilisateur)}</option>" + options;
        var lienAccueil = E(Lien("/", utilisateur));
        var lienDossiers = E(Lien("/dossiers", utilisateur));
        return $$"""
<!doctype html><html lang="fr-CA"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{{E(titre)}}</title>
<style>
:root{--accent:{{couleur}};--fond:#f6f7f9;--carte:#fff;--texte:#1d2430;--doux:#5b6574;--bord:#dfe3ea;--ok:#1b7a43;--ko:#b3261e;--attention:#8a5a00;--code:#f0ecf4}
@media (prefers-color-scheme:dark){:root{--fond:#14171c;--carte:#1d2128;--texte:#e8ebf0;--doux:#9aa4b2;--bord:#2e343e;--ok:#4cc27e;--ko:#ff8a80;--attention:#e0b25a;--code:#2a2333} }
*{box-sizing:border-box}body{margin:0;font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;background:var(--fond);color:var(--texte)}
header{background:var(--accent);color:#fff;padding:12px 16px;display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between}
header h1{font-size:18px;margin:0}header small{opacity:.85}header form{display:flex;gap:6px;align-items:center}
nav{background:var(--carte);border-bottom:1px solid var(--bord);padding:0 16px;display:flex;gap:4px;flex-wrap:wrap}
nav a{display:inline-block;padding:10px 12px;text-decoration:none;color:var(--texte);border-bottom:3px solid transparent;font-weight:600;font-size:14px}
nav a:hover{border-bottom-color:var(--accent)}
main{max-width:1100px;margin:0 auto;padding:16px}
.carte{background:var(--carte);border:1px solid var(--bord);border-radius:10px;padding:16px;margin-bottom:16px}
h2{font-size:16px;margin:0 0 12px}table{width:100%;border-collapse:collapse}td,th{text-align:left;padding:8px;border-bottom:1px solid var(--bord);vertical-align:top}
th{color:var(--doux);font-weight:600;font-size:13px}a{color:var(--accent)}
@media (prefers-color-scheme:dark){a{color:#c99be6} }
label{display:block;font-weight:600;margin:10px 0 4px}input,select,textarea{width:100%;padding:8px;border:1px solid var(--bord);border-radius:6px;background:var(--carte);color:var(--texte);font:inherit}
input[type=checkbox]{width:auto}button{background:var(--accent);color:#fff;border:0;border-radius:6px;padding:9px 14px;font:inherit;font-weight:600;cursor:pointer}
button.second{background:transparent;color:var(--accent);border:1px solid var(--accent)}
.grille{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:4px 16px}
.etiquette{display:inline-block;padding:2px 8px;border-radius:99px;font-size:12px;background:var(--fond);border:1px solid var(--bord)}
.ok{color:var(--ok)}.ko{color:var(--ko)}.attention{color:var(--attention)}.msg{padding:10px 12px;border-radius:8px;margin-bottom:16px;border:1px solid;background:var(--carte)}
.msg.ok{border-color:var(--ok)}.msg.ko{border-color:var(--ko)}.doux{color:var(--doux);font-size:13px}
.msg ul{margin:6px 0 0;padding-left:20px}
.defile{overflow-x:auto}
code,.mono{font-family:ui-monospace,"Cascadia Mono",Consolas,monospace;font-size:12.5px}
code{background:var(--code);padding:1px 5px;border-radius:4px}
.champ-ko input,.champ-ko select,.champ-ko textarea{border-color:var(--ko)}
.err-champ{color:var(--ko);font-size:13px;margin-top:2px}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:16px}
.stat{background:var(--carte);border:1px solid var(--bord);border-radius:10px;padding:12px 14px}
.stat b{display:block;font-size:22px;line-height:1.2}.stat span{color:var(--doux);font-size:13px}
.sceau{display:flex;gap:14px;align-items:center;padding:14px 16px;border-radius:10px;border:1px solid;margin-bottom:16px;background:var(--carte)}
.sceau.ok{border-color:var(--ok)}.sceau.ko{border-color:var(--ko)}
.sceau .icone{font-size:28px;line-height:1}
.action{display:inline-block;padding:1px 8px;border-radius:99px;font-size:12px;font-weight:600;border:1px solid var(--bord);white-space:nowrap}
.a-tache{border-color:#5b7bd5;color:#5b7bd5}.a-document{border-color:var(--accent);color:var(--accent)}
.a-refus{border-color:var(--ko);color:var(--ko)}.a-dossier{border-color:var(--ok);color:var(--ok)}
.a-paiement{border-color:var(--attention);color:var(--attention)}
tr.refus td{background:color-mix(in srgb,var(--ko) 7%,transparent)}
details summary{cursor:pointer;color:var(--doux);font-size:13px}
details pre{white-space:pre-wrap;word-break:break-word;margin:6px 0 0;font-size:12px}
.chaine{color:var(--doux);font-size:12px}
</style></head><body>
<header><div><h1>{{E(app)}}</h1><small>Application de sous-processus (.NET) — parle uniquement au contrat de la passerelle</small></div>
<form method="get" action=""><label for="u" style="margin:0;color:#fff">Agir en tant que</label>
<select id="u" name="u" onchange="this.form.submit()" style="width:auto">{{options}}</select><noscript><button type="submit">OK</button></noscript></form></header>
<nav><a href="{{lienAccueil}}">Mes tâches</a><a href="{{lienDossiers}}">Dossiers en post-investissement</a></nav>
<main>{{message}}{{corps}}</main></body></html>
""";
    }

    /// <summary>Génère les champs du formulaire à partir de la définition de la tâche (config/taches.yaml).</summary>
    public static string RendreChamps(DefinitionTache def, IReadOnlyDictionary<string, string?> valeurs, IReadOnlyDictionary<string, List<string>> erreurs)
    {
        var sb = new StringBuilder();
        foreach (var c in def.Champs)
        {
            valeurs.TryGetValue(c.Nom, out var v);
            v ??= "";
            var req = c.Obligatoire ? " required" : "";
            var id = $"c_{E(c.Nom)}";
            var nom = $"champs.{E(c.Nom)}";
            var regle = c.Regle switch
            {
                ChampRegle.Futur => " <span class=\"doux\">(aujourd'hui ou plus tard)</span>",
                ChampRegle.Passe => " <span class=\"doux\">(aujourd'hui ou avant)</span>",
                _ => "",
            };
            var lib = $"<label for=\"{id}\">{E(c.Libelle)}{(c.Obligatoire ? " *" : "")}{regle}</label>";
            var controle = c.Type switch
            {
                ChampType.Date => $"{lib}<input type=\"date\" id=\"{id}\" name=\"{nom}\" value=\"{E(v)}\"{req}>",
                ChampType.Nombre or ChampType.Montant =>
                    $"{lib}<input type=\"number\" step=\"any\"{(c.Type == ChampType.Montant ? " min=\"0\"" : "")} id=\"{id}\" name=\"{nom}\" value=\"{E(v)}\"{req}>",
                ChampType.Booleen =>
                    $"<label><input type=\"checkbox\" id=\"{id}\" name=\"{nom}\" value=\"true\"{(v is "true" or "on" ? " checked" : "")}> {E(c.Libelle)}{(c.Obligatoire ? " *" : "")}</label>",
                ChampType.Choix =>
                    $"{lib}<select id=\"{id}\" name=\"{nom}\"{req}><option value=\"\"></option>{string.Concat((c.Choix ?? []).Select(x => $"<option{(x == v ? " selected" : "")}>{E(x)}</option>"))}</select>",
                _ => $"{lib}<textarea id=\"{id}\" name=\"{nom}\" rows=\"2\"{req}>{E(v)}</textarea>",
            };
            sb.Append(Envelopper(controle, erreurs, c.Nom));
        }
        if (def.Decision is { Count: > 0 })
        {
            valeurs.TryGetValue("decision", out var d);
            var controle = $"<label for=\"decision\">Décision *</label><select id=\"decision\" name=\"decision\" required><option value=\"\"></option>{string.Concat(def.Decision.Select(x => $"<option{(x == d ? " selected" : "")}>{E(x)}</option>"))}</select>";
            sb.Append(Envelopper(controle, erreurs, "decision"));
        }
        if (sb.Length == 0) sb.Append("<p class=\"doux\">Aucun champ à saisir pour cette tâche.</p>");
        return sb.ToString();
    }

    private static string Envelopper(string controle, IReadOnlyDictionary<string, List<string>> erreurs, string nom)
    {
        if (!erreurs.TryGetValue(nom, out var liste) || liste.Count == 0) return $"<div>{controle}</div>\n";
        return $"<div class=\"champ-ko\">{controle}{string.Concat(liste.Select(x => $"<div class=\"err-champ\">{E(x)}</div>"))}</div>\n";
    }

    /// <summary>Formulaires de dépôt pour chaque document attendu.</summary>
    public static string RendreDepots(DefinitionTache def, IEnumerable<DocumentDepose> deposes, string action, IReadOnlyDictionary<string, List<string>> erreurs)
    {
        if (def.Documents.Count == 0) return "<p class=\"doux\">Aucune pièce requise.</p>";
        var sb = new StringBuilder();
        foreach (var d in def.Documents)
        {
            var dep = deposes.Where(x => x.Type == d.Type).ToList();
            var etat = dep.Count > 0
                ? string.Join("<br>", dep.Select(x =>
                    $"<span class=\"ok\">✔</span> <a href=\"{E(x.Url)}\" target=\"_blank\" rel=\"noopener\">{E(x.Nom)}</a> <span class=\"doux\">sha256 <code>{E(Hash(x.Sha256))}</code>{(x.DeposePar is null ? "" : $" — {E(x.DeposePar)}")}{(x.DeposeLe is null ? "" : $", {E(Date(x.DeposeLe))}")}</span>"))
                : $"<span class=\"{(d.Obligatoire ? "ko" : "doux")}\">{(d.Obligatoire ? "Obligatoire — non déposé" : "Facultatif")}</span>";
            var err = erreurs.TryGetValue($"document:{d.Type}", out var l) ? string.Concat(l.Select(x => $"<div class=\"err-champ\">{E(x)}</div>")) : "";
            sb.Append($"""
<form method="post" action="{E(action)}" enctype="multipart/form-data" class="grille" style="align-items:end;margin-bottom:8px">
<div><strong>{E(d.Libelle)}</strong> <span class="doux"><code>{E(d.Type)}</code></span><br>{etat}{err}</div>
<div><input type="hidden" name="type" value="{E(d.Type)}"><input type="file" name="fichier" required></div>
<div><button class="second" type="submit">Déposer dans SharePoint</button></div></form>
""");
        }
        return sb.ToString();
    }
}

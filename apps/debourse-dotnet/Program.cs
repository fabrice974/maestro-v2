// Application Déboursé (.NET) — preuve qu'une équipe .NET se branche sur le backbone avec le seul
// contrat contrats/openapi.yaml : client NSwag généré, aucune dépendance Camunda/Zeebe.
using System.Collections.Concurrent;
using System.Globalization;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using Debourse;
using Debourse.Passerelle;
using static Debourse.Html;
using TypeEvenement = Debourse.Passerelle.Type;

var builder = WebApplication.CreateBuilder(args);
var options = builder.Configuration.GetSection("Debourse").Get<OptionsApp>() ?? new OptionsApp();
builder.WebHost.UseUrls(options.UrlEcoute);

builder.Services.AddSingleton(options);
builder.Services.AddSingleton<Annuaire>();
builder.Services.AddSingleton<Notifications>();
builder.Services.AddHttpClient<IPasserelleClient, PasserelleClient>(c =>
{
    c.BaseAddress = new Uri(options.UrlPasserelle.TrimEnd('/') + "/");
    c.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", options.Jeton);
    c.Timeout = TimeSpan.FromSeconds(30);
});

var app = builder.Build();

// Passerelle injoignable ou réponse inattendue : page lisible plutôt qu'une trace .NET.
app.Use(async (http, next) =>
{
    try { await next(http); }
    catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or ApiException)
    {
        if (http.Response.HasStarted) throw;
        var ecran = await Ecran.Creer(http);
        var detail = ex is ApiException api ? $"{api.StatusCode} — {ErreursPasserelle.Lire(api).Message}" : ex.Message;
        http.Response.StatusCode = StatusCodes.Status502BadGateway;
        http.Response.ContentType = "text/html; charset=utf-8";
        await http.Response.WriteAsync(ecran.Rendre("Passerelle indisponible",
            Msg(false, $"<strong>La passerelle n'a pas répondu comme prévu</strong> ({E(options.UrlPasserelle)}).<br>{E(detail)}")));
    }
});

// ───────────────────────── Accueil : boîte de tâches ─────────────────────────
app.MapGet("/", async (HttpContext http, IPasserelleClient client, Notifications notifs) =>
{
    var c = await Ecran.Creer(http);
    var taches = (await client.ListerTachesAsync(Statut.Ouverte)).OrderBy(t => t.Echeance).ToList();
    var maintenant = DateTimeOffset.Now;
    var lignes = string.Concat(taches.Select(t =>
    {
        var ctx = Json.Objet(t.Contexte);
        var enRetard = t.Echeance < maintenant;
        return $"""
<tr><td><a href="{E(Lien($"/taches/{t.TacheId}", c.Utilisateur))}">{E(t.Titre ?? t.TypeTache)}</a><br><span class="doux"><code>{E(t.TypeTache)}</code></span></td>
<td><a href="{E(Lien($"/dossiers/{t.DossierId}/audit", c.Utilisateur))}">{E(t.DossierId)}</a><br><span class="doux">{E(Json.Champ(ctx, "nom"))}</span></td>
<td><span class="etiquette">{E(t.RoleRequis)}</span></td>
<td class="{(enRetard ? "ko" : "")}">{E(Date(t.Echeance))}{(enRetard ? " <strong>(dépassée)</strong>" : "")}{(t.Escalades > 0 ? $"<br><span class=\"attention\">{t.Escalades} escalade(s)</span>" : "")}{(t.Refus > 0 ? $"<br><span class=\"ko\">{t.Refus} refus</span>" : "")}</td></tr>
""";
    }));
    var recentes = notifs.Dernieres(5);
    var corps = $"""
{(http.Request.Query.ContainsKey("fait") ? Msg(true, "Tâche complétée : la passerelle a informé le backbone.") : "")}
<div class="carte"><h2>Mes tâches ouvertes ({taches.Count})</h2>
{(taches.Count > 0
    ? $"<div class=\"defile\"><table><thead><tr><th>Tâche</th><th>Dossier</th><th>Rôle requis</th><th>Échéance</th></tr></thead><tbody>{lignes}</tbody></table></div>"
    : "<p class=\"doux\">Aucune tâche ouverte. Le backbone en créera quand le processus le demandera.</p>")}
<p class="doux">{notifs.Nombre} notification(s) reçue(s) du backbone par webhook. <a href="{E(Lien("/", c.Utilisateur))}">Rafraîchir</a></p>
{(recentes.Count > 0 ? $"<ul class=\"doux\">{string.Concat(recentes.Select(n => $"<li>{E(n.RecuLe.ToLocalTime().ToString("HH:mm:ss", FrCa))} — <code>{E(n.TypeTache)}</code> sur {E(n.DossierId)}</li>"))}</ul>" : "")}
</div>
""";
    return Results.Content(c.Rendre("Mes tâches", corps), "text/html; charset=utf-8");
});

// ───────────────────────── Tâche : contexte, pièces, formulaire ─────────────────────────
app.MapGet("/taches/{id:guid}", async (HttpContext http, Guid id, IPasserelleClient client) =>
{
    var c = await Ecran.Creer(http);
    var valeurs = new Dictionary<string, string?>();
    if (http.Request.Query.ContainsKey("prerempli"))
    {
        var t = await client.LireTacheAsync(id);
        var montant = Json.Nombre(Json.Objet(t.Contexte), "montant") ?? t.Dossier?.Montant;
        valeurs = Simulation.Reponse(t.TypeTache, montant);
    }
    return await Taches.Rendre(c, client, id, "", valeurs, []);
});

app.MapPost("/taches/{id:guid}/documents", async (HttpContext http, Guid id, IPasserelleClient client) =>
{
    var c = await Ecran.Creer(http);
    var form = await http.Request.ReadFormAsync();
    var type = form["type"].ToString();
    var fichier = form.Files.GetFile("fichier");
    if (fichier is null || fichier.Length == 0)
        return await Taches.Rendre(c, client, id, Msg(false, "Aucun fichier reçu."), [], []);
    try
    {
        await using var flux = fichier.OpenReadStream();
        var doc = await client.DeposerDocumentAsync(id, c.Utilisateur, type, new FileParameter(flux, fichier.FileName, fichier.ContentType));
        return await Taches.Rendre(c, client, id,
            Msg(true, $"Pièce « {E(type)} » déposée dans SharePoint par le backbone — sha256 <code>{E(Hash(doc.Sha256))}</code>."), [], []);
    }
    catch (ApiException ex)
    {
        return await Taches.Rendre(c, client, id, ErreursPasserelle.Bandeau(ex), [], ErreursPasserelle.ParChamp(ex));
    }
});

app.MapPost("/taches/{id:guid}/completer", async (HttpContext http, Guid id, IPasserelleClient client) =>
{
    var c = await Ecran.Creer(http);
    var form = await http.Request.ReadFormAsync();
    var saisie = form.Keys.Where(k => k.StartsWith("champs.", StringComparison.Ordinal))
        .ToDictionary(k => k["champs.".Length..], k => (string?)form[k].ToString());
    var decision = form["decision"].ToString();
    var valeurs = new Dictionary<string, string?>(saisie) { ["decision"] = decision };

    // La définition sert seulement à typer les valeurs (nombre, booléen) ; la validation reste à la passerelle.
    var tache = await client.LireTacheAsync(id);
    var champs = new Dictionary<string, object>();
    foreach (var champ in tache.Definition.Champs)
    {
        if (!saisie.TryGetValue(champ.Nom, out var v) || string.IsNullOrEmpty(v)) continue;
        champs[champ.Nom] = champ.Type switch
        {
            ChampType.Nombre or ChampType.Montant => Json.LireNombre(v) is double n ? n : v,
            ChampType.Booleen => v is "true" or "on",
            _ => v,
        };
    }
    try
    {
        await client.CompleterTacheAsync(id, c.Utilisateur,
            new Completion { Champs = champs, Decision = string.IsNullOrEmpty(decision) ? null : decision });
        return Results.Redirect(Lien("/", c.Utilisateur) + "&fait=1");
    }
    catch (ApiException ex)
    {
        return await Taches.Rendre(c, client, id, ErreursPasserelle.Bandeau(ex), valeurs, ErreursPasserelle.ParChamp(ex));
    }
});

// ───────────────────────── Dossiers en post-investissement ─────────────────────────
app.MapGet("/dossiers", async (HttpContext http, IPasserelleClient client) =>
    Results.Content(await Dossiers.Rendre(await Ecran.Creer(http), client, ""), "text/html; charset=utf-8"));

app.MapPost("/dossiers/{id}/tirage", async (HttpContext http, string id, IPasserelleClient client) =>
{
    var c = await Ecran.Creer(http);
    var form = await http.Request.ReadFormAsync();
    var montantSaisi = form["montant"].ToString();
    var motif = form["motif"].ToString();
    var donnees = new Dictionary<string, object> { ["montant"] = Json.LireNombre(montantSaisi) is double n ? n : montantSaisi, ["motif"] = motif };
    var evenementId = Guid.NewGuid().ToString();
    string message;
    try
    {
        var r = await client.EmettreEvenementAsync(id, c.Utilisateur, TypeEvenement.DemandeTirage, new Evenement { EvenementId = evenementId, Donnees = donnees });
        message = Msg(true, r.Doublon
            ? $"Événement déjà reçu (doublon) — <code>{E(evenementId)}</code>."
            : $"Demande de tirage transmise au backbone pour <strong>{E(id)}</strong> — evenementId <code>{E(evenementId)}</code>.");
    }
    catch (ApiException ex)
    {
        message = ErreursPasserelle.Bandeau(ex);
    }
    return Results.Content(await Dossiers.Rendre(c, client, message), "text/html; charset=utf-8");
});

// ───────────────────────── Audit du dossier ─────────────────────────
app.MapGet("/dossiers/{id}/audit", async (HttpContext http, string id, IPasserelleClient client) =>
{
    var c = await Ecran.Creer(http);
    DossierDetaille dossier;
    try { dossier = await client.LireDossierAsync(id); }
    catch (ApiException ex) when (ex.StatusCode == 404)
    {
        return Results.Content(c.Rendre("Audit", ErreursPasserelle.Bandeau(ex)), "text/html; charset=utf-8", statusCode: 404);
    }
    var verification = await client.VerifierAuditAsync();
    return Results.Content(c.Rendre($"Audit {id}", Audit.Rendre(c, dossier, verification)), "text/html; charset=utf-8");
});

// ───────────────────────── Webhook du backbone ─────────────────────────
// Le backbone notifie les nouvelles tâches ; la boîte de tâches reste la source (GET /taches).
app.MapPost("/webhooks/taches", async (HttpContext http, Notifications notifs) =>
{
    if (http.Request.Headers.Authorization.ToString() != $"Bearer {options.Jeton}") return Results.Unauthorized();
    Notification? n = null;
    try { n = await JsonSerializer.DeserializeAsync<Notification>(http.Request.Body, Json.Options); }
    catch (JsonException) { /* corps illisible : la notification est tout de même comptée */ }
    notifs.Ajouter((n ?? new Notification()) with { RecuLe = DateTimeOffset.UtcNow });
    return Results.NoContent();
});

app.Run();

// ═════════════════════════ Types et écrans ═════════════════════════

public sealed class OptionsApp
{
    public string Nom { get; set; } = "Déboursé";
    public string Couleur { get; set; } = "#7a3e9d";
    public string UrlEcoute { get; set; } = "http://localhost:4103";
    public string UrlPasserelle { get; set; } = "http://localhost:4000";
    public string Jeton { get; set; } = "demo-jeton-debourse";
    public string UtilisateurParDefaut { get; set; } = "hugo";
}

/// <summary>Personnes de l'organisation (GET /organisation/personnes), chargées une fois.</summary>
public sealed class Annuaire(IPasserelleClient client)
{
    private IReadOnlyList<Personne>? _personnes;
    public async Task<IReadOnlyList<Personne>> Personnes()
    {
        if (_personnes is { Count: > 0 }) return _personnes;
        try { _personnes = (await client.ListerPersonnesAsync()).ToList(); }
        catch (Exception ex) when (ex is HttpRequestException or ApiException or TaskCanceledException) { return []; }
        return _personnes;
    }
}

public sealed record Notification
{
    public string? TacheId { get; init; }
    public string? TypeTache { get; init; }
    public string? DossierId { get; init; }
    public DateTimeOffset RecuLe { get; init; }
}

public sealed class Notifications
{
    private readonly ConcurrentQueue<Notification> _file = new();
    public int Nombre => _file.Count;
    public void Ajouter(Notification n) => _file.Enqueue(n);
    public IReadOnlyList<Notification> Dernieres(int n) => _file.Reverse().Take(n).ToList();
}

/// <summary>Contexte d'un écran : utilisateur courant (?u=), personnes, gabarit.</summary>
public sealed class Ecran
{
    public required string Utilisateur { get; init; }
    public required IReadOnlyList<Personne> Personnes { get; init; }
    public required OptionsApp Options { get; init; }

    public static async Task<Ecran> Creer(HttpContext http)
    {
        var o = http.RequestServices.GetRequiredService<OptionsApp>();
        var u = http.Request.Query["u"].ToString();
        return new Ecran
        {
            Utilisateur = string.IsNullOrWhiteSpace(u) ? o.UtilisateurParDefaut : u,
            Personnes = await http.RequestServices.GetRequiredService<Annuaire>().Personnes(),
            Options = o,
        };
    }

    public Personne? Courant => Personnes.FirstOrDefault(p => p.Id == Utilisateur);

    public string Rendre(string titre, string corps, string? message = null) =>
        Page($"{titre} — {Options.Nom}", Options.Nom, Options.Couleur, Utilisateur, Personnes, corps, message);
}

public static class Json
{
    public static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web);

    /// <summary>Les objets libres du contrat (contexte, details) arrivent en JsonElement.</summary>
    public static Dictionary<string, JsonElement> Objet(object? o) => o switch
    {
        JsonElement { ValueKind: JsonValueKind.Object } j => j.EnumerateObject().ToDictionary(p => p.Name, p => p.Value),
        _ => [],
    };

    public static string Champ(Dictionary<string, JsonElement> o, string cle) => o.TryGetValue(cle, out var v) ? Html.Texte(v) : "";

    public static double? Nombre(Dictionary<string, JsonElement> o, string cle) =>
        o.TryGetValue(cle, out var v) && v.ValueKind == JsonValueKind.Number ? v.GetDouble() : null;

    /// <summary>Accepte « 24000000 », « 24 000 000 » ou « 24 000 000,50 ».</summary>
    public static double? LireNombre(string? s)
    {
        if (string.IsNullOrWhiteSpace(s)) return null;
        var t = s.Replace(" ", "").Replace(" ", "").Replace(" ", "").Replace(',', '.');
        return double.TryParse(t, NumberStyles.Float, CultureInfo.InvariantCulture, out var d) ? d : null;
    }

    public static string Indente(object? o) => o is JsonElement j
        ? JsonSerializer.Serialize(j, new JsonSerializerOptions { WriteIndented = true, Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping })
        : "";
}

/// <summary>Lecture des erreurs métier de la passerelle (schéma Erreur du contrat).</summary>
public static class ErreursPasserelle
{
    public static Erreur Lire(ApiException ex)
    {
        if (ex is ApiException<Erreur> { Result: not null } typee) return typee.Result;
        // Réponses non décrites pour l'opération (ex. 403 sur le dépôt) : on lit tout de même le corps.
        try
        {
            var e = JsonSerializer.Deserialize<Erreur>(ex.Response ?? "", Json.Options);
            if (e is not null && !string.IsNullOrEmpty(e.Code)) return e;
        }
        catch (JsonException) { }
        return new Erreur { Code = $"HTTP_{ex.StatusCode}", Message = string.IsNullOrWhiteSpace(ex.Response) ? ex.Message : ex.Response };
    }

    /// <summary>Bandeau rouge : statut + code + message, puis la liste des erreurs par champ (422).</summary>
    public static string Bandeau(ApiException ex)
    {
        var e = Lire(ex);
        var intro = ex.StatusCode switch
        {
            403 => "Refus de sécurité — la tentative est consignée dans la piste d'audit et visible dans le BPMN.",
            422 => "Données refusées par la passerelle — corrigez les champs ci-dessous, votre saisie est conservée.",
            409 => "Conflit — l'état de la tâche a changé.",
            _ => "",
        };
        var liste = e.Erreurs is { Count: > 0 }
            ? $"<ul>{string.Concat(e.Erreurs.Select(x => $"<li>{(string.IsNullOrEmpty(x.Champ) ? "" : $"<code>{E(x.Champ)}</code> : ")}{E(x.Erreur)}</li>"))}</ul>"
            : "";
        return Msg(false, $"<strong>{ex.StatusCode} {E(e.Code)}</strong> — {E(e.Message)}{(intro.Length > 0 ? $"<br><span class=\"doux\">{E(intro)}</span>" : "")}{liste}");
    }

    public static Dictionary<string, List<string>> ParChamp(ApiException ex) =>
        (Lire(ex).Erreurs ?? []).Where(x => !string.IsNullOrEmpty(x.Champ))
            .GroupBy(x => x.Champ!)
            .ToDictionary(g => g.Key, g => g.Select(x => x.Erreur ?? "").ToList());
}

public static class Taches
{
    private static readonly string[] ClesContexte = ["dossierId", "nom", "contrepartie", "classeActif", "montant", "secteur", "phase", "instanceApprobation", "montantTirage"];

    public static async Task<IResult> Rendre(Ecran c, IPasserelleClient client, Guid id, string message,
        Dictionary<string, string?> valeurs, Dictionary<string, List<string>> erreurs)
    {
        TacheDetaillee t;
        try { t = await client.LireTacheAsync(id); }
        catch (ApiException ex)
        {
            return Results.Content(c.Rendre("Tâche", $"<p><a href=\"{E(Lien("/", c.Utilisateur))}\">← Mes tâches</a></p>{ErreursPasserelle.Bandeau(ex)}"), "text/html; charset=utf-8");
        }
        var def = t.Definition;
        var ctx = Json.Objet(t.Contexte);
        // Contexte : dossier puis contexte de la tâche (qui l'emporte), filtré sur les clés utiles.
        var infos = new Dictionary<string, string>();
        if (t.Dossier is { } d)
        {
            infos["dossierId"] = d.DossierId; infos["nom"] = d.Nom; infos["contrepartie"] = d.Contrepartie;
            infos["classeActif"] = d.ClasseActif; infos["montant"] = d.Montant.ToString("#,##0 $", FrCa); infos["secteur"] = d.Secteur; infos["phase"] = d.Phase;
        }
        foreach (var (k, v) in ctx) if (ClesContexte.Contains(k)) infos[k] = k is "montant" or "montantTirage" && v.ValueKind == JsonValueKind.Number ? v.GetDouble().ToString("#,##0 $", FrCa) : Html.Texte(v);
        var grille = string.Concat(ClesContexte.Where(infos.ContainsKey).Select(k => $"<div><span class=\"doux\">{E(k)}</span><br><strong>{E(infos[k])}</strong></div>"));

        var peutAgir = t.Statut != TacheStatut.Ouverte || t.Candidats.Any(p => p.Id == c.Utilisateur);
        var avertissement = peutAgir ? "" :
            $"<p class=\"ko\"><strong>Attention :</strong> vous agissez en tant que {E(c.Courant?.Nom ?? c.Utilisateur)}, qui ne détient pas le rôle « {E(t.RoleRequis)} ». La passerelle refusera la complétion (403) et le refus sera consigné et visible dans le BPMN.</p>";
        var candidats = t.Candidats.Count > 0 ? string.Join(", ", t.Candidats.Select(p => $"{E(p.Nom)} <span class=\"doux\">({E(p.Id)})</span>")) : "<span class=\"ko\">aucune</span>";
        var enRetard = t.Statut == TacheStatut.Ouverte && t.Echeance < DateTimeOffset.Now;

        var fermee = t.Statut != TacheStatut.Ouverte;
        var actionDepot = Lien($"/taches/{id}/documents", c.Utilisateur);
        var corps = $"""
<p><a href="{E(Lien("/", c.Utilisateur))}">← Mes tâches</a> · <a href="{E(Lien($"/dossiers/{t.DossierId}/audit", c.Utilisateur))}">Audit du dossier {E(t.DossierId)}</a></p>
<div class="carte"><h2>{E(def.Titre)} <span class="etiquette">{E(t.TypeTache)}</span></h2><div class="grille">{grille}</div>
<p class="doux">Rôle requis : <strong>{E(t.RoleRequis)}</strong> — personnes habilitées : {candidats}.<br>
Ouverte le {E(Date(t.OuverteLe))} · échéance <span class="{(enRetard ? "ko" : "")}">{E(Date(t.Echeance))}{(enRetard ? " (dépassée)" : "")}</span> (SLA {E(def.DelaiSla)}){(t.Escalades > 0 ? $" · <span class=\"attention\">{t.Escalades} escalade(s)</span>" : "")}{(t.Refus > 0 ? $" · <span class=\"ko\">{t.Refus} refus</span>" : "")}</p>
{avertissement}</div>
{(fermee
    ? Msg(true, $"Tâche complétée par {E(t.CompleteePar)} le {E(Date(t.CompleteeLe))}.") + $"<div class=\"carte\"><h2>Pièces déposées</h2>{RendreDepots(def, t.Documents, actionDepot, erreurs).Replace("<button class=\"second\" type=\"submit\">", "<button class=\"second\" type=\"submit\" disabled>")}</div>"
    : $"""
<div class="carte"><h2>Pièces justificatives</h2>{RendreDepots(def, t.Documents, actionDepot, erreurs)}</div>
<div class="carte"><h2>Saisie</h2><form method="post" action="{E(Lien($"/taches/{id}/completer", c.Utilisateur))}">{RendreChamps(def, valeurs, erreurs)}
<p style="display:flex;gap:8px;flex-wrap:wrap;margin-top:16px"><button type="submit">Compléter</button>
<a href="{E(Lien($"/taches/{id}?prerempli=1", c.Utilisateur))}"><button class="second" type="button">Pré-remplir (simulation)</button></a></p></form></div>
""")}
""";
        return Results.Content(c.Rendre(def.Titre, corps, message), "text/html; charset=utf-8");
    }
}

public static class Dossiers
{
    public const string PhaseSuivi = "suivi-periodique";

    public static async Task<string> Rendre(Ecran c, IPasserelleClient client, string message)
    {
        var tous = (await client.ListerDossiersAsync()).OrderByDescending(d => d.DossierId).ToList();
        var suivi = tous.Where(d => d.Phase == PhaseSuivi).ToList();
        var lignesSuivi = string.Concat(suivi.Select(d => $"""
<tr><td><a href="{E(Lien($"/dossiers/{d.DossierId}/audit", c.Utilisateur))}"><strong>{E(d.DossierId)}</strong></a><br>{E(d.Nom)}<br><span class="doux">{E(d.Contrepartie)} · {E(d.ClasseActif)}</span></td>
<td>{E(d.Montant.ToString("#,##0 $", FrCa))}</td>
<td><form method="post" action="{E(Lien($"/dossiers/{d.DossierId}/tirage", c.Utilisateur))}" class="grille" style="grid-template-columns:repeat(auto-fit,minmax(140px,1fr));align-items:end">
<div><label for="m_{E(d.DossierId)}" style="margin-top:0">Montant ($)</label><input id="m_{E(d.DossierId)}" name="montant" type="number" step="any" min="0" required value="{E(Math.Round(d.Montant * 0.1).ToString(CultureInfo.InvariantCulture))}"></div>
<div><label for="mo_{E(d.DossierId)}" style="margin-top:0">Motif</label><input id="mo_{E(d.DossierId)}" name="motif" required value="Financement des dépenses en capital"></div>
<div><button type="submit">Demander un tirage</button></div></form></td></tr>
"""));
        var lignesTous = string.Concat(tous.Select(d => $"""
<tr><td><a href="{E(Lien($"/dossiers/{d.DossierId}/audit", c.Utilisateur))}">{E(d.DossierId)}</a></td><td>{E(d.Nom)}</td><td><span class="etiquette">{E(d.Phase)}</span></td><td>{E(d.Statut.ToString().ToLowerInvariant())}</td><td>{E(Date(d.CreeLe))}</td></tr>
"""));
        var corps = $"""
<div class="carte"><h2>Dossiers en post-investissement ({suivi.Count})</h2>
<p class="doux">Phase « {PhaseSuivi} ». « Demander un tirage » émet l'événement métier <code>demande-tirage</code> (POST /dossiers/&#123;id&#125;/evenements/demande-tirage) avec un evenementId unique : la passerelle est idempotente sur cet identifiant.</p>
{(suivi.Count > 0
    ? $"<div class=\"defile\"><table><thead><tr><th>Dossier</th><th>Engagement</th><th>Nouveau tirage</th></tr></thead><tbody>{lignesSuivi}</tbody></table></div>"
    : "<p class=\"doux\">Aucun dossier en suivi périodique pour l'instant.</p>")}
</div>
<div class="carte"><h2>Tous les dossiers ({tous.Count})</h2>
{(tous.Count > 0
    ? $"<div class=\"defile\"><table><thead><tr><th>Dossier</th><th>Nom</th><th>Phase</th><th>Statut</th><th>Créé le</th></tr></thead><tbody>{lignesTous}</tbody></table></div>"
    : "<p class=\"doux\">Aucun dossier.</p>")}
<p class="doux">Cliquez sur un dossier pour consulter sa piste d'audit.</p></div>
""";
        return c.Rendre("Dossiers en post-investissement", corps, message);
    }
}

public static class Audit
{
    private static string ClasseAction(string action) => action switch
    {
        "tache.refusee" => "a-refus",
        _ when action.StartsWith("document.") => "a-document",
        _ when action.StartsWith("tache.") => "a-tache",
        _ when action.StartsWith("dossier.") => "a-dossier",
        _ when action.StartsWith("paiement.") => "a-paiement",
        _ => "",
    };

    public static string Rendre(Ecran c, DossierDetaille d, Response3 v)
    {
        var entrees = d.Audit.OrderBy(a => a.Seq).ToList();
        var titres = d.Taches.ToDictionary(t => t.TacheId, t => t.Titre ?? t.TypeTache);
        var acteurs = entrees.Select(a => a.Acteur).Distinct().Count();
        var depots = entrees.Count(a => a.Document is not null);
        var refus = entrees.Count(a => a.Action == "tache.refusee");

        var sceau = v.Valide
            ? $"<div class=\"sceau ok\"><div class=\"icone ok\">✔</div><div><strong class=\"ok\">Chaîne d'audit intègre</strong><br><span class=\"doux\">GET /audit/verification : {v.Entrees} entrées chaînées (toutes applications), chaque empreinte inclut la précédente. Dernier hash <code>{E(Hash(v.DernierHash, 16))}</code></span></div></div>"
            : $"<div class=\"sceau ko\"><div class=\"icone ko\">✖</div><div><strong class=\"ko\">Chaîne d'audit ROMPUE</strong>{(v.RompueA is int r ? $" à l'entrée n° {r}" : "")}<br><span class=\"doux\">GET /audit/verification : {v.Entrees} entrées vérifiées. Dernier hash <code>{E(Hash(v.DernierHash, 16))}</code>. Toute entrée à partir de ce rang doit être considérée comme non fiable.</span></div></div>";

        var lignes = new StringBuilder();
        foreach (var a in entrees)
        {
            var details = Json.Objet(a.Details);
            var tache = a.TacheId is not null && titres.TryGetValue(a.TacheId, out var ti) ? ti : Json.Champ(details, "typeTache");
            var doc = a.Document is { } dc
                ? $"<a href=\"{E(dc.Url)}\" target=\"_blank\" rel=\"noopener\">{E(dc.Nom)}</a>"
                : "<span class=\"doux\">—</span>";
            var sha = a.Document?.Sha256 is { } s ? $"<code title=\"{E(s)}\">{E(Hash(s))}</code>" : "<span class=\"doux\">—</span>";
            var rompue = v.RompueA is int rr && a.Seq >= rr;
            var detailsHtml = details.Count > 0 ? $"<details><summary>détails</summary><pre class=\"mono\">{E(Json.Indente(a.Details))}</pre></details>" : "";
            lignes.Append($"""
<tr class="{(a.Action == "tache.refusee" ? "refus" : "")}{(rompue ? " refus" : "")}">
<td class="mono">{a.Seq}</td>
<td class="mono" style="white-space:nowrap">{E(DateSec(a.Horodatage))}</td>
<td><strong>{E(a.Acteur)}</strong></td>
<td>{E(a.Application)}</td>
<td><span class="action {ClasseAction(a.Action)}">{E(a.Action)}</span>{(string.IsNullOrEmpty(tache) ? "" : $"<br><span class=\"doux\">{E(tache)}</span>")}{detailsHtml}</td>
<td>{doc}</td>
<td>{sha}</td>
<td class="chaine mono" title="précédent {E(a.HashPrecedent)} → {E(a.Hash)}">{E(Hash(a.Hash, 10))}<br>↑ {E(Hash(a.HashPrecedent, 10))}</td>
</tr>
""");
        }

        var docs = string.Concat(d.Documents.Select(x => $"""
<tr><td><a href="{E(x.Url)}" target="_blank" rel="noopener">{E(x.Nom)}</a></td><td><code>{E(x.Type)}</code></td><td>{E(x.DeposePar)}</td><td class="mono">{E(Date(x.DeposeLe))}</td><td><code title="{E(x.Sha256)}">{E(Hash(x.Sha256, 16))}</code></td></tr>
"""));

        var periode = entrees.Count > 0 ? $"{DateSec(entrees[0].Horodatage)} → {DateSec(entrees[^1].Horodatage)}" : "—";
        return $"""
<p><a href="{E(Lien("/dossiers", c.Utilisateur))}">← Dossiers</a></p>
<div class="carte"><h2>Audit du dossier {E(d.DossierId)} <span class="etiquette">{E(d.Phase)}</span> <span class="etiquette">{E(d.Statut.ToString().ToLowerInvariant())}</span></h2>
<div class="grille">
<div><span class="doux">Nom</span><br><strong>{E(d.Nom)}</strong></div>
<div><span class="doux">Contrepartie</span><br><strong>{E(d.Contrepartie)}</strong></div>
<div><span class="doux">Classe d'actif / secteur</span><br><strong>{E(d.ClasseActif)}</strong> · {E(d.Secteur)}</div>
<div><span class="doux">Montant</span><br><strong>{E(d.Montant.ToString("#,##0 $", FrCa))}</strong></div>
<div><span class="doux">Créé par</span><br><strong>{E(d.CreePar)}</strong> le {E(Date(d.CreeLe))}</div>
<div><span class="doux">Documents (SharePoint)</span><br>{(string.IsNullOrEmpty(d.UrlDocuments) ? "—" : $"<a href=\"{E(d.UrlDocuments)}\" target=\"_blank\" rel=\"noopener\">Ouvrir le dossier</a>")}</div>
</div></div>
{sceau}
<div class="stats">
<div class="stat"><b>{entrees.Count}</b><span>entrées pour ce dossier</span></div>
<div class="stat"><b>{acteurs}</b><span>acteurs distincts</span></div>
<div class="stat"><b>{depots}</b><span>pièces déposées (empreinte sha256)</span></div>
<div class="stat"><b class="{(refus > 0 ? "ko" : "")}">{refus}</b><span>tentatives refusées</span></div>
</div>
<div class="carte"><h2>Piste d'audit</h2>
<p class="doux">Période : {E(periode)}. Numérotation globale (seq) : les trous correspondent aux entrées d'autres dossiers dans la même chaîne. Colonne « Chaîne » : empreinte de l'entrée et, dessous, celle de l'entrée précédente qu'elle scelle.</p>
{(entrees.Count > 0
    ? $"<div class=\"defile\"><table><thead><tr><th>Seq</th><th>Horodatage</th><th>Acteur</th><th>Application</th><th>Action</th><th>Document</th><th>sha256</th><th>Chaîne</th></tr></thead><tbody>{lignes}</tbody></table></div>"
    : "<p class=\"doux\">Aucune entrée d'audit.</p>")}
</div>
<div class="carte"><h2>Pièces du dossier ({d.Documents.Count})</h2>
{(d.Documents.Count > 0
    ? $"<div class=\"defile\"><table><thead><tr><th>Pièce</th><th>Type</th><th>Déposée par</th><th>Le</th><th>sha256</th></tr></thead><tbody>{docs}</tbody></table></div>"
    : "<p class=\"doux\">Aucune pièce.</p>")}
</div>
""";
    }
}

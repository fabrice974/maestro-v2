using System.Globalization;

namespace Debourse;

/// <summary>
/// Valeurs plausibles pour le bouton « Pré-remplir (simulation) », reprises des cas debourse.* de
/// packages/commun/src/simulation.ts. Aucune règle d'affaires ici : la passerelle valide tout.
/// </summary>
public static class Simulation
{
    private static string Jour(int decalage = 0) => DateTime.Today.AddDays(decalage).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);

    public static Dictionary<string, string?> Reponse(string typeTache, double? montantDossier)
    {
        var montant = montantDossier is > 0 ? montantDossier.Value : 40_000_000;
        return typeTache switch
        {
            "debourse.demande" => new()
            {
                ["montantTirage"] = Math.Round(montant * 0.6).ToString(CultureInfo.InvariantCulture),
                ["dateValeur"] = Jour(5),
                ["compteBeneficiaire"] = "CA-0000-FICTIF-001",
            },
            "debourse.conditions-prealables" => new()
            {
                ["cpOpinionJuridique"] = "true",
                ["cpAssurances"] = "true",
                ["cpGaranties"] = "true",
                ["dateValiditeCertificat"] = Jour(60),
            },
            "debourse.kyc" => new() { ["dateVerification"] = Jour(), ["decision"] = "conforme" },
            "debourse.preparer-instruction" => new()
            {
                ["referencePaiement"] = "INSTR-" + DateTimeOffset.UtcNow.ToUnixTimeMilliseconds().ToString("X", CultureInfo.InvariantCulture),
            },
            "debourse.approuver" or "debourse.approuver-conformite" => new() { ["decision"] = "approuve" },
            _ => new(),
        };
    }
}

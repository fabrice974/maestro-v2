# Déboursé (.NET)

Application de sous-processus « Déboursé », écrite en ASP.NET Core (.NET 10, minimal API, HTML rendu
côté serveur). Elle prouve qu'une équipe .NET se branche sur le backbone avec le seul contrat
`contrats/openapi.yaml`.

## Lancer

Prérequis : SDK .NET 10 et la passerelle démarrée sur http://localhost:4000.

```sh
dotnet run --project apps/debourse-dotnet
```

L'application écoute sur http://localhost:4103 (utilisateur par défaut : `hugo`, à changer avec le
sélecteur « Agir en tant que »). Configuration dans `appsettings.json`, section `Debourse` (URL de la
passerelle, jeton `demo-jeton-debourse`, utilisateur par défaut).

Écrans : boîte de tâches (`/`), tâche (`/taches/{id}`), dossiers en post-investissement
(`/dossiers`, événement `demande-tirage`), audit d'un dossier (`/dossiers/{id}/audit`).
Webhook du backbone : `POST /webhooks/taches` (exige `Authorization: Bearer demo-jeton-debourse`).

## Régénérer le client de la passerelle

Le client C# `Passerelle/PasserelleClient.g.cs` est généré par NSwag à partir de
`../../contrats/openapi.yaml` (configuration : `nswag.json`) et **commité** : la compilation ne
demande ni NSwag ni accès réseau. Après une modification du contrat :

```sh
cd apps/debourse-dotnet
dotnet tool restore
dotnet nswag run nswag.json
```

Choix de génération : `System.Text.Json` (aucun paquet NuGet), `HttpClient` injecté (l'adresse et le
jeton sont posés par `Program.cs`), types optionnels nullables. Les erreurs 403/409/422 arrivent en
`ApiException<Erreur>` ; une réponse non décrite pour une opération (ex. 403 sur le dépôt de pièce)
est relue depuis le corps brut.

## Pourquoi aucune dépendance Camunda

- L'application ne connaît que des dossiers, des tâches, des documents et des événements métier :
  c'est le contrat de la passerelle, pas le BPMN.
- La passerelle est le seul client Camunda ; elle applique sécurité, séparation des tâches et audit
  avant d'informer le moteur.
- Changer de moteur (ou de version du BPMN) ne touche donc pas cette application, tant que le contrat
  OpenAPI tient.

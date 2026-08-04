# API-Football — mode shadow

Intégration progressive du fournisseur API-Football pour enrichir les matchs
du club suivi. **Cette branche active uniquement le mode shadow** : appels et
stockage autorisés, aperçu admin uniquement, aucune modification automatique
des matchs / résultats officiels.

La bascule publique est réservée à une branche ultérieure
`feature/api-football-cutover`.

## Prérequis

- Migrations `20260804190000` et `20260804191000` appliquées.
- Modèle de saison déjà en place (`seasons`, `matches.season_id`).
- Ancien connecteur `sync-fc-nantes` **conservé** comme repli.

## Secrets Supabase (Edge Functions)

Ne jamais committer de vraie clé.

```bash
# Clé API-Football (dashboard API-Sports)
supabase secrets set API_FOOTBALL_KEY=your_key_here

# Secret partagé cron ↔ Edge (valeur aléatoire longue)
supabase secrets set API_FOOTBALL_CRON_SECRET=your_cron_secret_here
```

Aucun `VITE_*` ne doit contenir ces secrets.

## Configuration sans hardcode de championnat

L’intégration **ne code pas en dur** la Ligue 1 ni `league_id = 61`.

1. Dans l’admin → onglet **API-Football**, lancer **Vérifier via API** avec un
   nom d’équipe (ex. `Nantes`).
2. L’Edge Function découvre l’identifiant d’équipe et les compétitions
   réellement disputées (championnat + coupes).
3. Les couples compétition / saison sont stockés dans
   `provider_competitions` avec leur couverture.
4. Tu peux changer d’équipe ou de division **sans migration**.

## Feature flags (branche shadow)

| Flag | Valeur | Modifiable admin |
| --- | --- | --- |
| `shadow_enabled` | `true` | Non (forcé) |
| `public_provider_enabled` | `false` | **Non** (CHECK SQL + pas de RPC) |
| `integration_enabled` | `true` par défaut | Oui |

L’UI admin affiche en lecture seule :

> Activation publique indisponible en mode shadow

## Déploiement progressif

1. Appliquer les migrations.
2. Configurer les secrets.
3. Déployer l’Edge Function `sync-api-football`.
4. (Optionnel) Installer le cron d’exemple
   [`schedule_api_football_tick.example.sql`](../supabase/schedule_api_football_tick.example.sql)
   avec secrets Vault `project_url`, `function_anon_key`,
   `api_football_cron_secret`.
5. Découvrir l’équipe + vérifier la couverture réelle.
6. Observer plusieurs matchs en shadow (admin uniquement).
7. **Plus tard** : `feature/api-football-cutover` pour l’activation publique.

## Synchronisation manuelle

Admin → API-Football → **Synchroniser (shadow)**.

Respecte le quota atomique, l’anti-spam serveur (cooldown 30 s) et n’écrit
**pas** dans les scores officiels.

## Quota

- Compteur journalier UTC.
- Réserve bloquante de 10 appels.
- Réservation transactionnelle (`provider_reserve_api_call`) avant chaque
  appel externe.
- Restitution (`released`) / échec tracé (`failed`) via
  `provider_finalize_api_call`.

## Repli manuel

- Fixture Download (`sync-fc-nantes`) reste disponible.
- Saisie / correction manuelle des résultats reste prioritaire
  (`official_result_source = manual`, `manual_override`).
- Désactiver l’intégration via le bouton admin **Désactiver l’intégration**.

## Tests

- Node (fixtures JSON locales) : `npm test`
- SQL isolé : `npm run test:sql:local`  
  (`a-la-nantaise-test`, API `55321`, DB `55322`) — ne touche pas la stack
  de développement.

Aucun test automatisé n’appelle la véritable API.

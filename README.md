# À la Nantaise

Webapp responsive de pronostics amicaux sur les matchs du FC Nantes (Ligue 2).

Accès par **code commun** (pas de compte, pas d’e-mail). Données hébergées sur Supabase (PostgreSQL + RPC). Pas d’Auth Supabase. Calendrier FC Nantes synchronisable depuis Fixture Download (pas d’API-Football).

## Stack

- React + TypeScript + Vite + Tailwind CSS
- React Router + Lucide React
- `@supabase/supabase-js` (clé **anon** uniquement côté client)
- Supabase Edge Function `sync-fc-nantes` (appel serveur du flux public)
- npm (voir `package-lock.json` ; Node `>=22.12.0`, fichier `.nvmrc`)

## Commandes

```bash
npm ci          # install figé (CI / prod)
npm install     # développement local
npm run dev
npm run build
npm run preview
npm run lint
npm test
```

## Variables d’environnement

### Frontend (seules variables injectées dans le navigateur)

| Variable | Rôle |
|---|---|
| `VITE_SUPABASE_URL` | URL publique du projet Supabase |
| `VITE_SUPABASE_ANON_KEY` | Clé **anon** / publique JWT |

Modèle : `.env.example` (placeholders uniquement). Copie vers `.env` en local.

**Règles :**

- Seules les variables préfixées `VITE_*` entrent dans le bundle frontend.
- N’utilise **jamais** la clé `service_role` dans le frontend, Vault Cron côté client, ni `.env` versionné.
- Ne committe jamais de valeurs réelles.

### Vault Supabase (serveur uniquement, jamais dans le frontend)

| Secret Vault | Rôle |
|---|---|
| `project_url` | URL du projet (`https://<ref>.supabase.co`) pour l’appel Cron |
| `function_anon_key` | Clé **anon** JWT pour invoquer l’Edge Function (pas `service_role`) |
| `fixture_sync_admin_code` | Code administrateur de l’app, lu uniquement côté serveur |

Les Edge Functions reçoivent automatiquement `SUPABASE_URL` et `SUPABASE_ANON_KEY` (anon) dans l’environnement Supabase.

## Configuration locale

1. Copie `.env.example` vers `.env`
2. Renseigne `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (anon uniquement) et, pour les rappels, `VITE_VAPID_PUBLIC_KEY`

## Mise en place Supabase

### 1. Créer le projet

Crée un projet sur [supabase.com](https://supabase.com), puis récupère l’URL et la clé anon dans **Project Settings → API**.

### 2. Exécuter les migrations (manuellement)

Dans le **SQL Editor**, exécute **dans l’ordre** (ne pas appliquer automatiquement depuis un agent) :

1. `supabase/migrations/20260803100000_init.sql`
2. `supabase/migrations/20260803120000_fix_upsert_prediction_ambiguity.sql`
3. `supabase/migrations/20260803130000_admin_rpcs.sql`
4. `supabase/migrations/20260803140000_fixture_download_sync.sql`
5. `supabase/migrations/20260803150000_match_list_order.sql`
6. `supabase/migrations/20260803160000_admin_update_access_code.sql`
7. `supabase/migrations/20260803170000_web_push.sql` (rappels Web Push ; envois désactivés par défaut)
8. `supabase/migrations/20260803171000_harden_web_push_before_smoke_tests.sql` (preview dry-run, reclaim, privilèges)

La migration sync ajoute les champs `source`, `last_synced_at`, `manual_override`, l’unicité `(source, external_id)`, et les RPC de commit / levée d’override. **Aucune donnée existante n’est supprimée.**

La migration `admin_update_access_code` permet de remplacer le hash du code commun depuis `/admin` → Réglages (le code admin n’est pas modifié).

### 3. Charger les données de test (optionnel, environnement de démo uniquement)
Exécute ensuite :

`supabase/seed.sql`

En production, après nettoyage des données de démo, les participants et pronostics réels peuvent exister : **ne pas** exiger « 1 participant » ou « 0 pronostic » comme critère de santé.

### 4. Définir le hash du code commun

**Ne versionne jamais le code en clair.** Dans le SQL Editor, exécute (en remplaçant `TON_CODE_ICI`) :

```sql
UPDATE public.app_settings
SET
  value = extensions.crypt('TON_CODE_ICI', extensions.gen_salt('bf')),
  updated_at = now()
WHERE key = 'access_code_hash';
```

Un modèle est aussi fourni dans `supabase/set_access_code.example.sql`.

### 5. Définir le hash du code administrateur

Après la migration admin (`20260803130000_admin_rpcs.sql`) :

```sql
UPDATE public.app_settings
SET
  value = extensions.crypt('TON_CODE_ADMIN', extensions.gen_salt('bf')),
  updated_at = now()
WHERE key = 'admin_code_hash';
```

Voir `supabase/set_admin_code.example.sql`. L’écran `/admin` est accessible via Paramètres → Administration.

### Modifier le code d’accès commun (administration)

Depuis `/admin` → **Réglages** → **Code d’accès du groupe** :

1. Saisir deux fois le nouveau code (4–64 caractères).
2. Confirmer : l’ancien code cesse **immédiatement** de fonctionner.
3. Les participants qui avaient l’ancien code en session locale sont renvoyés à l’écran d’accès à leur prochaine action RPC (ou au prochain chargement).
4. Le code administrateur reste inchangé.

Le code actuel n’est jamais affiché (seul `access_code_hash` est stocké).

**Ordre de déploiement** pour cette fonctionnalité :

1. Appliquer `20260803160000_admin_update_access_code.sql` dans le SQL Editor
2. Déployer le frontend
3. Tester : ancien code refusé, nouveau code accepté, admin toujours valide

### 6. Déployer l’Edge Function

```bash
supabase functions deploy sync-fc-nantes
```

Aucun secret externe n’est requis pour Fixture Download. Les variables `SUPABASE_URL` et `SUPABASE_ANON_KEY` sont injectées automatiquement dans la fonction. Le code admin est vérifié **avant** tout téléchargement du flux.

### 7. Vérifier

```sql
SELECT public.verify_access_code('TON_CODE_ICI'); -- doit renvoyer true
SELECT public.verify_admin_code('TON_CODE_ADMIN'); -- doit renvoyer true
```

## Synchronisation Fixture Download

- **Source** : `https://fixturedownload.com/feed/json/ligue-2-2026/fc-nantes`
- **Fréquence annoncée** : mise à jour quotidienne du calendrier / résultats (selon Fixture Download)
- **Schéma** : non garanti — validation stricte côté Edge Function (34 matchs, journées 1–34 uniques, FC Nantes présent, scores cohérents). Un flux incohérent est **entièrement refusé**.
- **Secours** : la saisie manuelle dans `/admin` reste disponible. Une modification manuelle protège le match (`manual_override`) jusqu’à action explicite « Remettre sous sync ».
- **Identifiants** : `fixturedownload:ligue-2-2026:<MatchNumber>`

### Test manuel

1. Appliquer la migration `20260803140000_fixture_download_sync.sql` dans le SQL Editor
2. Déployer `sync-fc-nantes`
3. Ouvrir `/admin` → onglet Matchs
4. Cliquer **Synchroniser les matchs**
5. Vérifier le résumé (créés / mis à jour / inchangés / protégés) et les pastilles Synchronisé / Modifié manuellement / Match manuel

### Synchronisation automatique quotidienne

Le bouton de synchronisation manuelle reste disponible. Pour ajouter une
synchronisation quotidienne à **05:15 UTC** :

1. Dans **Supabase → SQL Editor**, crée les trois secrets Vault ci-dessous en
   remplaçant uniquement les valeurs. Utilise la clé `anon` JWT du projet,
   jamais la clé `service_role` :

```sql
SELECT vault.create_secret(
  'https://PROJECT_REF.supabase.co',
  'project_url'
);
SELECT vault.create_secret(
  'CLE_ANON_JWT',
  'function_anon_key'
);
SELECT vault.create_secret(
  'CODE_ADMINISTRATEUR',
  'fixture_sync_admin_code'
);
```

2. Dans le SQL Editor, exécute tout le contenu de
   `supabase/schedule_fixture_sync.example.sql`.
3. Vérifie que la requête finale affiche un job actif nommé
   `a-la-nantaise-daily-fixture-sync`.

Les valeurs sensibles restent chiffrées dans Vault. Le script active
`pg_cron` et `pg_net`, remplace proprement un ancien job du même nom et appelle
la même Edge Function que le bouton de l'admin.

Pour consulter les dernières exécutions :

```sql
SELECT status, start_time, end_time, return_message
FROM cron.job_run_details
WHERE jobid = (
  SELECT jobid
  FROM cron.job
  WHERE jobname = 'a-la-nantaise-daily-fixture-sync'
)
ORDER BY start_time DESC
LIMIT 10;
```

Pour désactiver l'automatisation :

```sql
SELECT cron.unschedule('a-la-nantaise-daily-fixture-sync');
```

## Application installable (PWA)

L’application peut être installée sur Android et iPhone comme une app « standalone ».

### Fonctionnement

- Manifeste web + service worker générés par `vite-plugin-pwa` (`registerType: prompt`).
- Le **shell** (HTML/JS/CSS/icônes/fonts) est précaché pour ouvrir l’UI hors connexion.
- **Aucune** requête / réponse Supabase n’est mise en cache (`NetworkOnly` sur `*.supabase.co` et chemins `/rest|rpc|auth|functions|storage/v1/`).
- Pas de Background Sync, pas de file d’attente de pronostics hors ligne.
- Une bannière propose « Mettre à jour » lorsqu’une nouvelle version est prête ; activation uniquement après confirmation.

### Installation Android (Chrome / navigateurs compatibles)

1. Ouvre le site en HTTPS.
2. Paramètres → **Installer l’application** (ou le bandeau navigateur).
3. Confirme. L’icône ALN apparaît sur l’écran d’accueil.

### Installation iPhone / iPad (Safari)

Safari ne permet pas d’installer via `beforeinstallprompt`.

1. Ouvre le site dans Safari.
2. Touche **Partager**.
3. Choisis **Sur l’écran d’accueil**.
4. Confirme.

Les instructions disparaissent automatiquement en mode standalone.

### Mise à jour

1. Un nouveau déploiement publie un nouveau service worker.
2. Au prochain chargement, la bannière « Une nouvelle version… » apparaît.
3. Touche **Mettre à jour** → un seul rechargement active la version.
4. **Plus tard** masque temporairement la bannière (sans forcer l’ancienne version à rester pour toujours).

### Limites hors ligne

- Le shell peut s’afficher, mais **les données et les pronostics nécessitent une connexion**.
- Si `navigator.onLine === false`, l’enregistrement d’un prono est bloqué immédiatement.
- Si le navigateur se croit en ligne mais que le réseau échoue, l’erreur RPC existante s’affiche ; aucun succès n’est montré sans confirmation Supabase.
- Aucun prono n’est mémorisé pour un envoi différé.

### Icônes

Les fichiers dans `public/icons/` (192, 512, maskable, Apple Touch) sont des **icônes temporaires** basées sur le monogramme ALN. Remplace-les par des assets définitifs sans déformer le logo.

### Désactivation / nettoyage du service worker (support)

**Côté utilisateur :**

1. Chrome → Paramètres du site → **Supprimer les données**.
2. Ou DevTools → Application → Service Workers → **Unregister**, puis Clear storage.

**Côté déploiement (rollback réel si le SW pose problème) :**

1. Republier la dernière version stable **si** l’incident n’est pas lié au service worker.
2. Si le SW est en cause : publier temporairement un **worker de désinscription** (voir ci-dessous) qui prend le contrôle, purge les caches, puis se désenregistre.
3. Laisser cette version atteindre les clients (heures / jours selon fréquentation).
4. Ensuite seulement retirer définitivement `vite-plugin-pwa` et redéployer sans SW.
5. Documenter pour le support la procédure manuelle Unregister ci-dessus.

Exemple minimal de worker de désinscription (à servir temporairement comme `sw.js`) :

```js
self.addEventListener('install', (event) => {
  self.skipWaiting()
})
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys()
      await Promise.all(keys.map((key) => caches.delete(key)))
      await self.registration.unregister()
      const clientsList = await self.clients.matchAll({ type: 'window' })
      for (const client of clientsList) client.navigate(client.url)
    })(),
  )
})
```

Ne pas laisser ce kill switch en production en permanence.

## Rappels Web Push (MVP)

Les rappels de pronostic (≈24 h et ≈2 h avant un match) utilisent le Web Push natif.

**État actuel :** envois **désactivés** (`push_sending_enabled = false`). Aucun Cron push actif tant que les smoke tests n’ont pas validé le parcours.

### Composants

- Migration `supabase/migrations/20260803170000_web_push.sql` (tables + RPC)
- Migration `supabase/migrations/20260803171000_harden_web_push_before_smoke_tests.sql` (preview dry-run, reclaim lease, 3 tentatives, REVOKE PUBLIC sur signatures **170000**)
- Migration `supabase/migrations/20260803180000_player_pin_sessions.sql` (RPC Push basées sur `session_token` ; REVOKE/GRANT finaux)
- Edge Function `send-prediction-reminders` (`jsr:@negrel/webpush@0.5.0`, `aes128gcm`)
- Handlers SW `public/push-events.js` via `workbox.importScripts`
- Section **Rappels de pronostic** dans Paramètres

**Ordre des migrations Push / session :** `170000` → `71000` → `180000`.  
La migration `71000` seule **n’est pas compatible** avec le frontend PIN actuel (appels `p_session_token`). Elle durcit volontairement les signatures access-code de `170000` ; `180000` les remplace ensuite. Ne pas smoke-tester le frontend PIN contre une base arrêtée à `71000`.

### Règles d’envoi

| Paramètre | Valeur |
|---|---|
| Fenêtres | ≈24 h et ≈2 h avant kickoff (grâce 60 min) |
| Lease de claim | **5 minutes** |
| Tentatives max | **3** claims réels (`attempt_count`) |
| Reclaim | livraisons `processing` dont le lease a expiré |
| Dry-run | **strictement non mutatif** (`preview_push_reminder_batch`) ; autorisé même si le flag est `false` ; authentifié par `PUSH_CRON_SECRET` ; sans clés VAPID |

### Compatibilité navigateurs

- **Chrome / Chromium / Firefox** : activation depuis Paramètres.
- **Safari macOS** : support via `ServiceWorkerRegistration.prototype.pushManager` (pas `window.PushManager`).
- **iPhone / iPad** : installer d’abord la PWA sur l’écran d’accueil (iOS ≥ 16.4), puis activer les rappels depuis l’icône.
- Test local complet (service worker) : `npm run build` puis `npm run preview` (le SW n’est pas actif dans `vite` dev).

### Secrets (noms uniquement — jamais dans le dépôt)

| Nom | Emplacement |
|---|---|
| `VITE_VAPID_PUBLIC_KEY` | Vercel / `.env` local (clé publique base64url) |
| `VAPID_KEYS_JSON` | Secrets Edge Function (JSON JWK exporté par `@negrel/webpush`) |
| `VAPID_SUBJECT` | Secrets Edge (`mailto:…` ou URL de contact) |
| `PUSH_CRON_SECRET` | Secrets Edge + Vault `push_reminders_cron_secret` |

Génération locale des clés (exemple) :

```bash
deno run https://raw.githubusercontent.com/negrel/webpush/master/cmd/generate-vapid-keys.ts
```

Conserver la paire : une rotation oblige les appareils à se réabonner.

### Déploiement contrôlé

1. Appliquer les migrations dans l’ordre `170000` → `71000` → `180000` (`push_sending_enabled` reste `false`). Ne pas déployer le frontend PIN avant `180000`.
2. Configurer les secrets VAPID + Cron.
3. Déployer `supabase functions deploy send-prediction-reminders`.
4. Déployer le frontend (avec `VITE_VAPID_PUBLIC_KEY`).
5. Abonner un appareil propriétaire (Paramètres → Activer les rappels).
6. Invoke dry-run : `{ "cron_secret": "…", "dry_run": true }` (aucune écriture DB, aucune notif).
7. Smoke forcé uniquement après validation dry-run, avec `push_sending_enabled` encore à `false` :

```bash
curl -sS -X POST \
  "$SUPABASE_URL/functions/v1/send-prediction-reminders" \
  -H "Content-Type: application/json" \
  -d '{
    "cron_secret": "'"$PUSH_CRON_SECRET"'",
    "smoke_test": {
      "subscription_id": "'"$SUBSCRIPTION_UUID"'"
    }
  }'
```

Le mode `smoke_test` envoie une notification unique à l’abonnement `active` + `aes128gcm` désigné (chargé via `service_role`). Il n’accepte jamais d’endpoint ni de clés dans la requête, n’appelle ni `prepare_push_reminder_batch` ni `claim_push_deliveries`, et ne crée aucune ligne `push_reminders` / `push_deliveries`. Succès attendu : `{ "ok": true, "mode": "smoke_test", "sent": 1, ... }`.
8. Valider Chrome/Android **et** PWA iOS ≥ 16.4.
9. Ensuite seulement `push_sending_enabled = true` et décommenter / exécuter `supabase/schedule_push_reminders.example.sql` (toutes les 15 min).

### Rollback immédiat

```sql
UPDATE public.app_settings
SET value = 'false', updated_at = now()
WHERE key = 'push_sending_enabled';

SELECT cron.unschedule('a-la-nantaise-push-reminders');
```

## Déploiement Vercel


L’hébergement cible est **Vercel**. Le fichier `vercel.json` configure le fallback SPA afin que l’actualisation directe de `/admin`, `/calendrier`, `/classement` et `/parametres` renvoie `index.html`.

### Réglages projet

| Réglage | Valeur |
|---|---|
| Framework Preset | Vite |
| Production Branch | `main` |
| Install Command | `npm ci` |
| Build Command | `npm run build` |
| Output Directory | `dist` |

### Variables d’environnement (Production et Preview)

| Variable | Obligatoire |
|---|---|
| `VITE_SUPABASE_URL` | oui |
| `VITE_SUPABASE_ANON_KEY` | oui |

**Ne jamais** ajouter dans Vercel :

- la clé Supabase `service_role` ;
- le code administrateur ;
- les secrets Vault (`project_url`, `function_anon_key`, `fixture_sync_admin_code`).

Les variables `VITE_*` sont **publiques** : elles sont intégrées au bundle frontend au moment du build.

### Tests post-déploiement

Après un déploiement Preview ou Production :

- [ ] chargement de l’accueil ;
- [ ] connexion participant (code commun + choix de pseudo) ;
- [ ] enregistrement d’un pronostic ;
- [ ] accès `/admin` ;
- [ ] actualisation directe (F5) de `/admin`, `/calendrier`, `/classement`, `/parametres` (pas de 404) ;
- [ ] synchronisation manuelle des matchs (admin) ;
- [ ] absence d’erreur dans la console navigateur.

## Checklist production

- [ ] Variables frontend `VITE_SUPABASE_URL` et `VITE_SUPABASE_ANON_KEY` configurées chez Vercel (anon uniquement)
- [ ] Migrations SQL appliquées dans l’ordre (voir ci-dessus)
- [ ] Edge Function `sync-fc-nantes` déployée
- [ ] Secrets Vault `project_url`, `function_anon_key`, `fixture_sync_admin_code` créés
- [ ] Job Cron `a-la-nantaise-daily-fixture-sync` actif (`15 5 * * *`)
- [ ] Données de démonstration nettoyées (seed retiré) ; participants / pronostics réels autorisés
- [ ] CI GitHub verte sur `main`
- [ ] Fallback SPA Vercel actif (`vercel.json`)
- [ ] PWA : manifeste + SW (headers no-cache sur `sw.js`) ; hors-ligne shell-only
- [ ] Smoke tests post-déploiement (voir ci-dessus)
- [ ] Procédure de rollback connue (redeploy précédent côté Vercel)

### Rollback

1. Republier le déploiement précédent sur Vercel (Promote / Rollback).
2. En cas de régression code : `git revert` du commit déployé puis nouveau build.
3. Ne pas exécuter `supabase db reset`.
4. Désactiver le Cron seulement si nécessaire :
   `SELECT cron.unschedule('a-la-nantaise-daily-fixture-sync');`

## Règles produit

- Un seul pronostic par joueur et par match
- Modifiable jusqu’à l’heure exacte du coup d’envoi (contrôle **serveur** via `now()`)
- Score exact : **3** pts · Bon résultat : **1** pt · Sinon : **0**
- Les pronostics des autres ne sont visibles qu’à partir du coup d’envoi
- Dates stockées en UTC, affichées en `Europe/Paris`

## Tests & CI

```bash
npm ci
npm test
npm run lint
npm run build
```

La CI GitHub (`.github/workflows/ci.yml`) exécute ces commandes sur les PR et les pushes `main`, sans secrets Supabase et sans déploiement.

Couvre notamment :

- parsing / validation du flux Fixture Download (fixtures JSON locales, sans réseau)
- planification d’upsert (idempotence, rapprochement, conflit ambigu, override manuel)
- migrations / Edge Function (vérification admin avant fetch)
- planification Cron + Vault (pas de secrets en clair)

Pour valider en base (transaction annulée) :

```sql
-- Dans le SQL Editor Supabase : coller supabase/tests/upsert_prediction.sql
-- Le script se termine par ROLLBACK.
```

## Sécurité des dépendances

Contrôle périodique :

```bash
npm audit --omit=dev
```

Ne pas utiliser `npm audit fix --force`. Toute mise à jour majeure doit être justifiée.

### Alertes connues (`npm audit --omit=dev`, août 2026)

| Paquet | Sévérité | Advisory | Applicabilité SPA |
|---|---|---|---|
| `react-router` / `react-router-dom` (7.12.0–8.2.0) | high | [GHSA-qwww-vcr4-c8h2](https://github.com/advisories/GHSA-qwww-vcr4-c8h2) (CSRF en mode RSC) | **Faible** : l’app utilise `BrowserRouter` côté client, pas le mode RSC. `npm audit fix --force` proposerait une rétrogradation vers `7.11.0` (changement cassant non souhaité). Une correction amont peut nécessiter une montée majeure (`react-router` 8.3+) — reportée jusqu’à validation manuelle. |

La surface navigateur se limite au bundle Vite + clé anon Supabase.

## Structure utile

- `src/lib/supabase.ts` — client anon
- `src/lib/api.ts` — appels RPC
- `src/lib/adminApi.ts` — RPC admin + invoke sync
- `src/lib/session.ts` — mémorisation locale du code + joueur
- `src/context/` — session (provider + hook séparés)
- `src/pages/AccessPage.tsx` — code puis choix du pseudo
- `src/pages/AdminPage.tsx` — administration (matchs, sync, participants)
- `supabase/migrations/` — schéma + RPC
- `supabase/functions/sync-fc-nantes/` — synchronisation serveur
- `supabase/schedule_fixture_sync.example.sql` — planification quotidienne via Cron + Vault
- `supabase/seed.sql` — joueurs / matchs / pronos de test
- `tests/fixtures/ligue-2-2026-fc-nantes.json` — flux local de test
- `public/icons/` — icônes PWA temporaires ALN (à remplacer)
- `src/lib/pwa.ts` — helpers install / standalone / hors-ligne
- `.github/workflows/ci.yml` — contrôles automatiques

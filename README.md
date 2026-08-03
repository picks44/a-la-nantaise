# À la Nantaise

Webapp responsive de pronostics amicaux sur les matchs du FC Nantes (Ligue 2).

Accès par **code commun** (pas de compte, pas d’e-mail). Données hébergées sur Supabase (PostgreSQL + RPC). Pas d’Auth Supabase. Calendrier FC Nantes synchronisable depuis Fixture Download (pas d’API-Football).

## Stack

- React + TypeScript + Vite + Tailwind CSS
- React Router + Lucide React
- `@supabase/supabase-js` (clé **anon** uniquement côté client)
- Supabase Edge Function `sync-fc-nantes` (appel serveur du flux public)

## Commandes

```bash
npm install
npm run dev
npm run build
npm run preview
npm run lint
npm test
```

## Configuration locale

1. Copie `.env.example` vers `.env`
2. Renseigne :
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY` (clé publique anon, jamais la `service_role`)

## Mise en place Supabase

### 1. Créer le projet

Crée un projet sur [supabase.com](https://supabase.com), puis récupère l’URL et la clé anon dans **Project Settings → API**.

### 2. Exécuter les migrations (manuellement)

Dans le **SQL Editor**, exécute **dans l’ordre** (ne pas appliquer automatiquement depuis un agent) :

1. `supabase/migrations/20260803100000_init.sql`
2. `supabase/migrations/20260803120000_fix_upsert_prediction_ambiguity.sql`
3. `supabase/migrations/20260803130000_admin_rpcs.sql`
4. `supabase/migrations/20260803140000_fixture_download_sync.sql`

La migration sync ajoute les champs `source`, `last_synced_at`, `manual_override`, l’unicité `(source, external_id)`, et les RPC de commit / levée d’override. **Aucune donnée existante n’est supprimée.**

### 3. Charger les données de test

Exécute ensuite :

`supabase/seed.sql`

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

## Règles produit

- Un seul pronostic par joueur et par match
- Modifiable jusqu’à l’heure exacte du coup d’envoi (contrôle **serveur** via `now()`)
- Score exact : **3** pts · Bon résultat : **1** pt · Sinon : **0**
- Les pronostics des autres ne sont visibles qu’à partir du coup d’envoi
- Dates stockées en UTC, affichées en `Europe/Paris`

## Tests

```bash
npm test
```

Couvre notamment :

- parsing / validation du flux Fixture Download (fixtures JSON locales, sans réseau)
- planification d’upsert (idempotence, rapprochement, conflit ambigu, override manuel)
- migrations / Edge Function (vérification admin avant fetch)

Pour valider en base (transaction annulée) :

```sql
-- Dans le SQL Editor Supabase : coller supabase/tests/upsert_prediction.sql
-- Le script se termine par ROLLBACK.
```

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
- `supabase/seed.sql` — joueurs / matchs / pronos de test
- `tests/fixtures/ligue-2-2026-fc-nantes.json` — flux local de test

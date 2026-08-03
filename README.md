# À la Nantaise

Webapp responsive de pronostics amicaux sur les matchs du FC Nantes (Ligue 2).

Accès par **code commun** (pas de compte, pas d’e-mail). Données hébergées sur Supabase (PostgreSQL + RPC). Pas d’Auth Supabase, pas d’API sportive pour l’instant.

## Stack

- React + TypeScript + Vite + Tailwind CSS
- React Router + Lucide React
- `@supabase/supabase-js` (clé **anon** uniquement côté client)

## Commandes

```bash
npm install
npm run dev
npm run build
npm run preview
npm run lint
```

## Configuration locale

1. Copie `.env.example` vers `.env`
2. Renseigne :
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY` (clé publique anon, jamais la `service_role`)

## Mise en place Supabase

### 1. Créer le projet

Crée un projet sur [supabase.com](https://supabase.com), puis récupère l’URL et la clé anon dans **Project Settings → API**.

### 2. Exécuter la migration

Dans le **SQL Editor**, colle et exécute le contenu de :

`supabase/migrations/20260803100000_init.sql`

Cette migration crée les tables (`players`, `matches`, `predictions`, `app_settings`), active le RLS (sans policy = pas d’accès direct), et expose les fonctions RPC.

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

### 5. Vérifier

```sql
SELECT public.verify_access_code('TON_CODE_ICI'); -- doit renvoyer true
```

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

Couvre la migration corrective d’`upsert_prediction` (contrainte nommée, colonnes qualifiées, pas de suppression de données).

Pour valider en base (transaction annulée) :

```sql
-- Dans le SQL Editor Supabase : coller supabase/tests/upsert_prediction.sql
-- Le script se termine par ROLLBACK.
```

## Structure utile

- `src/lib/supabase.ts` — client anon
- `src/lib/api.ts` — appels RPC
- `src/lib/session.ts` — mémorisation locale du code + joueur
- `src/context/` — session (provider + hook séparés)
- `src/pages/AccessPage.tsx` — code puis choix du pseudo
- `supabase/migrations/` — schéma + RPC
- `supabase/seed.sql` — joueurs / matchs / pronos de test

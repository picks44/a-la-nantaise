# À la Nantaise

Application web de pronostics amicaux sur les matchs du FC Nantes.

Le frontend est une SPA React/Vite. L’application n’utilise pas **Supabase Auth**, mais une authentification **applicative** : code d’accès de groupe, PIN joueur, sessions opaques côté base, et session admin séparée.

## Stack

- React 19 + TypeScript + Vite 8
- Tailwind CSS 4
- React Router 7
- `@supabase/supabase-js`
- Supabase local / distant : Postgres, RPC SQL, Edge Functions
- PWA via `vite-plugin-pwa`
- npm 11 (`package-lock.json`), Node `>=22.12.0`

## Prérequis

- Node conforme à `.nvmrc`
- npm
- Supabase CLI `2.111.0`
- Docker Desktop pour la stack Supabase locale

## Installation

```bash
npm ci
cp .env.example .env
```

`.env.example` ne contient que des variables **frontend publiques**. Ne jamais y mettre de secret serveur.

## Environnements réels

| Environnement | Commande de lancement | Frontend | Supabase ciblé | Rôle de Docker | Configuration | Précautions |
|---|---|---|---|---|---|---|
| Frontend local + Supabase local | `supabase start` puis `npm run dev` | `http://localhost:5173` | `http://127.0.0.1:54321` | Docker exécute la stack Supabase locale via la CLI | `.env.local` prioritaire + `supabase/config.toml` | Mode le plus sûr pour développer et lancer les tests SQL |
| Frontend local + Supabase distant | `npm run dev` avec `.env.local` absent ou neutralisé | `http://localhost:5173` | URL de `.env` | Aucun conteneur applicatif | `.env` | Vérifier explicitement la cible avant tout test mutatif |
| CI GitHub | workflow automatique | pas de serveur persistant | aucun projet réel | aucun | `.github/workflows/ci.yml` injecte des placeholders | ne valide pas une vraie instance Supabase |
| Vercel Preview / Production | build Vercel | domaine Vercel | dépend des variables Vercel | aucun | `vercel.json` + variables Vercel | le repo ne contient pas le project ref Supabase distant |

### Ce qui est constaté actuellement

- `npm run dev` lance **uniquement Vite**.
- `.env` pointe vers un Supabase **distant**.
- `.env.local`, prioritaire pour Vite en local, pointe vers `http://127.0.0.1:54321`.
- Donc, dans l’état actuel du dépôt local, **le frontend localhost utilise Supabase local**.
- La stack Supabase locale est exécutée par la **CLI Supabase via Docker**.
- Il n’existe **aucun** `Dockerfile` ni fichier Compose dédié à l’application.

## Diagnostic rapide de la cible frontend

```bash
npm run env:frontend:default    # lit .env
npm run env:frontend:local      # lit .env.local
npm run env:frontend:effective  # applique la priorité .env.local > .env
```

Ces commandes affichent uniquement :

- un libellé clair (`Supabase local` ou `Supabase distant`) ;
- l’URL d’origine ;
- le hostname.

Elles n’affichent jamais de clé.

## Variables d’environnement

### Variables publiques du frontend

À placer dans `.env` ou `.env.local` :

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_VAPID_PUBLIC_KEY` (uniquement si les rappels push sont activés)

Règles :

- seules les variables `VITE_*` sont injectées dans le navigateur ;
- ne jamais y mettre `SUPABASE_SERVICE_ROLE_KEY`, `PUSH_CRON_SECRET`, `VAPID_KEYS_JSON`, ni un secret Vault ;
- `.env.local` est le bon endroit pour cibler Supabase local.

### Variables serveur des Edge Functions

`sync-fc-nantes` :

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`

`send-prediction-reminders` :

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `PUSH_CRON_SECRET`
- `VAPID_KEYS_JSON`
- `VAPID_SUBJECT`

### Secrets Vault Supabase

- `project_url`
- `function_anon_key`
- `fixture_sync_admin_code`
- `push_reminders_cron_secret`

### Variables Vercel

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_VAPID_PUBLIC_KEY` si les rappels push sont utilisés

Ne jamais configurer dans Vercel :

- `SUPABASE_SERVICE_ROLE_KEY`
- un code admin
- un PIN
- un secret Vault

## Démarrage local avec Supabase local

1. Vérifier que `.env.local` pointe vers `http://127.0.0.1:54321`.
2. Lancer la stack locale :

```bash
supabase start
```

3. Lancer le frontend :

```bash
npm run dev
```

Services locaux attendus :

- API Supabase : `127.0.0.1:54321`
- Postgres : `127.0.0.1:54322`
- Studio : `127.0.0.1:54323`

## Démarrage local avec un Supabase distant

Ce mode existe réellement via `.env`, mais il n’est **pas** le mode par défaut constaté localement tant que `.env.local` existe.

Procédure :

1. diagnostiquer la cible actuelle avec `npm run env:frontend:effective` ;
2. neutraliser temporairement `.env.local` si tu veux utiliser la cible de `.env` ;
3. relancer `npm run dev`.

Le repo ne permet pas d’identifier seul si la cible distante correspond à la preview, au staging ou à la production : cette information dépend des variables réellement configurées hors dépôt.

## Migrations Supabase

Le dépôt contient actuellement toutes les migrations de :

- `20260803100000_init.sql`
- à `20260804160000_drop_admin_code_auth_compat.sql`

La source de vérité est le dossier `supabase/migrations/`, pas une liste manuelle copiée dans ce README.

### Workflow local recommandé

Créer ou modifier une migration, puis valider localement :

```bash
supabase migration list --local
npm run test:sql:local
```

`npm run test:sql:local` :

- vérifie explicitement que la cible est locale (`127.0.0.1:54321` / `127.0.0.1:54322`) ;
- exécute un `supabase db reset --local --no-seed --yes` ;
- lance tous les fichiers de `supabase/tests/*.sql` contre la base locale Docker.

Si la cible n’est pas locale, la commande échoue avant toute mutation.

### Garde-fous importants

- ne jamais exécuter `supabase db push` ou `supabase db reset --linked` sans avoir vérifié manuellement le projet ciblé ;
- le repo ne versionne aucun `supabase link` ni project ref distant ;
- aucune commande courante du dépôt ne doit viser silencieusement la production.

## Commandes utiles

```bash
npm run dev
npm run build
npm run preview
npm run lint
npm run typecheck
npm test
npm run test:sql:local
```

## Architecture courte

- `src/lib/supabase.ts` : client Supabase frontend
- `src/lib/api.ts` : RPC joueur (code d’accès, PIN, sessions, pronostics, classement)
- `src/lib/adminApi.ts` : RPC admin et appel Edge Function de synchronisation
- `src/context/SessionProvider.tsx` : bootstrap et cycle de session frontend
- `src/pages/AccessPage.tsx` : entrée groupe + PIN
- `src/pages/AdminPage.tsx` : administration
- `supabase/migrations/` : schéma, RPC et sécurité SQL
- `supabase/functions/` : Edge Functions `sync-fc-nantes` et `send-prediction-reminders`

## Déploiement

D’après les fichiers présents :

- GitHub Actions exécute `npm ci`, `npm test`, `npm run lint` et `npm run build` sur les PR et sur `main`.
- Vercel construit la SPA avec `npm ci` puis `npm run build`, et sert `dist/`.
- `vercel.json` configure le fallback SPA et les headers de sécurité.
- Il n’existe pas de workflow de déploiement Supabase versionné dans le dépôt.

En pratique :

- le frontend est déployé par Vercel ;
- les migrations Supabase, les Edge Functions et les secrets serveur se gèrent hors de ce dépôt, avec vérification explicite de la cible avant toute action distante.

## Règles de sécurité

- ne jamais committer de secrets ;
- ne jamais exposer une clé complète dans un log, un README ou un ticket ;
- ne jamais placer un secret serveur dans `.env.example` ;
- ne jamais présumer qu’un projet Supabase distant est “de dev” ou “de prod” sans vérification explicite de son hostname et de son contexte de déploiement.

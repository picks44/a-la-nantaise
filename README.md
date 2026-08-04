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
| Frontend local + Supabase local (dev) | `supabase start` puis `npm run dev` | `http://localhost:5173` | `http://127.0.0.1:54321` | Stack Docker `a-la-nantaise` (ports 54xxx) | `.env.local` + `supabase/config.toml` | Données manuelles de développement ; **jamais** réinitialisée par les tests SQL |
| Tests SQL isolés | `npm run test:sql:local` | n/a | `http://127.0.0.1:55321` | Stack Docker `a-la-nantaise-test` (ports 55xxx) | `supabase-test/supabase/config.toml` | Reset uniquement de la base de test ; la stack dev reste intacte |
| Frontend local + Supabase distant | `npm run dev` avec `.env.local` absent ou neutralisé | `http://localhost:5173` | URL de `.env` | Aucun conteneur applicatif | `.env` | Vérifier explicitement la cible avant tout test mutatif |
| CI GitHub | workflow automatique | pas de serveur persistant | aucun projet réel | aucun | `.github/workflows/ci.yml` injecte des placeholders | ne valide pas une vraie instance Supabase |
| Vercel Preview / Production | build Vercel | domaine Vercel | dépend des variables Vercel | aucun | `vercel.json` + variables Vercel | le repo ne contient pas le project ref Supabase distant |

### Comportement du dépôt

- `npm run dev` lance **uniquement Vite**.
- en mode développement, `process.env.VITE_SUPABASE_URL` a priorité sur tous les fichiers `.env*` ;
- si `.env.local` existe, Vite le charge avant `.env` en développement ;
- la stack Supabase locale est exécutée par la **CLI Supabase via Docker** ;
- il n’existe **aucun** `Dockerfile` ni fichier Compose dédié à l’application.

## Diagnostic rapide de la cible frontend

```bash
npm run env:frontend:default    # lit .env
npm run env:frontend:local      # lit .env.local
npm run env:frontend:effective  # applique la priorité process.env > .env.local > .env et variantes development
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

1. Lancer la stack locale :

```bash
supabase start
```

2. Récupérer l’URL locale et la clé anon publique sans les copier depuis ce README :

```bash
supabase status
```

À relever dans la sortie :

- l’API locale, typiquement `http://127.0.0.1:54321` ;
- la clé `ANON_KEY` locale générée par Supabase CLI.

3. Créer `.env.local` à partir de ces informations :

```bash
cat > .env.local <<'EOF'
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_ANON_KEY=COLLE_ICI_LA_CLE_ANON_LOCALE
EOF
```

Ne jamais y mettre de `service_role`.

4. Lancer le frontend :

```bash
npm run dev
```

Services locaux attendus (stack **dev**) :

- API Supabase : `127.0.0.1:54321`
- Postgres : `127.0.0.1:54322`
- Studio : `127.0.0.1:54323`

## Deux stacks Supabase locales

Le dépôt maintient **deux** environnements Docker distincts :

| | Stack **dev** | Stack **test** |
|---|---|---|
| `project_id` | `a-la-nantaise` | `a-la-nantaise-test` |
| Conteneur DB | `supabase_db_a-la-nantaise` | `supabase_db_a-la-nantaise-test` |
| Workdir CLI | dépôt (défaut) | `supabase-test/` |
| Config | `supabase/config.toml` | `supabase-test/supabase/config.toml` |
| API | `127.0.0.1:54321` | `127.0.0.1:55321` |
| Postgres | `127.0.0.1:54322` | `127.0.0.1:55322` |
| Shadow DB | `54320` | `55320` |
| Studio | `54323` | `55323` |
| Inbucket | `54324` | `55324` |
| Analytics | `54327` | `55327` |
| Pooler | `54329` | `55329` |
| Usage | `npm run dev`, `.env.local`, données manuelles | `npm run test:sql:local` uniquement |

Les migrations restent une seule source de vérité : `supabase/migrations/` (symlink depuis la stack test). Les fichiers SQL de test restent dans `supabase/tests/` et sont lus directement par le runner.

### Commandes de la stack test

```bash
npm run supabase:test:start
npm run supabase:test:status
npm run supabase:test:stop
```

Ces commandes utilisent exclusivement `--workdir supabase-test` et **ne peuvent pas** arrêter ni réinitialiser la stack de développement.

### Dépannage : port déjà occupé

Si `supabase:test:start` échoue parce qu’un port `553xx` est pris :

1. `npm run supabase:test:status` pour voir si la stack test tourne déjà ;
2. `lsof -i :55321` (ou le port signalé) pour identifier le processus ;
3. arrêter uniquement la stack test avec `npm run supabase:test:stop` ;
4. ne jamais libérer un port `54xxx` en stoppant la stack test — ce sont les ports de développement.

### Suppression volontaire de la stack test

```bash
npm run supabase:test:stop
# optionnel, volumes Docker de la stack test uniquement :
supabase --workdir supabase-test stop --no-backup
```

Ne jamais utiliser `supabase stop` sans `--workdir supabase-test` si tu veux préserver la stack dev.

## Démarrage local avec un Supabase distant

Ce mode existe si `.env` contient une cible distante et qu’aucun fichier prioritaire ne l’écrase.

Procédure :

1. diagnostiquer la cible actuelle avec `npm run env:frontend:effective` ;
2. s’assurer qu’aucun `.env.local` ou `.env.development.local` ne pointe ailleurs ;
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

- cible uniquement la stack **Supabase test** (`a-la-nantaise-test`, ports `55321` / `55322`, conteneur `supabase_db_a-la-nantaise-test`) ;
- refuse la stack de développement (`54321` / `54322`, `supabase_db_a-la-nantaise`) et toute cible distante / liée ;
- démarre la stack test si besoin, applique les migrations via `db reset --local --no-seed`, puis exécute `supabase/tests/*.sql` ;
- **ne touche jamais** à la base de développement : codes d’accès, PIN, joueurs, matchs et sessions locaux restent intacts ;
- empêche deux exécutions simultanées via un verrou local non versionné.

Preuve d’isolation optionnelle (empreinte **lecture seule** de la base dev, sans écriture) :

```bash
npm run test:sql:isolation
```

### Garde-fous importants

- ne jamais exécuter `supabase db push` ou `supabase db reset --linked` sans avoir vérifié manuellement le projet ciblé ;
- le repo ne versionne aucun `supabase link` ni project ref distant ;
- aucune commande courante du dépôt ne doit viser silencieusement la production ;
- ne jamais copier `supabase/.temp/` (fichiers de liaison) vers `supabase-test/`.

## Commandes utiles

```bash
npm run dev
npm run build
npm run preview
npm run lint
npm run typecheck
npm test
npm run supabase:test:start
npm run supabase:test:status
npm run supabase:test:stop
npm run test:sql:local
npm run test:sql:isolation
```
## Architecture courte

- `src/lib/supabase.ts` : client Supabase frontend
- `src/lib/api.ts` : RPC joueur (code d’accès, PIN, sessions, pronostics, classement)
- `src/lib/adminApi.ts` : RPC admin et appel Edge Function de synchronisation
- `src/context/SessionProvider.tsx` : bootstrap et cycle de session frontend
- `src/pages/AccessPage.tsx` : entrée groupe + PIN
- `src/pages/AdminPage.tsx` : administration
- `supabase/migrations/` : schéma, RPC et sécurité SQL
- `supabase/tests/` : suites SQL exécutées sur la stack test isolée
- `supabase-test/` : workdir CLI de la stack test (ports 55xxx, symlink vers les migrations)
- `supabase/functions/` : Edge Functions `sync-fc-nantes`, `sync-api-football` (shadow) et `send-prediction-reminders`
- `docs/api-football-shadow.md` : activation shadow API-Football (secrets, couverture, cron, repli)

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

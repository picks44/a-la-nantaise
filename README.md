# À la Nantaise

Application web de pronostics amicaux sur les matchs du FC Nantes, pour un groupe privé.

Le frontend est une SPA React/Vite. L’application n’utilise pas **Supabase Auth**, mais une authentification **applicative** : code d’accès de groupe, PIN joueur, sessions opaques côté base, et session admin séparée. La source de vérité métier (scores, points, reveal, trophées, classement) reste **Postgres / RPC SQL**.

## Fonctionnalités

- **Accès groupe** : code d’accès partagé, puis sélection joueur + PIN
- **Pronostic du prochain match** (Home) avec feedback de succès
- **Calendrier** : prochain match mis en avant, lignes compactes pour le futur, matchs terminés avec détails repliables
- **Reveal groupe** : pronostics du groupe visibles après verrouillage / fin de match, chargés à la demande avec timeout et annulation
- **Classement** : général (compétition, ex æquo), participation par journée, récapitulatif de journée
- **Trophées & séries** : progression, célébrations anti-replay, confetti ciblé
- **Parcours de saison** (timeline) : journées, jalons, trophées
- **PWA** : installable, bannières hors-ligne / mise à jour
- **Notifications push** (optionnelles) : rappels de pronostic si VAPID + Edge Function configurés
- **Admin** : joueurs, matchs / résultats, sync fixtures, code d’accès, session admin opaque

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
| Vercel Preview / Production | build Vercel | domaine Vercel | dépend des variables Vercel | aucun | `vercel.json` + variables Vercel | Le project ref Supabase distant n’est pas versionné ; une liaison locale peut exister dans `supabase/.temp/` |

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
- `SUPABASE_ANON_KEY` (suffisant : les écritures passent par des RPC admin `SECURITY DEFINER`, authentifiées via session admin ou code legacy)

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

### Réinitialiser / reseeder la base locale

Pour rejouer les migrations et recharger le seed de développement (`supabase/seed.sql`) :

```bash
supabase db reset
```

Cette commande cible uniquement la stack **locale** (ports `54xxx`). Elle efface les données manuelles de la base de dev. Ne jamais exécuter de reset sur une base liée ou distante. `supabase db reset` doit rester strictement local dans ce projet.

**Contrat seed (standard) :** codes d’accès locaux + 8 joueurs déterministes uniquement. Aucun match, aucun pronostic, aucun calendrier fictif. Compatible avec une sync Fixture Download ultérieure (setup réaliste, lot S2). Ne pas réintroduire de matchs `source=manual` / `external_id` `seed-j*` dans ce fichier.

**Données protégées :** la section joueurs / codes d’accès / PIN du seed est figée — ne pas la modifier. Les identifiants de smoke restent documentés uniquement dans l’en-tête de `supabase/seed.sql` (ne pas les recopier ailleurs).

**Après reset (dev) :** login possible (groupe `ALN`, PIN documenté dans le seed, admin `ADMIN`) ; calendrier et classement matchs vides jusqu’au setup réaliste ci-dessous ou création manuelle admin. Les scénarios UI déterministes (locked, TBC, reveal, etc.) restent couverts par la stack **test** isolée (`--no-seed` + fixtures SQL), pas par ce seed.

### Setup local réaliste (calendrier Fixture Download)

Pour obtenir les **34 vrais matchs** FC Nantes (`source=fixturedownload`, vrais `external_id`) après le seed minimal :

```bash
# Stack dev déjà démarrée : supabase start
npm run db:setup:realistic -- --yes
```

Cette commande (strictement locale) :

1. vérifie la cible (`project_id=a-la-nantaise`, API `127.0.0.1:54321`, DB `54322`) ;
2. refuse `--linked`, URLs distantes, stack test `55xxx`, et les variables CLI qui pourraient rediriger hors local ;
3. exécute `supabase db reset --yes` (seed minimal S1) ;
4. importe le calendrier depuis le JSON figé `tests/fixtures/ligue-2-2026-fc-nantes.json` (même référentiel Fixture Download) ;
5. valide via `supabase/maintenance/verify_realistic_setup.sql` (34 matchs, 0 manual, 0 prediction).

Resynchroniser sans reset :

```bash
npm run db:sync:fixtures:local
npm run db:sync:fixtures:local -- --live   # fetch réseau du feed (local uniquement)
```

S2 ne crée **aucun** pronostic. Les données de dev (pronos) s’ajoutent ensuite :

```bash
npm run db:seed:predictions:local
```

Cette commande (strictement locale, post-S2) :

1. réutilise les garde-fous dev (`127.0.0.1:54321` / DB `54322`, refus remote / linked / stack test) ;
2. échoue clairement si les 34 matchs `fixturedownload` sont absents ;
3. insère ~10 pronos sur J1/J2/J3 en ciblant uniquement `external_id` (aucun UUID match hardcodé, aucun UPDATE sur `matches`) ;
4. appelle `recalculate_season_achievements` (points restent NULL tant qu’aucun match n’est `finished`) ;
5. valide via `supabase/maintenance/verify_dev_predictions.sql` → notice `DEV_PREDICTIONS_OK`.

Le snapshot JSON figé n’a pas encore de scores officiels : Home / Calendrier / reveal J1 sont utiles ; classement scoré et trophées à points apparaîtront après une sync `--live` quand le feed livrera des résultats (ou restent couverts par la stack test).

Ne jamais lancer une sync live sur un ancien seed fictif : depuis S1 ce risque est retiré du seed standard.

**Vérifier les invariants** (après reset validé, lecture seule, sans afficher de secrets) :

```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
  -v ON_ERROR_STOP=1 \
  -f supabase/maintenance/verify_seed_invariants.sql
```

Après setup réaliste :

```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
  -v ON_ERROR_STOP=1 \
  -f supabase/maintenance/verify_realistic_setup.sql
```

Après seed pronos (S3) :

```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
  -v ON_ERROR_STOP=1 \
  -f supabase/maintenance/verify_dev_predictions.sql
```

Adapter l’URL si votre Postgres local diffère. Succès attendu : notice `SEED_INVARIANTS_OK` (seed seul), `REALISTIC_SETUP_OK` (après S2), ou `DEV_PREDICTIONS_OK` (après S3).

### Tests déterministes (CI / stack test)

- `npm test` : suites Node, **sans** feed réseau Fixture Download ;
- `npm run test:sql:local` : stack **test** isolée, `db reset --local --no-seed`, fixtures SQL propres.

**Stacks :** le seed est chargé uniquement sur la stack **dev** (`[db.seed]` → `seed.sql`). La stack **test** utilise `sql_paths = []` et `db reset --local --no-seed` (`npm run test:sql:local`) — elle n’applique jamais ce seed.

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

Le dépôt contient actuellement les migrations de :

- `20260803100000_init.sql`
- à `20260806100000_push_register_limit_after_endpoint_lookup.sql`

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

- ne jamais exécuter de reset ou de push sur une base liée / distante ; `supabase db reset` reste strictement local ;
- le project ref Supabase distant n’est pas versionné dans le dépôt (une liaison locale peut néanmoins exister dans `supabase/.temp/`) ;
- aucune commande courante du dépôt ne doit viser silencieusement la production ;
- ne jamais copier `supabase/.temp/` (fichiers de liaison) vers `supabase-test/`.

## Scripts (`package.json`)

```bash
npm run dev                     # Vite uniquement
npm run build                   # tsc -b && vite build
npm run preview
npm run lint                    # oxlint
npm run typecheck               # tsc -b
npm test                        # tests Node (tests/**/*.test.mjs) — n’exécute pas le SQL
npm run env:frontend:default
npm run env:frontend:local
npm run env:frontend:effective
npm run supabase:test:start
npm run supabase:test:status
npm run supabase:test:stop
npm run test:sql:local          # gate SQL manuelle / locale sur stack test
npm run test:sql:isolation
```

## Architecture

### Frontend

| Zone | Rôle |
|---|---|
| `src/pages/` | `AccessPage`, `HomePage`, `CalendarPage`, `RankingPage`, `SettingsPage`, `AdminPage` (lazy) |
| `src/components/` | UI partagée (`MatchListItem`, `Podium`, `RoundRecapCard`, `TrophyPanel`, `SeasonTimelinePanel`, PWA, etc.) |
| `src/context/` | `SessionProvider` : bootstrap, invalidation, récupération d’accès |
| `src/lib/api.ts` | wrappers RPC joueur |
| `src/lib/adminApi.ts` | wrappers RPC admin + sync fixtures |
| `src/lib/pageLoad.ts` / `pageLoadTimeout.ts` | bundles de chargement page + timeout |
| `src/lib/calendarRefresh.ts` | soft refresh calendrier (génération + coalescing) |
| `src/lib/matchGroupRevealState.ts` | loader reveal (in-flight, timeout, requestId) |
| `src/lib/sessionRecovery.ts` | invalidation session vs code d’accès |
| `src/lib/*Display.ts`, `formatPoints.ts`, `seasonTimeline.ts`, `ranking.ts` | helpers purs de présentation / règles UI |
| `src/lib/supabase.ts` | client Supabase frontend |

### Backend

- `supabase/migrations/` : schéma, RPC, sécurité SQL
- `supabase/tests/` : suites SQL (14 fichiers) exécutées **uniquement** via `npm run test:sql:local`
- `supabase-test/` : workdir CLI de la stack test (ports 55xxx, symlink vers les migrations)
- `supabase/functions/` : Edge Functions `sync-fc-nantes` et `send-prediction-reminders`
- `supabase/seed.sql` : seed de développement uniquement (codes + joueurs ; pas de calendrier)
- `npm run db:setup:realistic -- --yes` : reset local + calendrier Fixture Download (34 matchs)
- `npm run db:sync:fixtures:local` : resync calendrier sans reset (JSON figé ; `--live` optionnel)
- `npm run db:seed:predictions:local` : pronos de dev sur external_id Fixture Download (post-S2)

### Tests frontend

- `tests/*.test.mjs` : helpers unitaires, garde-fous env/SQL, scans de câblage ciblés
- CI exécute `npm test`, `npm run lint` et `npm run build` — **pas** les suites SQL Docker
- `npm run build` exécute également `tsc -b`, mais `npm run typecheck` reste conservé comme vérification explicite et plus rapide avant le build complet

## Flux sensibles

- **Source de vérité** : Postgres / RPC ; le client ne recalcule pas les points ni le reveal.
- **Verrouillage des pronostics** : au coup d’envoi confirmé (côté SQL) ; le frontend affiche les états dérivés (`to_predict`, `predicted`, `locked`, etc.).
- **Reveal groupe** : chargé à l’ouverture des détails ; `matchGroupRevealState` évite les courses et applique un timeout.
- **Retry & timeouts** : Home / Ranking / Calendar partagent des bundles de chargement, un garde anti double-clic, et un timeout de page (~20s) hors reveal.
- **Refresh calendrier** : soft refresh au focus (génération + coalescing) pour ne pas vider la liste.
- **Classement compétition** : les ex æquo partagent le même rang lorsque les points et le nombre de scores exacts sont identiques ; le pseudo ne sert qu’à stabiliser l’ordre d’affichage (`getCompetitionRanks`).
- **Trophées** : overview + ack côté RPC ; célébrations anti-replay en `localStorage` (clés scopées groupe/joueur/saison).
- **Subscriptions push** : un joueur peut avoir au maximum 5 endpoints actifs ; un endpoint déjà connu peut être réactivé sans consommer un nouveau slot ; les endpoints définitivement invalides sont désactivés lors des envois.
- **Session joueur** : token opaque en `localStorage` ; expiration de session peut conserver le code d’accès valide (`needs_player`) ; code d’accès invalide force un clear complet.
- **Deep-link** `?match=` : ouverture des détails pour matchs terminés / verrouillés ; scroll pour prochain / compact.

## Tests — attentes avant merge

1. `npm run typecheck`
2. `npm run lint`
3. `npm test`
4. `npm run build`
5. Si le diff touche SQL / migrations / RPC : `npm run test:sql:local` sur la stack test (gate manuelle, hors CI)

## Déploiement

D’après les fichiers présents :

- GitHub Actions exécute `npm ci`, `npm test`, `npm run lint` et `npm run build` sur les PR et sur `main`.
- Vercel construit la SPA avec `npm ci` puis `npm run build`, et sert `dist/`.
- `vercel.json` configure le fallback SPA et les headers de sécurité.
- Il n’existe pas de workflow de déploiement Supabase versionné dans le dépôt.

En pratique :

- le frontend est déployé par Vercel ;
- les migrations Supabase sont versionnées dans `supabase/migrations/`, mais leur application distante n’est pas automatisée par un workflow versionné dans ce dépôt ;
- les Edge Functions et les secrets serveur sont déployés ou configurés manuellement, avec vérification explicite de la cible.

## Règles de sécurité

- ne jamais committer de secrets ;
- ne jamais exposer une clé complète dans un log, un README ou un ticket ;
- ne jamais placer un secret serveur dans `.env.example` ;
- ne jamais présumer qu’un projet Supabase distant est “de dev” ou “de prod” sans vérification explicite de son hostname et de son contexte de déploiement.

## Dette acceptée (pour l’instant)

- `AdminPage` monolithique (split ultérieur)
- pas de React Query / cache global saison
- pas d’E2E Playwright
- session joueur en `localStorage` (modèle actuel)
- `strict: true` TypeScript non poussé au maximum (chantier séparé)
- source-scans de garde-fous sécurité / env conservés volontairement
- suites SQL hors CI Docker (gate locale volontaire)

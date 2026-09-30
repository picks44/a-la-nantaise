---
description: Diagnostic qualité et correctifs ciblés, sans évolution produit
---

# Code quality

Renforce lint, types, tests et lisibilité. Pas de feature, pas de bump, pas de changement métier.

## Niveaux d’effet

- **Lecture seule stricte** : lecture de fichiers, `git status`, `git diff`, `git log`. Aucune sortie générée.
- **Validation avec sorties générées** : `npm run typecheck` (écrit `node_modules/.tmp/*.tsbuildinfo`), `npm run lint`, `npm test`, et `npm run build` (écrit aussi `dist/`). Les sources du dépôt ne sont pas éditées.
- **Application** : édite les sources du périmètre, puis relance la validation.

## Modes

- Défaut : cadrage en lecture seule, puis validation, puis application seulement pour un correctif sûr, puis validation à nouveau.
- `dry-run` : lecture seule puis validation avec sorties générées. Pas d’édition de source. Ce n’est pas « zéro écriture » : `tsbuildinfo` et, si le build est lancé, `dist/` sont produits. L’annoncer dans le rapport.

Ne pas commit, push, tag, déployer, ni modifier `package.json` / `package-lock.json`.

## Entrées facultatives

`dry-run` ; périmètre (`src/`, `supabase/migrations/`, `tests/`, un fichier) ; contrainte (pas de Docker, pas de build).

## Application autorisée (défaut seulement)

Fichiers du périmètre, plus un test existant cassé par ce correctif. Pas de nouvelle page, RPC, migration ou dépendance. Pas de React Query, de découpage d’`AdminPage` ou de Playwright ajoutés à cette occasion : ce sont des évolutions, pas des correctifs de gate.

## Interdit, y compris en dry-run

`db:setup:realistic`, `db:sync:fixtures:local`, `db:seed:predictions:local`, `supabase db reset`, `supabase db push`, `git fetch`. Édition de `supabase/seed.sql`. Réintroduction d’API-Football, de Supabase Auth, de `recalculate_match_points(text, uuid)`. Affaiblir un test ou élargir la CSP pour faire passer un check.

`npm run test:sql:local` n’est pas une validation locale anodine : il peut reset la base test. Uniquement en mode défaut, uniquement si le diff touche `supabase/migrations/`, `supabase/tests/` ou une signature RPC, et si Docker n’a pas été interdit. S’il n’est pas lancé, le dire. Ne pas le présenter comme vert.

## Procédure

1. `git status`. Ne pas modifier un fichier déjà sale hors périmètre.
2. Lire les règles `00` à `50` qui matchent le périmètre.
3. Choisir les gates. Build seulement si le graphe Vite, la PWA ou un import de build est en cause, ou si l’utilisateur le demande. En `dry-run`, annoncer les fichiers générés avant de lancer.
4. Défaut : corriger un échec de gate ou un défaut local prouvé. Relancer la gate.
5. `dry-run` : décrire le correctif, ne pas l’écrire.

## Arrêt

Le correctif exigerait un changement de formule de points, de verrou SQL ou de contrat RPC non demandé. Un fichier hors périmètre est déjà modifié. L’environnement (Node, Docker) empêche une gate : le rapporter, ne pas contourner.

## Rapport

Mode, niveau d’effet réel, sorties générées, fichiers sources modifiés (aucun en `dry-run`), commandes et résultat, SQL test exécuté ou non.

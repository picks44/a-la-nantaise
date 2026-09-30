---
description: Audit des dépendances npm et plan par lots, sans application par défaut
---

# Update stack

Dépendances npm de ce dépôt unique, par lots.

## Modes

- Défaut / `dry-run` : **lecture seule stricte du dépôt**. Inventaire et plan. Interdit : modifier `package.json` ou `package-lock.json`, `npm install`, `npm update`, `npm audit fix`.
- `apply` : **application** du lot nommément accepté, puis validation avec sorties générées.

`npm outdated` peut utiliser le réseau et le cache npm. Il ne doit pas modifier les fichiers du dépôt. Si on le lance, le dire. Ne pas lancer `npm update` global ni `npm audit fix --force`.

Ne pas commit. Ne pas déployer.

## Runtime

Node `>=22.12.0`, `.nvmrc` = `22`, `packageManager` npm `11.17.0`. Pas de pnpm ni yarn. TypeScript 6 : ne pas passer à 7 sans accord. La CLI Supabase `2.111.0` est une exigence du README, hors `package.json`.

## Lots

1. Lire `package.json`, `package-lock.json`, `.nvmrc`, `vite.config.ts`, `tsconfig*.json`, `.oxlintrc.json`.
2. Classer patch, minor, major. Sensibles : `react`, `react-dom`, `vite`, `@vitejs/plugin-react`, `typescript`, `tailwindcss`, `@tailwindcss/vite`, `react-router-dom`, `@supabase/supabase-js`, `vite-plugin-pwa`, `oxlint`.
3. Proposer patch et minor d’abord. Isoler chaque major.
4. Stop, sauf `apply` sur un lot nommé.

## Apply

Un lot à la fois, versions explicites. Puis `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` (ces commandes écrivent `tsbuildinfo` et `dist/`). Pas de changement fonctionnel pour « profiter » de l’upgrade. Si `vite-plugin-pwa` bouge : Supabase doit rester `NetworkOnly`. Échec : ne pas enchaîner le lot suivant.

## Rapport

Runtime, mises à jour par sévérité, lot appliqué ou non, gates, majors reportées, fichiers de dépôt touchés.

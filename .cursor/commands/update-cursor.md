---
description: Réaligne rules et commands sur le dépôt, en lecture seule par défaut
---

# Update Cursor

Entretien de `.cursor/rules/*.mdc` et `.cursor/commands/*.md`.

## Modes

- Défaut / `dry-run` : **lecture seule stricte**. Propositions dans la réponse. Pas d’écriture, pas de build, pas de `git fetch`, pas de fichier de brouillon.
- `apply` : **application** sur les écarts prouvés dans `.cursor/` seulement. Pas de réécriture stylistique globale.

Ne pas modifier le code applicatif. Ne pas commit. Ne pas réécrire `.cursor/commands/mep.md` sauf chantier de publication demandé explicitement. Cette command n’est pas un préalable pour exécuter une opération demandée dans `/mep`.

## Fichiers attendus

Rules `00` à `50` et commands `code-quality`, `update-stack`, `update-docs`, `update-cursor`, `mep`. Pas de `settings.json`, pas de `ignore.json`, pas de commande native.

## Contrôles

- `alwaysApply: true` seulement sur `00`.
- Globs comparés à l’arborescence : `src/index.css` en `10` ; `PushNotificationsSection.tsx` et `schedule_push_reminders.example.sql` en `40` ; `tsconfig*.json`, `.oxlintrc.json`, `package-lock.json` en `50`.
- Les modes distinguent lecture seule stricte, validation avec sorties générées, et application. Aucun `dry-run` n’est décrit comme « zéro écriture » s’il autorise un build.
- Scripts : `test:sql:local` peut reset la stack test ; `db:setup:realistic` reset la dev ; `tsc -b` écrit des `tsbuildinfo` ; `vite build` écrit `dist/` ; `git fetch` écrit `.git`.
- Session client en `10`, grants et `search_path` en `20`. Pas de doublon long dans `00`.
- Versions lues dans `package.json` et `.nvmrc`.

## Apply

Corriger un fait périmé (script, route, glob, port). Ne pas transformer un état actuel en interdiction.

## Rapport

Écarts, fichiers proposés ou patchés, éléments laissés tels quels.

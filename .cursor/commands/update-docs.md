---
description: Rapproche le README et .env.example de l’implémentation
---

# Update docs

Aligne la documentation versionnée sur le code. Ne réécrit pas le produit.

## Modes

- `audit` : **lecture seule stricte**. Aucun fichier écrit, pas de `tsc`, pas de `vite build`, pas de `git fetch`, pas de dossier de travail généré.
- Défaut : **application** limitée à `README.md` et `.env.example`.

Ne pas modifier `src/`, `supabase/`, `scripts/` ni les tests. Ne pas commit.

Hors périmètre sauf demande explicite : recréer `docs/`, ajouter un CHANGELOG, recopier les identifiants du seed.

## Sources

`package.json`, `src/App.tsx`, le dossier `supabase/migrations/` (pas une plage recopiée), `import.meta.env`, les Edge Functions, `scripts/supabase-dev-guards.mjs`, `supabase/config.toml`, `.github/workflows/ci.yml`.

Migrations : comparer les bornes citées dans `README.md` au premier et au dernier fichier de `supabase/migrations/`. Ne pas recopier la liste. Le dossier reste la source.

## Arrêt

Fait non vérifiable ici (projet Supabase distant, cron réellement actif, déploiement Vercel) : « point à confirmer », pas un fait. Les corps de PR #1 à #6 décrivent des intentions de l’époque ; les reprendre seulement si le code actuel les confirme.

## Rapport

Mode, niveau d’effet, écarts, fichiers touchés, points à confirmer.

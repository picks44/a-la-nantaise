---
description: Préparation release par voies, sans publication par défaut
---

# MEP

Ce dépôt n’a pas de procédure de release versionnée (version `0.0.0`, pas de tag, pas de CHANGELOG, pas de workflow de deploy). Le mode par défaut ne publie rien et ne comble pas ce vide.

Il n’est pas nécessaire de modifier cette command pour qu’une demande explicite soit traitée.

## Modes

- Défaut : préparation. **Lecture seule stricte** sur les sources. Pas de `git fetch`, pas de build, pas de commit, push, tag, deploy, migration, ni déploiement de fonction.
- `refresh` : autorise **uniquement** `git fetch`, qui met à jour les refs sous `.git`. Puis reprendre le classement Git. Toujours pas de publication.
- Opération nommée : seulement si l’utilisateur demande une action précise (pousser la branche courante, appliquer une migration sur un project ref nommé, déployer une Edge Function nommée, promouvoir un déploiement Vercel identifié). Vérifier cible, périmètre et prérequis, exécuter cette action seule, ne pas enchaîner les autres voies.

`dry-run` est identique au défaut.

## Voies

Les rapporter toutes, même si Git est synchronisé. Un déploiement ou une migration peut rester nécessaire. Statuts autorisés : `vérifié`, `non vérifié`, `action requise`, `sans objet`.

- **Git.** Comparer `HEAD` à la ref locale `origin/main`. États : référence absente ; référence non rafraîchie (défaut, car pas de fetch) ; à jour ; en avance ; en retard ; divergent. En avance et en retard ensemble = divergent. Ne pas s’arrêter quand c’est à jour.
- **Frontend.** `vercel.json` et le README décrivent un build Vercel. Sans interrogation Vercel dans cette exécution : `non vérifié`. `action requise` seulement si l’utilisateur a demandé ce déploiement et que la cible est identifiée, ou si un échec de déploiement est sous les yeux.
- **Migrations distantes.** Fichiers dans `supabase/migrations/`. Aucun project ref versionné, aucun workflow d’apply. Sans preuve d’apply sur la cible : `non vérifié`. Ce n’est pas `sans objet` seulement parce que Git est à jour.
- **Edge Functions.** `sync-fc-nantes` et `send-prediction-reminders` sont dans le dépôt. Leur déploiement distant est `non vérifié` sans preuve.
- **Secrets et cron.** Exemples : `schedule_fixture_sync.example.sql`, `schedule_push_reminders.example.sql`, noms Vault dans le README. Présence réelle : `non vérifié`. La PR #2 (août 2026) disait le cron quotidien déjà actif : ne pas le recopier comme un état actuel.

`vérifié` exige une preuve de cette exécution (sortie de commande, réponse d’API, fichier). `sans objet` seulement si la voie ne s’applique pas au diff ou à la demande (exemple : opération nommée « push Git » et aucune fonction à déployer dans cette demande — la voie Edge de cette opération est `sans objet`, mais le rapport de préparation par défaut ne marque pas Edge `sans objet`).

## Procédure par défaut

1. `git status`, `git branch --show-current`, `git rev-parse --verify origin/main` sans fetch.
2. Si `origin/main` manque : Git = référence absente. Continuer les autres voies.
3. Sinon `git rev-list --left-right --count origin/main...HEAD`. Indiquer : « comparaison avec la référence locale ; état distant actuel non vérifié ». `git log -1 --format=%ci origin/main` donne la date du commit référencé, pas celle du dernier fetch.
4. Working tree sale : le signaler. Ne pas le ranger. Ne pas stopper les autres voies.
5. Résumer `git log --oneline origin/main..HEAD` et `HEAD..origin/main` s’il y a des commits. Classer le diff : frontend, SQL, Edge, PWA, docs.
6. Ne pas lancer les gates dans le défaut. Les proposer. Si l’utilisateur demande de les exécuter ici, c’est une validation avec sorties générées (`typecheck`, `lint`, `test`, éventuellement `build`), à annoncer avant.
7. Remplir les cinq statuts. Ne pas conclure « rien à faire » parce que Git est à jour.

## Opération nommée

1. Cible : remote Git, projet Vercel, ou project ref Supabase. Si elle n’est pas prouvée (hostname, ref, environnement), s’arrêter et demander cette cible. Ne pas deviner prod ou preview.
2. Périmètre : fichiers ou fonctions concernés, et rien d’autre.
3. Prérequis : gates adaptées. SQL : rappeler que `test:sql:local` reset la stack test et ne prouve pas la base distante. Secrets : ne pas les afficher.
4. Exécuter uniquement l’action demandée. Une migration distante n’entraîne pas un déploiement frontend, et l’inverse non plus.
5. Rapport : action, cible, résultat, voies non touchées.

## Arrêt

Cible inconnue. Branche ou environnement autre que celui demandé. Gate échouée. La demande reste globale (« fais la mep ») sans nommer une action : rester en préparation et lister les voies `non vérifié`, sans inventer l’enchaînement.

## Rapport

Pour chaque voie : statut et preuve ou absence de preuve. État Git parmi : absente, non rafraîchie, à jour, en avance, en retard, divergent. Actions faites, ou aucune.

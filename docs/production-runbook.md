# Runbook production — À la Nantaise

Procédures de diagnostic et d’intervention en production. Public visé :
mainteneur(s) du projet, en astreinte ou en support ponctuel.

**Règle transversale : ne jamais coller de secret ou de donnée personnelle dans
un ticket, une capture d’écran, un message Slack ou ce document.** Voir
[Ce qu’il ne faut jamais copier dans un ticket](#ce-quil-ne-faut-jamais-copier-dans-un-ticket).

## Sommaire

- [1. Vérifier le déploiement Vercel](#1-vérifier-le-déploiement-vercel)
- [2. Vérifier les migrations Supabase](#2-vérifier-les-migrations-supabase)
- [3. Consulter les logs](#3-consulter-les-logs)
- [4. Vérifier la synchronisation Fixture Download](#4-vérifier-la-synchronisation-fixture-download)
- [5. Diagnostiquer un échec de synchronisation](#5-diagnostiquer-un-échec-de-synchronisation)
- [6. Diagnostiquer les notifications Push / VAPID](#6-diagnostiquer-les-notifications-push--vapid)
- [7. Révoquer une session compromise](#7-révoquer-une-session-compromise)
- [8. Réagir à un verrouillage admin (ADMIN_LOCKED)](#8-réagir-à-un-verrouillage-admin-admin_locked)
- [9. Vérifications post-incident](#9-vérifications-post-incident)
- [Ce qu’il ne faut jamais copier dans un ticket](#ce-quil-ne-faut-jamais-copier-dans-un-ticket)
- [10. Sauvegardes (checklist)](#10-sauvegardes-checklist)

---

## 1. Vérifier le déploiement Vercel

1. Ouvrir le projet sur [vercel.com](https://vercel.com) → onglet **Deployments**.
2. Confirmer que le déploiement **Production** le plus récent correspond au
   dernier commit attendu sur `main` :
   - comparer le hash court affiché par Vercel avec `git log -1 --format=%h main` ;
   - vérifier l’horodatage (« Ready » + date/heure).
3. Si le déploiement le plus récent n’est pas celui attendu :
   - vérifier qu’il n’y a pas de build en échec au-dessus dans la liste ;
   - vérifier que le webhook GitHub → Vercel a bien déclenché un build (onglet
     **Deployments**, filtrer par branche `main`).
4. Vérifier les variables d’environnement (Production) : `VITE_SUPABASE_URL`,
   `VITE_SUPABASE_ANON_KEY`, et si les rappels sont actifs, `VITE_VAPID_PUBLIC_KEY`.
   Ne jamais afficher leur valeur dans un ticket — seule leur **présence**
   (✅/❌) doit être notée.

## 2. Vérifier les migrations Supabase

```bash
supabase migration list --linked
```

- Toutes les migrations présentes dans `supabase/migrations/` doivent
  apparaître comme **appliquées** côté distant (colonne `Remote`).
- Une migration présente en local mais absente côté distant signifie qu’elle
  n’a pas encore été exécutée en production : ne pas déployer un frontend qui
  suppose son application.
- En cas de doute sur une fonction précise, vérifier sa signature directement
  dans le **SQL Editor** :

```sql
SELECT proname, pg_get_function_identity_arguments(oid)
FROM pg_proc
WHERE proname = 'nom_de_la_fonction';
```

### Ordre de déploiement sûr

1. **Vérifier la cible distante** avant toute action (`supabase link` n’est pas versionné dans le dépôt).
2. **Appliquer toutes les migrations requises** présentes dans `supabase/migrations/`.
3. **Déployer ensuite les Edge Functions concernées**.
4. **Déployer enfin le frontend Vercel**.

Le dépôt local inclut déjà la migration
`20260804160000_drop_admin_code_auth_compat` : en l’état actuel du code,
considérer les sessions opaques admin comme le comportement attendu.

## 3. Consulter les logs

### Vercel (runtime / build)

- **Deployments → (déploiement) → Runtime Logs** : erreurs côté edge/serveur
  Vercel (rare ici, l’app est une SPA statique).
- **Deployments → (déploiement) → Build Logs** : échecs de build (`npm run build`).

### Supabase

Dans le dashboard du projet :

- **Logs → API** : requêtes REST/RPC, codes HTTP, latence.
- **Logs → Postgres** : erreurs SQL, `RAISE EXCEPTION`, deadlocks.
- **Logs → Edge Functions** : logs de `sync-fc-nantes` et
  `send-prediction-reminders` (si déployée).
- **Database → Cron** ou requête directe (voir §4) pour l’historique des jobs
  planifiés.

Filtrer par plage horaire précise (heure de l’incident signalé) plutôt que de
parcourir l’ensemble des logs.

## 4. Vérifier la synchronisation Fixture Download

Trois signaux à croiser :

1. **Dernière exécution Cron** :

```sql
SELECT status, start_time, end_time, return_message
FROM cron.job_run_details
WHERE jobid = (
  SELECT jobid FROM cron.job
  WHERE jobname = 'a-la-nantaise-daily-fixture-sync'
)
ORDER BY start_time DESC
LIMIT 10;
```

2. **Réponse HTTP renvoyée par `pg_net`** (si le Cron utilise `net.http_post`) :

```sql
SELECT id, status_code, created, error_msg
FROM net._http_response
ORDER BY created DESC
LIMIT 10;
```

3. **Horodatage métier de la dernière synchro réussie** (table `app_settings`
   ou colonne dédiée selon la migration en place) :

```sql
SELECT key, value, updated_at
FROM public.app_settings
WHERE key = 'fixture_sync_last_at';
```

Si cette clé n’existe pas encore dans l’environnement inspecté, se référer à
la colonne `last_synced_at` sur `public.matches` (`MAX(last_synced_at)`) comme
proxy.

Un job Cron « succeeded » mais avec un `fixture_sync_last_at` ancien indique un
problème **après** l’appel HTTP (voir §5).

## 5. Diagnostiquer un échec de synchronisation

Ordre de vérification recommandé :

1. **Le Cron s’est-il déclenché ?** → `cron.job_run_details` (§4.1). Sinon,
   vérifier que le job est toujours actif :

```sql
SELECT jobname, schedule, active FROM cron.job
WHERE jobname = 'a-la-nantaise-daily-fixture-sync';
```

2. **L’appel HTTP a-t-il atteint l’Edge Function ?** → `net._http_response`
   (§4.2) et **Logs → Edge Functions** dans le dashboard Supabase.
3. **L’authentification a-t-elle échoué ?** Chercher dans les logs Edge Function
   un refus `INVALID_ADMIN_SESSION` ou `INVALID_ADMIN_CODE` :
   - si le Cron utilise un `admin_code` Vault, vérifier que le secret
     `fixture_sync_admin_code` correspond toujours au code administrateur
     actuel (il change si `/admin` → Réglages → code admin a été modifié) ;
   - un appel client (admin connecté) doit apparaître avec un
     `admin_session_token`, jamais un code en clair.
4. **Le flux source a-t-il été refusé par la validation ?** Chercher dans les
   logs Edge Function un message de validation (34 matchs attendus, journées
   1–34 uniques, FC Nantes présent, scores cohérents). Un flux incohérent est
   **entièrement rejeté** : aucune donnée n’est modifiée, c’est le
   comportement attendu, pas une régression à corriger en urgence.
5. **Un override manuel bloque-t-il la mise à jour attendue ?** Un match avec
   `manual_override = true` ne sera jamais réécrit par la sync — c’est
   volontaire. Vérifier dans `/admin` → Matchs si la pastille « Modifié
   manuellement » est présente sur le match concerné.

Si aucun de ces points n’explique l’écart, relancer une synchronisation
manuelle depuis `/admin` → Matchs → **Synchroniser les matchs** et observer le
résumé affiché (créés / mis à jour / inchangés / protégés) ainsi que les logs
Edge Function en direct.

## 6. Diagnostiquer les notifications Push / VAPID

**Ne jamais afficher, logger ou copier une clé VAPID (publique ou privée), un
`endpoint` de souscription push complet, ou le contenu de `VAPID_KEYS_JSON`.**

1. **Le flag d’envoi est-il activé ?**

```sql
SELECT value, updated_at FROM public.app_settings
WHERE key = 'push_sending_enabled';
```

2. **Le frontend a-t-il une clé VAPID publique configurée ?** Ne pas lire la
   valeur — vérifier uniquement côté build/Vercel que `VITE_VAPID_PUBLIC_KEY`
   est **présente** (✅/❌) dans les variables d’environnement du projet. Le
   frontend expose `isVapidPublicKeyConfigured()` (`src/lib/vapid.ts`) : une
   valeur absente ou visiblement non éditée (contient `YOUR_`) fait basculer
   l’UI Paramètres sur l’état « rappels non configurés », sans erreur bruyante.
3. **Le Cron push tourne-t-il ?**

```sql
SELECT status, start_time, end_time, return_message
FROM cron.job_run_details
WHERE jobid = (
  SELECT jobid FROM cron.job
  WHERE jobname = 'a-la-nantaise-push-reminders'
)
ORDER BY start_time DESC
LIMIT 10;
```

4. **Tester en dry-run** (jamais destructif, n’envoie rien, ne nécessite pas
   les clés VAPID) : invoquer l’Edge Function `send-prediction-reminders` avec
   `{ "cron_secret": "…", "dry_run": true }`. Vérifier uniquement le résumé
   retourné (nombre de rappels éligibles), pas le contenu détaillé des
   souscriptions.
5. **Un appareil ne reçoit plus de rappel ?**
   - vérifier que sa souscription existe toujours côté serveur
     (`SELECT count(*) FROM public.push_subscriptions WHERE player_id = '<id>'`,
     sans jamais sélectionner ni afficher la colonne `endpoint` ou `keys`) ;
   - vérifier `attempt_count` sur la dernière livraison pour ce joueur :
     3 tentatives échouées = plus de nouvelle tentative jusqu’au prochain
     abonnement ;
   - sur iPhone/iPad, confirmer que l’app est installée en PWA
     (écran d’accueil) et non ouverte dans un onglet Safari classique.
6. **Rollback immédiat si un incident d’envoi est suspecté :**

```sql
UPDATE public.app_settings
SET value = 'false', updated_at = now()
WHERE key = 'push_sending_enabled';

SELECT cron.unschedule('a-la-nantaise-push-reminders');
```

## 7. Révoquer une session compromise

### Session joueur

```sql
UPDATE public.player_sessions
SET revoked_at = now()
WHERE player_id = '<player_id>'
  AND revoked_at IS NULL;
```

Le joueur sera invité à se reconnecter (code d’accès + pseudo + PIN) à la
prochaine action. Pour forcer aussi un changement de PIN à la reconnexion,
utiliser `admin_reset_player_pin` depuis `/admin` plutôt qu’une requête SQL
directe (il génère un PIN temporaire et positionne `must_change_pin`).

### Session admin

```sql
UPDATE public.admin_sessions
SET revoked_at = now()
WHERE revoked_at IS NULL;
```

Révoque **toutes** les sessions admin actives (il n’y a normalement qu’un seul
administrateur). Après révocation, ré-authentifier via `/admin` avec le code
administrateur actuel — `login_admin` révoque déjà automatiquement les
anciennes sessions à chaque connexion réussie, cette requête n’est donc utile
qu’en cas d’urgence (ex. suspicion de vol de jeton) avant qu’une nouvelle
connexion n’ait lieu.

### Changer le code d’accès du groupe ou le code admin

- Code d’accès groupe : `/admin` → Réglages → Code d’accès du groupe (voir
  `README.md`, section « Modifier le code d’accès commun »).
- Code administrateur : mise à jour manuelle par requête SQL (voir
  `README.md`, section 5). Il n’existe pas d’écran self-service pour ce code
  précis — c’est volontaire.

## 8. Réagir à un verrouillage admin (ADMIN_LOCKED)

`login_admin` verrouille l’accès admin pendant **15 minutes** après 5 échecs
consécutifs.

1. Vérifier l’état actuel :

```sql
SELECT failed_attempts, locked_until
FROM public.admin_auth_state
WHERE id = TRUE;
```

2. Si le verrouillage est légitime (code oublié, plusieurs essais infructueux
   par un humain) : **attendre l’expiration** (`locked_until`) plutôt que de
   contourner le mécanisme.
3. Si le verrouillage bloque une intervention urgente et que l’identité de la
   personne qui tente de se connecter est certaine, déverrouiller
   manuellement :

```sql
UPDATE public.admin_auth_state
SET failed_attempts = 0, locked_until = NULL
WHERE id = TRUE;
```

4. Si le volume d’échecs suggère une tentative de force brute externe (pas un
   oubli interne) : traiter comme un incident de sécurité — voir §9 — et
   envisager un changement du code administrateur une fois l’accès rétabli.

## 9. Vérifications post-incident

Une fois l’incident résolu, avant de clôturer :

- [ ] La cause racine est identifiée et documentée (pas seulement contournée).
- [ ] Les migrations attendues sont toutes marquées comme appliquées (§2).
- [ ] `fixture_sync_last_at` (ou équivalent) reflète une synchronisation
      récente et cohérente (§4).
- [ ] Aucune session admin ou joueur suspecte ne reste active
      (`SELECT count(*) FROM public.admin_sessions WHERE revoked_at IS NULL`
      doit correspondre au nombre de sessions légitimes attendues).
- [ ] `push_sending_enabled` est dans l’état voulu (activé seulement si les
      rappels doivent repartir).
- [ ] Le Cron `a-la-nantaise-daily-fixture-sync` (et `a-la-nantaise-push-reminders`
      si actif) est toujours planifié et actif.
- [ ] Aucun secret, code, PIN ou jeton n’a été laissé dans un ticket, un
      message ou ce document (voir section suivante).
- [ ] Un résumé de l’incident (cause, impact, correctif, date) est consigné
      dans l’outil de suivi habituel — sans données sensibles.

## Ce qu’il ne faut jamais copier dans un ticket

Ne **jamais** coller, logger, capturer à l’écran ou envoyer par message :

- le **code d’accès** du groupe (en clair ou hashé) ;
- un **PIN** joueur (temporaire ou définitif) ;
- le **code administrateur** ;
- un **jeton de session** (joueur ou admin), y compris tronqué ;
- les **scores pronostiqués** par un joueur (donnée personnelle du jeu) ;
- un **endpoint push complet** ou le contenu de `VAPID_KEYS_JSON`.

En cas de besoin de preuve pour un ticket, préférer :

- un **identifiant** (`player_id`, `match_id`, nom de job Cron) plutôt que la
  donnée elle-même ;
- un **statut booléen** (« le secret est présent », « la session existe »)
  plutôt que la valeur ;
- un **horodatage** ou un **code d’erreur** (`ADMIN_LOCKED`,
  `MATCH_KICKOFF_UNCONFIRMED`, …) plutôt qu’un extrait de payload brut.

## 10. Sauvegardes (checklist)

**À vérifier dans le dashboard Supabase** (Project Settings → Database →
Backups) — cette section liste les points à confirmer plutôt que des valeurs
figées, car ils dépendent du plan Supabase souscrit et peuvent changer :

- [ ] Les sauvegardes automatiques sont **activées** — à vérifier dans le
      dashboard Supabase.
- [ ] Date/heure de la **dernière sauvegarde** réussie — à vérifier dans le
      dashboard Supabase.
- [ ] **Durée de rétention** des sauvegardes (nombre de jours conservés) — à
      vérifier dans le dashboard Supabase.
- [ ] Disponibilité du **Point-in-Time Recovery (PITR)** et, si activé,
      fenêtre de restauration couverte — à vérifier dans le dashboard Supabase.
- [ ] **Propriétaire** de la responsabilité de vérification périodique des
      sauvegardes (qui contrôle, à quelle fréquence) — à documenter en dehors
      de ce fichier si nécessaire.
- [ ] **Fréquence de vérification** convenue (ex. mensuelle) — à définir.
- [ ] Procédure de **restauration** connue et testée (étapes exactes dans le
      dashboard Supabase, temps d’indisponibilité attendu) — à vérifier dans
      le dashboard Supabase.
- [ ] Un **test de restauration en staging** (projet Supabase séparé, jamais
      sur la production) a été réalisé au moins une fois — à planifier si ce
      n’est pas encore fait.
- [ ] **Vérifications post-restauration** définies : au minimum, contrôler
      après une restauration que les migrations listées dans
      `supabase/migrations/` sont toutes appliquées (§2), que
      `verify_access_code` et `verify_admin_code` répondent correctement, et
      que le nombre de joueurs actifs / matchs correspond à l’attendu avant de
      rouvrir l’accès aux participants.

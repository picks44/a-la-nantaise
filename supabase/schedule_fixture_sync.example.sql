-- Planification de la synchronisation Fixture Download.
--
-- Prérequis : créer ces trois secrets dans Supabase Vault avant d'exécuter
-- ce script (voir README) :
--   project_url               https://<project-ref>.supabase.co
--   function_anon_key         clé anon JWT du projet (jamais une clé privilégiée)
--   fixture_sync_admin_code   code administrateur de l'application
--
-- Les valeurs restent chiffrées dans Vault et ne sont jamais inscrites dans
-- la définition du job Cron.
--
-- Schedules pg_cron : UTC (ne pas changer la timezone globale de pg_cron).
--
-- Jobs :
--   daily       15 5 * * *   → sync toujours (filet calendrier + résultats)
--   conditional */15 * * * * → sync-fc-nantes SEULEMENT si
--                              public.fixture_result_sync_is_needed()
--                              (kickoff confirmé + 105 min, non terminal,
--                               sans plafond : rattrapage hors fenêtre soir)
--
-- Source de vérité : matches.kickoff_at (TIMESTAMPTZ) + kickoff_time_confirmed.
-- Aucune dépendance à l’heure locale Paris ni au DST.

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

DO $check_secrets$
DECLARE
  missing_names TEXT[];
BEGIN
  SELECT array_agg(required.name ORDER BY required.name)
  INTO missing_names
  FROM (
    VALUES
      ('project_url'),
      ('function_anon_key'),
      ('fixture_sync_admin_code')
  ) AS required(name)
  WHERE NOT EXISTS (
    SELECT 1
    FROM vault.decrypted_secrets AS secret
    WHERE secret.name = required.name
  );

  IF missing_names IS NOT NULL THEN
    RAISE EXCEPTION
      'Secrets Vault manquants : %',
      array_to_string(missing_names, ', ');
  END IF;
END
$check_secrets$;

-- Prérequis : migration fixture_result_sync_is_needed déjà appliquée.
DO $check_predicate$
BEGIN
  IF to_regprocedure('public.fixture_result_sync_is_needed()') IS NULL THEN
    RAISE EXCEPTION
      'Fonction public.fixture_result_sync_is_needed() absente. '
      'Appliquer la migration 20260810130000 avant ce script Ops.';
  END IF;
END
$check_predicate$;

-- Rend le script rejouable : l'ancien job daily portant ce nom est remplacé.
DO $replace_daily$
DECLARE
  existing_job_id BIGINT;
BEGIN
  SELECT jobid
  INTO existing_job_id
  FROM cron.job
  WHERE jobname = 'a-la-nantaise-daily-fixture-sync';

  IF existing_job_id IS NOT NULL THEN
    PERFORM cron.unschedule(existing_job_id);
  END IF;
END
$replace_daily$;

-- Tous les jours à 05:15 UTC (filet de sécurité — toujours synchroniser).
SELECT cron.schedule(
  'a-la-nantaise-daily-fixture-sync',
  '15 5 * * *',
  $job$
  SELECT net.http_post(
    url := (
      SELECT decrypted_secret
      FROM vault.decrypted_secrets
      WHERE name = 'project_url'
    ) || '/functions/v1/sync-fc-nantes',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', (
        SELECT decrypted_secret
        FROM vault.decrypted_secrets
        WHERE name = 'function_anon_key'
      ),
      'Authorization', 'Bearer ' || (
        SELECT decrypted_secret
        FROM vault.decrypted_secrets
        WHERE name = 'function_anon_key'
      )
    ),
    body := jsonb_build_object(
      'admin_code', (
        SELECT decrypted_secret
        FROM vault.decrypted_secrets
        WHERE name = 'fixture_sync_admin_code'
      )
    ),
    timeout_milliseconds := 20000
  ) AS request_id;
  $job$
);

-- Remplace uniquement le job conditionnel (+ nettoie d’anciens evening/late
-- s’ils avaient été créés manuellement). Ne touche PAS au daily ici.
DO $replace_conditional$
DECLARE
  existing_job_id BIGINT;
  job_name TEXT;
BEGIN
  FOREACH job_name IN ARRAY ARRAY[
    'a-la-nantaise-conditional-fixture-sync',
    'a-la-nantaise-evening-fixture-sync',
    'a-la-nantaise-late-fixture-sync'
  ]
  LOOP
    SELECT jobid
    INTO existing_job_id
    FROM cron.job
    WHERE jobname = job_name;

    IF existing_job_id IS NOT NULL THEN
      PERFORM cron.unschedule(existing_job_id);
    END IF;
  END LOOP;
END
$replace_conditional$;

-- Toutes les 15 minutes UTC : appelle sync-fc-nantes seulement si un match
-- est passé de 105 min sans statut terminal (rattrapage inclus).
SELECT cron.schedule(
  'a-la-nantaise-conditional-fixture-sync',
  '*/15 * * * *',
  $job$
  SELECT net.http_post(
    url := (
      SELECT decrypted_secret
      FROM vault.decrypted_secrets
      WHERE name = 'project_url'
    ) || '/functions/v1/sync-fc-nantes',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', (
        SELECT decrypted_secret
        FROM vault.decrypted_secrets
        WHERE name = 'function_anon_key'
      ),
      'Authorization', 'Bearer ' || (
        SELECT decrypted_secret
        FROM vault.decrypted_secrets
        WHERE name = 'function_anon_key'
      )
    ),
    body := jsonb_build_object(
      'admin_code', (
        SELECT decrypted_secret
        FROM vault.decrypted_secrets
        WHERE name = 'fixture_sync_admin_code'
      )
    ),
    timeout_milliseconds := 20000
  ) AS request_id
  WHERE public.fixture_result_sync_is_needed();
  $job$
);

-- Contrôle rapide :
SELECT jobid, jobname, schedule, active
FROM cron.job
WHERE jobname IN (
  'a-la-nantaise-daily-fixture-sync',
  'a-la-nantaise-conditional-fixture-sync'
)
ORDER BY jobname;

-- Santé sync (lecture seule, aucune secret) :
-- cron.job_run_details = succeeded confirme seulement net.http_post,
-- pas le succès HTTP ni le commit applicatif.
SELECT key, left(value, 120) AS value_preview, updated_at
FROM public.app_settings
WHERE key LIKE 'fixture_sync_%'
ORDER BY key;

SELECT public.fixture_result_sync_is_needed();

-- Checklist Vault (présence uniquement, jamais les valeurs) :
--   project_url
--   function_anon_key          → même JWT anon que l’Edge Function
--   fixture_sync_admin_code    → même code que admin_code_hash (login_admin)
-- Un code Vault incorrect incrémente admin_auth_state et peut locker l’admin.

-- Rollback ciblé (conditional uniquement) :
-- SELECT cron.unschedule('a-la-nantaise-conditional-fixture-sync');
-- Ne jamais unschedule le daily ici.
--
-- Désactiver le daily (ops séparée) :
-- SELECT cron.unschedule('a-la-nantaise-daily-fixture-sync');

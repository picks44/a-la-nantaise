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
-- Correspondance Europe/Paris :
--   15 5  * * *  → 07:15 été / 06:15 hiver
--   30 21 * * *  → 23:30 été / 22:30 hiver
--   15 22 * * *  → 00:15 été / 23:15 hiver
-- Le décalage DST n’est volontairement pas corrigé dans ce lot.

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

-- Rend le script rejouable : l'ancien job portant ce nom est remplacé.
DO $replace_job$
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
$replace_job$;

-- Tous les jours à 05:15 UTC (07:15 à Paris l'été, 06:15 l'hiver).
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

-- Remplace uniquement evening / late (JAMAIS le daily dans ce bloc).
DO $replace_evening_late$
DECLARE
  existing_job_id BIGINT;
  job_name TEXT;
BEGIN
  FOREACH job_name IN ARRAY ARRAY[
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
$replace_evening_late$;

-- Soir : 21:30 UTC = 23:30 Paris (été) / 22:30 Paris (hiver).
SELECT cron.schedule(
  'a-la-nantaise-evening-fixture-sync',
  '30 21 * * *',
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

-- Rattrapage : 22:15 UTC = 00:15 Paris (été) / 23:15 Paris (hiver).
SELECT cron.schedule(
  'a-la-nantaise-late-fixture-sync',
  '15 22 * * *',
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

-- Contrôle rapide :
SELECT jobid, jobname, schedule, active
FROM cron.job
WHERE jobname IN (
  'a-la-nantaise-daily-fixture-sync',
  'a-la-nantaise-evening-fixture-sync',
  'a-la-nantaise-late-fixture-sync'
)
ORDER BY jobname;

-- Rollback ciblé (evening / late uniquement) :
-- SELECT cron.unschedule('a-la-nantaise-evening-fixture-sync');
-- SELECT cron.unschedule('a-la-nantaise-late-fixture-sync');
-- Ne jamais unschedule le daily ici.
--
-- Désactiver le daily (ops séparée) :
-- SELECT cron.unschedule('a-la-nantaise-daily-fixture-sync');

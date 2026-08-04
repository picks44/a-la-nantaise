-- Planification fréquente de sync-api-football (tick local-first).
--
-- Prérequis Vault :
--   project_url
--   function_anon_key          (Authorization bearer pour Edge)
--   api_football_cron_secret   (header x-api-football-cron-secret)
--
-- La fonction lit d’abord l’état local et n’appelle API-Football que si nécessaire.
-- Ne jamais exposer ce secret côté frontend.

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
      ('api_football_cron_secret')
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

SELECT cron.unschedule(jobid)
FROM cron.job
WHERE jobname = 'aln-api-football-tick';

SELECT cron.schedule(
  'aln-api-football-tick',
  '*/2 * * * *',
  $$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url')
      || '/functions/v1/sync-api-football',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (
        SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'function_anon_key'
      ),
      'x-api-football-cron-secret', (
        SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'api_football_cron_secret'
      )
    ),
    body := jsonb_build_object('mode', 'tick')
  );
  $$
);

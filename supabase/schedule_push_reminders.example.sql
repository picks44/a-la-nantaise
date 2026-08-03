-- Planification des rappels de pronostic (Web Push) — EXEMPLE, non activé.
--
-- Prérequis Vault (noms uniquement) :
--   project_url
--   function_anon_key
--   push_reminders_cron_secret   même valeur que le secret Edge PUSH_CRON_SECRET
--
-- Ne PAS exécuter avant :
--   1) smoke test aes128gcm de l’Edge Function ;
--   2) envoi réel Chrome/Android ou desktop ;
--   3) envoi réel PWA iPhone/iPad ;
--   4) flag app_settings.push_sending_enabled = 'true'.
--
-- Par défaut ce script crée le job en active = false si supporté,
-- sinon commente la ligne cron.schedule jusqu’à validation.

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
      ('push_reminders_cron_secret')
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

DO $replace_job$
DECLARE
  existing_job_id BIGINT;
BEGIN
  SELECT jobid
  INTO existing_job_id
  FROM cron.job
  WHERE jobname = 'a-la-nantaise-push-reminders';

  IF existing_job_id IS NOT NULL THEN
    PERFORM cron.unschedule(existing_job_id);
  END IF;
END
$replace_job$;

-- Toutes les 15 minutes. Laisser commenté jusqu’à validation manuelle.
-- SELECT cron.schedule(
--   'a-la-nantaise-push-reminders',
--   '*/15 * * * *',
--   $job$
--   SELECT net.http_post(
--     url := (
--       SELECT decrypted_secret
--       FROM vault.decrypted_secrets
--       WHERE name = 'project_url'
--     ) || '/functions/v1/send-prediction-reminders',
--     headers := jsonb_build_object(
--       'Content-Type', 'application/json',
--       'apikey', (
--         SELECT decrypted_secret
--         FROM vault.decrypted_secrets
--         WHERE name = 'function_anon_key'
--       ),
--       'Authorization', 'Bearer ' || (
--         SELECT decrypted_secret
--         FROM vault.decrypted_secrets
--         WHERE name = 'function_anon_key'
--       )
--     ),
--     body := jsonb_build_object(
--       'cron_secret', (
--         SELECT decrypted_secret
--         FROM vault.decrypted_secrets
--         WHERE name = 'push_reminders_cron_secret'
--       )
--     ),
--     timeout_milliseconds := 25000
--   ) AS request_id;
--   $job$
-- );

-- Contrôle :
-- SELECT jobid, jobname, schedule, active
-- FROM cron.job
-- WHERE jobname = 'a-la-nantaise-push-reminders';

-- Désactivation immédiate :
-- SELECT cron.unschedule('a-la-nantaise-push-reminders');

-- Activation des envois (après smoke tests) :
-- UPDATE public.app_settings
-- SET value = 'true', updated_at = now()
-- WHERE key = 'push_sending_enabled';

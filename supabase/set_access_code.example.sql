-- Définir le hash du code commun (à exécuter une seule fois dans le SQL Editor).
-- Remplace TON_CODE_ICI par le vrai code. Ne committe jamais ce fichier rempli.
--
-- Exemple :
--   UPDATE public.app_settings
--   SET value = extensions.crypt('TON_CODE_ICI', extensions.gen_salt('bf')),
--       updated_at = now()
--   WHERE key = 'access_code_hash';

UPDATE public.app_settings
SET
  value = extensions.crypt('TON_CODE_ICI', extensions.gen_salt('bf')),
  updated_at = now()
WHERE key = 'access_code_hash';

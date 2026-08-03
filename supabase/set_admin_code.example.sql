-- Définir le hash du code administrateur (SQL Editor Supabase).
-- Remplace TON_CODE_ADMIN par le vrai code. Ne committe jamais ce fichier rempli.

INSERT INTO public.app_settings (key, value)
VALUES ('admin_code_hash', '')
ON CONFLICT (key) DO NOTHING;

UPDATE public.app_settings
SET
  value = extensions.crypt('TON_CODE_ADMIN', extensions.gen_salt('bf')),
  updated_at = now()
WHERE key = 'admin_code_hash';

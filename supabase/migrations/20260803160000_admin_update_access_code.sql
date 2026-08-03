-- À la Nantaise — modification du code d’accès commun depuis l’administration
-- Aucune table ni donnée existante n’est supprimée.

CREATE OR REPLACE FUNCTION public.admin_update_access_code(
  p_admin_code TEXT,
  p_new_access_code TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  cleaned TEXT;
  existing_key TEXT;
  updated_rows INTEGER;
BEGIN
  PERFORM public.assert_admin_code(p_admin_code);

  cleaned := trim(COALESCE(p_new_access_code, ''));

  IF cleaned = '' THEN
    RAISE EXCEPTION 'INVALID_ACCESS_CODE'
      USING ERRCODE = '22023',
            DETAIL = 'Le nouveau code d’accès est vide.';
  END IF;

  IF char_length(cleaned) < 4 OR char_length(cleaned) > 64 THEN
    RAISE EXCEPTION 'INVALID_ACCESS_CODE_LENGTH'
      USING ERRCODE = '22023',
            DETAIL = 'Le code d’accès doit contenir entre 4 et 64 caractères.';
  END IF;

  SELECT s.key
  INTO existing_key
  FROM public.app_settings AS s
  WHERE s.key = 'access_code_hash';

  IF existing_key IS NULL THEN
    RAISE EXCEPTION 'ACCESS_CODE_NOT_CONFIGURED'
      USING ERRCODE = 'P0001',
            DETAIL = 'La clé access_code_hash est absente.';
  END IF;

  UPDATE public.app_settings AS s
  SET
    value = extensions.crypt(cleaned, extensions.gen_salt('bf')),
    updated_at = now()
  WHERE s.key = 'access_code_hash';

  GET DIAGNOSTICS updated_rows = ROW_COUNT;

  IF updated_rows <> 1 THEN
    RAISE EXCEPTION 'ACCESS_CODE_NOT_CONFIGURED'
      USING ERRCODE = 'P0001',
            DETAIL = 'Impossible de mettre à jour access_code_hash.';
  END IF;

  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_update_access_code(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_update_access_code(TEXT, TEXT) TO anon, authenticated;

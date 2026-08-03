-- Tests manuels pour les RPC push (abonnements via session).
-- Exécuter dans une transaction : BEGIN; … ; ROLLBACK;

BEGIN;

UPDATE public.app_settings
SET
  value = extensions.crypt('test-code-aln', extensions.gen_salt('bf')),
  updated_at = now()
WHERE key = 'access_code_hash';

INSERT INTO public.app_settings (key, value)
SELECT 'access_code_hash', extensions.crypt('test-code-aln', extensions.gen_salt('bf'))
WHERE NOT EXISTS (
  SELECT 1 FROM public.app_settings AS s WHERE s.key = 'access_code_hash'
);

INSERT INTO public.players (
  id, display_name, is_active, pin_hash, must_change_pin
)
VALUES
  (
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa01',
    'Push Joueur A',
    TRUE,
    extensions.crypt('1111', extensions.gen_salt('bf')),
    FALSE
  ),
  (
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa02',
    'Push Joueur B',
    TRUE,
    extensions.crypt('2222', extensions.gen_salt('bf')),
    FALSE
  )
ON CONFLICT (id) DO UPDATE
SET
  display_name = EXCLUDED.display_name,
  is_active = TRUE,
  pin_hash = EXCLUDED.pin_hash,
  must_change_pin = FALSE,
  pin_failed_attempts = 0,
  pin_locked_until = NULL,
  pin_temporary_expires_at = NULL;

DELETE FROM public.player_sessions
WHERE player_id IN (
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa01',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa02'
);

DO $$
DECLARE
  tok_a text;
  tok_b text;
BEGIN
  SELECT l.session_token INTO tok_a
  FROM public.login_player(
    'test-code-aln',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa01',
    '1111'
  ) AS l;

  SELECT l.session_token INTO tok_b
  FROM public.login_player(
    'test-code-aln',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa02',
    '2222'
  ) AS l;

  PERFORM set_config('test.push_token_a', tok_a, true);
  PERFORM set_config('test.push_token_b', tok_b, true);
END;
$$;

-- 1) Refus sans session valide
DO $$
BEGIN
  BEGIN
    PERFORM *
    FROM public.register_push_subscription(
      repeat('00', 32),
      'https://fcm.googleapis.com/fcm/send/test-endpoint-aaaa',
      'BFakeP256dhKeyMaterialBase64urlxx',
      'fakeAuthKeyBase64'
    );
    RAISE EXCEPTION 'TEST_FAIL: expected INVALID_SESSION';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%INVALID_SESSION%' THEN
        RAISE;
      END IF;
  END;
END;
$$;

-- 2) Inscription OK
DO $$
DECLARE
  rec RECORD;
BEGIN
  SELECT * INTO rec
  FROM public.register_push_subscription(
    current_setting('test.push_token_a'),
    'https://fcm.googleapis.com/fcm/send/test-endpoint-aaaa',
    'BFakeP256dhKeyMaterialBase64urlxx',
    'fakeAuthKeyBase64',
    NULL,
    'TestAgent/1.0'
  );

  IF rec.status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'TEST_FAIL: expected active status, got %', rec.status;
  END IF;
  IF rec.player_id IS DISTINCT FROM 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa01' THEN
    RAISE EXCEPTION 'TEST_FAIL: unexpected player_id';
  END IF;
END;
$$;

-- 3) Statut visible pour cet endpoint seulement
DO $$
DECLARE
  rec RECORD;
BEGIN
  SELECT * INTO rec
  FROM public.get_push_subscription_status(
    current_setting('test.push_token_a'),
    'https://fcm.googleapis.com/fcm/send/test-endpoint-aaaa'
  );

  IF rec.active IS NOT TRUE OR rec.status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'TEST_FAIL: status should be active';
  END IF;
END;
$$;

-- 4) Réassociation vers un autre joueur (même endpoint)
DO $$
DECLARE
  rec RECORD;
BEGIN
  SELECT * INTO rec
  FROM public.register_push_subscription(
    current_setting('test.push_token_b'),
    'https://fcm.googleapis.com/fcm/send/test-endpoint-aaaa',
    'BFakeP256dhKeyMaterialBase64urlxx',
    'fakeAuthKeyBase64'
  );

  IF rec.player_id IS DISTINCT FROM 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa02' THEN
    RAISE EXCEPTION 'TEST_FAIL: reassociation failed';
  END IF;

  IF (
    SELECT count(*) FROM public.push_subscriptions AS s
    WHERE s.endpoint LIKE '%test-endpoint-aaaa'
  ) <> 1 THEN
    RAISE EXCEPTION 'TEST_FAIL: endpoint uniqueness broken';
  END IF;
END;
$$;

-- 5) Endpoint HTTP refusé
DO $$
BEGIN
  BEGIN
    PERFORM *
    FROM public.register_push_subscription(
      current_setting('test.push_token_a'),
      'http://evil.example/push',
      'BFakeP256dhKeyMaterialBase64urlxx',
      'fakeAuthKeyBase64'
    );
    RAISE EXCEPTION 'TEST_FAIL: expected INVALID_PUSH_ENDPOINT for http';
  EXCEPTION
    WHEN SQLSTATE '22023' THEN
      NULL;
  END;
END;
$$;

-- 6) Endpoint localhost refusé
DO $$
BEGIN
  BEGIN
    PERFORM *
    FROM public.register_push_subscription(
      current_setting('test.push_token_a'),
      'https://127.0.0.1/push',
      'BFakeP256dhKeyMaterialBase64urlxx',
      'fakeAuthKeyBase64'
    );
    RAISE EXCEPTION 'TEST_FAIL: expected INVALID_PUSH_ENDPOINT for localhost';
  EXCEPTION
    WHEN SQLSTATE '22023' THEN
      NULL;
  END;
END;
$$;

-- 7) Désactivation (propriétaire de l’endpoint après réassociation = B)
DO $$
DECLARE
  ok BOOLEAN;
  rec RECORD;
BEGIN
  ok := public.deactivate_push_subscription(
    current_setting('test.push_token_b'),
    'https://fcm.googleapis.com/fcm/send/test-endpoint-aaaa'
  );
  IF ok IS NOT TRUE THEN
    RAISE EXCEPTION 'TEST_FAIL: deactivate should return true';
  END IF;

  SELECT * INTO rec
  FROM public.get_push_subscription_status(
    current_setting('test.push_token_b'),
    'https://fcm.googleapis.com/fcm/send/test-endpoint-aaaa'
  );
  IF rec.active IS NOT FALSE OR rec.status IS DISTINCT FROM 'disabled' THEN
    RAISE EXCEPTION 'TEST_FAIL: expected disabled status';
  END IF;
END;
$$;

-- 8) anon ne peut pas SELECT les tables
DO $$
BEGIN
  BEGIN
    EXECUTE 'SET LOCAL ROLE anon';
    PERFORM count(*) FROM public.push_subscriptions;
    EXECUTE 'RESET ROLE';
    RAISE EXCEPTION 'TEST_FAIL: anon should not SELECT push_subscriptions';
  EXCEPTION
    WHEN insufficient_privilege THEN
      EXECUTE 'RESET ROLE';
    WHEN OTHERS THEN
      EXECUTE 'RESET ROLE';
      IF SQLERRM LIKE '%TEST_FAIL%' THEN
        RAISE;
      END IF;
  END;
END;
$$;

-- 9) PUBLIC n’a plus EXECUTE ; anon conserve l’accès (signatures finales post-180000)
DO $$
BEGIN
  -- Legacy access-code signature from 170000 must be gone after 180000
  IF to_regprocedure(
    'public.register_push_subscription(text, uuid, text, text, text, timestamptz, text)'
  ) IS NOT NULL THEN
    RAISE EXCEPTION 'TEST_FAIL: legacy access-code register_push_subscription must be dropped';
  END IF;

  -- PUBLIC is a pseudo-role (OID 0); has_function_privilege('PUBLIC', …) fails on PG17.
  IF EXISTS (
    SELECT 1
    FROM pg_proc AS p
    CROSS JOIN LATERAL aclexplode(
      COALESCE(p.proacl, acldefault('f', p.proowner))
    ) AS acl
    WHERE p.oid = 'public.register_push_subscription(text, text, text, text, timestamptz, text)'::regprocedure
      AND acl.grantee = 0
      AND acl.privilege_type = 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'TEST_FAIL: PUBLIC must not execute register_push_subscription';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_proc AS p
    CROSS JOIN LATERAL aclexplode(
      COALESCE(p.proacl, acldefault('f', p.proowner))
    ) AS acl
    WHERE p.oid = 'public.deactivate_push_subscription(text, text)'::regprocedure
      AND acl.grantee = 0
      AND acl.privilege_type = 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'TEST_FAIL: PUBLIC must not execute deactivate_push_subscription';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_proc AS p
    CROSS JOIN LATERAL aclexplode(
      COALESCE(p.proacl, acldefault('f', p.proowner))
    ) AS acl
    WHERE p.oid = 'public.get_push_subscription_status(text, text)'::regprocedure
      AND acl.grantee = 0
      AND acl.privilege_type = 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'TEST_FAIL: PUBLIC must not execute get_push_subscription_status';
  END IF;

  IF NOT has_function_privilege(
    'anon',
    'public.register_push_subscription(text, text, text, text, timestamptz, text)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'TEST_FAIL: anon must execute register_push_subscription';
  END IF;

  IF NOT has_function_privilege(
    'anon',
    'public.deactivate_push_subscription(text, text)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'TEST_FAIL: anon must execute deactivate_push_subscription';
  END IF;

  IF NOT has_function_privilege(
    'authenticated',
    'public.register_push_subscription(text, text, text, text, timestamptz, text)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'TEST_FAIL: authenticated must execute register_push_subscription';
  END IF;
END;
$$;

ROLLBACK;

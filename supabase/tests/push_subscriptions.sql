-- Tests manuels pour les RPC push (abonnements).
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

INSERT INTO public.players (id, display_name, is_active)
VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa01', 'Push Joueur A', TRUE),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa02', 'Push Joueur B', TRUE)
ON CONFLICT (id) DO UPDATE
SET display_name = EXCLUDED.display_name, is_active = TRUE;

-- 1) Refus mauvais code
DO $$
BEGIN
  BEGIN
    PERFORM *
    FROM public.register_push_subscription(
      'wrong-code',
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa01',
      'https://fcm.googleapis.com/fcm/send/test-endpoint-aaaa',
      'BFakeP256dhKeyMaterialBase64urlxx',
      'fakeAuthKeyBase64'
    );
    RAISE EXCEPTION 'TEST_FAIL: expected INVALID_ACCESS_CODE';
  EXCEPTION
    WHEN SQLSTATE '28000' THEN
      NULL; -- OK
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
    'test-code-aln',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa01',
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
    'test-code-aln',
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
    'test-code-aln',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa02',
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
      'test-code-aln',
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa01',
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
      'test-code-aln',
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa01',
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

-- 7) Désactivation
DO $$
DECLARE
  ok BOOLEAN;
  rec RECORD;
BEGIN
  ok := public.deactivate_push_subscription(
    'test-code-aln',
    'https://fcm.googleapis.com/fcm/send/test-endpoint-aaaa'
  );
  IF ok IS NOT TRUE THEN
    RAISE EXCEPTION 'TEST_FAIL: deactivate should return true';
  END IF;

  SELECT * INTO rec
  FROM public.get_push_subscription_status(
    'test-code-aln',
    'https://fcm.googleapis.com/fcm/send/test-endpoint-aaaa'
  );
  IF rec.active IS NOT FALSE OR rec.status IS DISTINCT FROM 'disabled' THEN
    RAISE EXCEPTION 'TEST_FAIL: expected disabled status';
  END IF;
END;
$$;

-- 8) anon ne peut pas SELECT les tables (simulation via role)
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
      -- Certains environnements lèvent une autre erreur RLS ; OK si pas de lecture.
      IF SQLERRM LIKE '%TEST_FAIL%' THEN
        RAISE;
      END IF;
  END;
END;
$$;

ROLLBACK;

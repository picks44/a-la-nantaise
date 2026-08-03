-- Tests manuels pour rappels / livraisons push (anti-doublon).
-- Exécuter dans une transaction : BEGIN; … ; ROLLBACK;
-- Les RPC job nécessitent le rôle service_role (ou owner).

BEGIN;

UPDATE public.app_settings
SET
  value = extensions.crypt('test-code-aln', extensions.gen_salt('bf')),
  updated_at = now()
WHERE key = 'access_code_hash';

INSERT INTO public.app_settings (key, value)
VALUES ('push_sending_enabled', 'false')
ON CONFLICT (key) DO UPDATE SET value = 'false';

INSERT INTO public.players (id, display_name, is_active)
VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaab01', 'Reminder A', TRUE),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaab02', 'Reminder B', FALSE)
ON CONFLICT (id) DO UPDATE
SET display_name = EXCLUDED.display_name, is_active = EXCLUDED.is_active;

INSERT INTO public.matches (
  id, external_id, round_number, home_team, away_team, kickoff_at, status
) VALUES (
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb01',
  'test-push-reminder-24h',
  98,
  'FC Nantes',
  'Push FC',
  now() + interval '23 hours 30 minutes',
  'scheduled'
)
ON CONFLICT (id) DO UPDATE
SET
  kickoff_at = EXCLUDED.kickoff_at,
  status = EXCLUDED.status;

-- Abonnement actif pour joueur A
INSERT INTO public.push_subscriptions (
  id,
  player_id,
  endpoint,
  endpoint_hash,
  p256dh,
  auth,
  status
) VALUES (
  'cccccccc-cccc-cccc-cccc-cccccccccc01',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaab01',
  'https://fcm.googleapis.com/fcm/send/test-reminder-device-1',
  public.push_endpoint_hash(
    'https://fcm.googleapis.com/fcm/send/test-reminder-device-1'
  ),
  'BFakeP256dhKeyMaterialBase64urlxx',
  'fakeAuthKeyBase64',
  'active'
)
ON CONFLICT (endpoint_hash) DO UPDATE
SET
  player_id = EXCLUDED.player_id,
  status = 'active';

-- Second appareil même joueur
INSERT INTO public.push_subscriptions (
  id,
  player_id,
  endpoint,
  endpoint_hash,
  p256dh,
  auth,
  status
) VALUES (
  'cccccccc-cccc-cccc-cccc-cccccccccc02',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaab01',
  'https://updates.push.services.mozilla.com/wpush/v2/test-reminder-device-2',
  public.push_endpoint_hash(
    'https://updates.push.services.mozilla.com/wpush/v2/test-reminder-device-2'
  ),
  'BFakeP256dhKeyMaterialBase64urlxx',
  'fakeAuthKeyBase64',
  'active'
)
ON CONFLICT (endpoint_hash) DO UPDATE
SET
  player_id = EXCLUDED.player_id,
  status = 'active';

-- 1) Prépare batch → 1 rappel logique + 2 livraisons
DO $$
DECLARE
  prep RECORD;
  reminder_count INTEGER;
  delivery_count INTEGER;
BEGIN
  SELECT * INTO prep FROM public.prepare_push_reminder_batch(now());

  SELECT count(*)::integer INTO reminder_count
  FROM public.push_reminders AS r
  WHERE r.match_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb01'
    AND r.player_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaab01'
    AND r.reminder_type = '24h';

  IF reminder_count <> 1 THEN
    RAISE EXCEPTION 'TEST_FAIL: expected 1 logical reminder, got %', reminder_count;
  END IF;

  SELECT count(*)::integer INTO delivery_count
  FROM public.push_deliveries AS d
  INNER JOIN public.push_reminders AS r ON r.id = d.reminder_id
  WHERE r.match_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb01'
    AND r.reminder_type = '24h';

  IF delivery_count <> 2 THEN
    RAISE EXCEPTION 'TEST_FAIL: expected 2 deliveries, got %', delivery_count;
  END IF;
END;
$$;

-- 2) Deuxième préparation : pas de doublon
DO $$
DECLARE
  prep RECORD;
  reminder_count INTEGER;
  delivery_count INTEGER;
BEGIN
  SELECT * INTO prep FROM public.prepare_push_reminder_batch(now());

  SELECT count(*)::integer INTO reminder_count
  FROM public.push_reminders AS r
  WHERE r.match_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb01'
    AND r.player_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaab01'
    AND r.reminder_type = '24h';

  SELECT count(*)::integer INTO delivery_count
  FROM public.push_deliveries AS d
  INNER JOIN public.push_reminders AS r ON r.id = d.reminder_id
  WHERE r.match_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb01'
    AND r.reminder_type = '24h';

  IF reminder_count <> 1 OR delivery_count <> 2 THEN
    RAISE EXCEPTION
      'TEST_FAIL: duplicates after second prepare (% reminders, % deliveries)',
      reminder_count,
      delivery_count;
  END IF;
END;
$$;

-- 2b) preview : créations nettes (exclure existants) puis restauration des livraisons
DO $$
DECLARE
  before_r INTEGER;
  before_d INTEGER;
  prev RECORD;
  after_r INTEGER;
  after_d INTEGER;
  prep RECORD;
BEGIN
  SELECT count(*)::integer INTO before_r FROM public.push_reminders;
  SELECT count(*)::integer INTO before_d FROM public.push_deliveries;

  SELECT * INTO prev FROM public.preview_push_reminder_batch(now());

  IF prev.candidates_24h <> 0 OR prev.candidates_2h <> 0 THEN
    RAISE EXCEPTION 'TEST_FAIL: preview must exclude existing reminders (got 24h=%, 2h=%)',
      prev.candidates_24h, prev.candidates_2h;
  END IF;

  IF prev.candidate_deliveries <> 0 THEN
    RAISE EXCEPTION 'TEST_FAIL: preview must exclude existing deliveries (got %)',
      prev.candidate_deliveries;
  END IF;

  SELECT count(*)::integer INTO after_r FROM public.push_reminders;
  SELECT count(*)::integer INTO after_d FROM public.push_deliveries;
  IF after_r <> before_r OR after_d <> before_d THEN
    RAISE EXCEPTION 'TEST_FAIL: preview must not mutate reminders/deliveries';
  END IF;

  DELETE FROM public.push_deliveries;

  SELECT * INTO prev FROM public.preview_push_reminder_batch(now());

  IF prev.candidates_24h <> 0 OR prev.candidates_2h <> 0 THEN
    RAISE EXCEPTION 'TEST_FAIL: existing reminders still must be excluded from candidates';
  END IF;

  IF prev.candidate_deliveries <> 2 THEN
    RAISE EXCEPTION 'TEST_FAIL: preview should count 2 missing deliveries, got %',
      prev.candidate_deliveries;
  END IF;

  SELECT count(*)::integer INTO after_d FROM public.push_deliveries;
  IF after_d <> 0 THEN
    RAISE EXCEPTION 'TEST_FAIL: preview must not recreate deliveries';
  END IF;

  SELECT * INTO prep FROM public.prepare_push_reminder_batch(now());
  IF prep.deliveries_created <> 2 THEN
    RAISE EXCEPTION 'TEST_FAIL: expected prepare to recreate 2 deliveries, got %',
      prep.deliveries_created;
  END IF;
END;
$$;

-- 3) Claim : 2 livraisons, second claim concurrent vide (lease 5 min)
DO $$
DECLARE
  claimed INTEGER;
  claimed2 INTEGER;
BEGIN
  SELECT count(*)::integer INTO claimed
  FROM public.claim_push_deliveries(50, 300, now());

  IF claimed <> 2 THEN
    RAISE EXCEPTION 'TEST_FAIL: expected 2 claimed, got %', claimed;
  END IF;

  SELECT count(*)::integer INTO claimed2
  FROM public.claim_push_deliveries(50, 300, now());

  IF claimed2 <> 0 THEN
    RAISE EXCEPTION 'TEST_FAIL: second claim should be empty, got %', claimed2;
  END IF;
END;
$$;

-- 4) Pronostic apparu → complete skipped sur une livraison encore pending
-- (recréer un cas : nouveau match 2h)
INSERT INTO public.matches (
  id, external_id, round_number, home_team, away_team, kickoff_at, status
) VALUES (
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb02',
  'test-push-reminder-2h',
  98,
  'FC Nantes',
  'Skip FC',
  now() + interval '1 hour 45 minutes',
  'scheduled'
)
ON CONFLICT (id) DO UPDATE
SET kickoff_at = EXCLUDED.kickoff_at, status = EXCLUDED.status;

DO $$
DECLARE
  prep RECORD;
  del_id UUID;
BEGIN
  SELECT * INTO prep FROM public.prepare_push_reminder_batch(now());

  SELECT d.id INTO del_id
  FROM public.push_deliveries AS d
  INNER JOIN public.push_reminders AS r ON r.id = d.reminder_id
  WHERE r.match_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb02'
    AND d.status = 'pending'
  LIMIT 1;

  INSERT INTO public.predictions (
    player_id, match_id, predicted_home_score, predicted_away_score
  ) VALUES (
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaab01',
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb02',
    1,
    0
  )
  ON CONFLICT ON CONSTRAINT predictions_player_match_unique DO NOTHING;

  -- Claim ne doit plus prendre ce match (prono présent)
  IF EXISTS (
    SELECT 1
    FROM public.claim_push_deliveries(50, 300, now()) AS c
    WHERE c.match_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb02'
  ) THEN
    RAISE EXCEPTION 'TEST_FAIL: should not claim when prediction exists';
  END IF;

  IF del_id IS NOT NULL THEN
    PERFORM public.complete_push_delivery(del_id, 'skipped', NULL, now());
  END IF;
END;
$$;

-- 5) Flag sending disabled par défaut
DO $$
BEGIN
  IF public.is_push_sending_enabled() IS TRUE THEN
    RAISE EXCEPTION 'TEST_FAIL: push_sending_enabled should be false';
  END IF;
END;
$$;

-- 6) Joueur inactif : pas de rappel
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.push_reminders AS r
    WHERE r.player_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaab02'
  ) THEN
    RAISE EXCEPTION 'TEST_FAIL: inactive player should have no reminders';
  END IF;
END;
$$;

-- 7) preview_push_reminder_batch : lecture seule (nets déjà couverts en 2b)
DO $$
DECLARE
  before_r INTEGER;
  before_d INTEGER;
  prev RECORD;
  after_r INTEGER;
  after_d INTEGER;
BEGIN
  SELECT count(*)::integer INTO before_r FROM public.push_reminders;
  SELECT count(*)::integer INTO before_d FROM public.push_deliveries;

  SELECT * INTO prev FROM public.preview_push_reminder_batch(now());

  IF prev.candidates_24h IS NULL THEN
    RAISE EXCEPTION 'TEST_FAIL: preview returned null';
  END IF;

  IF prev.candidates_24h <> 0 OR prev.candidates_2h <> 0 OR prev.candidate_deliveries <> 0 THEN
    RAISE EXCEPTION 'TEST_FAIL: preview nets should stay 0 after prepare (24h=%, 2h=%, del=%)',
      prev.candidates_24h, prev.candidates_2h, prev.candidate_deliveries;
  END IF;

  SELECT count(*)::integer INTO after_r FROM public.push_reminders;
  SELECT count(*)::integer INTO after_d FROM public.push_deliveries;

  IF after_r <> before_r OR after_d <> before_d THEN
    RAISE EXCEPTION 'TEST_FAIL: preview must not mutate reminders/deliveries';
  END IF;
END;
$$;

-- 8) Reclaim processing après lease expiré ; pas si lease encore valide
DO $$
DECLARE
  del_id UUID;
  n INTEGER;
BEGIN
  SELECT d.id INTO del_id
  FROM public.push_deliveries AS d
  WHERE d.status = 'processing'
  LIMIT 1;

  IF del_id IS NULL THEN
    RAISE EXCEPTION 'TEST_FAIL: expected a processing delivery from prior claim';
  END IF;

  -- Lease encore valide → pas de reclaim
  SELECT count(*)::integer INTO n
  FROM public.claim_push_deliveries(50, 300, now()) AS c
  WHERE c.delivery_id = del_id;

  IF n <> 0 THEN
    RAISE EXCEPTION 'TEST_FAIL: valid lease must not be reclaimed';
  END IF;

  UPDATE public.push_deliveries
  SET lease_until = now() - interval '1 second'
  WHERE id = del_id;

  SELECT count(*)::integer INTO n
  FROM public.claim_push_deliveries(50, 300, now()) AS c
  WHERE c.delivery_id = del_id;

  IF n <> 1 THEN
    RAISE EXCEPTION 'TEST_FAIL: expired processing lease should be reclaimed';
  END IF;
END;
$$;

-- 9) Max 3 tentatives : attempt_count >= 3 non claimable
DO $$
DECLARE
  del_id UUID;
  n INTEGER;
BEGIN
  SELECT d.id INTO del_id
  FROM public.push_deliveries AS d
  WHERE d.status = 'processing'
  LIMIT 1;

  UPDATE public.push_deliveries
  SET
    attempt_count = 3,
    lease_until = now() - interval '1 second',
    status = 'processing'
  WHERE id = del_id;

  SELECT count(*)::integer INTO n
  FROM public.claim_push_deliveries(50, 300, now()) AS c
  WHERE c.delivery_id = del_id;

  IF n <> 0 THEN
    RAISE EXCEPTION 'TEST_FAIL: attempt_count >= 3 must not be claimable';
  END IF;
END;
$$;

-- 10) preview / eligibility réservés (pas d’EXECUTE pour anon)
DO $$
BEGIN
  IF has_function_privilege(
    'anon',
    'public.preview_push_reminder_batch(timestamptz)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'TEST_FAIL: anon must not execute preview_push_reminder_batch';
  END IF;

  IF has_function_privilege(
    'anon',
    'public.push_reminder_eligibility(timestamptz)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'TEST_FAIL: anon must not execute push_reminder_eligibility';
  END IF;

  IF has_function_privilege(
    'PUBLIC',
    'public.preview_push_reminder_batch(timestamptz)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'TEST_FAIL: PUBLIC must not execute preview_push_reminder_batch';
  END IF;
END;
$$;

ROLLBACK;

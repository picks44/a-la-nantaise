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

-- 3) Claim : 2 livraisons, second claim concurrent vide
DO $$
DECLARE
  claimed INTEGER;
  claimed2 INTEGER;
BEGIN
  SELECT count(*)::integer INTO claimed
  FROM public.claim_push_deliveries(50, 120, now());

  IF claimed <> 2 THEN
    RAISE EXCEPTION 'TEST_FAIL: expected 2 claimed, got %', claimed;
  END IF;

  SELECT count(*)::integer INTO claimed2
  FROM public.claim_push_deliveries(50, 120, now());

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
    FROM public.claim_push_deliveries(50, 120, now()) AS c
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

ROLLBACK;

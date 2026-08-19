-- Enqueue + envoi results_available (Phases 1 & 2).
-- Exécuter via npm run test:sql:local (BEGIN / ROLLBACK).

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

DO $$
DECLARE
  v_season_id UUID := public.get_active_season_id();
  v_player_pred UUID := '0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a01';
  v_player_nopred UUID := '0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a02';
  v_player_inactive UUID := '0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a03';
  v_player_nosub UUID := '0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a04';
  v_player_disabled UUID := '0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a05';
  v_player_expired UUID := '0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a06';
  v_match_scheduled UUID := '0b0b0b0b-0b0b-4b0b-8b0b-0b0b0b0b0b01';
  v_match_a UUID := '0b0b0b0b-0b0b-4b0b-8b0b-0b0b0b0b0b02';
  v_match_b UUID := '0b0b0b0b-0b0b-4b0b-8b0b-0b0b0b0b0b03';
  v_count INTEGER;
  v_points INTEGER;
  v_deliveries INTEGER;
  v_recalc INTEGER;
  v_failed BOOLEAN;
  v_prep RECORD;
  v_claimed INTEGER;
  v_del_id UUID;
  v_sub_status TEXT;
  v_next_attempt TIMESTAMPTZ;
BEGIN
  INSERT INTO public.players (
    id, display_name, is_active, created_at, pin_hash, must_change_pin
  )
  VALUES
    (v_player_pred, 'RA Pred', TRUE, now() - interval '90 days', extensions.crypt('1111', extensions.gen_salt('bf')), FALSE),
    (v_player_nopred, 'RA NoPred', TRUE, now() - interval '90 days', extensions.crypt('2222', extensions.gen_salt('bf')), FALSE),
    (v_player_inactive, 'RA Inactive', FALSE, now() - interval '90 days', extensions.crypt('3333', extensions.gen_salt('bf')), FALSE),
    (v_player_nosub, 'RA NoSub', TRUE, now() - interval '90 days', extensions.crypt('4444', extensions.gen_salt('bf')), FALSE),
    (v_player_disabled, 'RA Disabled', TRUE, now() - interval '90 days', extensions.crypt('5555', extensions.gen_salt('bf')), FALSE),
    (v_player_expired, 'RA Expired', TRUE, now() - interval '90 days', extensions.crypt('6666', extensions.gen_salt('bf')), FALSE)
  ON CONFLICT (id) DO UPDATE
  SET
    display_name = EXCLUDED.display_name,
    is_active = EXCLUDED.is_active,
    created_at = EXCLUDED.created_at,
    pin_hash = EXCLUDED.pin_hash,
    must_change_pin = FALSE;

  INSERT INTO public.matches (
    id, season_id, external_id, round_number, home_team, away_team,
    kickoff_at, kickoff_time_confirmed, status, home_score, away_score
  )
  VALUES
    (
      v_match_scheduled, v_season_id, 'test-ra-scheduled', 31,
      'FC Nantes', 'RA Scheduled FC',
      now() + interval '2 days', TRUE, 'scheduled', NULL, NULL
    ),
    (
      v_match_a, v_season_id, 'test-ra-finished-a', 32,
      'FC Nantes', 'RA Finished A',
      now() - interval '4 hours', TRUE, 'finished', 1, 0
    ),
    (
      v_match_b, v_season_id, 'test-ra-finished-b', 33,
      'RA Finished B', 'FC Nantes',
      now() - interval '5 hours', TRUE, 'finished', 0, 2
    )
  ON CONFLICT (id) DO UPDATE
  SET
    season_id = EXCLUDED.season_id,
    external_id = EXCLUDED.external_id,
    round_number = EXCLUDED.round_number,
    home_team = EXCLUDED.home_team,
    away_team = EXCLUDED.away_team,
    kickoff_at = EXCLUDED.kickoff_at,
    kickoff_time_confirmed = EXCLUDED.kickoff_time_confirmed,
    status = EXCLUDED.status,
    home_score = EXCLUDED.home_score,
    away_score = EXCLUDED.away_score;

  INSERT INTO public.push_subscriptions (
    id, player_id, endpoint, endpoint_hash, p256dh, auth, status
  )
  VALUES
    (
      '0c0c0c0c-0c0c-4c0c-8c0c-0c0c0c0c0c01',
      v_player_pred,
      'https://fcm.googleapis.com/fcm/send/test-ra-pred-1',
      public.push_endpoint_hash('https://fcm.googleapis.com/fcm/send/test-ra-pred-1'),
      'BFakeP256dhKeyMaterialBase64urlxx',
      'fakeAuthKeyBase64',
      'active'
    ),
    (
      '0c0c0c0c-0c0c-4c0c-8c0c-0c0c0c0c0c02',
      v_player_pred,
      'https://updates.push.services.mozilla.com/wpush/v2/test-ra-pred-2',
      public.push_endpoint_hash('https://updates.push.services.mozilla.com/wpush/v2/test-ra-pred-2'),
      'BFakeP256dhKeyMaterialBase64urlxx',
      'fakeAuthKeyBase64',
      'active'
    ),
    (
      '0c0c0c0c-0c0c-4c0c-8c0c-0c0c0c0c0c03',
      v_player_nopred,
      'https://fcm.googleapis.com/fcm/send/test-ra-nopred',
      public.push_endpoint_hash('https://fcm.googleapis.com/fcm/send/test-ra-nopred'),
      'BFakeP256dhKeyMaterialBase64urlxx',
      'fakeAuthKeyBase64',
      'active'
    ),
    (
      '0c0c0c0c-0c0c-4c0c-8c0c-0c0c0c0c0c04',
      v_player_inactive,
      'https://fcm.googleapis.com/fcm/send/test-ra-inactive',
      public.push_endpoint_hash('https://fcm.googleapis.com/fcm/send/test-ra-inactive'),
      'BFakeP256dhKeyMaterialBase64urlxx',
      'fakeAuthKeyBase64',
      'active'
    ),
    (
      '0c0c0c0c-0c0c-4c0c-8c0c-0c0c0c0c0c05',
      v_player_disabled,
      'https://fcm.googleapis.com/fcm/send/test-ra-disabled',
      public.push_endpoint_hash('https://fcm.googleapis.com/fcm/send/test-ra-disabled'),
      'BFakeP256dhKeyMaterialBase64urlxx',
      'fakeAuthKeyBase64',
      'disabled'
    ),
    (
      '0c0c0c0c-0c0c-4c0c-8c0c-0c0c0c0c0c06',
      v_player_expired,
      'https://fcm.googleapis.com/fcm/send/test-ra-expired',
      public.push_endpoint_hash('https://fcm.googleapis.com/fcm/send/test-ra-expired'),
      'BFakeP256dhKeyMaterialBase64urlxx',
      'fakeAuthKeyBase64',
      'expired'
    )
  ON CONFLICT (endpoint_hash) DO UPDATE
  SET
    player_id = EXCLUDED.player_id,
    status = EXCLUDED.status;

  INSERT INTO public.predictions (
    player_id, match_id, predicted_home_score, predicted_away_score
  )
  VALUES (v_player_pred, v_match_a, 1, 0)
  ON CONFLICT ON CONSTRAINT predictions_player_match_unique DO UPDATE
  SET
    predicted_home_score = EXCLUDED.predicted_home_score,
    predicted_away_score = EXCLUDED.predicted_away_score,
    points = NULL;

  -- 1) Match scheduled → aucun results_available
  v_recalc := public.recalculate_points_for_match(v_match_scheduled);

  SELECT count(*)::integer INTO v_count
  FROM public.push_reminders
  WHERE match_id = v_match_scheduled
    AND reminder_type = 'results_available';

  IF v_count <> 0 THEN
    RAISE EXCEPTION 'TEST FAIL: scheduled match must not enqueue results_available (got %)', v_count;
  END IF;

  -- 2) Match finished A → 1 reminder par joueur éligible (pred + nopred)
  v_recalc := public.recalculate_points_for_match(v_match_a);

  SELECT count(*)::integer INTO v_count
  FROM public.push_reminders
  WHERE match_id = v_match_a
    AND reminder_type = 'results_available';

  IF v_count <> 2 THEN
    RAISE EXCEPTION 'TEST FAIL: expected 2 results_available for match A, got %', v_count;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.push_reminders
    WHERE match_id = v_match_a
      AND player_id = v_player_pred
      AND reminder_type = 'results_available'
  ) THEN
    RAISE EXCEPTION 'TEST FAIL: player with prediction must get results_available';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.push_reminders
    WHERE match_id = v_match_a
      AND player_id = v_player_nopred
      AND reminder_type = 'results_available'
  ) THEN
    RAISE EXCEPTION 'TEST FAIL: player without prediction must get results_available';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.push_reminders
    WHERE match_id = v_match_a
      AND reminder_type = 'results_available'
      AND player_id IN (v_player_inactive, v_player_nosub, v_player_disabled, v_player_expired)
  ) THEN
    RAISE EXCEPTION 'TEST FAIL: ineligible players must not get results_available';
  END IF;

  SELECT points INTO v_points
  FROM public.predictions
  WHERE player_id = v_player_pred
    AND match_id = v_match_a;

  IF v_points <> 3 THEN
    RAISE EXCEPTION 'TEST FAIL: expected 3 points for exact 1-0, got %', v_points;
  END IF;

  -- D) match scheduled → pas de claim results (avant prepare : aucune delivery match A)
  INSERT INTO public.push_reminders (
    match_id, player_id, reminder_type, kickoff_snapshot, due_at
  )
  VALUES (
    v_match_scheduled,
    v_player_pred,
    'results_available',
    now() + interval '2 days',
    now()
  )
  ON CONFLICT (match_id, player_id, reminder_type) DO NOTHING;

  INSERT INTO public.push_deliveries (reminder_id, subscription_id, status)
  SELECT r.id, s.id, 'pending'
  FROM public.push_reminders AS r
  INNER JOIN public.push_subscriptions AS s
    ON s.player_id = r.player_id
   AND s.status = 'active'
  WHERE r.match_id = v_match_scheduled
    AND r.reminder_type = 'results_available'
  ON CONFLICT (reminder_id, subscription_id) DO NOTHING;

  IF EXISTS (
    SELECT 1
    FROM public.claim_push_deliveries(50, 300, now()) AS c
    WHERE c.match_id = v_match_scheduled
      AND c.reminder_type = 'results_available'
  ) THEN
    RAISE EXCEPTION 'TEST FAIL: must not claim results for non-finished match';
  END IF;

  -- Remettre la delivery scheduled en pending si claim l'a touchée
  UPDATE public.push_deliveries AS d
  SET status = 'pending', lease_until = NULL, attempt_count = 0
  FROM public.push_reminders AS r
  WHERE d.reminder_id = r.id
    AND r.match_id = v_match_scheduled
    AND r.reminder_type = 'results_available';

  -- 3) Deuxième recalc → pas de doublon
  v_recalc := public.recalculate_points_for_match(v_match_a);

  SELECT count(*)::integer INTO v_count
  FROM public.push_reminders
  WHERE match_id = v_match_a
    AND reminder_type = 'results_available';

  IF v_count <> 2 THEN
    RAISE EXCEPTION 'TEST FAIL: second recalc must not duplicate reminders (got %)', v_count;
  END IF;

  -- 9) Plusieurs appareils → un seul reminder ; prepare crée 2 deliveries
  SELECT count(*)::integer INTO v_count
  FROM public.push_reminders
  WHERE match_id = v_match_a
    AND player_id = v_player_pred
    AND reminder_type = 'results_available';

  IF v_count <> 1 THEN
    RAISE EXCEPTION 'TEST FAIL: two devices must still yield 1 reminder, got %', v_count;
  END IF;

  SELECT count(*)::integer INTO v_deliveries
  FROM public.push_deliveries AS d
  INNER JOIN public.push_reminders AS r ON r.id = d.reminder_id
  WHERE r.match_id = v_match_a
    AND r.reminder_type = 'results_available';

  IF v_deliveries <> 0 THEN
    RAISE EXCEPTION 'TEST FAIL: recalc must not create deliveries, got %', v_deliveries;
  END IF;

  SELECT * INTO v_prep FROM public.prepare_push_reminder_batch(now());

  IF v_prep.deliveries_created <> 3 THEN
    RAISE EXCEPTION 'TEST FAIL: prepare should create 3 results deliveries (2+1), got %',
      v_prep.deliveries_created;
  END IF;

  SELECT count(*)::integer INTO v_deliveries
  FROM public.push_deliveries AS d
  INNER JOIN public.push_reminders AS r ON r.id = d.reminder_id
  WHERE r.match_id = v_match_a
    AND r.reminder_type = 'results_available';

  IF v_deliveries <> 3 THEN
    RAISE EXCEPTION 'TEST FAIL: expected 3 deliveries for match A, got %', v_deliveries;
  END IF;

  -- B) disabled / expired subscriptions → no delivery
  SELECT count(*)::integer INTO v_deliveries
  FROM public.push_deliveries AS d
  INNER JOIN public.push_reminders AS r ON r.id = d.reminder_id
  WHERE r.player_id IN (v_player_disabled, v_player_expired)
    AND r.reminder_type = 'results_available';

  IF v_deliveries <> 0 THEN
    RAISE EXCEPTION 'TEST FAIL: disabled/expired must not get deliveries, got %', v_deliveries;
  END IF;

  -- C) claim avec prono (pred) et sans prono (nopred)
  SELECT count(*)::integer INTO v_claimed
  FROM public.claim_push_deliveries(50, 300, now()) AS c
  WHERE c.match_id = v_match_a
    AND c.reminder_type = 'results_available';

  IF v_claimed <> 3 THEN
    RAISE EXCEPTION 'TEST FAIL: expected 3 claimed results deliveries, got %', v_claimed;
  END IF;

  -- G) double claim → vide (lease actif)
  SELECT count(*)::integer INTO v_claimed
  FROM public.claim_push_deliveries(50, 300, now()) AS c
  WHERE c.match_id = v_match_a;

  IF v_claimed <> 0 THEN
    RAISE EXCEPTION 'TEST FAIL: second claim should be empty, got %', v_claimed;
  END IF;

  -- Remettre les deliveries match A en pending pour les tests retry
  UPDATE public.push_deliveries AS d
  SET
    status = 'pending',
    lease_until = NULL,
    attempt_count = 0,
    next_attempt_at = NULL
  FROM public.push_reminders AS r
  WHERE d.reminder_id = r.id
    AND r.match_id = v_match_a
    AND r.reminder_type = 'results_available';

  -- H) retry 503
  SELECT d.id INTO v_del_id
  FROM public.push_deliveries AS d
  INNER JOIN public.push_reminders AS r ON r.id = d.reminder_id
  WHERE r.match_id = v_match_a
    AND r.player_id = v_player_nopred
    AND r.reminder_type = 'results_available'
    AND d.status = 'pending'
  LIMIT 1;

  IF v_del_id IS NULL THEN
    RAISE EXCEPTION 'TEST FAIL: no pending delivery for retry test';
  END IF;

  PERFORM public.complete_push_delivery(v_del_id, 'failed', 503, now());

  SELECT d.next_attempt_at INTO v_next_attempt
  FROM public.push_deliveries AS d
  WHERE d.id = v_del_id;

  IF v_next_attempt IS NULL THEN
    RAISE EXCEPTION 'TEST FAIL: 503 should set next_attempt_at';
  END IF;

  -- I) subscription 410
  SELECT d.id INTO v_del_id
  FROM public.push_deliveries AS d
  INNER JOIN public.push_reminders AS r ON r.id = d.reminder_id
  WHERE r.match_id = v_match_a
    AND r.player_id = v_player_pred
    AND r.reminder_type = 'results_available'
    AND d.status = 'pending'
  LIMIT 1;

  IF v_del_id IS NOT NULL THEN
    PERFORM public.complete_push_delivery(v_del_id, 'expired', 410, now());

    SELECT s.status INTO v_sub_status
    FROM public.push_deliveries AS d
    INNER JOIN public.push_subscriptions AS s ON s.id = d.subscription_id
    WHERE d.id = v_del_id;

    IF v_sub_status <> 'expired' THEN
      RAISE EXCEPTION 'TEST FAIL: 410 should expire subscription, got %', v_sub_status;
    END IF;
  END IF;

  -- 4) Correction de score → points mis à jour, pas de 2e reminder
  UPDATE public.matches
  SET home_score = 0, away_score = 1
  WHERE id = v_match_a;

  v_recalc := public.recalculate_points_for_match(v_match_a);

  SELECT points INTO v_points
  FROM public.predictions
  WHERE player_id = v_player_pred
    AND match_id = v_match_a;

  IF v_points <> 0 THEN
    RAISE EXCEPTION 'TEST FAIL: expected 0 points after score correction 0-1, got %', v_points;
  END IF;

  SELECT count(*)::integer INTO v_count
  FROM public.push_reminders
  WHERE match_id = v_match_a
    AND reminder_type = 'results_available';

  IF v_count <> 2 THEN
    RAISE EXCEPTION 'TEST FAIL: score correction must not add results_available (got %)', v_count;
  END IF;

  -- 11) Deuxième match finished → reminders indépendants
  v_recalc := public.recalculate_points_for_match(v_match_b);

  SELECT count(*)::integer INTO v_count
  FROM public.push_reminders
  WHERE match_id = v_match_b
    AND reminder_type = 'results_available';

  IF v_count <> 2 THEN
    RAISE EXCEPTION 'TEST FAIL: expected 2 results_available for match B, got %', v_count;
  END IF;

  SELECT count(*)::integer INTO v_count
  FROM public.push_reminders
  WHERE reminder_type = 'results_available'
    AND match_id IN (v_match_a, v_match_b);

  IF v_count <> 4 THEN
    RAISE EXCEPTION 'TEST FAIL: expected 4 independent reminders across two matches, got %', v_count;
  END IF;
END;
$$;

-- 10) Échec achievements → aucun reminder.
-- Dernier scénario du fichier : stub SQL (hors DO), assertions, puis ROLLBACK
-- qui restaure recalculate_season_achievements pour le fichier SQL suivant.
INSERT INTO public.players (
  id, display_name, is_active, created_at, pin_hash, must_change_pin
)
VALUES (
  '0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a07',
  'RA AchFail',
  TRUE,
  now() - interval '90 days',
  extensions.crypt('7777', extensions.gen_salt('bf')),
  FALSE
)
ON CONFLICT (id) DO UPDATE
SET is_active = TRUE;

INSERT INTO public.matches (
  id, season_id, external_id, round_number, home_team, away_team,
  kickoff_at, kickoff_time_confirmed, status, home_score, away_score
)
VALUES (
  '0b0b0b0b-0b0b-4b0b-8b0b-0b0b0b0b0b04',
  public.get_active_season_id(),
  'test-ra-ach-fail',
  34,
  'FC Nantes',
  'RA Ach Fail',
  now() - interval '3 hours',
  TRUE,
  'finished',
  2,
  2
)
ON CONFLICT (id) DO UPDATE
SET
  status = 'finished',
  home_score = 2,
  away_score = 2;

INSERT INTO public.push_subscriptions (
  id, player_id, endpoint, endpoint_hash, p256dh, auth, status
)
VALUES (
  '0c0c0c0c-0c0c-4c0c-8c0c-0c0c0c0c0c07',
  '0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a07',
  'https://fcm.googleapis.com/fcm/send/test-ra-ach-fail',
  public.push_endpoint_hash('https://fcm.googleapis.com/fcm/send/test-ra-ach-fail'),
  'BFakeP256dhKeyMaterialBase64urlxx',
  'fakeAuthKeyBase64',
  'active'
)
ON CONFLICT (endpoint_hash) DO UPDATE
SET
  player_id = EXCLUDED.player_id,
  status = 'active';

CREATE OR REPLACE FUNCTION public.recalculate_season_achievements(p_season_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'TEST_ACHIEVEMENTS_FAIL'
    USING ERRCODE = 'P0001';
END;
$$;

DO $$
DECLARE
  v_match UUID := '0b0b0b0b-0b0b-4b0b-8b0b-0b0b0b0b0b04';
  v_count INTEGER;
  v_failed BOOLEAN := FALSE;
BEGIN
  BEGIN
    PERFORM public.recalculate_points_for_match(v_match);
  EXCEPTION
    WHEN SQLSTATE 'P0001' THEN
      v_failed := TRUE;
  END;

  IF NOT v_failed THEN
    RAISE EXCEPTION 'TEST FAIL: expected achievements failure';
  END IF;

  SELECT count(*)::integer INTO v_count
  FROM public.push_reminders
  WHERE match_id = v_match
    AND reminder_type = 'results_available';

  IF v_count <> 0 THEN
    RAISE EXCEPTION 'TEST FAIL: achievements failure must not leave results_available (got %)', v_count;
  END IF;
END;
$$;

ROLLBACK;

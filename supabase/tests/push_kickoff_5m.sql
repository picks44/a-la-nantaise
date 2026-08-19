-- kickoff_5m : création, claim, recalage kickoff, retry, non-régression ciblée.
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
  v_player_pred UUID := '1a1a1a1a-1a1a-4a1a-8a1a-1a1a1a1a1a01';
  v_player_nopred UUID := '1a1a1a1a-1a1a-4a1a-8a1a-1a1a1a1a1a02';
  v_player_inactive UUID := '1a1a1a1a-1a1a-4a1a-8a1a-1a1a1a1a1a03';
  v_player_nosub UUID := '1a1a1a1a-1a1a-4a1a-8a1a-1a1a1a1a1a04';
  v_player_disabled UUID := '1a1a1a1a-1a1a-4a1a-8a1a-1a1a1a1a1a05';
  v_player_expired UUID := '1a1a1a1a-1a1a-4a1a-8a1a-1a1a1a1a1a06';
  v_match UUID := '1b1b1b1b-1b1b-4b1b-8b1b-1b1b1b1b1b01';
  v_match_unconfirmed UUID := '1b1b1b1b-1b1b-4b1b-8b1b-1b1b1b1b1b02';
  v_match_postponed UUID := '1b1b1b1b-1b1b-4b1b-8b1b-1b1b1b1b1b03';
  v_match_cancelled UUID := '1b1b1b1b-1b1b-4b1b-8b1b-1b1b1b1b1b04';
  v_match_finished UUID := '1b1b1b1b-1b1b-4b1b-8b1b-1b1b1b1b1b05';
  v_kickoff TIMESTAMPTZ;
  v_now TIMESTAMPTZ;
  v_count INTEGER;
  v_prep RECORD;
  v_due TIMESTAMPTZ;
  v_del_id UUID;
  v_stale_del_id UUID;
  v_sub_status TEXT;
  v_next_attempt TIMESTAMPTZ;
  v_claimed INTEGER;
  v_old_kickoff TIMESTAMPTZ;
  v_new_kickoff TIMESTAMPTZ;
  v_snapshot TIMESTAMPTZ;
BEGIN
  v_kickoff := date_trunc('minute', now()) + interval '2 hours';

  INSERT INTO public.players (
    id, display_name, is_active, created_at, pin_hash, must_change_pin
  )
  VALUES
    (v_player_pred, 'K5 Pred', TRUE, now() - interval '90 days', extensions.crypt('1111', extensions.gen_salt('bf')), FALSE),
    (v_player_nopred, 'K5 NoPred', TRUE, now() - interval '90 days', extensions.crypt('2222', extensions.gen_salt('bf')), FALSE),
    (v_player_inactive, 'K5 Inactive', FALSE, now() - interval '90 days', extensions.crypt('3333', extensions.gen_salt('bf')), FALSE),
    (v_player_nosub, 'K5 NoSub', TRUE, now() - interval '90 days', extensions.crypt('4444', extensions.gen_salt('bf')), FALSE),
    (v_player_disabled, 'K5 Disabled', TRUE, now() - interval '90 days', extensions.crypt('5555', extensions.gen_salt('bf')), FALSE),
    (v_player_expired, 'K5 Expired', TRUE, now() - interval '90 days', extensions.crypt('6666', extensions.gen_salt('bf')), FALSE)
  ON CONFLICT (id) DO UPDATE
  SET
    display_name = EXCLUDED.display_name,
    is_active = EXCLUDED.is_active,
    pin_hash = EXCLUDED.pin_hash,
    must_change_pin = FALSE;

  INSERT INTO public.matches (
    id, season_id, external_id, round_number, home_team, away_team,
    kickoff_at, kickoff_time_confirmed, status
  )
  VALUES
    (
      v_match, v_season_id, 'test-k5-main', 40,
      'FC Nantes', 'K5 Away FC',
      v_kickoff, TRUE, 'scheduled'
    ),
    (
      v_match_unconfirmed, v_season_id, 'test-k5-unconfirmed', 41,
      'FC Nantes', 'K5 Unconfirmed FC',
      v_kickoff, FALSE, 'scheduled'
    ),
    (
      v_match_postponed, v_season_id, 'test-k5-postponed', 42,
      'FC Nantes', 'K5 Postponed FC',
      v_kickoff + interval '1 day', TRUE, 'postponed'
    ),
    (
      v_match_cancelled, v_season_id, 'test-k5-cancelled', 43,
      'FC Nantes', 'K5 Cancelled FC',
      v_kickoff + interval '1 day', TRUE, 'cancelled'
    ),
    (
      v_match_finished, v_season_id, 'test-k5-finished', 44,
      'FC Nantes', 'K5 Finished FC',
      now() - interval '2 hours', TRUE, 'finished'
    )
  ON CONFLICT (id) DO UPDATE
  SET
    season_id = EXCLUDED.season_id,
    kickoff_at = EXCLUDED.kickoff_at,
    kickoff_time_confirmed = EXCLUDED.kickoff_time_confirmed,
    status = EXCLUDED.status,
    home_team = EXCLUDED.home_team,
    away_team = EXCLUDED.away_team;

  UPDATE public.matches
  SET home_score = 1, away_score = 0
  WHERE id = v_match_finished;

  INSERT INTO public.push_subscriptions (
    id, player_id, endpoint, endpoint_hash, p256dh, auth, status
  )
  VALUES
    (
      '1c1c1c1c-1c1c-4c1c-8c1c-1c1c1c1c1c01',
      v_player_pred,
      'https://fcm.googleapis.com/fcm/send/test-k5-pred-1',
      public.push_endpoint_hash('https://fcm.googleapis.com/fcm/send/test-k5-pred-1'),
      'BFakeP256dhKeyMaterialBase64urlxx',
      'fakeAuthKeyBase64',
      'active'
    ),
    (
      '1c1c1c1c-1c1c-4c1c-8c1c-1c1c1c1c1c02',
      v_player_pred,
      'https://updates.push.services.mozilla.com/wpush/v2/test-k5-pred-2',
      public.push_endpoint_hash('https://updates.push.services.mozilla.com/wpush/v2/test-k5-pred-2'),
      'BFakeP256dhKeyMaterialBase64urlxx',
      'fakeAuthKeyBase64',
      'active'
    ),
    (
      '1c1c1c1c-1c1c-4c1c-8c1c-1c1c1c1c1c03',
      v_player_nopred,
      'https://fcm.googleapis.com/fcm/send/test-k5-nopred',
      public.push_endpoint_hash('https://fcm.googleapis.com/fcm/send/test-k5-nopred'),
      'BFakeP256dhKeyMaterialBase64urlxx',
      'fakeAuthKeyBase64',
      'active'
    ),
    (
      '1c1c1c1c-1c1c-4c1c-8c1c-1c1c1c1c1c04',
      v_player_inactive,
      'https://fcm.googleapis.com/fcm/send/test-k5-inactive',
      public.push_endpoint_hash('https://fcm.googleapis.com/fcm/send/test-k5-inactive'),
      'BFakeP256dhKeyMaterialBase64urlxx',
      'fakeAuthKeyBase64',
      'active'
    ),
    (
      '1c1c1c1c-1c1c-4c1c-8c1c-1c1c1c1c1c05',
      v_player_disabled,
      'https://fcm.googleapis.com/fcm/send/test-k5-disabled',
      public.push_endpoint_hash('https://fcm.googleapis.com/fcm/send/test-k5-disabled'),
      'BFakeP256dhKeyMaterialBase64urlxx',
      'fakeAuthKeyBase64',
      'disabled'
    ),
    (
      '1c1c1c1c-1c1c-4c1c-8c1c-1c1c1c1c1c06',
      v_player_expired,
      'https://fcm.googleapis.com/fcm/send/test-k5-expired',
      public.push_endpoint_hash('https://fcm.googleapis.com/fcm/send/test-k5-expired'),
      'BFakeP256dhKeyMaterialBase64urlxx',
      'fakeAuthKeyBase64',
      'expired'
    )
  ON CONFLICT (endpoint_hash) DO UPDATE
  SET player_id = EXCLUDED.player_id, status = EXCLUDED.status;

  INSERT INTO public.predictions (
    player_id, match_id, predicted_home_score, predicted_away_score
  )
  VALUES (v_player_pred, v_match, 2, 1)
  ON CONFLICT ON CONSTRAINT predictions_player_match_unique DO UPDATE
  SET
    predicted_home_score = EXCLUDED.predicted_home_score,
    predicted_away_score = EXCLUDED.predicted_away_score;

  -- 1) Création anticipée + due_at
  v_now := v_kickoff - interval '1 hour';
  SELECT * INTO v_prep FROM public.prepare_push_reminder_batch(v_now);

  SELECT count(*)::integer INTO v_count
  FROM public.push_reminders
  WHERE match_id = v_match
    AND reminder_type = 'kickoff_5m';

  IF v_count <> 2 THEN
    RAISE EXCEPTION 'TEST FAIL: expected 2 kickoff_5m reminders (pred+nopred), got %', v_count;
  END IF;

  SELECT r.due_at INTO v_due
  FROM public.push_reminders AS r
  WHERE r.match_id = v_match
    AND r.player_id = v_player_pred
    AND r.reminder_type = 'kickoff_5m';

  IF v_due <> v_kickoff - interval '5 minutes' THEN
    RAISE EXCEPTION 'TEST FAIL: due_at must be kickoff - 5 min (got %, expected %)',
      v_due, v_kickoff - interval '5 minutes';
  END IF;

  -- 2) Idempotence prepare
  SELECT * INTO v_prep FROM public.prepare_push_reminder_batch(v_now);

  SELECT count(*)::integer INTO v_count
  FROM public.push_reminders
  WHERE match_id = v_match
    AND reminder_type = 'kickoff_5m';

  IF v_count <> 2 THEN
    RAISE EXCEPTION 'TEST FAIL: second prepare must not duplicate reminders (got %)', v_count;
  END IF;

  -- 5–7) Joueurs inéligibles
  IF EXISTS (
    SELECT 1 FROM public.push_reminders
    WHERE match_id = v_match
      AND reminder_type = 'kickoff_5m'
      AND player_id IN (v_player_inactive, v_player_nosub, v_player_disabled, v_player_expired)
  ) THEN
    RAISE EXCEPTION 'TEST FAIL: ineligible players must not get kickoff_5m';
  END IF;

  -- 9) Kickoff non confirmé
  PERFORM public.prepare_push_reminder_batch(v_now);

  IF EXISTS (
    SELECT 1 FROM public.push_reminders
    WHERE match_id = v_match_unconfirmed
      AND reminder_type = 'kickoff_5m'
  ) THEN
    RAISE EXCEPTION 'TEST FAIL: unconfirmed kickoff must not get kickoff_5m';
  END IF;

  -- 13) T−6 : pas de delivery
  v_now := v_kickoff - interval '6 minutes';
  SELECT * INTO v_prep FROM public.prepare_push_reminder_batch(v_now);

  SELECT count(*)::integer INTO v_count
  FROM public.push_deliveries AS d
  INNER JOIN public.push_reminders AS r ON r.id = d.reminder_id
  WHERE r.match_id = v_match
    AND r.reminder_type = 'kickoff_5m';

  IF v_count <> 0 THEN
    RAISE EXCEPTION 'TEST FAIL: T-6 must not create kickoff_5m deliveries (got %)', v_count;
  END IF;

  -- 14) T−5 : deliveries + claim
  v_now := v_kickoff - interval '5 minutes';
  SELECT * INTO v_prep FROM public.prepare_push_reminder_batch(v_now);

  IF v_prep.deliveries_created <> 3 THEN
    RAISE EXCEPTION 'TEST FAIL: T-5 expected 3 deliveries (2 pred + 1 nopred), got %',
      v_prep.deliveries_created;
  END IF;

  SELECT count(*)::integer INTO v_count
  FROM public.push_reminders
  WHERE match_id = v_match
    AND reminder_type = 'kickoff_5m';

  IF v_count <> 2 THEN
    RAISE EXCEPTION 'TEST FAIL: multi-device must keep 1 reminder per player (got %)', v_count;
  END IF;

  SELECT count(*)::integer INTO v_claimed
  FROM public.claim_push_deliveries(50, 300, v_now)
  WHERE match_id = v_match
    AND reminder_type = 'kickoff_5m';

  IF v_claimed <> 3 THEN
    RAISE EXCEPTION 'TEST FAIL: T-5 expected 3 claimed kickoff_5m, got %', v_claimed;
  END IF;

  -- Remettre en pending pour la suite
  UPDATE public.push_deliveries AS d
  SET status = 'pending', lease_until = NULL, attempt_count = 0, claimed_at = NULL
  FROM public.push_reminders AS r
  WHERE d.reminder_id = r.id
    AND r.match_id = v_match
    AND r.reminder_type = 'kickoff_5m';

  -- 15) T−1 : claim encore possible
  v_now := v_kickoff - interval '1 minute';

  SELECT count(*)::integer INTO v_claimed
  FROM public.claim_push_deliveries(50, 300, v_now)
  WHERE match_id = v_match
    AND reminder_type = 'kickoff_5m';

  IF v_claimed <> 3 THEN
    RAISE EXCEPTION 'TEST FAIL: T-1 expected 3 claimable kickoff_5m, got %', v_claimed;
  END IF;

  UPDATE public.push_deliveries AS d
  SET status = 'pending', lease_until = NULL, attempt_count = 0, claimed_at = NULL
  FROM public.push_reminders AS r
  WHERE d.reminder_id = r.id
    AND r.match_id = v_match
    AND r.reminder_type = 'kickoff_5m';

  -- 16) T+1 : claim impossible
  v_now := v_kickoff + interval '1 minute';

  SELECT count(*)::integer INTO v_claimed
  FROM public.claim_push_deliveries(50, 300, v_now)
  WHERE match_id = v_match
    AND reminder_type = 'kickoff_5m';

  IF v_claimed <> 0 THEN
    RAISE EXCEPTION 'TEST FAIL: T+1 must not claim kickoff_5m (got %)', v_claimed;
  END IF;

  -- 10–12) Postponed / cancelled / finished : pas de claim
  INSERT INTO public.push_reminders (
    match_id, player_id, reminder_type, kickoff_snapshot, due_at
  )
  VALUES
    (v_match_postponed, v_player_pred, 'kickoff_5m', v_kickoff + interval '1 day', now()),
    (v_match_cancelled, v_player_pred, 'kickoff_5m', v_kickoff + interval '1 day', now()),
    (v_match_finished, v_player_pred, 'kickoff_5m', now() - interval '2 hours', now())
  ON CONFLICT (match_id, player_id, reminder_type) DO NOTHING;

  INSERT INTO public.push_deliveries (reminder_id, subscription_id, status)
  SELECT r.id, s.id, 'pending'
  FROM public.push_reminders AS r
  INNER JOIN public.push_subscriptions AS s
    ON s.player_id = r.player_id
   AND s.status = 'active'
  WHERE r.match_id IN (v_match_postponed, v_match_cancelled, v_match_finished)
    AND r.reminder_type = 'kickoff_5m'
  ON CONFLICT (reminder_id, subscription_id) DO NOTHING;

  v_now := v_kickoff - interval '5 minutes';

  IF EXISTS (
    SELECT 1
    FROM public.claim_push_deliveries(50, 300, v_now) AS c
    WHERE c.reminder_type = 'kickoff_5m'
      AND c.match_id IN (v_match_postponed, v_match_cancelled, v_match_finished)
  ) THEN
    RAISE EXCEPTION 'TEST FAIL: must not claim kickoff_5m for postponed/cancelled/finished';
  END IF;

  -- 17) Recalage kickoff + stale deliveries
  UPDATE public.matches
  SET kickoff_at = v_kickoff
  WHERE id = v_match;

  DELETE FROM public.push_deliveries AS d
  USING public.push_reminders AS r
  WHERE d.reminder_id = r.id
    AND r.match_id = v_match
    AND r.reminder_type = 'kickoff_5m';

  DELETE FROM public.push_reminders
  WHERE match_id = v_match
    AND reminder_type = 'kickoff_5m';

  v_old_kickoff := date_trunc('minute', now()) + interval '1 hour';

  UPDATE public.matches
  SET kickoff_at = v_old_kickoff, status = 'scheduled', kickoff_time_confirmed = TRUE
  WHERE id = v_match;

  v_now := v_old_kickoff - interval '1 hour';
  PERFORM public.prepare_push_reminder_batch(v_now);

  v_now := v_old_kickoff - interval '5 minutes';
  SELECT * INTO v_prep FROM public.prepare_push_reminder_batch(v_now);

  SELECT d.id INTO v_stale_del_id
  FROM public.push_deliveries AS d
  INNER JOIN public.push_reminders AS r ON r.id = d.reminder_id
  WHERE r.match_id = v_match
    AND r.player_id = v_player_pred
    AND r.reminder_type = 'kickoff_5m'
    AND d.status = 'pending'
  LIMIT 1;

  IF v_stale_del_id IS NULL THEN
    RAISE EXCEPTION 'TEST FAIL: expected stale pending delivery before kickoff change';
  END IF;

  v_new_kickoff := v_old_kickoff + interval '1 hour';

  UPDATE public.matches
  SET kickoff_at = v_new_kickoff
  WHERE id = v_match;

  v_now := v_old_kickoff + interval '10 minutes';
  PERFORM public.prepare_push_reminder_batch(v_now);

  IF NOT EXISTS (
    SELECT 1 FROM public.push_deliveries
    WHERE id = v_stale_del_id
      AND status = 'skipped'
  ) THEN
    RAISE EXCEPTION 'TEST FAIL: stale delivery must be skipped after kickoff change';
  END IF;

  SELECT count(*)::integer INTO v_claimed
  FROM public.claim_push_deliveries(50, 300, v_now) AS c
  WHERE c.delivery_id = v_stale_del_id;

  IF v_claimed <> 0 THEN
    RAISE EXCEPTION 'TEST FAIL: stale delivery must not be claimable after recalage';
  END IF;

  SELECT r.due_at, r.kickoff_snapshot INTO v_due, v_snapshot
  FROM public.push_reminders AS r
  WHERE r.match_id = v_match
    AND r.player_id = v_player_pred
    AND r.reminder_type = 'kickoff_5m';

  IF v_snapshot <> v_new_kickoff OR v_due <> v_new_kickoff - interval '5 minutes' THEN
    RAISE EXCEPTION 'TEST FAIL: reminder must be recalibrated (snapshot=%, due=%)',
      v_snapshot, v_due;
  END IF;

  v_now := v_new_kickoff - interval '5 minutes';
  SELECT * INTO v_prep FROM public.prepare_push_reminder_batch(v_now);

  IF v_prep.deliveries_created < 1 THEN
    RAISE EXCEPTION 'TEST FAIL: new T-5 must create deliveries after recalage (got %)',
      v_prep.deliveries_created;
  END IF;

  SELECT count(*)::integer INTO v_claimed
  FROM public.claim_push_deliveries(50, 300, v_now) AS c
  WHERE c.match_id = v_match
    AND c.reminder_type = 'kickoff_5m'
    AND c.delivery_id <> v_stale_del_id;

  IF v_claimed < 1 THEN
    RAISE EXCEPTION 'TEST FAIL: new deliveries must be claimable at new T-5 (got %)', v_claimed;
  END IF;

  -- 18) Double claim pendant lease
  UPDATE public.push_deliveries AS d
  SET status = 'pending', lease_until = NULL, attempt_count = 0, claimed_at = NULL
  FROM public.push_reminders AS r
  WHERE d.reminder_id = r.id
    AND r.match_id = v_match
    AND r.reminder_type = 'kickoff_5m'
    AND d.status <> 'skipped';

  v_now := (SELECT kickoff_at FROM public.matches WHERE id = v_match) - interval '3 minutes';

  SELECT count(*)::integer INTO v_claimed
  FROM public.claim_push_deliveries(50, 300, v_now);

  SELECT count(*)::integer INTO v_count
  FROM public.claim_push_deliveries(50, 300, v_now);

  IF v_count <> 0 THEN
    RAISE EXCEPTION 'TEST FAIL: second claim must be empty during lease (got %)', v_count;
  END IF;

  UPDATE public.push_deliveries AS d
  SET status = 'pending', lease_until = NULL, attempt_count = 0
  FROM public.push_reminders AS r
  WHERE d.reminder_id = r.id
    AND r.match_id = v_match
    AND r.reminder_type = 'kickoff_5m'
    AND d.status = 'processing';

  -- 19) Retry 503
  SELECT d.id INTO v_del_id
  FROM public.push_deliveries AS d
  INNER JOIN public.push_reminders AS r ON r.id = d.reminder_id
  WHERE r.match_id = v_match
    AND r.reminder_type = 'kickoff_5m'
    AND d.status = 'pending'
  LIMIT 1;

  IF v_del_id IS NULL THEN
    RAISE EXCEPTION 'TEST FAIL: no pending delivery for 503 retry test';
  END IF;

  PERFORM public.complete_push_delivery(v_del_id, 'failed', 503, now());

  SELECT d.next_attempt_at INTO v_next_attempt
  FROM public.push_deliveries AS d
  WHERE d.id = v_del_id;

  IF v_next_attempt IS NULL THEN
    RAISE EXCEPTION 'TEST FAIL: 503 should set next_attempt_at for kickoff_5m';
  END IF;

  -- 20) 410 expire subscription
  SELECT d.id INTO v_del_id
  FROM public.push_deliveries AS d
  INNER JOIN public.push_reminders AS r ON r.id = d.reminder_id
  WHERE r.match_id = v_match
    AND r.reminder_type = 'kickoff_5m'
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
END;
$$;

ROLLBACK;

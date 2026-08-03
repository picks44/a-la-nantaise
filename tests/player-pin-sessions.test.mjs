import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function read(rel) {
  return readFileSync(join(root, rel), 'utf8')
}

describe('player PIN sessions migration', () => {
  const sql = read('supabase/migrations/20260803180000_player_pin_sessions.sql')
  const api = read('src/lib/api.ts')
  const session = read('src/lib/session.ts')
  const provider = read('src/context/SessionProvider.tsx')
  const settings = read('src/pages/SettingsPage.tsx')
  const access = read('src/pages/AccessPage.tsx')
  const sqlTests = read('supabase/tests/player_pin_sessions.sql')
  const vercel = read('vercel.json')

  it('drops vulnerable player_id RPC signatures explicitly', () => {
    assert.match(
      sql,
      /DROP FUNCTION IF EXISTS public\.upsert_prediction\(TEXT, UUID, UUID, INTEGER, INTEGER\)/,
    )
    assert.match(
      sql,
      /DROP FUNCTION IF EXISTS public\.get_my_predictions\(TEXT, UUID\)/,
    )
    assert.match(
      sql,
      /DROP FUNCTION IF EXISTS public\.get_visible_predictions\(TEXT, UUID\)/,
    )
    assert.match(
      sql,
      /DROP FUNCTION IF EXISTS public\.register_push_subscription\(TEXT, UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ, TEXT\)/,
    )
  })

  it('stores SHA-256 of random 32-byte tokens, never plaintext', () => {
    assert.match(sql, /gen_random_bytes\(32\)/)
    assert.match(sql, /digest\(v_raw, 'sha256'\)/)
    assert.match(sql, /token_hash BYTEA/)
    assert.doesNotMatch(sql, /INSERT INTO public\.player_sessions[^;]*session_token/s)
  })

  it('uses bcrypt for PIN hashes and generic INVALID_CREDENTIALS', () => {
    assert.match(sql, /extensions\.crypt\(p_pin, v_player\.pin_hash\)/)
    assert.match(sql, /extensions\.crypt\(v_pin, extensions\.gen_salt\('bf'\)\)/)
    assert.match(sql, /INVALID_CREDENTIALS/)
    assert.match(sql, /must_change_pin/)
    assert.match(sql, /interval '48 hours'/)
    assert.match(sql, /pin_failed_attempts \+ 1/)
    assert.match(sql, /FOR UPDATE/)
  })

  it('upsert_prediction takes session token only and locks on DB now()', () => {
    assert.match(
      sql,
      /CREATE OR REPLACE FUNCTION public\.upsert_prediction\(\s*p_session_token TEXT,/s,
    )
    const upsertBlock = sql.match(
      /CREATE OR REPLACE FUNCTION public\.upsert_prediction\([\s\S]*?^\$\$;/m,
    )?.[0]
    assert.ok(upsertBlock)
    assert.doesNotMatch(upsertBlock, /p_player_id/)
    assert.doesNotMatch(upsertBlock, /p_access_code/)
    assert.match(upsertBlock, /now\(\) >= match_row\.kickoff_at/)
    assert.match(upsertBlock, /v_player_id := public\.assert_player_session/)
  })

  it('hardens SECURITY DEFINER helpers and player_sessions table', () => {
    assert.match(sql, /SET search_path = public, extensions/)
    assert.match(sql, /REVOKE ALL ON TABLE public\.player_sessions FROM PUBLIC/)
    assert.match(sql, /REVOKE ALL ON FUNCTION public\.assert_player_session/)
    assert.match(sql, /ENABLE ROW LEVEL SECURITY/)
  })

  it('frontend never sends client-chosen playerId to prediction mutations', () => {
    assert.match(api, /p_session_token: input\.sessionToken/)
    assert.match(api, /p_match_id: input\.matchId/)
    assert.match(api, /p_predicted_home_score: input\.homeScore/)
    assert.doesNotMatch(
      api,
      /upsert_prediction',\s*\{[^}]*p_player_id/s,
    )
    assert.doesNotMatch(
      api,
      /upsertPrediction\(input: \{[^}]*playerId:/s,
    )
    assert.match(api, /login_player/)
    assert.match(api, /change_player_pin/)
  })

  it('replaces free player switching with logout + PIN login', () => {
    assert.doesNotMatch(provider, /\bchangePlayer\b/)
    assert.doesNotMatch(settings, /Changer de joueur/)
    assert.match(settings, /Se déconnecter/)
    assert.match(settings, /Changer mon PIN/)
    assert.match(access, /loginWithPin/)
    assert.match(access, /needs_pin/)
    assert.match(session, /aln_session_token/)
    assert.match(session, /LEGACY_PLAYER_ID_KEY/)
  })

  it('adds CSP headers on Vercel', () => {
    assert.match(vercel, /Content-Security-Policy/)
    assert.match(vercel, /connect-src[^"]*supabase\.co/)
  })

  it('SQL regression suite covers ownership, expiry, lockout and DROP checks', () => {
    assert.match(sqlTests, /ancienne upsert_prediction encore présente/)
    assert.match(sqlTests, /INVALID_CREDENTIALS/)
    assert.match(sqlTests, /session expirée/)
    assert.match(sqlTests, /autre session aurait dû être révoquée/)
    assert.match(sqlTests, /verrouillage après 5 essais/)
    assert.match(sqlTests, /ROLLBACK/)
  })
})

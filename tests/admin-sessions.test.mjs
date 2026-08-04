import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function read(relativePath) {
  return readFileSync(join(root, relativePath), 'utf8')
}

describe('admin_sessions migration', () => {
  const migration = read('supabase/migrations/20260804120000_admin_sessions.sql')

  it('creates dedicated admin_sessions and admin_auth_state tables', () => {
    assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.admin_sessions/)
    assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.admin_auth_state/)
    assert.match(migration, /token_hash BYTEA/)
    assert.match(migration, /failed_attempts INTEGER NOT NULL DEFAULT 0/)
  })

  it('defines login_admin, incrementing failed_attempts and returning nothing on a bad code', () => {
    assert.match(migration, /CREATE OR REPLACE FUNCTION public\.login_admin\(p_admin_code TEXT\)/)
    assert.match(
      migration,
      /failed_attempts = a\.failed_attempts \+ 1[\s\S]{0,200}RETURN;/,
    )
    assert.match(migration, /ADMIN_LOCKED/)
    assert.match(migration, /THEN now\(\) \+ interval '15 minutes'/)
  })

  it('resets the failure counter and issues a hashed session token on success', () => {
    assert.match(
      migration,
      /failed_attempts = 0,\s*\n\s*locked_until = NULL/,
    )
    assert.match(migration, /v_hash := public\.hash_session_token\(v_token\)/)
    assert.match(migration, /INSERT INTO public\.admin_sessions \(token_hash, expires_at\)/)
    assert.doesNotMatch(migration, /INSERT INTO public\.admin_sessions[\s\S]{0,80}v_token\)/)
  })

  it('exposes logout_admin and assert_admin_session, never trusting a raw admin code again', () => {
    assert.match(migration, /CREATE OR REPLACE FUNCTION public\.logout_admin\(p_admin_session_token TEXT\)/)
    assert.match(migration, /CREATE OR REPLACE FUNCTION public\.assert_admin_session\(p_admin_session_token TEXT\)/)
    assert.match(migration, /INVALID_ADMIN_SESSION/)
  })

  it('drops every legacy admin_*(p_admin_code, ...) signature', () => {
    assert.match(migration, /DROP FUNCTION IF EXISTS public\.admin_get_players\(TEXT\)/)
    assert.match(migration, /DROP FUNCTION IF EXISTS public\.admin_get_stats\(TEXT\)/)
  })

  it('re-defines every admin_* RPC to take p_admin_session_token, never p_admin_code', () => {
    for (const fn of [
      'admin_get_players',
      'admin_create_player',
      'admin_update_player_name',
      'admin_set_player_active',
      'admin_get_matches',
      'admin_create_match',
      'admin_update_match',
      'admin_set_match_result',
      'admin_get_stats',
    ]) {
      const definition = migration.match(
        new RegExp(`CREATE OR REPLACE FUNCTION public\\.${fn}\\([\\s\\S]*?\\$\\$;`),
      )?.[0]
      assert.ok(definition, `${fn} definition not found`)
      assert.match(definition, /p_admin_session_token TEXT/)
      assert.doesNotMatch(definition, /p_admin_code/)
    }
  })
})

describe('admin_sessions.sql regression suite', () => {
  const sqlTests = read('supabase/tests/admin_sessions.sql')

  it('covers wrong-code lockout, successful login, session scoping and logout', () => {
    assert.match(sqlTests, /login_admin/)
    assert.match(sqlTests, /admin_auth_state/)
    assert.match(sqlTests, /failed_attempts/)
    assert.match(sqlTests, /ADMIN_LOCKED/)
    assert.match(sqlTests, /INVALID_ADMIN_SESSION/)
    assert.match(sqlTests, /logout_admin/)
  })

  it('asserts token_hash never equals the raw session token', () => {
    assert.match(sqlTests, /token_hash/)
    assert.match(sqlTests, /<>/)
  })

  it('verifies no admin RPC still accepts a raw admin_code argument', () => {
    assert.match(
      sqlTests,
      /pg_get_function_identity_arguments\(oid\) LIKE '%admin_code%'/,
    )
  })

  it('is self-contained (rolls back or resets admin_auth_state between scenarios)', () => {
    assert.match(sqlTests, /BEGIN;|ROLLBACK/)
  })
})

describe('admin session client storage never persists the raw code', () => {
  it('adminSession.ts only stores a session token key, not an admin code', () => {
    const adminSession = read('src/lib/adminSession.ts')
    assert.match(adminSession, /ADMIN_SESSION_TOKEN_KEY = 'aln_admin_session_token'/)
    assert.match(adminSession, /export function readAdminSessionToken/)
    assert.match(adminSession, /export function saveAdminSessionToken/)
    assert.match(adminSession, /export function clearAdminSessionToken/)
    assert.doesNotMatch(adminSession, /admin_code/i)
    assert.doesNotMatch(adminSession, /adminCode/)
  })

  it('adminApi.ts sends the session token on every admin RPC after login', () => {
    const adminApi = read('src/lib/adminApi.ts')
    assert.match(adminApi, /export async function loginAdmin\(adminCode: string\)/)
    assert.match(adminApi, /p_admin_code: adminCode/)
    assert.match(adminApi, /p_admin_session_token: sessionToken/)
  })

  it('AdminPage stores and clears the session token, never the raw admin code', () => {
    const adminPage = read('src/pages/AdminPage.tsx')
    assert.match(adminPage, /saveAdminSessionToken/)
    assert.match(adminPage, /clearAdminSessionToken/)
    assert.doesNotMatch(adminPage, /saveAdminCode|readAdminCode/)
  })
})

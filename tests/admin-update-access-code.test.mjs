import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const migrationPath = join(
  root,
  'supabase/migrations/20260803160000_admin_update_access_code.sql',
)
const sqlTestPath = join(
  root,
  'supabase/tests/admin_update_access_code.sql',
)
const adminApiPath = join(root, 'src/lib/adminApi.ts')
const adminPagePath = join(root, 'src/pages/AdminPage.tsx')
const sessionPath = join(root, 'src/context/SessionProvider.tsx')
const apiPath = join(root, 'src/lib/api.ts')

describe('admin_update_access_code migration', () => {
  const sql = readFileSync(migrationPath, 'utf8')
  const sqlTest = readFileSync(sqlTestPath, 'utf8')

  it('defines SECURITY DEFINER RPC with admin check before update', () => {
    assert.match(sql, /CREATE OR REPLACE FUNCTION public\.admin_update_access_code/)
    assert.match(sql, /p_admin_code TEXT/)
    assert.match(sql, /p_new_access_code TEXT/)
    assert.match(sql, /SECURITY DEFINER/)
    assert.match(sql, /SET search_path = public, extensions/)
    assert.match(sql, /PERFORM public\.assert_admin_code\(p_admin_code\)/)
    const assertIndex = sql.indexOf('assert_admin_code')
    const updateIndex = sql.indexOf("WHERE s.key = 'access_code_hash'")
    assert.ok(assertIndex > 0 && updateIndex > assertIndex)
  })

  it('validates length and hashes with bcrypt salt', () => {
    assert.match(sql, /char_length\(cleaned\) < 4/)
    assert.match(sql, /char_length\(cleaned\) > 64/)
    assert.match(sql, /INVALID_ACCESS_CODE_LENGTH/)
    assert.match(sql, /extensions\.crypt\(cleaned, extensions\.gen_salt\('bf'\)\)/)
    assert.match(sql, /updated_at = now\(\)/)
    assert.doesNotMatch(sql, /RETURN cleaned/)
    assert.doesNotMatch(sql, /RETURNS TEXT/)
  })

  it('only updates access_code_hash and grants anon execute', () => {
    assert.match(sql, /WHERE s\.key = 'access_code_hash'/)
    assert.doesNotMatch(sql, /admin_code_hash/)
    assert.doesNotMatch(sql, /DROP TABLE/i)
    assert.doesNotMatch(sql, /TRUNCATE/i)
    assert.doesNotMatch(sql, /DELETE FROM/i)
    assert.match(sql, /REVOKE ALL ON FUNCTION public\.admin_update_access_code/)
    assert.match(
      sql,
      /GRANT EXECUTE ON FUNCTION public\.admin_update_access_code\(TEXT, TEXT\) TO anon, authenticated/,
    )
  })

  it('SQL regression covers refusals, hash, old/new codes and admin intact', () => {
    assert.match(sqlTest, /INVALID_ADMIN_CODE/)
    assert.match(sqlTest, /INVALID_ACCESS_CODE/)
    assert.match(sqlTest, /INVALID_ACCESS_CODE_LENGTH/)
    assert.match(sqlTest, /ancien code encore valide/)
    assert.match(sqlTest, /nouveau code invalide/)
    assert.match(sqlTest, /code admin cassé/)
    assert.match(sqlTest, /hash access_code invalide ou clair/)
    assert.match(sqlTest, /ROLLBACK/)
    assert.doesNotMatch(sqlTest, /COMMIT;/)
  })
})

describe('admin update access code frontend', () => {
  const adminApi = readFileSync(adminApiPath, 'utf8')
  const adminPage = readFileSync(adminPagePath, 'utf8')
  const session = readFileSync(sessionPath, 'utf8')
  const api = readFileSync(apiPath, 'utf8')

  it('calls RPC with p_admin_code and p_new_access_code', () => {
    assert.match(adminApi, /admin_update_access_code/)
    assert.match(adminApi, /p_admin_code: adminCode/)
    assert.match(adminApi, /p_new_access_code: newAccessCode/)
    assert.match(adminApi, /ACCESS_CODE_MIN_LENGTH = 4/)
    assert.match(adminApi, /ACCESS_CODE_MAX_LENGTH = 64/)
  })

  it('requires identical confirmation fields before submit', () => {
    assert.match(adminPage, /Code d’accès du groupe/)
    assert.match(
      adminPage,
      /Les deux saisies du nouveau code doivent être identiques/,
    )
    assert.match(adminPage, /type="password"/)
    assert.match(adminPage, /autoComplete="new-password"/)
    assert.match(
      adminPage,
      /L’ancien code cessera immédiatement de fonctionner/,
    )
    assert.match(adminPage, /adminUpdateAccessCode/)
    assert.doesNotMatch(adminPage, /localStorage\.setItem\([^)]*access/)
    assert.doesNotMatch(adminPage, /sessionStorage\.setItem\([^)]*access/)
  })

  it('invalidates player session on INVALID_ACCESS_CODE without touching admin', () => {
    assert.match(api, /setAccessInvalidationHandler/)
    assert.match(api, /INVALID_ACCESS_CODE/)
    assert.match(session, /setAccessInvalidationHandler\(invalidatePlayerSession\)/)
    assert.match(
      session,
      /Le code d’accès du groupe a changé/,
    )
    assert.doesNotMatch(session, /clearAdminCode/)
  })
})

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  isValidPinFormat,
  sanitizePinInput,
  PIN_FORMAT_RE,
} from '../src/lib/pin.ts'

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

  it('maps empty login_player rows to INVALID_CREDENTIALS and raises PIN_LOCKED when locked', () => {
    const loginFix = read(
      'supabase/migrations/20260803184000_login_player_commit_failed_attempts.sql',
    )
    assert.match(loginFix, /RAISE EXCEPTION 'PIN_LOCKED'/)
    assert.match(loginFix, /RAISE EXCEPTION 'TEMP_PIN_EXPIRED'/)
    assert.match(loginFix, /pin_failed_attempts = pl\.pin_failed_attempts \+ 1/)
    assert.match(api, /throw new ApiError\('INVALID_CREDENTIALS'/)
    assert.doesNotMatch(read('src/lib/errors.ts'), /code reçu/)
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
    assert.match(sqlTests, /login invalide aurait dû renvoyer 0 ligne/)
    assert.match(sqlTests, /PIN_LOCKED/)
    assert.match(sqlTests, /session expirée/)
    assert.match(sqlTests, /autre session aurait dû être révoquée/)
    assert.match(sqlTests, /verrouillage après 5 essais/)
    assert.match(sqlTests, /PIN temporaire admin doit faire 6 chiffres/)
    assert.match(sqlTests, /change à 4 chiffres/)
    assert.match(sqlTests, /ROLLBACK/)
  })
})

describe('PIN format (4 or 6 digits)', () => {
  const pinLib = read('src/lib/pin.ts')
  const access = read('src/pages/AccessPage.tsx')
  const settings = read('src/pages/SettingsPage.tsx')
  const sql = read('supabase/migrations/20260803180000_player_pin_sessions.sql')

  it('exports shared /^(\\d{4}|\\d{6})$/ validation and sanitizes to 6 max', () => {
    assert.equal(PIN_FORMAT_RE.source, '^(\\d{4}|\\d{6})$')
    assert.equal(isValidPinFormat('1234'), true)
    assert.equal(isValidPinFormat('123456'), true)
    assert.equal(isValidPinFormat('12345'), false)
    assert.equal(isValidPinFormat('12'), false)
    assert.equal(isValidPinFormat('12ab'), false)
    assert.equal(sanitizePinInput('12a34b56c78'), '123456')
    assert.equal(sanitizePinInput('99'), '99')
    assert.match(pinLib, /slice\(0,\s*6\)/)
  })

  it('login and change-PIN forms allow progressive 6-digit input', () => {
    assert.match(access, /maxLength=\{6\}/)
    assert.match(settings, /maxLength=\{6\}/)
    assert.doesNotMatch(access, /maxLength=\{4\}/)
    assert.doesNotMatch(settings, /maxLength=\{4\}/)
    assert.doesNotMatch(access, /slice\(0,\s*4\)/)
    assert.doesNotMatch(settings, /slice\(0,\s*4\)/)
    assert.match(access, /sanitizePinInput/)
    assert.match(settings, /sanitizePinInput/)
    assert.match(access, /isValidPinFormat/)
    assert.match(settings, /isValidPinFormat/)
    assert.match(access, /inputMode="numeric"/)
    assert.match(settings, /inputMode="numeric"/)
  })

  it('SQL accepts the same 4-or-6 digit rule without a new migration', () => {
    assert.match(sql, /assert_valid_pin_format/)
    assert.match(sql, /p_pin !~ '\^\\d\{4\}\$'/)
    assert.match(sql, /p_pin !~ '\^\\d\{6\}\$'/)
    assert.match(sql, /lpad\(\(100000 \+ floor\(random\(\) \* 900000\)/)
  })
})

describe('PIN journey UI copy', () => {
  const access = read('src/pages/AccessPage.tsx')
  const admin = read('src/pages/AdminPage.tsx')

  it('shows login and forced-change French labels', () => {
    assert.match(access, /Ton PIN/)
    assert.match(access, /Entre le PIN à 4 ou 6 chiffres de/)
    assert.match(access, /PIN à 4 ou 6 chiffres/)
    assert.match(access, /Se connecter/)
    assert.match(access, /Choisis ton nouveau PIN/)
    assert.match(
      access,
      /Ton PIN temporaire doit être remplacé par un PIN personnel à 4 ou 6/,
    )
    assert.match(access, /Nouveau PIN/)
    assert.match(access, /Confirmer le nouveau PIN/)
    assert.match(access, /Enregistrer mon PIN/)
    assert.match(access, /completeForcedPinChange/)
  })

  it('shows one-shot admin temporary PIN with copy action', () => {
    assert.match(admin, /Nouveau PIN temporaire/)
    assert.match(
      admin,
      /Copie ce PIN maintenant : il ne sera plus affiché ensuite et\s+expirera dans 48 heures/,
    )
    assert.match(admin, /Copier le PIN/)
    assert.match(admin, /PIN copié/)
    assert.match(admin, /navigator\.clipboard\.writeText/)
  })
})

describe('user-facing error messages', () => {
  it('translates PIN and session codes without exposing raw codes', async () => {
    const { ApiError, toUserMessage } = await import('../src/lib/errors.ts')

    const cases = [
      [
        'INVALID_CREDENTIALS',
        'PIN incorrect. Réessaie.',
      ],
      [
        'PIN_LOCKED',
        'Trop de tentatives. Réessaie dans 15 minutes.',
      ],
      [
        'INVALID_PIN_FORMAT',
        'Le PIN doit contenir exactement 4 ou 6 chiffres.',
      ],
      [
        'PIN_CHANGE_REQUIRED',
        'Tu dois choisir un nouveau PIN pour continuer.',
      ],
      [
        'TEMP_PIN_EXPIRED',
        'Ce PIN temporaire a expiré. Demande un nouveau PIN à l’administrateur.',
      ],
      [
        'SESSION_EXPIRED',
        'Ta session a expiré. Connecte-toi à nouveau.',
      ],
      [
        'INVALID_SESSION',
        'Ta session n’est plus valide. Connecte-toi à nouveau.',
      ],
      [
        'MATCH_LOCKED',
        'Ce match a commencé : les pronostics sont maintenant verrouillés.',
      ],
    ]

    for (const [code, expected] of cases) {
      assert.equal(toUserMessage(new ApiError(code, code)), expected)
      assert.equal(toUserMessage(new Error(code)), expected)
      assert.doesNotMatch(expected, /INVALID_|SESSION_|PIN_|MATCH_|TEMP_/)
    }

    assert.equal(
      toUserMessage(new TypeError('Failed to fetch')),
      'Connexion impossible. Vérifie ta connexion internet et réessaie.',
    )
    assert.equal(
      toUserMessage(new Error('relation "players" does not exist')),
      'Une erreur est survenue. Réessaie dans quelques instants.',
    )
    assert.doesNotMatch(
      toUserMessage(new Error('relation "players" does not exist')),
      /relation|supabase|stack|SQL/i,
    )
  })

  it('pages never render error.message or raw INVALID_CREDENTIALS', () => {
    const pages = [
      'src/pages/AccessPage.tsx',
      'src/pages/SettingsPage.tsx',
      'src/pages/AdminPage.tsx',
      'src/pages/HomePage.tsx',
      'src/pages/RankingPage.tsx',
      'src/pages/CalendarPage.tsx',
      'src/components/PushNotificationsSection.tsx',
      'src/context/SessionProvider.tsx',
    ]

    for (const rel of pages) {
      const source = read(rel)
      assert.doesNotMatch(
        source,
        /setError\(\s*(?:err|error)\.message/,
        `${rel} must not setError(error.message)`,
      )
      assert.doesNotMatch(
        source,
        /\{(?:err|error)\.message\}/,
        `${rel} must not render error.message`,
      )
      assert.match(source, /toUserMessage/, `${rel} should use toUserMessage`)
    }

    const access = read('src/pages/AccessPage.tsx')
    assert.doesNotMatch(
      access,
      /['"`]INVALID_CREDENTIALS['"`]/,
      'AccessPage must not hardcode INVALID_CREDENTIALS as UI text',
    )
  })
})

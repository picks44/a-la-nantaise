import assert from 'node:assert/strict'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { describe, it } from 'node:test'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function read(relativePath) {
  return readFileSync(join(root, relativePath), 'utf8')
}

describe('pwa helpers', () => {
  it('exposes offline message and install heuristics without claiming absolute connectivity', async () => {
    const source = read('src/lib/pwa.ts')
    assert.match(source, /Connexion indisponible/)
    assert.match(source, /isBrowserOnline/)
    assert.match(source, /isStandaloneDisplay/)
    assert.match(source, /shouldShowIosInstallHelp/)
    assert.match(source, /shouldOfferNativeInstall/)
    assert.match(source, /Hint only/)
  })

  it('blocks offline prediction save before any RPC and never queues retries', () => {
    const home = read('src/pages/HomePage.tsx')
    assert.match(home, /isBrowserOnline\(\)/)
    assert.match(home, /OFFLINE_USER_MESSAGE/)
    assert.match(home, /setSaveError\(OFFLINE_USER_MESSAGE\)/)
    assert.doesNotMatch(home, /BackgroundSync|sync\.register|queue/)
  })

  it('configures vite-plugin-pwa with prompt updates and NetworkOnly for Supabase', () => {
    const config = read('vite.config.ts')
    assert.match(config, /registerType:\s*'prompt'/)
    assert.match(config, /injectRegister:\s*false/)
    assert.match(config, /NetworkOnly/)
    assert.match(config, /supabase/)
    assert.match(config, /rest\|rpc\|auth\|functions\|storage/)
    assert.match(config, /SUPABASE_HOST_PATTERN/)
    assert.doesNotMatch(config, /BackgroundSync/)
    assert.doesNotMatch(config, /StaleWhileRevalidate/)
    assert.doesNotMatch(config, /CacheFirst/)
  })

  it('ships real icon dimensions and temporary ALN branding files', () => {
    const icons = [
      ['public/icons/icon-192.png', 192],
      ['public/icons/icon-512.png', 512],
      ['public/icons/icon-192-maskable.png', 192],
      ['public/icons/icon-512-maskable.png', 512],
      ['public/icons/apple-touch-icon.png', 180],
    ]
    for (const [relative, expected] of icons) {
      const path = join(root, relative)
      assert.equal(existsSync(path), true, `${relative} missing`)
      const buf = readFileSync(path)
      assert.equal(buf[0], 0x89)
      assert.equal(buf[1], 0x50) // P
      assert.equal(buf[2], 0x4e) // N
      assert.equal(buf[3], 0x47) // G
      // IHDR width/height at bytes 16-23
      const width = buf.readUInt32BE(16)
      const height = buf.readUInt32BE(20)
      assert.equal(width, expected, `${relative} width`)
      assert.equal(height, expected, `${relative} height`)
    }
  })

  it('keeps SPA fallback and adds no-cache headers for the service worker', () => {
    const vercel = read('vercel.json')
    assert.match(vercel, /"destination": "\/index\.html"/)
    assert.match(vercel, /"\/sw\.js"/)
    assert.match(vercel, /no-cache, no-store, must-revalidate/)
    assert.doesNotMatch(vercel, /Service-Worker-Allowed/)
  })
})

describe('pwa dist artifacts', () => {
  it('produces a safe service worker and manifest after build when dist exists', () => {
    const dist = join(root, 'dist')
    if (!existsSync(dist)) {
      // Build runs after unit tests in CI script order may vary; skip soft.
      return
    }

    const files = readdirSync(dist)
    const sw = files.find((name) => name === 'sw.js')
    assert.ok(sw, 'sw.js missing in dist')
    const swSource = readFileSync(join(dist, sw), 'utf8')
    assert.match(swSource, /NetworkOnly/)
    assert.match(swSource, /supabase/)
    assert.match(swSource, /rest\|rpc\|auth\|functions\|storage/)
    assert.doesNotMatch(swSource, /isSupabaseUrl/)
    assert.doesNotMatch(swSource, /service_role/)
    assert.doesNotMatch(swSource, /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]+\./) // JWT-like

    // Precache list must stay local shell assets — no absolute Supabase URLs.
    assert.doesNotMatch(swSource, /https:\/\/[a-z0-9.-]+\.supabase\.co/)

    // No caching strategies that could retain business data.
    assert.doesNotMatch(swSource, /StaleWhileRevalidate|CacheFirst/)

    const manifestName = files.find((name) => name.endsWith('.webmanifest'))
    assert.ok(manifestName, 'webmanifest missing')
    const manifest = JSON.parse(readFileSync(join(dist, manifestName), 'utf8'))
    assert.equal(manifest.name, 'À la Nantaise')
    assert.equal(manifest.short_name, 'ALN Pronos')
    assert.equal(manifest.start_url, '/')
    assert.equal(manifest.scope, '/')
    assert.equal(manifest.display, 'standalone')
    assert.equal(manifest.lang, 'fr')
    assert.equal(manifest.theme_color, '#ffdd00')
    assert.ok(Array.isArray(manifest.icons))
    assert.ok(manifest.icons.length >= 4)

    for (const icon of manifest.icons) {
      const iconPath = join(dist, icon.src.replace(/^\//, ''))
      assert.equal(existsSync(iconPath), true, `missing icon ${icon.src}`)
      assert.match(icon.sizes, /^\d+x\d+$/)
      assert.equal(icon.type, 'image/png')
      assert.ok(icon.purpose === 'any' || icon.purpose === 'maskable')
    }
  })
})

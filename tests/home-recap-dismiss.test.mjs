import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function read(relativePath) {
  return readFileSync(join(root, relativePath), 'utf8')
}

describe('Home provisional recap dismiss', () => {
  const home = read('src/pages/HomePage.tsx')
  const applyStart = home.indexOf('const applyHomeBundle')
  const applyEnd = home.indexOf('const loadPage')
  const apply = home.slice(applyStart, applyEnd)
  const dismissStart = home.indexOf('function dismissHomeRecap')
  const dismissEnd = home.indexOf('function retry')
  const dismiss = home.slice(dismissStart, dismissEnd)

  it('does not flag a provisional recap as seen on display', () => {
    assert.match(
      apply,
      /if \(recapPayload\.isDefinitive && !alreadySeen\) \{[\s\S]*setCelebrationFlag\(seenKey\)/,
    )
    assert.doesNotMatch(
      apply,
      /!recapPayload\.isDefinitive[\s\S]{0,80}setCelebrationFlag/,
    )
  })

  it('skips reopening a dismissed provisional recap after applyHomeBundle', () => {
    assert.match(
      apply,
      /else if \(!recapPayload\.isDefinitive && !alreadySeen\) \{\s*setShowRecap\(true\)/,
    )
    assert.match(
      apply,
      /else if \(!recapPayload\.isDefinitive\) \{\s*setShowRecap\(false\)/,
    )
  })

  it('stores the provisional flag only when the user closes the recap', () => {
    assert.match(dismiss, /function dismissHomeRecap/)
    assert.match(dismiss, /!recap\.isDefinitive/)
    assert.match(dismiss, /eventId: `\$\{recap\.roundNumber\}:prov`/)
    assert.match(dismiss, /setCelebrationFlag/)
    assert.match(dismiss, /setShowRecap\(false\)/)
    assert.match(home, /onDismiss=\{dismissHomeRecap\}/)
  })
})

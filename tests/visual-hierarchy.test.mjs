import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function read(relativePath) {
  return readFileSync(join(root, relativePath), 'utf8')
}

/** Mirrors src/lib/api.ts getCompetitionRanks — keep in sync for ranking assertions. */
function getCompetitionRanks(rankedPlayers) {
  const ranks = []
  rankedPlayers.forEach((player, index) => {
    if (index === 0) {
      ranks.push(1)
      return
    }
    const previous = rankedPlayers[index - 1]
    if (
      player.points === previous.points &&
      player.exactScores === previous.exactScores
    ) {
      ranks.push(ranks[index - 1])
    } else {
      ranks.push(index + 1)
    }
  })
  return ranks
}

describe('visual hierarchy polish', () => {
  it('exposes semantic color tokens and button primitives', () => {
    const css = read('src/index.css')
    assert.match(css, /--color-surface-muted/)
    assert.match(css, /--color-success/)
    assert.match(css, /--color-warning/)
    assert.match(css, /--color-focus/)
    assert.match(css, /\.btn-secondary/)
    assert.match(css, /\.btn-danger/)
    assert.match(css, /\.btn-ghost/)
    assert.match(css, /\.btn-green/)
    assert.match(css, /\.badge/)
    assert.match(css, /outline: 2px solid var\(--color-focus\)/)
  })

  it('keeps calendar cards white by default without heavy side bars', () => {
    const item = read('src/components/MatchListItem.tsx')
    assert.match(item, /isNext/)
    assert.match(item, /border-border bg-surface/)
    assert.match(item, /border-ink bg-yellow/)
    assert.doesNotMatch(item, /border-l-4 border-l-yellow/)
    assert.doesNotMatch(item, /border-l-4 border-l-green/)
  })

  it('does not paint every rank-1 row yellow in ranking views', () => {
    const ranking = read('src/pages/RankingPage.tsx')
    const podium = read('src/components/Podium.tsx')
    assert.match(ranking, /GroupRanking/)
    assert.match(podium, /isFirstOccurrenceOfRank/)
    assert.doesNotMatch(ranking, /isLeader \? 'bg-yellow'/)
    assert.doesNotMatch(podium, /isLeader \? 'bg-yellow'/)
    assert.match(ranking, /border-l-green/)
    assert.match(podium, /badge border-green bg-green/)
    assert.match(podium, /h-5 w-1\.5.*bg-green/)
  })

  it('uses green for desktop active nav and sticky header', () => {
    const layout = read('src/components/Layout.tsx')
    assert.match(layout, /sticky top-0/)
    assert.match(layout, /after:bg-green/)
    assert.match(layout, /text-green-dark/)
    assert.match(layout, /min-h-11/)
  })

  it('compacts board score inputs and keeps font-size mobile-safe', () => {
    const score = read('src/components/ScoreInput.tsx')
    assert.match(score, /max-w-\[5\.5rem\]/)
    assert.match(score, /text-3xl/)
    assert.doesNotMatch(score, /sm:text-5xl/)
  })

  it('makes ConfirmModal keyboard-accessible', () => {
    const modal = read('src/components/ConfirmModal.tsx')
    assert.match(modal, /aria-describedby/)
    assert.match(modal, /Escape/)
    assert.match(modal, /getFocusableElements/)
    assert.match(modal, /previouslyFocused/)
    assert.match(modal, /stopPropagation/)
  })

  it('uses green CTA and success feedback on home without left score rail', () => {
    const home = read('src/pages/HomePage.tsx')
    const settings = read('src/pages/SettingsPage.tsx')
    assert.match(home, /btn-green/)
    assert.match(home, /text-success/)
    assert.match(home, /bg-success-soft text-green-dark/)
    assert.doesNotMatch(home, /absolute top-0 bottom-0 left-0 w-1 bg-ink/)
    assert.match(home, /Classement du groupe/)
    assert.match(home, /<form/)
    assert.match(home, /type="submit"/)
    assert.match(home, /flex justify-center/)
    assert.match(home, /grid grid-cols-\[1fr_auto_1fr\]/)
    assert.match(settings, /btn-danger/)
    assert.match(settings, /Se déconnecter/)
    assert.doesNotMatch(settings, /Changer de joueur/)
    assert.doesNotMatch(settings, /checked \? 'bg-yellow'/)
  })
})

describe('home group ranking', () => {
  it('shows a compact ranking on home instead of the full list', () => {
    const podium = read('src/components/Podium.tsx')
    const home = read('src/pages/HomePage.tsx')
    assert.doesNotMatch(podium, /slice\(0,\s*3\)/)
    assert.doesNotMatch(podium, /topThree/)
    assert.match(podium, /players\.map\(/)
    assert.match(podium, /Classement du groupe/)
    assert.match(podium, /isFirstOccurrenceOfRank/)
    assert.match(podium, /badge border-green bg-green/)
    assert.match(podium, /awaitingFirstResult/)
    assert.match(podium, /premier match/)
    assert.match(home, /title="Classement du groupe"/)
    assert.match(home, /selectHomeRanking/)
    assert.match(home, /homeRanking\.players/)
    assert.match(home, /homeRanking\.ranks/)
    assert.match(home, /awaitingFirstResult/)
  })

  it('keeps competition ranking order for five tied participants', () => {
    const players = [
      { id: '1', pseudo: 'Camille', points: 0, exactScores: 0 },
      { id: '2', pseudo: 'Pogo', points: 0, exactScores: 0 },
      { id: '3', pseudo: 'Renard', points: 0, exactScores: 0 },
      { id: '4', pseudo: 'Toinou', points: 0, exactScores: 0 },
      { id: '5', pseudo: 'Vinz', points: 0, exactScores: 0 },
    ]
    const ranks = getCompetitionRanks(players)
    assert.equal(players.length, 5)
    assert.deepEqual(ranks, [1, 1, 1, 1, 1])
  })

  it('does not invent a unique leader when everyone is tied at zero', () => {
    const players = [
      { id: 'a', pseudo: 'Alpha', points: 0, exactScores: 0 },
      { id: 'b', pseudo: 'Bravo', points: 0, exactScores: 0 },
      { id: 'c', pseudo: 'Charlie', points: 0, exactScores: 0 },
    ]
    assert.deepEqual(getCompetitionRanks(players), [1, 1, 1])
    const podium = read('src/components/Podium.tsx')
    assert.match(
      podium,
      /isLeaderMark[\s\S]*?bg-yellow|rank === 1 && isFirstOccurrenceOfRank[\s\S]*?bg-yellow/,
    )
  })

  it('marks a sole leader when scores diverge', () => {
    const players = [
      { id: 'a', pseudo: 'Alpha', points: 9, exactScores: 2 },
      { id: 'b', pseudo: 'Bravo', points: 4, exactScores: 1 },
      { id: 'c', pseudo: 'Charlie', points: 1, exactScores: 0 },
    ]
    assert.deepEqual(getCompetitionRanks(players), [1, 2, 3])
  })
})

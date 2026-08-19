import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getCompetitionRanks } from '../src/lib/ranking.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function read(relativePath) {
  return readFileSync(join(root, relativePath), 'utf8')
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
    assert.match(css, /--duration-ui:\s*150ms/)
    assert.match(css, /\.ui-motion/)
    assert.match(css, /\.page-stack/)
    assert.match(css, /outline: 2px solid var\(--color-focus\)/)
  })

  it('keeps calendar next match yellow without painting every predicted card', () => {
    const item = read('src/components/MatchListItem.tsx')
    assert.match(item, /isNext/)
    assert.match(item, /id="prochain-match"/)
    assert.match(item, /bg-yellow/)
    assert.match(item, /Ton prono/)
    assert.match(item, /Modifier mon prono/)
    assert.match(item, /Prono enregistré|statusLabel/)
    assert.doesNotMatch(item, /border-l-4 border-l-yellow/)
    assert.doesNotMatch(item, /border-l-4 border-l-green/)
    assert.doesNotMatch(item, /font-black tracking-tight uppercase/)
  })

  it('shows Pronostiquer for to_predict prediction target without nested link', () => {
    const item = read('src/components/MatchListItem.tsx')
    assert.match(item, /Pronostiquer/)
    assert.match(item, /shouldLinkToPrediction \? \(/)
    assert.match(
      item,
      /function RevealSection[\s\S]*match\.status === 'to_predict' \|\| match\.status === 'kickoff_unconfirmed'/,
    )
  })

  it('shows Modifier mon prono only for predicted + isPredictionTarget', () => {
    const item = read('src/components/MatchListItem.tsx')
    assert.match(
      item,
      /const canShowModifier[\s\S]*match\.status === 'predicted' && isPredictionTarget/,
    )
    assert.match(item, /aria-label="Modifier mon prono sur l’accueil"/)
    assert.match(item, /<Link[\s\S]*>\s*Modifier\s*<\/Link>/)
    assert.doesNotMatch(item, /Voir mon prono/)
  })

  it('renders score + "Ton prono" for predicted and locked', () => {
    const item = read('src/components/MatchListItem.tsx')
    assert.match(item, /Ton prono/)
    assert.match(
      item,
      /\(match\.status === 'predicted' \|\| match\.status === 'locked'\) &&\s*prediction/,
    )
    assert.match(
      item,
      /prediction\.homeScore\} – \{prediction\.awayScore\}/,
    )
  })

  it('never links the card shell except to_predict + isPredictionTarget', () => {
    const item = read('src/components/MatchListItem.tsx')
    assert.match(
      item,
      /const shouldLinkToPrediction[\s\S]*match\.status === 'to_predict' && isPredictionTarget/,
    )
    assert.match(item, /if \(shouldLinkToPrediction\)/)
  })

  it('does not paint every rank-1 row yellow in ranking views', () => {
    const ranking = read('src/pages/RankingPage.tsx')
    const podium = read('src/components/Podium.tsx')
    assert.match(ranking, /GroupRanking/)
    assert.doesNotMatch(ranking, /isLeader \? 'bg-yellow'/)
    assert.doesNotMatch(podium, /isLeader \? 'bg-yellow'/)
    assert.match(podium, /const isLeaderMark = variant === 'full' && rank === 1/)
  })

  it('keeps the heraldic crest visible in the mobile header', () => {
    const layout = read('src/components/Layout.tsx')
    assert.match(layout, /sticky top-0/)
    assert.match(layout, /BrandMark/)
    assert.match(layout, /size="md"/)
    assert.match(layout, /bg-yellow/)
    assert.match(layout, /safe-area-inset-top/)
    assert.doesNotMatch(layout, /hidden shrink-0[\s\S]*BrandMark|BrandMark[\s\S]*hidden sm:block/)
  })

  it('clarifies mobile active nav without changing routes or yellow header', () => {
    const layout = read('src/components/Layout.tsx')
    assert.match(layout, /bg-green-dark/)
    assert.match(layout, /bg-white\/12 text-yellow/)
    assert.match(layout, /after:h-1 after:rounded-full after:bg-green/)
    assert.match(layout, /Saison 26\/27/)
    assert.match(layout, /aria-label="Paramètres"/)
    assert.doesNotMatch(layout, /to="\/parametres"[\s\S]{0,200}BottomNav|BottomNav[\s\S]{0,400}parametres/)
    assert.match(layout, /navItems = \[[\s\S]*Accueil[\s\S]*Calendrier[\s\S]*Classement/)
  })

  it('centralizes brand crest colors sampled from the logo', () => {
    const css = read('src/index.css')
    assert.match(css, /--color-yellow:\s*#feca03/)
    assert.match(css, /--color-green:\s*#055d46/)
    assert.match(css, /--color-green-dark:\s*#033528/)
    assert.match(css, /--color-on-green/)
    assert.match(css, /--color-on-yellow/)
    assert.match(css, /--color-info/)
    const html = read('index.html')
    assert.match(html, /theme-color" content="#055D46"/)
    assert.match(html, /favicon\.ico/)
    assert.match(html, /favicon-32\.png/)
  })

  it('compacts board score inputs and keeps font-size mobile-safe', () => {
    const score = read('src/components/ScoreInput.tsx')
    const home = read('src/pages/HomePage.tsx')
    assert.match(score, /max-w-\[5\.5rem\]/)
    assert.match(score, /inputMode="numeric"/)
    assert.match(score, /pattern="\[0-9\]\*"/)
    assert.match(score, /onFocus=\{\(event\) => event\.currentTarget\.select\(\)\}/)
    assert.match(score, /value=\{value \?\? ''\}/)
    assert.match(home, /scoreIncomplete/)
    assert.match(home, /disabled=\{inputsLocked \|\| saving \|\| scoreIncomplete\}/)
    assert.doesNotMatch(score, /sm:text-5xl/)
    assert.doesNotMatch(score, /font-black tracking-tight uppercase/)
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
    assert.match(home, /Ton prono enregistré :/)
    assert.match(home, /Ton prono :/)
    assert.doesNotMatch(home, /Pronostic enregistré :/)
    assert.doesNotMatch(home, /Pronostic actuel :/)
    assert.doesNotMatch(home, /absolute top-0 bottom-0 left-0 w-1 bg-ink/)
    assert.match(home, /title="Classement"/)
    assert.match(home, /<form/)
    assert.match(home, /type="submit"/)
    assert.match(settings, /btn-danger/)
    assert.match(settings, /Se déconnecter/)
    assert.doesNotMatch(settings, /Changer de joueur/)
  })

  it('collapses calendar reveal details behind an accessible toggle', () => {
    const item = read('src/components/MatchListItem.tsx')
    assert.match(item, /detailsOpen/)
    assert.match(item, /onDetailsOpenChange/)
    assert.match(item, /aria-expanded/)
    assert.match(item, /aria-controls/)
    assert.match(item, /hidden=\{!detailsOpen\}/)
    assert.match(item, /Afficher les détails/)
    assert.match(item, /Masquer les détails/)
    assert.match(item, /match-reveal-details/)
  })

  it('uses explicit calendar status labels', () => {
    const status = read('src/lib/status.ts')
    assert.match(status, /Prono enregistré/)
    assert.match(status, /À pronostiquer/)
    assert.match(status, /Verrouillé/)
    assert.doesNotMatch(status, /predicted: 'Prédit'/)
  })
})

describe('home group ranking', () => {
  it('shows a compact ranking on home instead of the full list', () => {
    const podium = read('src/components/Podium.tsx')
    const home = read('src/pages/HomePage.tsx')
    assert.doesNotMatch(podium, /slice\(0,\s*3\)/)
    assert.doesNotMatch(podium, /topThree/)
    assert.match(podium, /players\.map\(/)
    assert.match(podium, /title = 'Classement du groupe'/)
    assert.match(podium, /awaitingFirstResult/)
    assert.match(podium, /premier match/)
    assert.match(home, /title="Classement"/)
    assert.doesNotMatch(home, /title="Classement du groupe"/)
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

  it('keeps full leader mark and hides it on compact home rows', () => {
    const players = [
      { id: 'a', pseudo: 'Alpha', points: 0, exactScores: 0 },
      { id: 'b', pseudo: 'Bravo', points: 0, exactScores: 0 },
      { id: 'c', pseudo: 'Charlie', points: 0, exactScores: 0 },
    ]
    assert.deepEqual(getCompetitionRanks(players), [1, 1, 1])
    const podium = read('src/components/Podium.tsx')
    assert.match(podium, /const isLeaderMark = variant === 'full' && rank === 1/)
    assert.doesNotMatch(
      podium,
      /isLeaderMark = rank === 1 && isFirstOccurrenceOfRank/,
    )
    assert.match(podium, /isLeaderMark[\s\S]*?bg-yellow/)
  })

  it('marks a sole leader when scores diverge', () => {
    const players = [
      { id: 'a', pseudo: 'Alpha', points: 9, exactScores: 2 },
      { id: 'b', pseudo: 'Bravo', points: 4, exactScores: 1 },
      { id: 'c', pseudo: 'Charlie', points: 1, exactScores: 0 },
    ]
    assert.deepEqual(getCompetitionRanks(players), [1, 2, 3])
  })

  it('uses compact widget copy for points, exacts, and Toi badge', () => {
    const podium = read('src/components/Podium.tsx')
    assert.match(podium, /badge-text border-green bg-green text-white[\s\S]*Toi/)
    assert.doesNotMatch(podium, />TOI</)
    assert.match(podium, /\{player\.points\} pts/)
    assert.match(
      podium,
      /\$\{player\.exactScores\} exact\$\{player\.exactScores > 1 \? 's' : ''\}/,
    )
    assert.doesNotMatch(podium, /scores exact/)
  })

  it('converges full ranking to compact language without dropping live detail', () => {
    const podium = read('src/components/Podium.tsx')
    // Full: inline "N pts", reduced rank, denser row — not the stacked PTS block.
    assert.match(
      podium,
      /variant === 'compact'[\s\S]*?\{player\.points\} pts[\s\S]*?\{player\.points\} pts/,
    )
    assert.doesNotMatch(
      podium,
      /tracking-wider uppercase text-ink\/55[\s\S]*pts/,
    )
    assert.match(podium, /variant === 'full'[\s\S]*?text-lg font-black sm:text-xl/)
    assert.match(podium, /variant === 'full'[\s\S]*?text-ink sm:w-9/)
    assert.doesNotMatch(podium, /text-2xl font-black sm:text-3xl/)
    assert.match(podium, /variant === 'full' \? 'gap-2\.5 py-3\.5'/)
    assert.match(podium, /const isLeaderMark = variant === 'full' && rank === 1/)
    assert.match(podium, /isLeaderMark[\s\S]*?bg-yellow/)
    assert.match(podium, /formatLiveRankDeltaLabel/)
    assert.match(podium, /formatLiveRoundPointsLabel/)
    // Compact branch untouched.
    assert.match(podium, /gap-2\.5 py-3/)
    assert.match(podium, /w-5 items-baseline pt-0\.5 text-ink\/45/)
    assert.match(podium, /text-sm font-semibold sm:text-\[0\.9375rem\]/)
  })

  it('shows compact hierarchy and reference-round context without live deltas', () => {
    const podium = read('src/components/Podium.tsx')
    assert.match(podium, /Après J\$\{referenceRoundNumber\}/)
    assert.match(podium, /referenceRoundNumber/)
    assert.match(podium, /text-ink\/45/)
    assert.match(podium, /font-bold sm:text-base/)
    assert.match(podium, /gap-2\.5 py-3/)
    assert.match(podium, /variant === 'compact'[\s\S]*?exact\$\{/)
    assert.doesNotMatch(podium, /variant === 'compact'[\s\S]{0,120}rankDelta/)
  })
})

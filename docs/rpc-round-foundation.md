# Contrats RPC — Fondation classement / récap / timeline

Document de référence **L0**. Aucune migration ni code applicatif n’est décrit ici comme déjà livré : ce fichier fige les contrats avant implémentation.

## Principes

- Source de vérité : `predictions.points`, `matches.status` / `round_number`, `player_trophies` (`is_active` pour l’UI).
- Aucune table de snapshots.
- Auth commune : `p_session_token` + `assert_player_session` ; `p_season_id` + `assert_season_exists`.
- Cinq RPC : 3 fondation + 2 composition. Timeline = lot L6 séparé.

```text
Fondation          Composition
─────────          ───────────
get_round_status   get_live_season_ranking
get_season_ranking_as_of_round
get_round_player_stats
                   get_player_round_recap
                   (+ get_player_season_timeline en L6)
```

---

## 1. Règles communes

### 1.1 Statut de journée

| Statut | Définition |
|---|---|
| `open` | Aucun match non-`cancelled` en `finished`, **ou** `nonCancelledMatchCount = 0` |
| `provisional` | ≥1 non-cancelled `finished` **et** ≥1 non-cancelled non-finished |
| `completed` | `nonCancelledMatchCount > 0` **et** tous les non-cancelled sont `finished` |

**Garde journée vide / entièrement annulée :**

```text
Si nonCancelledMatchCount = 0 :
  status = open
  isDefinitive = false
  hasStarted = false
```

Couvre : journée sans match ; journée uniquement `cancelled`.

Dérivés :

- `isDefinitive = (status === 'completed')`
- `hasStarted = (finishedCount > 0)`
- `remainingCount = nonCancelledMatchCount - finishedCount` (non-cancelled non-finished)
- `postponed` empêche `completed` (compte dans remaining)

### 1.2 Rang compétition

```sql
RANK() OVER (ORDER BY points DESC, exact_score_count DESC)
```

Ordre d’affichage final : `points DESC, exact_score_count DESC, display_name ASC`.  
`display_name` ne participe **pas** au calcul du rang.

Même tie-break pour `rankInRound` : `round_points DESC, exact_score_count DESC`.

**Actifs à zéro point :** inclus dans as-of / live. Tous à `0 pts / 0 exacts` partagent le même rang ; le pseudo n’ordonne que l’affichage.

**Delta :** `previousRank - currentRank` (positif = remontée). Exemple : 5 → 3 ⇒ `+2`.

### 1.3 `gapToPrevious` (écart de points)

| Situation | Valeur |
|---|---|
| Leader (1re ligne d’affichage) | `null` |
| Même total de points que la ligne précédente | `0` |
| Nouveau palier de points | `points_précédents - points_courants` |

Ne signifie **pas** « points pour gagner une place » (les exacts peuvent encore départager). UI : « écart de points ».

| Joueur | Pts | Exacts | Rang | gapToPrevious |
|---|---:|---:|---:|---:|
| Alice | 20 | 3 | 1 | `null` |
| Bob | 20 | 3 | 1 | 0 |
| Chloé | 20 | 2 | 3 | 0 |
| David | 18 | 5 | 4 | 2 |

### 1.4 Inclusion joueurs (as-of)

Alignée sur `get_season_ranking` : joueur `is_active` **ou** ayant au moins un `points IS NOT NULL AND points > 0` sur la saison (règle historique existante). Les agrégats as-of ne comptent que les matchs `finished` avec `round_number <= N` (ou le filtre du contrat).

### 1.5 Rang technique vs rang métier

L’as-of SQL peut classer un actif à 0 point (rang technique). Les RPC de **composition** masquent ce rang pour les nouveaux :

```text
hadPriorScored =
  COUNT(predictions with points IS NOT NULL
        on finished matches with round_number < reference) > 0

previousRank / rankBefore = NULL si NOT hadPriorScored
rankDelta                 = NULL si previousRank IS NULL
isNewToRanking            = NOT hadPriorScored
```

`rankDelta` n’est **jamais** coercé en `0` dans le payload. Pour l’évaluation des messages uniquement : `COALESCE(rankDelta, 0)`.

### 1.6 Matchs : deux notions

| Concept | Champs | Définition |
|---|---|---|
| Constitutifs journée | `roundMatchCount`, `nonCancelledMatchCount` | Tous les matchs de la journée ; non-cancelled pour complétion |
| Participation | `participationMatchCount` | non `cancelled`, non `postponed`, `kickoff_time_confirmed = true`, et (`kickoff_at <= now()` **ou** `status = 'finished'`) |
| Manqués | `missedPredictionCount` | matchs de participation sans prédiction complète |

Un match `finished` compte toujours dans les points de journée. Un `postponed` ou un futur non commencé n’est pas un manqué.

### 1.7 Prédiction et participation

```text
predicted (match) =
  predicted_home_score IS NOT NULL
  AND predicted_away_score IS NOT NULL
  -- y compris 0-0

predictedMatchCount =
  nombre de matchs de participationMatchCount
  ayant une prédiction complète
  -- une prédiction sur un match ensuite reporté ne compte plus

participated = predictedMatchCount > 0
```

### 1.8 `participationStatus`

| Valeur | Condition |
|---|---|
| `none` | `predictedMatchCount = 0` et `participationMatchCount > 0` |
| `partial` | `0 < predictedMatchCount < participationMatchCount` |
| `complete` | `participationMatchCount > 0` et égalité des counts |
| `not_applicable` | `participationMatchCount = 0` |

Distinct de l’ancien statut UI `missing` (onglet Participation historique).

### 1.9 Compteurs de résultats

| Champ | Signification | Nullabilité |
|---|---|---|
| `exactScoreCount` | `points = 3` | toujours entier ≥ 0 |
| `correctOutcomeOnlyCount` | `points = 1` | toujours entier ≥ 0 |
| `successfulPredictionCount` | exact + correct outcome only | toujours entier ≥ 0 |
| `scoredPredictionCount` | `points IS NOT NULL` | toujours entier ≥ 0 |
| `successRate` | `ROUND(100 * successful / scored, 1)` | `null` si scored = 0 |
| `participantAveragePoints` | `ROUND(AVG(round_points)::numeric, 1)` des `predictedMatchCount > 0` | `null` si aucun participant |

Unité `successRate` : pourcentage **0–100** (pas 0–1).

### 1.10 Champions de journée

- Candidats : `predictedMatchCount > 0` uniquement
- `RANK() OVER (ORDER BY round_points DESC, exact_score_count DESC)`
- Champions = rang 1
- Aucun participant → `championPlayerIds = []`, `championRoundPoints = null`

### 1.11 Journée de référence (classement vivant)

1. Parmi les journées `provisional`, celle dont le dernier match `finished` a le `kickoff_at` le plus récent
2. Égalité → plus petit `round_number`
3. Sinon → dernière journée `completed` (plus grand `round_number` completed)
4. Jamais une journée `open`

Champs exposés : `referenceRoundNumber`, `referenceRoundStatus` (`provisional` \| `completed`), `isRankingProvisional`.

### 1.12 Classement courant (live)

**Tous** les matchs `finished` de la saison, **indépendamment** de `round_number`.  
Ne pas utiliser `get_season_ranking_as_of_round(maxFinishedRound)`.

| Vue | Filtre |
|---|---|
| Courant | `status = finished` (saison) |
| Avant référence | finished et `round_number < referenceRoundNumber` |
| Points référence | finished et `round_number = referenceRoundNumber` |

### 1.13 Messages (`messageKey`) — priorité

Premier match gagne :

1. `no_participation` si `participated = false`
2. `champion_of_round` si champion **et** `isDefinitive`
3. `personal_best_rank` si `isDefinitive` et `rankAfter < min(rangs after journées completed < N)`
4. `strong_rise` si `rankDelta >= 3`
5. `exact_scores_notable` si `exactScoreCount >= 2`
6. `positive_day` si `roundPoints >= 3 OR (successfulPredictionCount >= 1 AND COALESCE(rankDelta, 0) >= 0)`
7. `neutral_day` si participé, 1–2 pts, delta ∈ {-1,0,1}
8. `tough_day` sinon (participé)

SQL renvoie `messageKey` + `messageParams` uniquement. Le FE choisit le libellé selon `isDefinitive` (provisoire vs définitif).

### 1.14 Trophées (récap)

Lecture du ledger `player_trophies` avec `is_active = true` pour la journée. Pas de simulation / anticipation.

---

## 2. Erreurs RPC

| Cas | Code / comportement |
|---|---|
| Session invalide / expirée | `INVALID_SESSION` |
| Saison inexistante | `SEASON_NOT_FOUND` (`assert_season_exists`) |
| `round_number` NULL ou `< 1` | `INVALID_ROUND` |
| `round_number >= 1` sans aucun match | **Pas une erreur** → payload `open`, compteurs à 0 |

---

## 3. RPC fondation

### 3.1 `get_round_status(p_session_token, p_season_id, p_round_number) → jsonb`

```json
{
  "seasonId": "uuid",
  "roundNumber": 12,
  "status": "provisional",
  "isDefinitive": false,
  "hasStarted": true,
  "roundMatchCount": 3,
  "nonCancelledMatchCount": 3,
  "finishedCount": 1,
  "cancelledCount": 0,
  "postponedCount": 1,
  "remainingCount": 2
}
```

| Champ | Type | Nullable |
|---|---|---|
| `seasonId` | uuid string | non |
| `roundNumber` | int | non |
| `status` | `open` \| `provisional` \| `completed` | non |
| `isDefinitive` | bool | non |
| `hasStarted` | bool | non |
| compteurs | int ≥ 0 | non |

### 3.2 `get_season_ranking_as_of_round(p_session_token, p_season_id, p_round_number) → table`

**Sans** champs de classement vivant. Cumul : matchs `finished`, `round_number <= p_round_number`, `points` agrégés.

| Colonne SQL | JSON / FE | Type | Nullable |
|---|---|---|---|
| `player_id` | `playerId` | uuid | non |
| `display_name` | `displayName` | text | non |
| `is_active` | `isActive` | bool | non |
| `points` | `points` | int | non |
| `exact_score_count` | `exactScoreCount` | int | non |
| `correct_outcome_only_count` | `correctOutcomeOnlyCount` | int | non |
| `successful_prediction_count` | `successfulPredictionCount` | int | non |
| `scored_prediction_count` | `scoredPredictionCount` | int | non |
| `success_rate` | `successRate` | numeric 0–100, 1 déc. | oui |
| `rank` | `rank` | int | non |
| `gap_to_leader` | `gapToLeader` | int | non |
| `gap_to_previous` | `gapToPrevious` | int | oui (`null` leader) |

### 3.3 `get_round_player_stats(p_session_token, p_season_id, p_round_number) → jsonb`

Objet enveloppe (agrégats groupe **non** répétés par joueur) :

```json
{
  "seasonId": "uuid",
  "roundNumber": 12,
  "roundStatus": "completed",
  "players": [
    {
      "playerId": "uuid",
      "displayName": "Alice",
      "roundPoints": 4,
      "exactScoreCount": 1,
      "correctOutcomeOnlyCount": 1,
      "successfulPredictionCount": 2,
      "scoredPredictionCount": 2,
      "predictedMatchCount": 2,
      "participationMatchCount": 2,
      "missedPredictionCount": 0,
      "participationStatus": "complete",
      "rankInRound": 1
    }
  ],
  "group": {
    "participantCount": 8,
    "participantAveragePoints": 2.5,
    "championPlayerIds": ["uuid"],
    "championRoundPoints": 6
  }
}
```

| Champ joueur | Nullable |
|---|---|
| compteurs | non (0 si vide) |
| `rankInRound` | `null` si `scoredPredictionCount = 0` |
| `participationStatus` | non |

| Champ group | Nullable |
|---|---|
| `participantCount` | non |
| `participantAveragePoints` | oui (`null` si 0 participants) |
| `championPlayerIds` | non (tableau, éventuellement `[]`) |
| `championRoundPoints` | oui (`null` si pas de champion) |

Joueurs listés : actifs + ceux ayant une prédiction ou des points sur la journée (aligné besoin récap / moyenne).

---

## 4. RPC composition

### 4.1 `get_live_season_ranking(p_session_token, p_season_id) → table`

Classement courant = tous `finished` saison.  
Référence = règle multi-provisional (§1.11).  
`previous_rank` / `rank_delta` / `is_new_to_ranking` = règles métier (§1.5).

Colonnes additionnelles typiques :

| Colonne | Nullable |
|---|---|
| `rank` | non |
| `previous_rank` | oui |
| `rank_delta` | oui |
| `is_new_to_ranking` | non |
| `round_points` | non |
| `reference_round_number` | oui (null si aucune journée completed/provisional) |
| `reference_round_status` | oui |
| `is_ranking_provisional` | non (`false` si pas de référence provisoire) |
| `gap_to_previous` | oui |
| agrégats saison (naming explicite) | comme as-of |

### 4.2 `get_player_round_recap(p_session_token, p_season_id, p_round_number) → jsonb`

```json
{
  "seasonId": "uuid",
  "roundNumber": 12,
  "roundStatus": "provisional",
  "isDefinitive": false,
  "messageKey": "strong_rise",
  "messageParams": { "places": 3, "rank": 4 },
  "summary": {
    "roundPoints": 4,
    "exactScoreCount": 1,
    "correctOutcomeOnlyCount": 1,
    "successfulPredictionCount": 2,
    "scoredPredictionCount": 2,
    "missedPredictionCount": 0,
    "predictedMatchCount": 2,
    "participationMatchCount": 2,
    "participated": true
  },
  "ranking": {
    "rankBefore": 7,
    "rankAfter": 4,
    "rankDelta": 3,
    "isNewToRanking": false,
    "gapToPrevious": 2
  },
  "social": {
    "championDisplayNames": ["Alice"],
    "championRoundPoints": 6,
    "participantAveragePoints": 2.5,
    "playerAhead": { "displayName": "Bob", "points": 18, "gap": 2 }
  },
  "matches": [],
  "trophies": []
}
```

- `rankBefore` : as-of `round < N` puis masquage métier si `!hadPriorScored` → `null`
- `rankAfter` : as-of `round <= N` (finished)
- Non-participation : récap minimal, `messageKey = no_participation`, pas de bloc perf vide
- Nouveau joueur exemple : `{ "rankBefore": null, "rankAfter": 7, "rankDelta": null, "isNewToRanking": true }`

### 4.3 `get_player_season_timeline` (L6)

Hors contrats fondation L0–L5. Journées `completed` uniquement ; `season_id` dans les args ; jalons fiables (trophées actifs, meilleure journée, meilleure position, rang/points après chaque journée completed).

---

## 5. Checklist de sortie L0

- [x] Journée vide / entièrement annulée → `open`
- [x] `participationStatus` : `none` / `partial` / `complete` / `not_applicable`
- [x] Nullabilité documentée par champ
- [x] Arrondi `participantAveragePoints` et `successRate`
- [x] Classement courant = tous `finished`, pas `max(round_number)`
- [x] Multi-provisional : dernier finished le plus récent
- [x] `no_participation` en priorité 1
- [x] Sémantique `gapToPrevious` + exemple
- [x] Rang technique vs métier nouveau joueur
- [x] Erreurs + numéro valide sans match → `open`

Après validation humaine → implémentation **L1 uniquement** (`get_round_status` + tests), puis lots suivants séparés.

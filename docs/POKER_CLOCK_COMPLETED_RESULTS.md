# Poker Clock: official completed results

## Endpoint

`GET /api/integrations/v1/tournaments/:id/completed-results`

The endpoint uses the same `Authorization: Bearer <POKER_CLOCK_INTEGRATION_TOKEN>` credential as the existing Poker Clock integration endpoints. It is read-only, dynamically rendered, and returns `Cache-Control: no-store`.

The response is built from persisted `results` rows and the canonical player display name. It does not read live attendance, live eliminations, Google Sheets, season aggregates, or the Rating Engine.

```json
{
  "tournamentId": "uuid",
  "title": "BOSS BOUNTY",
  "tournamentType": "boss_bounty",
  "status": "completed",
  "ratingApplicable": true,
  "completedAt": null,
  "participantsCount": 30,
  "results": [
    {
      "playerId": "uuid",
      "nickname": "Winner",
      "place": 1,
      "ratingPointsEarned": 250,
      "knockouts": 4,
      "bossKnockouts": 2,
      "mysteryBountyPoints": null
    }
  ]
}
```

`results` is ordered by the persisted official `place`. The winner is the unique row with `place = 1`. `ratingPointsEarned` is the frozen `results.rating_points` value for this tournament, not the live season rating returned by `/players`. For non-rating tournaments it is `null`; a numeric `0` remains a legitimate zero for a rating-applicable tournament.

`participantsCount` counts persisted `arrived = true` rows only when every result row has a known `arrived` value. If any historical row has `arrived = null`, the field is `null` rather than a fabricated exact count. `completedAt` is currently always `null` because the persisted tournament model has no authoritative completion timestamp.

## Statuses

- `401`: missing or invalid Bearer credential.
- `404`: tournament does not exist.
- `409` with `code: RESULTS_NOT_READY`: tournament is not completed; the consumer may poll again after completion.
- `422` with `code: UNSUPPORTED_TOURNAMENT_TYPE`: the persisted type is outside the supported domain.
- `502` with `code: RESULTS_UNAVAILABLE`: result rows are missing or internally inconsistent, including a missing or duplicated winner.
- `500`: unexpected internal failure; database details are not exposed.

No result corrections are cached. A subsequent GET reflects authorized post-completion corrections.

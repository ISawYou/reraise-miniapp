# Academy — Push/Fold data audit (HoldemMath 9-max)

> Developer-facing. Status: **scored Push/Fold training paused**; ranges stay
> available as a clearly-labelled, non-scored reference. Raw data, manifest,
> license and attribution are unchanged.

## Question

A product owner reported that the Push/Fold trainer marks **Q4o** as a correct
**call** for the BB against a UTG1 all-in at 10 BB (ante 0.1 BB), with the
source's EV at about +0.354 BB, while the no-ante chart folds it (EV about
−0.502 BB). Is this an importer or mapping bug, or does the data really say that?

## Reproduction (vendored file, byte-for-byte upstream)

Source: `data/academy/reference/holdemmath-pushfold/pushfold_charts.json`
(SHA-256 `00bc184e…9bec`, pinned commit `7c72b12…`, CC BY 4.0). `s` holds
indices into `order` and `e` holds per-hand EVs (BB); `p` is the share of
combos in the range, in %.

| Check | ante10 (`dataAnte10`) | no-ante (`data`) |
|---|---|---|
| `order.indexOf("Q4o")` | 132 | 132 |
| `max9["10"]["BB\|UTG1"]`: is Q4o in `s`? | **yes** | **no** |
| `max9["10"]["BB\|UTG1"].e[132]` | **+0.354** | **−0.502** |
| `max9["10"]["BB\|UTG1"].p` (BB call range) | **59.6%** | 44.8% |
| `max9["10"]["UTG1"].p` (UTG1 first-in shove) | **78.3%** | 67.4% |
| `max9["10"]["UTG"].p` (UTG first-in shove) | 78.3% (same `s` as UTG1) | 67.4% |

Combo-weighted membership (pairs 6, suited 4, offsuit 12; 1326 total)
reproduces each `p` exactly. The importer
(`lib/academy/push-fold-import.ts`) maps `BB|UTG1` to
`CALL_VS_SHOVE_BB_VS_UTG1`. In the ante10 dataset Q4o comes out as
`{CALL: 1, FOLD: 0}`, and in the no-ante dataset as `{CALL: 0, FOLD: 1}`.
All 169 hands match the raw membership.

**Conclusion: the trainer showed exactly what the source says. This is not
an importer, mapping or variant mix-up.** The two variants really differ:
ante10 (`anteVariants.dataAnte10 = 0.1`) puts 0.9 BB of dead money in a 9-max
pot, and that alone widens calling ranges.

## Why the data is still unsuitable for scoring

The source documents its own limitation (`MANIFEST.json` →
`modelNotes.multiway`, README "Model, honestly stated"): every 6-max and 9-max
table solves each first-in seat's sub-game against a **single caller** and
fixes the SB first-in range to the heads-up solution. That is "NOT a true
multi-way Nash equilibrium."

For early seats the approximation produces ranges that are implausibly wide
for real 9-max tournament play:

- With eight players left to act, UTG and UTG1 both shove **78.3%** of hands
  at 10 BB. Both seats get the identical range, a sign of the per-seat
  single-caller sub-game: the remaining field barely changes the answer.
- The BB calls a UTG1 shove with **59.6%** of hands, Q4o included.

### Sanity cross-check with an independent source (not an authority)

`data/academy/reference/mtt-preflop/MTT_10_GTO.json` comes from
jensbaagaard/poker-practice and has status `EXTERNAL_REFERENCE_UNVERIFIED`;
its licensing and solver provenance are not established, so it is used here
only as a comparison. At 10 BB its RFI is an all-in, and it assumes a 1 BB
ante (BB ante) against HoldemMath's 0.9 BB total, so the spots are comparable.
Seat names map EP1 to UTG and EP2 to UTG1, and a missing hand counts as 0.

| Spot (10 BB) | HoldemMath ante10 | External MTT ref |
|---|---|---|
| UTG1 first-in shove | 78.3% | **17.1%** (`OpenEP2`) |
| BB calls UTG1 shove | 59.6% | **14.9%** (`CallBBvsEP2`) |
| Q4o in BB call range | yes | **no** (0) |

The independent source points to a range several times tighter (about 4.6×
for the shove, about 4× for the call). Neither source counts as validated,
but the gap and the documented approximation are enough reason not to
grade players against the HoldemMath 9-max charts.

## Decision (Part 1A policy)

- **Reference stays.** Study pages (`/academy/solver/push-fold`,
  `/academy/solver/push-fold/<stack>/<node>`) still show the ranges, table and
  attribution. Each one carries a "Справочник · без оценки" notice saying the
  ranges are an approximate guide, not a verified exact tournament answer.
  These pages offer no "Начать тренировку" button.
- **Scored training is paused**, with fail-closed enforcement. The new
  `ACADEMY_PUSH_FOLD_SCORED_DATASET_IDS` in
  `config/academy/push-fold-trainer.ts` is **empty**. The reference whitelist
  `ACADEMY_PUSH_FOLD_TRAINER_DATASET_IDS` is unchanged. Every scored question
  goes through `buildPushFoldQuestion`, which calls
  `assertAcademyPushFoldDatasetScored`. Serve, reveal and verify (fixed node
  and Quick) throw `AcademyTrainerUnavailableError`: API routes answer 409 and
  `/api/academy/attempts` answers 400 without recording anything. The scored
  routes `/push-fold/mix` and `/push-fold/<stack>/<node>/train` still exist
  and show a "Тренировка Push/Fold на паузе" screen that links back to the
  reference.
- **No substitute data.** No replacement ranges were fabricated, and the
  external MTT set is not silently served in HoldemMath's place.
- **Guarded for the future.** A test fails if any dataset whose
  `assumptions.multiwayModel` is `SINGLE_CALLER_APPROXIMATION` is put on the
  scored list. Scoring can only resume after independent validation against
  an MTT-appropriate source, and that change is a product decision.
- **Engine kept.** The scored engine (sessions, sampling, verifier, UI) is
  kept and tested against a simulated validated whitelist
  (`features/__tests__/academy-push-fold.test.ts`, push-fold routes,
  `components/academy/__tests__/push-fold-scored-ui.test.tsx`). It uses the
  same three-state scoring as the preflop trainer.

## Regression fixtures

- `features/__tests__/academy-push-fold-audit.test.ts` pins the Q4o numbers,
  the ante10 vs no-ante distinction, the 78.3% / 59.6% breadth, exact importer
  membership and the external cross-check figures, all against the real
  vendored files.
- `features/__tests__/academy-push-fold-policy.test.ts` pins the real,
  unmocked fail-closed policy across all 264 reference nodes and every entry
  path.

## Reproduce by hand

```python
import json
d = json.load(open("data/academy/reference/holdemmath-pushfold/pushfold_charts.json"))
i = d["order"].index("Q4o")                                    # 132
for v in ("dataAnte10", "data"):
    n = d[v]["max9"]["10"]["BB|UTG1"]
    print(v, i in n["s"], n["e"][i], n["p"], d[v]["max9"]["10"]["UTG1"]["p"])
# dataAnte10 True 0.354 59.6 78.3
# data False -0.502 44.8 67.4
```

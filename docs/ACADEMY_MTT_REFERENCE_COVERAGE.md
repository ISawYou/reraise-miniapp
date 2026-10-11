# Academy — external MTT preflop reference: coverage audit

> Developer-facing only. Not shown to players. Status of all data below:
> **EXTERNAL_REFERENCE_UNVERIFIED**. This is third-party reference data. It is
> not RERAISE solver output and must not be presented as such.

## Source

| | |
|---|---|
| Repository | https://github.com/jensbaagaard/poker-practice |
| Pinned commit | `449993f78d995c77b72d0bcac418a8507dd6f783` |
| Files | `data/openSourcePokerData/MTT_{5,10,20,40,100}_GTO.json` |
| Vendored (byte-for-byte) | `data/academy/reference/mtt-preflop/` (+ `MANIFEST.json`, SHA-256 per file) |
| Adapter | `lib/academy/mtt-reference-import.ts` (pure) |
| Datasets | `config/academy/mtt-reference-datasets.ts` → registered in `ACADEMY_STRATEGY_DATASETS` |
| Tests | `config/academy/__tests__/mtt-reference-datasets.test.ts` |

Dataset ids (registry-only; **no lesson binding**, no route, no UI):
`external_mtt_preflop_9max_{5,10,20,40,100}bb_v1`.

### Provenance caveats

- The upstream README says these sets were extracted from the inline JSON
  blobs of a third-party poker-trainer app's built-in ranges. Neither the
  licence nor which solver produced them is established. Clear both before
  any player-facing use.
- **Strategy model.** The README calls the sets "GTO" with a 1 BB ante.
  It never says whether they are chip-EV or ICM, so
  `metadata.strategyModel = "SOURCE_UNSTATED"` (no `CHIP_EV` claim).
- **Sparsity.** The README says only `MTT_100_GTO.json` is sparse. In fact
  `MTT_10_GTO.json` (6 keys) and `MTT_20_GTO.json` (116 keys) are sparse too.
  The upstream consumer code treats a missing hand as 0 (`prev[hand] ?? 0` and
  it iterates only the entries present), and the README says "Treat a missing
  hand as 0". So the manifest gives 10/20/100 BB `missingHandPolicy: "ZERO"`;
  10/20 BB are flagged `OBSERVED_SPARSE_UNDOCUMENTED`. 5 and 40 BB are fully
  dense and use `REJECT`: a missing hand there fails the whole file.

## Import semantics

Per spot (exact upstream composition and `conditional()` math):

| Scenario | Node key | Raise key | Call key | `prev` (hero's own previous node) |
|---|---|---|---|---|
| RFI | `RFI_<H>` | `Open<H>` | `Limp<H>` (action `LIMP`) | none |
| Facing open | `FACING_OPEN_<H>_VS_<V>` | `3Bet<H>vs<V>` | `Call<H>vs<V>` | none |
| Facing 3-bet | `FACING_3BET_<H>_VS_<V>` | `4Bet<H>vs<V>` | `Call 3Bet<H>vs<V>` | `Open<H>` |
| Facing 4-bet | `FACING_4BET_<H>_VS_<V>` | `5Bet<H>vs<V>` | `Call 4Bet<H>vs<V>` | `3Bet<H>vs<V>` |
| Facing 5-bet | `FACING_5BET_<H>_VS_<V>` | none | `Call 5Bet<H>vs<V>` | `4Bet<H>vs<V>` |

`conditional(w, p) = p > 0 ? min(1, w / p) : 0` is applied to both lines.
Then `FOLD = 1 − raise − call`, computed **after** normalization.

- **Seat names.** RERAISE uses 9-max names: EP1→UTG, EP2→UTG1, EP3→UTG2;
  LJ/HJ/CO/BTN/SB/BB are unchanged. Hero, villain and scenario are stored per
  node in `provenance.nodeSources` and in the typed report descriptors.
- **Table sizes.** The data is imported **once**, under 9-max names. The
  upstream chart for a seat is the same key at 6, 8 and 9 handed; only the
  names of the early seats change (8-max calls EP2/EP3 "UTG"/"UTG1"; 6-max
  starts at LJ). Each node records the table sizes its seats exist at
  (`tableSizes`). Emitting three relabelled copies would add no information.
- **Action codes.** `RAISE` (kind RAISE; size varies by seat, see
  assumptions), `ALL_IN` (kind ALL_IN, `amountBb` = stack), `LIMP` (kind
  CALL), `CALL`, `FOLD`. Whether a stack's aggressive action is `RAISE` or
  `ALL_IN` follows the upstream sizing table. A node offers an action only if
  its source line has at least one non-zero frequency after normalization;
  `FOLD` is always offered. (This generalizes the brief's "LIMP only if
  present" rule to every action, so for example facing an all-in 4-bet at
  40 BB the node is CALL/FOLD rather than offering an impossible 5-bet.)
- **Skipped (`DEGENERATE_ALL_FOLD`).** Raise and call are 0 for every hand.
  The upstream script drops these too.
- **Rejected (`UNREACHABLE_VILLAIN_ACTION_EMPTY`).** A non-RFI spot is
  imported only if the villain node whose aggression creates it (`RFI_<V>`,
  `FACING_OPEN_<V>_VS_<H>`, …) was imported and offers RAISE/ALL_IN.
  Example: at 5/10 BB every upstream `3Bet*` key is all-zero, yet some
  `4Bet*`/`Call 3Bet*` keys carry numbers. Those spots are unreachable and
  are not imported.
- **Rejected (`NEGATIVE_FOLD_REMAINDER`).** For some hand, raise + call after
  normalization exceeds 1 + `ACADEMY_STRATEGY_FREQUENCY_SUM_EPSILON` (1e-9).
  The value is never clamped. A float residue in [−1e-9, 0) is written as
  fold 0.
- **Upstream cap.** The upstream `min(1, …)` cap is reproduced but not
  silent: each node records `conditionalCappedHands` and
  `conditionalUnreachedHands` (raw w > 0 while prev = 0 → 0).

## Summary matrix

```
STACK | RFI | BB DEFENCE      | SB DEFENCE      | VS 3BET              | PUSH-LIKE
5     | 8   | 8 (call/fold)   | 7 (call/fold)   | 0 (unreachable)      | yes: 8/8 RFI are ALL_IN shove/fold; no 3-bets
10    | 8   | 8 (call/fold)   | 7 (call/fold)   | 0 (unreachable)      | yes: 8/8 RFI are ALL_IN shove/fold; no 3-bets
20    | 8   | 8 (jam/call/f)  | 7 (jam/call/f)  | 36 (call/fold only)  | partly: 36/80 nodes ALL_IN (all 3-bets are jams)
40    | 8   | 8 (3b/call/f)   | 7 (3b/call/f)   | 36 (jam/call/fold)   | partly: 36/114 nodes ALL_IN (all 4-bets are jams)
100   | 8   | 8 (3b/call/f)   | 7 (3b/call/f)   | 36 (4b/call/fold)    | no: only the 36 5-bet nodes are ALL_IN (36/152)
```

"PUSH-LIKE" = number of imported nodes whose aggressive action is `ALL_IN`.

## Per stack

Node counts are per scenario. All nodes have exactly 169 hands and pass
`validateAcademyStrategyDataset`.

| Stack | Total | RFI | Facing open | Facing 3-bet | Facing 4-bet | Facing 5-bet | Skipped | Rejected | 6-max nodes | 8-max nodes | 9-max nodes |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 5 | **44** | 8 | 36 | 0 | 0 | 0 | 36 | 73 | 20 | 35 | 44 |
| 10 | **44** | 8 | 36 | 0 | 0 | 0 | 51 | 58 | 20 | 35 | 44 |
| 20 | **80** | 8 | 36 | 36 | 0 | 0 | 36 | 37 | 35 | 63 | 80 |
| 40 | **114** | 8 | 36 | 36 | 34 | 0 | 0 | 39 | 49 | 90 | 114 |
| 100 | **152** | 8 | 36 | 36 | 36 | 36 | 0 | 1 | 65 | 119 | 152 |
| **all** | **434** | 40 | 180 | 108 | 70 | 36 | 123 | 208 | | | |

Actions per node type:

| Stack | RFI | Facing open | Facing 3-bet | Facing 4-bet | Facing 5-bet |
|---|---|---|---|---|---|
| 5 | ALL_IN / FOLD | CALL / FOLD | — | — | — |
| 10 | ALL_IN / FOLD | CALL / FOLD | — | — | — |
| 20 | RAISE / FOLD (SB: RAISE / LIMP / FOLD) | ALL_IN / CALL / FOLD | CALL / FOLD | — | — |
| 40 | RAISE / FOLD | RAISE / CALL / FOLD | ALL_IN / CALL / FOLD | CALL / FOLD | — |
| 100 | RAISE / FOLD (SB: RAISE / LIMP / FOLD) | RAISE / CALL / FOLD | RAISE / CALL / FOLD | ALL_IN / CALL / FOLD | CALL / FOLD |

### Seat coverage (9-max: UTG, UTG1, UTG2, LJ, HJ, CO, BTN, SB, BB)

- **RFI.** UTG, UTG1, UTG2, LJ, HJ, CO, BTN and SB at every stack (8). There
  is no `RFI_BB`: upstream has no `OpenBB`. In 6-max: LJ–SB (5); in 8-max:
  UTG1–SB (7).
- **Facing open.** All 36 hero-after-opener pairs at every stack.
- **Facing 3-bet** (hero is the opener). 36 pairs at 20/40/100 BB; none at
  5/10 BB. `FACING_3BET_BTN_VS_CO` is always rejected: upstream lists a
  `Call 3BetBTNvsCO` key, but CO acts before BTN and cannot 3-bet a BTN open
  (`FACING_OPEN_CO_VS_BTN` does not exist).
- **Facing 4-bet** (hero is the 3-bettor). 36 at 100 BB and 34 at 40 BB (two
  rejected, see below). None at 5/10/20 BB: at 20 BB the 3-bet is all-in, so
  upstream `4Bet*` keys are all-zero.
- **Facing 5-bet** (hero is the 4-bettor). 36 at 100 BB only. At 40 BB the
  4-bet is all-in; the only two non-zero upstream `5Bet` keys belong to the
  rejected nodes.

### BB defence

`FACING_OPEN_BB_VS_{UTG,UTG1,UTG2,LJ,HJ,CO,BTN,SB}` — all 8 at every stack.

- **BB vs BTN.** Facing open at all stacks. At 40 BB also
  `FACING_4BET_BB_VS_BTN` (CALL/FOLD). At 100 BB also `FACING_4BET_BB_VS_BTN`
  (ALL_IN/CALL/FOLD). BTN's side: `FACING_3BET_BTN_VS_BB` at 20/40/100 and
  `FACING_5BET_BTN_VS_BB` at 100.
- **BB vs CO.** Facing open at all stacks; `FACING_4BET_BB_VS_CO` at 40 and
  100 BB.
- **BB vs SB.** Facing open at all stacks; `FACING_4BET_BB_VS_SB` at 40 and
  100 BB.
- **Not covered.** BB facing an SB **limp** (and any limp-raise tree): the
  upstream data has no "vs limp" keys, although SB limps at 20 and 100 BB.

### SB defence

`FACING_OPEN_SB_VS_{UTG,UTG1,UTG2,LJ,HJ,CO,BTN}` — all 7 at every stack.

- **SB vs BTN.** Facing open at all stacks. `FACING_4BET_SB_VS_BTN` at 40 and
  100 BB. BTN's side: `FACING_3BET_BTN_VS_SB` at 20/40/100 and
  `FACING_5BET_BTN_VS_SB` at 100.
- **SB vs CO.** Facing open at all stacks; `FACING_4BET_SB_VS_CO` at 40 and
  100 BB.
- **SB as opener.** `RFI_SB` at every stack. A LIMP option exists only at 20
  and 100 BB, the only stacks where upstream `LimpSB` has data.

### Blind vs blind (SB opens, BB responds)

| Stack | Nodes |
|---|---|
| 5 | `RFI_SB`, `FACING_OPEN_BB_VS_SB` |
| 10 | `RFI_SB`, `FACING_OPEN_BB_VS_SB` |
| 20 | + `FACING_3BET_SB_VS_BB` |
| 40 | + `FACING_3BET_SB_VS_BB`, `FACING_4BET_BB_VS_SB` |
| 100 | + `FACING_3BET_SB_VS_BB`, `FACING_4BET_BB_VS_SB`, `FACING_5BET_SB_VS_BB` |

SB vs BB complete-and-check / limp trees are not in the source.

### BTN vs blinds

| Stack | Nodes |
|---|---|
| 5, 10 | `FACING_OPEN_SB_VS_BTN`, `FACING_OPEN_BB_VS_BTN` |
| 20 | + `FACING_3BET_BTN_VS_SB`, `FACING_3BET_BTN_VS_BB` |
| 40 | + `FACING_4BET_SB_VS_BTN`, `FACING_4BET_BB_VS_BTN` |
| 100 | + `FACING_5BET_BTN_VS_SB`, `FACING_5BET_BTN_VS_BB` |

## Missing / invalid / rejected

| Stack | Reason | Nodes |
|---|---|---|
| 5 | `UNREACHABLE` | all 37 `FACING_3BET_*` (upstream `3Bet*` all-zero); all 36 `FACING_5BET_*` (no reachable villain 4-bet node) |
| 5 | skipped (all-fold) | all 36 `FACING_4BET_*` (hero's `3Bet` prev is all-zero) |
| 10 | `UNREACHABLE` | all 37 `FACING_3BET_*`; 21 `FACING_5BET_*` |
| 10 | skipped (all-fold) | 36 `FACING_4BET_*`, 15 `FACING_5BET_*` |
| 20 | `UNREACHABLE` | `FACING_3BET_BTN_VS_CO`; all 36 `FACING_4BET_*` (upstream `4Bet*` all-zero: the 3-bet is all-in) |
| 20 | skipped (all-fold) | all 36 `FACING_5BET_*` |
| 40 | `NEGATIVE_FOLD_REMAINDER` | `FACING_4BET_CO_VS_UTG`, `FACING_4BET_BB_VS_LJ`. For AA, conditional 5-bet = 1 and call = 1, so the fold remainder is −1. These are the only two non-zero upstream `5Bet*` keys at 40 BB, where the 4-bet is already all-in. |
| 40 | `UNREACHABLE` | `FACING_3BET_BTN_VS_CO`; all 36 `FACING_5BET_*` |
| 100 | `UNREACHABLE` | `FACING_3BET_BTN_VS_CO` |

Other observations:

- **Upstream cap and unreached hands.** Across imported nodes these occur
  only at 100 BB: 4 hands hit the upstream `min(1, w/p)` cap, and 17 hands
  had raw w > 0 but prev 0 (→ 0). Both are recorded per node.
- **Zero-filled lookups.** 10 BB: 753; 20 BB: 14,925; 100 BB: 34,864.
  5/40 BB: 0.
- **Ignored keys.** `EmptyRange` and `WideRange` in every file. No
  unrecognized keys.

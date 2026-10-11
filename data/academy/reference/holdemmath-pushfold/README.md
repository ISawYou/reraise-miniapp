# HoldemMath Poker Math Data

Precomputed Texas Hold'em datasets powering the free tools at
**[holdemmath.com](https://holdemmath.com/)** — no account, no paywall, everything runs in your browser.

| Dataset | What it contains | Files |
|---|---|---|
| **Preflop equity matrix** | All **14,365 unique starting-hand matchups** (169×169 grid), 20,000 Monte Carlo runouts per pair | [`matrix/`](matrix/) |
| **Nash push-fold charts** | Heads-up / 6-max / 9-max equilibrium shove & call ranges at 7 stack depths (4–20bb), no-ante and 10%-ante variants | [`pushfold/`](pushfold/) |

Interactive versions: [odds calculator](https://holdemmath.com/odds-calculator/) ·
[matchup matrix](https://holdemmath.com/matchups/) ·
[push-fold charts](https://holdemmath.com/push-fold/) ·
[push-fold trainer](https://holdemmath.com/trainer/)

A zero-dependency in-browser viewer for the charts ships in [`viewer/`](viewer/) —
enable GitHub Pages (or serve the folder with any static file server) to browse all ranges without writing code.

---

## 1. Preflop equity matrix

### `matrix/preflop_equity_matrix.json`

```jsonc
{
  "n": 20000,          // Monte Carlo runouts per pair
  "order": ["AA", "AKs", "AQs", "..."],  // 169 hand classes, same order everywhere
  "p": [               // 14,365 rows, one per unique unordered pair {i, j}
    [0, 0, 21, 956, 22],   // [i, j, i_wins_permille, tie_permille, j_wins_permille]
    ...
  ]
}
```

- Hand notation: `AKs` = ace-king suited, `AKo` = ace-king offsuit, `TT` = pocket tens.
  `order[i]` gives the display name of class index `i`.
- Probabilities are integer **permille** (out of 1000). Example row `[0, 0, 21, 956, 22]`:
  AA vs AA wins 2.1% / chops 95.6% / loses 2.2% — the famous near-guaranteed split.
- All-in equity (pot equity) of `i` vs `j` = `(i_wins + tie/2) / 1000`.

### `matrix/preflop_equity_matrix.csv`

169×169 wide table, cell = equity of row hand vs column hand in **percent** (win + ½·tie, 2 decimals).

### `matrix/preflop_matchups_long.csv`

Long format, one row per unique matchup:
`hand1, hand2, win_pct, tie_pct, lose_pct, equity_pct`.

---

## 2. Nash push-fold charts

### `pushfold/pushfold_charts.json`

```jsonc
{
  "v": 1,
  "depths": [4, 6, 8, 10, 12, 15, 20],        // effective stack in big blinds
  "order": ["AA", "AKs", "..."],              // same 169-hand order as the matrix
  "formats": { "hu": {"seats": [...]}, "max6": {...}, "max9": {...} },
  "anteVariants": { "data": 0, "dataAnte10": 0.1 },  // ante per player, in bb
  "data":      { "<fmt>": { "<depth>": { "<seat>": PfRange } } },
  "dataAnte10":{ "<fmt>": { "<depth>": { "<seat>": PfRange } } }
}
```

A `PfRange` entry is:

```jsonc
{
  "s": [0, 1, 5, ...],  // hand-class indices (into "order") in this range
  "p": 12.3,            // coverage: % of all combos this range covers
  "e": [3.02, ...]      // EV of the strategy per hand class, aligned with "order"
}
```

**Seat keys** (`<fmt>` = `hu` / `max6` / `max9`, `<depth>` = one of the depths above):

- `"UTG"`, `"HJ"`, `"CO"`, `"BTN"`, `"SB"`, ... — that seat's **first-in all-in (shove) range**.
- `"BB|UTG"`, `"CO|HJ"`, `"BB|SB"`, ... — the **calling range** of the seat left of `|`
  facing a shove by the seat right of `|`. E.g. `"BB|SB"` = big blind call vs small blind,
  `"BB|UTG"` = big blind call vs UTG shove.
- Heads-up has exactly two entries per depth: `"SB"` (SB shove) and `"BB|SB"` (BB call).

**EV convention:** chip EV in big blinds, relative to folding (fold = 0), aligned with `order`.
For shove ranges `e[h]` is the EV of jamming hand `h` against the field's calling strategy;
for call ranges it is the EV of calling.

### Model, honestly stated

- **Heads-up is a near-exact Nash equilibrium** (fictitious play, best-response deviation
  ε ≤ 0.05bb; ε ≤ 0.13bb in the ante variant).
- **Multiway tables** solve each first-in seat's sub-game independently with a
  **single-caller approximation**, and fix the SB first-in range to the heads-up solution
  so tables stay mutually consistent.
- Chip EV, no rake, no limps, no ICM. The 10% ante follows the common
  (HRC-style) convention: every player posts 0.1bb before the cards are dealt.
- Multi-equilibrium degeneracy in push-fold games means other sites' charts may differ
  slightly and still be equilibria — compare EVs, not exact hand lists.

---

## 3. Quick start

Python and JavaScript examples live in [`examples/`](examples/):

```python
from examples.equity_lookup import equity
equity("AA", "KK")   # 81.95  (% for AA all-in preflop vs KK)
```

```javascript
const { equity } = await import('./examples/equity_lookup.js');
await equity('AA', 'KK');   // 81.95
```

Load the push-fold charts and read the HU 10bb SB range:

```python
from examples.pushfold_ranges import pushfold
pf = pushfold()
sb = pf["data"]["hu"]["10"]["SB"]
hands = [pf["order"][i] for i in sb["s"]]   # e.g. ['AA', 'AKs', ...]
```

## 4. Viewer (no code needed)

`viewer/index.html` renders every chart as a 13×13 grid (dropdowns: format, depth, ante, seat).
Serve the repo root with any static server, e.g. `python3 -m http.server 8000`, then open
`http://localhost:8000/viewer/`. On GitHub it works out of the box once Pages is enabled
(*Settings → Pages → Deploy from branch → main → /root*).

## 5. Attribution & license

- **Data** (`matrix/`, `pushfold/`): [CC BY 4.0](LICENSE-DATA) — free to use and redistribute,
  please credit *"HoldemMath (holdemmath.com)"* and link back if you build on it.
- **Code / examples / viewer**: [MIT](LICENSE-CODE).

Generated by HoldemMath's own tooling (Monte Carlo via the MIT-licensed
[eval7](https://pypi.org/project/eval7/) engine; charts solved by
[HoldemMath's fictitious-play solver](https://holdemmath.com/push-fold/)).

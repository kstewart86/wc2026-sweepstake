# WC 2026 Office Sweepstake

Live standings tracker for a 19-person CI$15-entry 2026 FIFA World Cup sweepstake. Runs free on GitHub Pages; data is refreshed every 5 minutes by a GitHub Actions cron job.

---

## 1 — Enable GitHub Pages

1. Push this repo to GitHub.
2. Go to **Settings → Pages**.
3. Under **Source**, choose `Deploy from a branch`, branch = `main`, folder = `/docs`.
4. Save. The site will be live at `https://<your-org>.github.io/<repo-name>/`.

---

## 2 — Set the `SCORE_API_KEY` secret

1. Register a free account at [football-data.org](https://www.football-data.org/).
2. Copy your API token.
3. In GitHub go to **Settings → Secrets and variables → Actions → New repository secret**.
4. Name: `SCORE_API_KEY`, Value: your token.

The workflow reads this as `process.env.SCORE_API_KEY`. If it's absent or empty the updater falls back to the ESPN public API (no key required).

---

## 3 — Running locally

```bash
# No npm install needed — pure Node, no external deps (uses native fetch, Node 20+)
SCORE_API_KEY=your_token node scripts/update.js
```

To serve the site locally (any static server works):
```bash
npx serve docs
# or
python -m http.server 8080 --directory docs
```

---

## 4 — Data source notes

| Source | Key needed | Live WC data | Notes |
|--------|-----------|-------------|-------|
| football-data.org | Yes (free tier) | ⚠️ **Unconfirmed** — free TIER_ONE may not include WC competition (id 2000). Check your plan and upgrade if needed. | Primary |
| ESPN public API | No | ✅ Confirmed working | Fallback |

**⚠️ If football-data.org free tier does NOT include live WC scores**, either:
- Upgrade to a paid plan, or
- The fallback ESPN adapter will be used automatically (no action needed).

---

## 5 — Elo ratings & model

- **Source:** eloratings.net pre-tournament ratings (pulled 2026-06-11, before matchday 1).
- **Conversion → goals:**
  - `base = 1.35` goals per team per 90 min (World Cup neutral-venue average)
  - `supremacy = (elo_home − elo_away) / 200`
  - `λ_home = max(0.20, base + supremacy/2 + homeAdv)`
  - `λ_away = max(0.20, base − supremacy/2)`
  - `homeAdv = 0.25` for host nations (MEX / USA / CAN) **at their home venues only**
  - Goals drawn from independent Poisson distributions
- **Extra time:** 30 min modelled as 1/3 of normal intensity; if still level → Elo-weighted penalty coin flip (`p = 1 / (1 + 10^((elo_B − elo_A)/400))`)
- **Simulations:** 20 000 per update cycle

---

## 6 — Sweepstake rules summary

| Prize | Allocation | Amount |
|-------|-----------|--------|
| 🥇 Final Winner | Owner of the team that wins the Final | CI$142 (50%) |
| 🥈 Runner-up    | Owner of the team that loses the Final | CI$85 (30%) |
| 🏅 Group Stage  | Owner with highest combined group-stage points (both teams) | CI$57 (20%) |

Pot = 19 × CI$15 = **CI$285**. Tiebreakers for Group Stage prize: (1) combined GD, (2) combined GF, then displayed as a tie.

---

## ⚠️ Teams to confirm

All 19 participants' teams were validated against the official 48-team draw as of 2026-06-11. No unresolvable teams were found.

**Name corrections applied:**
| Input | Canonical | Notes |
|-------|-----------|-------|
| Columbia | Colombia | Spelling fix — COL, Group K |
| Côte d'Ivoire | Côte d'Ivoire (CIV) | Also listed as "Ivory Coast" in some sources — same team |

---

## 7 — Third-place R32 allocation (Annex C)

FIFA's regulations include a 495-row Annex C table mapping every combination of 8 qualifying 3rd-place groups to R32 slot assignments. Six representative rows are hardcoded in `scripts/simulate.js`. For all other combinations the simulation falls back to a greedy bipartite-matching algorithm that respects each slot's eligible-group constraints. The probability estimates are robust to this approximation at 20 000 simulations.

---

## 8 — Participants

| # | Name | Team 1 | Team 2 |
|---|------|--------|--------|
| 1 | Alex Tesh | Germany (E) | Ghana (L) |
| 2 | Bianca Tibbitts | Japan (F) | DR Congo (K) |
| 3 | Cally Rush | Uruguay (H) | Czechia (A) |
| 4 | Conor Byrne | Ecuador (E) | Sweden (F) |
| 5 | Conor Parkes | Croatia (L) | Iran (G) |
| 6 | David Brady | Egypt (G) | Türkiye (D) |
| 7 | Eleanor Fisher | Colombia (K) | USA (D) |
| 8 | Erika Leggat | Netherlands (F) | Senegal (I) |
| 9 | Giji Alex | Belgium (G) | Panama (L) |
| 10 | James Brewer | Mexico (A) | Australia (D) |
| 11 | Jason Robinson | Switzerland (B) | Austria (J) |
| 12 | Jeffrey Stower | Brazil (C) | Paraguay (D) |
| 13 | Jemma Green | Portugal (K) | Côte d'Ivoire (E) |
| 14 | Kirsten Walmsley | Morocco (C) | Bosnia & Herzegovina (B) |
| 15 | Kyle Stewart | England (L) | Tunisia (F) |
| 16 | Neema Griffin | Spain (H) | South Korea (A) |
| 17 | Sam Story | France (I) | Algeria (J) |
| 18 | Xaria Deosaran | Argentina (J) | Scotland (C) |
| 19 | Hannah Penketh | Norway (I) | Canada (B) |

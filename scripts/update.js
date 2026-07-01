/**
 * Main updater: fetch live scores → merge results → run simulation → write JSON.
 * Called by GitHub Actions every 5 minutes.
 *
 * Self-gating: exits early if no match is live or finished in the last 12 minutes.
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const { fetchLiveResults }        = require('./fetchResults.js');
const { simulate, resolveBracket } = require('./simulate.js');

const DATA_DIR = path.join(__dirname, '..', 'docs', 'data');

function load(name) {
  return JSON.parse(fs.readFileSync(path.join(DATA_DIR, name), 'utf8'));
}

function save(name, obj) {
  fs.writeFileSync(path.join(DATA_DIR, name), JSON.stringify(obj, null, 2), 'utf8');
}

function json(obj) { return JSON.stringify(obj); }

// ---------------------------------------------------------------------------
async function main() {
  console.log('[update] Starting', new Date().toISOString());

  const fixtures     = load('fixtures.json');
  const teams        = load('teams.json');
  const participants = load('participants.json');
  let   results      = load('results.json');

  // ---- RESOLVE KNOCKOUT MATCHUPS (so the fetcher can match KO games) -------
  // Knockout fixtures only carry slots (W73, 3rd, …); the score feed reports
  // real teams. Resolve the current bracket from existing results so the fetcher
  // knows which teamIds belong to each knockout matchId.
  const preBracket = resolveBracket(fixtures, results, teams);
  const finishedIds = new Set(results.matches.filter(m => m.status === 'finished').map(m => m.matchId));
  const koIds = new Set(fixtures.matches.filter(f => f.stage !== 'group').map(f => f.matchId));
  const koMatchups = [];
  for (const rd of preBracket.rounds) {
    for (const m of rd.matches) {
      if (!m.homeId && !m.awayId) continue;
      const fix = fixtures.matches.find(f => f.matchId === m.matchId);
      // Anchors = the reliably-known side(s) (group seed or prior winner, never a
      // predicted third-place slot), used to match a game whose other side we
      // mispredicted. Only for not-yet-finished matches (avoids cross-round clashes).
      const anchors = [];
      if (!finishedIds.has(m.matchId)) {
        if (fix.homeSlot !== '3rd' && m.homeId) anchors.push(m.homeId);
        if (fix.awaySlot !== '3rd' && m.awayId) anchors.push(m.awayId);
      }
      koMatchups.push({ matchId: m.matchId, homeId: m.homeId, awayId: m.awayId, anchors });
    }
  }

  // ---- SELF-GATE ----------------------------------------------------------
  // Skip if no match is live and none imminent. (Saves API calls on the many
  // cron ticks during off-hours.) During the knockout phase we always poll:
  // knockout kickoff times shift with the bracket, so a kickoff-window heuristic
  // would wrongly skip the days when KO games are actually being played.
  const nowMs        = Date.now();
  const knockoutLive = preBracket.groupStageComplete && preBracket.currentStage !== 'complete';
  const hasActive = results.matches.some(m => {
    if (m.status === 'live') return true;
    const fix = fixtures.matches.find(f => f.matchId === m.matchId);
    if (!fix) return false;
    const kickoffMs = new Date(fix.kickoffUtc).getTime();
    return m.status === 'finished' && nowMs - kickoffMs < 4 * 60 * 60 * 1000; // finished today-ish
  });
  const upcomingSoon = fixtures.matches.some(f => {
    const kickMs = new Date(f.kickoffUtc).getTime();
    return kickMs > nowMs - 3 * 60 * 60 * 1000 && kickMs < nowMs + 2 * 60 * 60 * 1000;
  });

  if (!knockoutLive && !hasActive && !upcomingSoon) {
    console.log('[update] No active or imminent matches — skipping fetch');
    process.exit(0);
  }

  // ---- FETCH LIVE RESULTS -------------------------------------------------
  let fresh;
  try {
    fresh = await fetchLiveResults(fixtures, koMatchups);
  } catch (e) {
    console.error('[update] Fetch failed:', e.message);
    process.exit(1);
  }

  if (fresh.length === 0) {
    console.log('[update] No results returned by fetch — keeping existing data');
    // Still re-run simulation in case we're in tournament time
  }

  // ---- MERGE RESULTS ------------------------------------------------------
  // Never downgrade a finished/live match; never overwrite finished with a
  // lesser status. Knockout scheduled fixtures ARE persisted (teams only, no
  // score) so the real bracket matchups show before kickoff.
  const merged = [...results.matches];
  for (const raw of fresh) {
    const played = raw.status === 'finished' || raw.status === 'live';
    const koScheduled = raw.status === 'scheduled' && koIds.has(raw.matchId) && raw.homeId && raw.awayId;
    if (!played && !koScheduled) continue;
    if (played && (raw.homeGoals === null || raw.awayGoals === null)) continue; // skip incomplete
    const r = koScheduled
      ? { matchId: raw.matchId, homeId: raw.homeId, awayId: raw.awayId, status: 'scheduled', homeGoals: null, awayGoals: null }
      : raw;
    const idx = merged.findIndex(m => m.matchId === r.matchId);
    if (idx >= 0) {
      const cur = merged[idx].status;
      if ((cur === 'finished' || cur === 'live') && r.status === 'scheduled') continue; // don't downgrade
      if (cur === 'finished' && r.status !== 'finished') continue; // guard
      merged[idx] = r;
    } else {
      merged.push(r);
    }
  }

  const newResults = { updatedUtc: new Date().toISOString(), matches: merged };

  // ---- RUN SIMULATION -----------------------------------------------------
  console.log('[update] Running Monte Carlo simulation (20 000 iterations)...');
  const t0   = Date.now();
  const probs = simulate(fixtures, newResults, teams, participants, 20000);
  console.log(`[update] Simulation done in ${Date.now() - t0}ms`);

  // ---- RESOLVE BRACKET ----------------------------------------------------
  const bracket = resolveBracket(fixtures, newResults, teams);

  // ---- COMMIT ONLY IF CHANGED ---------------------------------------------
  const oldResults = load('results.json');
  const oldProbs   = load('probabilities.json');
  let   oldBracket = { rounds: [] };
  try { oldBracket = load('bracket.json'); } catch (_) {}

  const resultsChanged = json(oldResults.matches) !== json(newResults.matches);
  const probsChanged   = json(oldProbs.participants) !== json(probs.participants)
                      || json(oldProbs.groupLeaderboard) !== json(probs.groupLeaderboard);
  // Compare rounds only (ignore updatedUtc, which changes every run).
  const bracketChanged = json(oldBracket.rounds) !== json(bracket.rounds);

  if (!resultsChanged && !probsChanged && !bracketChanged) {
    console.log('[update] No changes — nothing to commit');
    process.exit(0);
  }

  if (resultsChanged) { save('results.json', newResults); console.log('[update] Wrote results.json'); }
  if (probsChanged)   { save('probabilities.json', probs); console.log('[update] Wrote probabilities.json'); }
  if (bracketChanged) { save('bracket.json', bracket);     console.log('[update] Wrote bracket.json'); }

  // ---- RANKINGS SNAPSHOT (every 12 hours) ---------------------------------
  // Sorted by group pts (desc), then GD, then GF — same order as the leaderboard default.
  const HISTORY_PATH = 'rankings_history.json';
  let history = { snapshotUtc: null, rankings: [] };
  try { history = load(HISTORY_PATH); } catch (_) {}
  const twelveHoursMs = 12 * 60 * 60 * 1000;
  const lastSnapshot = history.snapshotUtc ? new Date(history.snapshotUtc).getTime() : 0;
  if (nowMs - lastSnapshot >= twelveHoursMs) {
    const sorted = [...probs.participants].sort((a, b) => {
      if ((b.currentGroupPts ?? 0) !== (a.currentGroupPts ?? 0)) return (b.currentGroupPts ?? 0) - (a.currentGroupPts ?? 0);
      if ((b.currentGroupGd  ?? 0) !== (a.currentGroupGd  ?? 0)) return (b.currentGroupGd  ?? 0) - (a.currentGroupGd  ?? 0);
      return (b.currentGroupGf ?? 0) - (a.currentGroupGf ?? 0);
    });
    save(HISTORY_PATH, {
      snapshotUtc: new Date().toISOString(),
      rankings: sorted.map((p, i) => ({ id: p.id, rank: i + 1 })),
    });
    console.log('[update] Wrote rankings_history.json snapshot');
  }

  console.log('[update] Done', new Date().toISOString());
}

main().catch(e => { console.error('[update] Fatal:', e); process.exit(1); });

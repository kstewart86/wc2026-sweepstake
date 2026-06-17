/**
 * Main updater: fetch live scores → merge results → run simulation → write JSON.
 * Called by GitHub Actions every 5 minutes.
 *
 * Self-gating: exits early if no match is live or finished in the last 12 minutes.
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const { fetchLiveResults } = require('./fetchResults.js');
const { simulate }         = require('./simulate.js');

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

  // ---- SELF-GATE ----------------------------------------------------------
  // Skip if no match is live and none finished within the last 12 min.
  // (Saves API calls on 95% of cron ticks that happen during off-hours.)
  const nowMs     = Date.now();
  const windowMs  = 12 * 60 * 1000;
  const hasActive = results.matches.some(m => {
    if (m.status === 'live') return true;
    // No timestamp on finished matches — we rely on kickoff times as a proxy.
    // If the match's expected finish time (kickoff + 110 min) is within the window, keep going.
    const fix = fixtures.matches.find(f => f.matchId === m.matchId);
    if (!fix) return false;
    const kickoffMs = new Date(fix.kickoffUtc).getTime();
    return m.status === 'finished' && nowMs - kickoffMs < 4 * 60 * 60 * 1000; // finished today-ish
  });

  // Also check if any fixture kicked off in the last 3 hours (could still be in play)
  // or kicks off in the next 2 hours
  const upcomingSoon = fixtures.matches.some(f => {
    const kickMs = new Date(f.kickoffUtc).getTime();
    return kickMs > nowMs - 3 * 60 * 60 * 1000 && kickMs < nowMs + 2 * 60 * 60 * 1000;
  });

  if (!hasActive && !upcomingSoon) {
    console.log('[update] No active or imminent matches — skipping fetch');
    process.exit(0);
  }

  // ---- FETCH LIVE RESULTS -------------------------------------------------
  let fresh;
  try {
    fresh = await fetchLiveResults(fixtures);
  } catch (e) {
    console.error('[update] Fetch failed:', e.message);
    process.exit(1);
  }

  if (fresh.length === 0) {
    console.log('[update] No results returned by fetch — keeping existing data');
    // Still re-run simulation in case we're in tournament time
  }

  // ---- MERGE RESULTS ------------------------------------------------------
  // Never overwrite a finished match with a non-finished one (data quality guard).
  const merged = [...results.matches];
  for (const r of fresh) {
    if (r.homeGoals === null || r.awayGoals === null) continue; // skip incomplete
    const idx = merged.findIndex(m => m.matchId === r.matchId);
    if (idx >= 0) {
      if (merged[idx].status === 'finished' && r.status !== 'finished') continue; // guard
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

  // ---- COMMIT ONLY IF CHANGED ---------------------------------------------
  const oldResults = load('results.json');
  const oldProbs   = load('probabilities.json');

  const resultsChanged = json(oldResults.matches) !== json(newResults.matches);
  const probsChanged   = json(oldProbs.participants) !== json(probs.participants)
                      || json(oldProbs.groupLeaderboard) !== json(probs.groupLeaderboard);

  if (!resultsChanged && !probsChanged) {
    console.log('[update] No changes — nothing to commit');
    process.exit(0);
  }

  if (resultsChanged) { save('results.json', newResults); console.log('[update] Wrote results.json'); }
  if (probsChanged)   { save('probabilities.json', probs); console.log('[update] Wrote probabilities.json'); }

  console.log('[update] Done', new Date().toISOString());
}

main().catch(e => { console.error('[update] Fatal:', e); process.exit(1); });

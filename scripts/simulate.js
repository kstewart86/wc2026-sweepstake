/**
 * Monte Carlo simulation for the 2026 World Cup sweepstake.
 *
 * Model: Poisson goals driven by Elo rating difference.
 *   base = 1.35 goals per team per 90 min (neutral venue World Cup average)
 *   supremacy = (elo_A - elo_B) / 200   (expected goal advantage for team A)
 *   λ_A = max(0.20, base + supremacy/2 + homeAdv)
 *   λ_B = max(0.20, base - supremacy/2)
 *   homeAdv = 0.25 for host nations (MEX/USA/CAN) at their home venues, 0 otherwise
 *
 * Extra time: 30 min modelled as 1/3 of a full match (base * 1/3), then if still level,
 * Elo-weighted coin flip for penalties (p_pen = 1 / (1 + 10^((eloB-eloA)/400))).
 *
 * Third-place Annex C: FIFA's 495-combination table is partially hardcoded; unknown
 * combinations fall back to a greedy bipartite-matching algorithm that respects
 * the eligibility constraints per R32 slot.
 */

'use strict';

// ---------------------------------------------------------------------------
// Poisson RNG (Knuth algorithm)
// ---------------------------------------------------------------------------
function poisson(lambda) {
  if (lambda <= 0) return 0;
  const L = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do { k++; p *= Math.random(); } while (p > L);
  return k - 1;
}

// ---------------------------------------------------------------------------
// Simulate a single 90-min match; returns { goalsA, goalsB }
// ---------------------------------------------------------------------------
function simMatch(eloA, eloB, homeAdvA = 0) {
  const BASE = 1.35;
  const supremacy = (eloA - eloB) / 200;
  const lambdaA = Math.max(0.20, BASE + supremacy / 2 + homeAdvA);
  const lambdaB = Math.max(0.20, BASE - supremacy / 2);
  return { goalsA: poisson(lambdaA), goalsB: poisson(lambdaB) };
}

// Simulate with extra time + penalties for knockout matches (returns winner 'A' or 'B')
function simKnockout(eloA, eloB, homeAdvA = 0) {
  const { goalsA: g90A, goalsB: g90B } = simMatch(eloA, eloB, homeAdvA);
  if (g90A !== g90B) return { winner: g90A > g90B ? 'A' : 'B', goalsA: g90A, goalsB: g90B, aet: false };

  // Extra time: 30 min ≈ 1/3 of 90, reduced intensity
  const etBase = 1.35 / 3;
  const sup = (eloA - eloB) / 200;
  const etA = Math.max(0.05, etBase + sup / 2 + homeAdvA / 3);
  const etB = Math.max(0.05, etBase - sup / 2);
  const etGoalsA = poisson(etA);
  const etGoalsB = poisson(etB);
  const totA = g90A + etGoalsA;
  const totB = g90B + etGoalsB;
  if (totA !== totB) return { winner: totA > totB ? 'A' : 'B', goalsA: totA, goalsB: totB, aet: true };

  // Penalties: Elo-weighted
  const pPen = 1 / (1 + Math.pow(10, (eloB - eloA) / 400));
  return { winner: Math.random() < pPen ? 'A' : 'B', goalsA: totA, goalsB: totB, aet: true, pens: true };
}

// ---------------------------------------------------------------------------
// Group table computation
// ---------------------------------------------------------------------------
function buildGroupTable(teams, matches) {
  const table = {};
  for (const t of teams) table[t] = { pts: 0, gd: 0, gf: 0, ga: 0, headToHead: {} };

  for (const m of matches) {
    const { homeId, awayId, homeGoals, awayGoals } = m;
    if (!table[homeId] || !table[awayId]) continue;
    table[homeId].gf += homeGoals; table[homeId].ga += awayGoals;
    table[awayId].gf += awayGoals; table[awayId].ga += homeGoals;
    table[homeId].gd = table[homeId].gf - table[homeId].ga;
    table[awayId].gd = table[awayId].gf - table[awayId].ga;
    if (homeGoals > awayGoals) {
      table[homeId].pts += 3;
    } else if (homeGoals === awayGoals) {
      table[homeId].pts += 1; table[awayId].pts += 1;
    } else {
      table[awayId].pts += 3;
    }
    // head-to-head record for tiebreaking
    if (!table[homeId].headToHead[awayId]) table[homeId].headToHead[awayId] = { pts: 0, gd: 0, gf: 0 };
    if (!table[awayId].headToHead[homeId]) table[awayId].headToHead[homeId] = { pts: 0, gd: 0, gf: 0 };
    if (homeGoals > awayGoals) {
      table[homeId].headToHead[awayId].pts += 3;
    } else if (homeGoals === awayGoals) {
      table[homeId].headToHead[awayId].pts += 1;
      table[awayId].headToHead[homeId].pts += 1;
    } else {
      table[awayId].headToHead[homeId].pts += 3;
    }
    table[homeId].headToHead[awayId].gd += (homeGoals - awayGoals);
    table[awayId].headToHead[homeId].gd += (awayGoals - homeGoals);
    table[homeId].headToHead[awayId].gf += homeGoals;
    table[awayId].headToHead[homeId].gf += awayGoals;
  }
  return table;
}

// Sort a group using FIFA 2026 tiebreakers:
// 1. Points  2. GD  3. GF  4. Head-to-head pts  5. H2H GD  6. H2H GF  7. coin flip (sim)
function sortGroup(teamIds, table) {
  return [...teamIds].sort((a, b) => {
    if (table[b].pts !== table[a].pts) return table[b].pts - table[a].pts;
    if (table[b].gd  !== table[a].gd)  return table[b].gd  - table[a].gd;
    if (table[b].gf  !== table[a].gf)  return table[b].gf  - table[a].gf;
    const h2hAB = (table[a].headToHead[b] || {}).pts || 0;
    const h2hBA = (table[b].headToHead[a] || {}).pts || 0;
    if (h2hBA !== h2hAB) return h2hBA - h2hAB;
    const h2hGDA = (table[a].headToHead[b] || {}).gd || 0;
    const h2hGDB = (table[b].headToHead[a] || {}).gd || 0;
    if (h2hGDB !== h2hGDA) return h2hGDB - h2hGDA;
    return Math.random() < 0.5 ? -1 : 1; // coin flip tiebreak
  });
}

// ---------------------------------------------------------------------------
// Annex C: third-place team → R32 slot assignment
// Partial hardcode of FIFA's 495-combination table; fallback = greedy matching.
// Key = sorted qualifying groups joined, value = { slotMatchId: groupChar }
// ---------------------------------------------------------------------------
const ANNEX_C = {
  'EFGHIJKL': { 74:'E', 77:'J', 79:'I', 80:'F', 81:'H', 82:'G', 85:'L', 87:'K' },
  'DFGHIJKL': { 74:'H', 77:'G', 79:'I', 80:'D', 81:'J', 82:'F', 85:'L', 87:'K' },
  'BFGHIJKL': { 74:'H', 77:'J', 79:'B', 80:'F', 81:'I', 82:'G', 85:'L', 87:'K' },
  'AFGHIJKL': { 74:'H', 77:'J', 79:'I', 80:'F', 81:'A', 82:'G', 85:'L', 87:'K' },
  'ABGHIJKL': { 74:'H', 77:'J', 79:'B', 80:'A', 81:'I', 82:'G', 85:'L', 87:'K' },
  'ABCDEFGH': { 74:'H', 77:'G', 79:'B', 80:'C', 81:'A', 82:'F', 85:'D', 87:'E' },
};

// Eligible groups per R32 slot (those that contain 3rd-place team possibilities)
const SLOT_ELIGIBLE = {
  74: ['A','B','C','D','F'],
  77: ['C','D','F','G','H'],
  79: ['C','E','F','H','I'],
  80: ['E','H','I','J','K'],
  81: ['B','E','F','I','J'],
  82: ['A','E','H','I','J'],
  85: ['E','F','G','I','J'],
  87: ['D','E','I','J','L'],
};

function assignThirdPlace(qualGroups) {
  const key = [...qualGroups].sort().join('');
  if (ANNEX_C[key]) return ANNEX_C[key];

  // Greedy bipartite matching: assign most-constrained slots first
  const remaining = new Set(qualGroups);
  const assignment = {};
  const slots = Object.keys(SLOT_ELIGIBLE).map(Number);

  // Sort by number of eligible groups that are available (ascending = most constrained first)
  const sorted = slots.sort((a, b) => {
    const elig_a = SLOT_ELIGIBLE[a].filter(g => remaining.has(g)).length;
    const elig_b = SLOT_ELIGIBLE[b].filter(g => remaining.has(g)).length;
    return elig_a - elig_b;
  });

  for (const slot of sorted) {
    const eligible = SLOT_ELIGIBLE[slot].filter(g => remaining.has(g));
    if (eligible.length === 0) {
      // Fallback: pick any remaining group (shouldn't happen with valid input)
      const fallback = [...remaining][0];
      assignment[slot] = fallback;
      remaining.delete(fallback);
    } else {
      assignment[slot] = eligible[0];
      remaining.delete(eligible[0]);
    }
  }
  return assignment;
}

// ---------------------------------------------------------------------------
// Compare two 3rd-place teams for the "best 8 thirds" ranking
// Criteria (FIFA): pts → gd → gf
// ---------------------------------------------------------------------------
function compareThirds(a, b) {
  if (b.pts !== a.pts) return b.pts - a.pts;
  if (b.gd  !== a.gd)  return b.gd  - a.gd;
  return b.gf - a.gf;
}

// ---------------------------------------------------------------------------
// One full tournament simulation
// Returns { finalWinner, finalLoser, groupPrize: {id, pts, gd, gf} }
// ---------------------------------------------------------------------------
function runSim(fixtures, results, teams, participants) {
  // Build finished match lookup
  const finished = {};
  for (const r of results.matches) {
    if (r.status === 'finished') finished[r.matchId] = r;
  }

  // ---- GROUP STAGE --------------------------------------------------------
  const groups = 'ABCDEFGHIJKL'.split('');
  const groupResults = {}; // group → [{ homeId, awayId, homeGoals, awayGoals }]
  const groupTeams  = {}; // group → [teamId]

  for (const g of groups) { groupResults[g] = []; groupTeams[g] = []; }
  for (const [id, t] of Object.entries(teams)) groupTeams[t.group].push(id);

  for (const fix of fixtures.matches) {
    if (fix.stage !== 'group') continue;
    const done = finished[fix.matchId];
    let hg, ag;
    if (done) {
      hg = done.homeGoals; ag = done.awayGoals;
    } else {
      const homeAdv = fix.hostAdvantage === fix.homeId ? 0.25 : 0;
      const eloH = teams[fix.homeId]?.elo || 1500;
      const eloA = teams[fix.awayId]?.elo || 1500;
      const r = simMatch(eloH, eloA, homeAdv);
      hg = r.goalsA; ag = r.goalsB;
    }
    groupResults[fix.group].push({ homeId: fix.homeId, awayId: fix.awayId, homeGoals: hg, awayGoals: ag });
  }

  // Build final group tables
  const groupWinner  = {}; // group → teamId (1st)
  const groupRunnerUp= {}; // group → teamId (2nd)
  const thirds = []; // [{group, teamId, pts, gd, gf}]

  for (const g of groups) {
    const tbl = buildGroupTable(groupTeams[g], groupResults[g]);
    const sorted = sortGroup(groupTeams[g], tbl);
    groupWinner[g]   = sorted[0];
    groupRunnerUp[g] = sorted[1];
    thirds.push({ group: g, teamId: sorted[2], pts: tbl[sorted[2]].pts, gd: tbl[sorted[2]].gd, gf: tbl[sorted[2]].gf });
  }

  // Best 8 thirds
  thirds.sort(compareThirds);
  const best8 = thirds.slice(0, 8);
  const qualThirdGroups = best8.map(t => t.group);
  const thirdTeamByGroup = {};
  for (const t of best8) thirdTeamByGroup[t.group] = t.teamId;
  const annexAssign = assignThirdPlace(qualThirdGroups); // { slotMatchId: group }

  // Resolve R32 slot to actual teamId
  function resolveSlot(slot) {
    if (!slot) return null;
    if (slot.startsWith('1')) return groupWinner[slot[1]];
    if (slot.startsWith('2')) return groupRunnerUp[slot[1]];
    if (slot === '3rd') return null; // resolved via eligibleGroups + annexAssign
    return null;
  }

  // ---- KNOCKOUT STAGE -----------------------------------------------------
  const knockoutWinner = {}; // matchId → teamId

  function simKnockoutMatch(fix) {
    let homeTeam, awayTeam;
    if (fix.homeSlot && fix.homeSlot.startsWith('W')) {
      homeTeam = knockoutWinner[parseInt(fix.homeSlot.slice(1))];
    } else {
      homeTeam = resolveSlot(fix.homeSlot);
    }
    if (fix.awaySlot && fix.awaySlot.startsWith('W')) {
      awayTeam = knockoutWinner[parseInt(fix.awaySlot.slice(1))];
    } else if (fix.awaySlot === '3rd') {
      const assignedGroup = annexAssign[fix.matchId];
      awayTeam = thirdTeamByGroup[assignedGroup];
    } else {
      awayTeam = resolveSlot(fix.awaySlot);
    }

    if (!homeTeam || !awayTeam) return null;

    const eloH = teams[homeTeam]?.elo || 1500;
    const eloA = teams[awayTeam]?.elo  || 1500;
    const doneResult = finished[fix.matchId];
    if (doneResult) {
      return doneResult.homeGoals > doneResult.awayGoals ? homeTeam : awayTeam;
    }
    const res = simKnockout(eloH, eloA, 0);
    return res.winner === 'A' ? homeTeam : awayTeam;
  }

  // Simulate R32 → R16 → QF → SF → Final
  for (const fix of fixtures.matches) {
    if (['r32','r16','qf','sf','final'].includes(fix.stage)) {
      const winner = simKnockoutMatch(fix);
      if (winner) knockoutWinner[fix.matchId] = winner;
    }
  }

  const finalWinner = knockoutWinner[103];
  // Find the finalist who lost: whoever was in slot W101 or W102 and is not the winner
  const sf1Winner = knockoutWinner[101];
  const sf2Winner = knockoutWinner[102];
  const finalLoser = finalWinner === sf1Winner ? sf2Winner : sf1Winner;

  // ---- GROUP PRIZE CALCULATION --------------------------------------------
  // Each participant's group prize score = sum of both teams' pts, gd, gf across group stage
  const groupPrizeScores = participants.map(p => {
    let pts = 0, gd = 0, gf = 0;
    for (const g of groups) {
      const tbl = buildGroupTable(groupTeams[g], groupResults[g]);
      for (const tid of p.teams) {
        if (tbl[tid]) { pts += tbl[tid].pts; gd += tbl[tid].gd; gf += tbl[tid].gf; }
      }
    }
    return { id: p.id, pts, gd, gf };
  });

  // Rank by pts → gd → gf (ties are NOT broken further in sim; handled in aggregation)
  groupPrizeScores.sort((a, b) => {
    if (b.pts !== a.pts) return b.pts - a.pts;
    if (b.gd  !== a.gd)  return b.gd  - a.gd;
    return b.gf - a.gf;
  });

  return { finalWinner, finalLoser, groupPrize: groupPrizeScores };
}

// ---------------------------------------------------------------------------
// Aggregate N simulations → probability output
// ---------------------------------------------------------------------------
function simulate(fixtures, results, teamsObj, participants, N = 20000) {
  const teams = teamsObj.teams;

  const counts = {
    finalWinner: {},
    runnerUp:    {},
    groupPrize:  {},
  };
  for (const p of participants) {
    counts.finalWinner[p.id] = 0;
    counts.runnerUp[p.id]    = 0;
    counts.groupPrize[p.id]  = 0;
  }

  const teamToParticipant = {};
  for (const p of participants) for (const t of p.teams) teamToParticipant[t] = p.id;

  for (let i = 0; i < N; i++) {
    const { finalWinner, finalLoser, groupPrize } = runSim(fixtures, results, teams, participants);

    if (finalWinner && teamToParticipant[finalWinner]) counts.finalWinner[teamToParticipant[finalWinner]]++;
    if (finalLoser  && teamToParticipant[finalLoser])  counts.runnerUp[teamToParticipant[finalLoser]]++;

    // Group prize: find best score; split ties fractionally
    if (groupPrize.length > 0) {
      const best = groupPrize[0];
      const tied = groupPrize.filter(p => p.pts === best.pts && p.gd === best.gd && p.gf === best.gf);
      for (const t of tied) counts.groupPrize[t.id] += 1 / tied.length;
    }
  }

  // Compute actual current standings from real results
  const realGroupResults = {};
  for (const g of 'ABCDEFGHIJKL'.split('')) realGroupResults[g] = [];
  for (const r of results.matches) {
    const fix = fixtures.matches.find(f => f.matchId === r.matchId);
    if (fix?.stage === 'group') {
      realGroupResults[fix.group].push({ homeId: r.homeId, awayId: r.awayId, homeGoals: r.homeGoals, awayGoals: r.awayGoals });
    }
  }

  const pot = fixtures.pot.entryFee * fixtures.pot.participants;
  const prize1 = pot * 0.50;
  const prize2 = pot * 0.30;
  const prize3 = pot * 0.20;

  const output = participants.map(p => {
    const pFW = counts.finalWinner[p.id] / N;
    const pRU = counts.runnerUp[p.id]    / N;
    const pGP = counts.groupPrize[p.id]  / N;
    const exp = pFW * prize1 + pRU * prize2 + pGP * prize3;

    // Real current group points
    let realPts = 0, realGd = 0, realGf = 0;
    for (const g of 'ABCDEFGHIJKL'.split('')) {
      const tbl = buildGroupTable(
        Object.entries(teams).filter(([,t]) => t.group === g).map(([id]) => id),
        realGroupResults[g]
      );
      for (const tid of p.teams) {
        if (tbl[tid]) { realPts += tbl[tid].pts; realGd += tbl[tid].gd; realGf += tbl[tid].gf; }
      }
    }

    return {
      id: p.id,
      pFinalWinner: +pFW.toFixed(4),
      pRunnerUp:    +pRU.toFixed(4),
      pGroupPrize:  +pGP.toFixed(4),
      expectedWinnings: +exp.toFixed(2),
      currentGroupPts: realPts,
      currentGroupGd:  realGd,
      currentGroupGf:  realGf,
    };
  });

  // Build real group leaderboard with actual standings
  const groupLeaderboard = [];
  for (const g of 'ABCDEFGHIJKL'.split('')) {
    const gTeams = Object.entries(teams).filter(([,t]) => t.group === g).map(([id]) => id);
    const tbl = buildGroupTable(gTeams, realGroupResults[g]);
    const sorted = sortGroup(gTeams, tbl);
    for (let rank = 0; rank < sorted.length; rank++) {
      const id = sorted[rank];
      groupLeaderboard.push({
        group: g,
        rank: rank + 1,
        teamId: id,
        pts: tbl[id].pts,
        gd:  tbl[id].gd,
        gf:  tbl[id].gf,
        ga:  tbl[id].ga,
        played: realGroupResults[g].filter(m => m.homeId === id || m.awayId === id).length,
      });
    }
  }

  return {
    updatedUtc: new Date().toISOString(),
    simulations: N,
    pot: { total: pot, prize1, prize2, prize3 },
    participants: output,
    groupLeaderboard,
  };
}

module.exports = { simulate };

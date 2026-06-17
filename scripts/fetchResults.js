/**
 * Live score adapter for 2026 FIFA World Cup.
 *
 * Primary source: football-data.org (competition WC, id 2000).
 *   - Requires SCORE_API_KEY env var (free account at football-data.org).
 *   - ⚠️ RISK: football-data.org free tier (TIER_ONE) may not include live WC data.
 *     If you get 403/404, see README "Data source notes".
 *
 * Fallback: ESPN public scoreboard API (no key required).
 *   - https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard
 *   - This is an undocumented but publicly accessible ESPN endpoint.
 */

'use strict';

const COMPETITION_ID = 2000; // FIFA World Cup on football-data.org
const ESPN_BASE = 'https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard';

// ---------------------------------------------------------------------------
// Normalised match schema:
// { matchId, homeId, awayId, homeGoals, awayGoals, status, minute }
//   status: 'scheduled' | 'live' | 'finished'
//   homeId/awayId: 3-letter FIFA team code (from teams.json slugs)
// ---------------------------------------------------------------------------

// Map ESPN team abbreviations → our canonical slugs
const ESPN_TO_SLUG = {
  'ARG': 'ARG', 'AUS': 'AUS', 'AUT': 'AUT', 'BEL': 'BEL',
  'BIH': 'BIH', 'BRA': 'BRA', 'CAN': 'CAN', 'CPV': 'CPV',
  'COD': 'COD', 'COL': 'COL', 'CRO': 'CRO', 'CUW': 'CUW',
  'CZE': 'CZE', 'DZA': 'DZA', 'ECU': 'ECU', 'EGY': 'EGY',
  'ENG': 'ENG', 'ESP': 'ESP', 'FRA': 'FRA', 'GER': 'GER',
  'GHA': 'GHA', 'HTI': 'HTI', 'IRN': 'IRN', 'IRQ': 'IRQ',
  'CIV': 'CIV', 'JPN': 'JPN', 'JOR': 'JOR', 'KOR': 'KOR',
  'KSA': 'KSA', 'MAR': 'MAR', 'MEX': 'MEX', 'NED': 'NED',
  'NOR': 'NOR', 'NZL': 'NZL', 'PAN': 'PAN', 'PAR': 'PAR',
  'POR': 'POR', 'QAT': 'QAT', 'SCO': 'SCO', 'SEN': 'SEN',
  'SUI': 'SUI', 'SWE': 'SWE', 'TUN': 'TUN', 'TUR': 'TUR',
  'URU': 'URU', 'USA': 'USA', 'UZB': 'UZB', 'ZAF': 'ZAF',
  // ESPN sometimes uses different codes:
  'CRC': 'CRC', 'BLR': 'BLR',
  'CIV': 'CIV', 'HAI': 'HTI', 'CMR': 'CMR',
  'CGO': 'COD',  // Congo DR
  'RSA': 'ZAF',  // South Africa
  'ALG': 'DZA',  // Algeria
  'IRE': 'IRL',
  'NED': 'NED', 'HOL': 'NED',
  'TUR': 'TUR',
  'GRE': 'GRE',
  'SWE': 'SWE',
  'DEN': 'DEN',
};

function toSlug(code) { return ESPN_TO_SLUG[code] || code; }

// Match the fixture's homeId/awayId to a real match result by team IDs
function matchFixtureToResult(homeSlug, awaySlug, fixtures) {
  return fixtures.find(f =>
    f.stage === 'group' &&
    ((f.homeId === homeSlug && f.awayId === awaySlug) ||
     (f.homeId === awaySlug && f.awayId === homeSlug))
  );
}

// ---------------------------------------------------------------------------
// football-data.org adapter
// ---------------------------------------------------------------------------
async function fetchFromFootballData(apiKey, fixtures) {
  const url = `https://api.football-data.org/v4/competitions/${COMPETITION_ID}/matches?status=LIVE,FINISHED,IN_PLAY`;
  const res = await fetch(url, { headers: { 'X-Auth-Token': apiKey } });
  if (!res.ok) throw new Error(`football-data.org ${res.status}: ${res.statusText}`);
  const data = await res.json();

  return (data.matches || []).map(m => {
    const homeSlug = toSlug(m.homeTeam?.tla || '');
    const awaySlug = toSlug(m.awayTeam?.tla || '');
    const fix = matchFixtureToResult(homeSlug, awaySlug, fixtures);
    if (!fix) return null;

    const statusMap = { 'FINISHED': 'finished', 'IN_PLAY': 'live', 'PAUSED': 'live', 'SCHEDULED': 'scheduled', 'TIMED': 'scheduled' };
    return {
      matchId: fix.matchId,
      homeId: fix.homeId,
      awayId: fix.awayId,
      homeGoals: m.score?.fullTime?.home ?? m.score?.halfTime?.home ?? null,
      awayGoals: m.score?.fullTime?.away ?? m.score?.halfTime?.away ?? null,
      status: statusMap[m.status] || 'scheduled',
      minute: m.minute || null,
    };
  }).filter(Boolean);
}

// ---------------------------------------------------------------------------
// ESPN public API adapter
// ---------------------------------------------------------------------------
async function fetchFromESPN(fixtures) {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10).replace(/-/g, '');
  const results = [];

  for (const dateStr of [yesterday, today]) {
    const url = `${ESPN_BASE}?dates=${dateStr}&limit=20`;
    const res = await fetch(url);
    if (!res.ok) continue;
    const data = await res.json();

    for (const event of (data.events || [])) {
      const comp = event.competitions?.[0];
      if (!comp) continue;
      const home = comp.competitors?.find(c => c.homeAway === 'home');
      const away = comp.competitors?.find(c => c.homeAway === 'away');
      if (!home || !away) continue;

      const homeSlug = toSlug(home.team?.abbreviation || '');
      const awaySlug = toSlug(away.team?.abbreviation || '');
      const fix = matchFixtureToResult(homeSlug, awaySlug, fixtures);
      if (!fix) continue;

      const stateType = comp.status?.type?.name || '';
      let status = 'scheduled';
      if (stateType === 'STATUS_FINAL') status = 'finished';
      else if (['STATUS_IN_PROGRESS', 'STATUS_HALFTIME'].includes(stateType)) status = 'live';

      const hg = parseInt(home.score, 10);
      const ag = parseInt(away.score, 10);

      results.push({
        matchId: fix.matchId,
        homeId: fix.homeId,
        awayId: fix.awayId,
        homeGoals: isNaN(hg) ? null : hg,
        awayGoals: isNaN(ag) ? null : ag,
        status,
        minute: comp.status?.displayClock || null,
      });
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Main export: fetchLiveResults()
// Returns normalised match array; throws only on total failure.
// ---------------------------------------------------------------------------
async function fetchLiveResults(fixtures) {
  const apiKey = process.env.SCORE_API_KEY;
  const fixtureList = fixtures.matches;

  if (apiKey) {
    try {
      console.log('[fetch] Trying football-data.org...');
      const r = await fetchFromFootballData(apiKey, fixtureList);
      if (r.length > 0) { console.log(`[fetch] football-data.org: ${r.length} matches`); return r; }
      console.log('[fetch] football-data.org returned 0 matches — falling through to ESPN');
    } catch (e) {
      console.warn('[fetch] football-data.org failed:', e.message);
    }
  }

  console.log('[fetch] Trying ESPN public API...');
  const espn = await fetchFromESPN(fixtureList);
  console.log(`[fetch] ESPN: ${espn.length} matches`);
  return espn;
}

module.exports = { fetchLiveResults };

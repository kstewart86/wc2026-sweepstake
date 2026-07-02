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

// Match a live/finished game (by its two team slugs) to a fixture.
//   • Group fixtures carry homeId/awayId directly.
//   • Knockout fixtures don't — their teams come from the bracket via `koMatchups`
//     ({ matchId, homeId, awayId, anchors }). The third-place side of an R32 tie
//     can be mispredicted, so we also match on `anchors` — the reliably-known
//     group-seeded / prior-winner side — and then take BOTH real teams from the
//     feed. Returns { matchId, ko } or null.
function matchFixtureToResult(homeSlug, awaySlug, fixtures, koMatchups = []) {
  const group = fixtures.find(f =>
    f.stage === 'group' &&
    ((f.homeId === homeSlug && f.awayId === awaySlug) ||
     (f.homeId === awaySlug && f.awayId === homeSlug))
  );
  if (group) return { matchId: group.matchId, ko: false, fix: group };

  // Exact pair first, then anchor (one reliable side) as a fallback.
  const exact = koMatchups.find(m =>
    (m.homeId === homeSlug && m.awayId === awaySlug) ||
    (m.homeId === awaySlug && m.awayId === homeSlug));
  const ko = exact || koMatchups.find(m =>
    (m.anchors || []).includes(homeSlug) || (m.anchors || []).includes(awaySlug));
  return ko ? { matchId: ko.matchId, ko: true } : null;
}

// Build a normalised result row. Group games keep the fixture's canonical
// home/away orientation; knockout games take the feed's real teams as-is.
// `kickoffUtc`/`venue` come from the feed (authoritative schedule); shootout
// scores are attached only for a genuine shootout (level score, different pens).
function buildRow({ match, homeSlug, awaySlug, feedHome, feedAway, feedHomePens, feedAwayPens, status, winnerId, minute, kickoffUtc, venue }) {
  const extra = {};
  if (kickoffUtc) extra.kickoffUtc = kickoffUtc;
  if (venue) extra.venue = venue;
  const isShootout = feedHome != null && feedHome === feedAway
    && feedHomePens != null && feedAwayPens != null && feedHomePens !== feedAwayPens;

  const orient = match.ko ? true : homeSlug === match.fix.homeId;
  const homeId = match.ko ? homeSlug : match.fix.homeId;
  const awayId = match.ko ? awaySlug : match.fix.awayId;
  const row = {
    matchId: match.matchId, homeId, awayId,
    homeGoals: orient ? feedHome : feedAway,
    awayGoals: orient ? feedAway : feedHome,
    status, winnerId, minute, ...extra,
  };
  if (isShootout) {
    row.homePens = orient ? feedHomePens : feedAwayPens;
    row.awayPens = orient ? feedAwayPens : feedHomePens;
  }
  return row;
}

// ---------------------------------------------------------------------------
// football-data.org adapter
// ---------------------------------------------------------------------------
async function fetchFromFootballData(apiKey, fixtures, koMatchups) {
  const url = `https://api.football-data.org/v4/competitions/${COMPETITION_ID}/matches?status=LIVE,FINISHED,IN_PLAY`;
  const res = await fetch(url, { headers: { 'X-Auth-Token': apiKey } });
  if (!res.ok) throw new Error(`football-data.org ${res.status}: ${res.statusText}`);
  const data = await res.json();

  return (data.matches || []).map(m => {
    const homeSlug = toSlug(m.homeTeam?.tla || '');
    const awaySlug = toSlug(m.awayTeam?.tla || '');
    const match = matchFixtureToResult(homeSlug, awaySlug, fixtures, koMatchups);
    if (!match) return null;

    const statusMap = { 'FINISHED': 'finished', 'IN_PLAY': 'live', 'PAUSED': 'live', 'SCHEDULED': 'scheduled', 'TIMED': 'scheduled' };
    const feedHome = m.score?.fullTime?.home ?? m.score?.halfTime?.home ?? null;
    const feedAway = m.score?.fullTime?.away ?? m.score?.halfTime?.away ?? null;
    const w = m.score?.winner; // HOME_TEAM | AWAY_TEAM | DRAW | null
    return buildRow({
      match, homeSlug, awaySlug, feedHome, feedAway,
      feedHomePens: m.score?.penalties?.home ?? null,
      feedAwayPens: m.score?.penalties?.away ?? null,
      status: statusMap[m.status] || 'scheduled',
      winnerId: w === 'HOME_TEAM' ? homeSlug : w === 'AWAY_TEAM' ? awaySlug : null,
      minute: m.minute || null,
      kickoffUtc: m.utcDate || null,
      venue: m.venue || null,
    });
  }).filter(Boolean);
}

// ---------------------------------------------------------------------------
// ESPN public API adapter
// ---------------------------------------------------------------------------
async function fetchFromESPN(fixtures, koMatchups) {
  // Scan a wider window than yesterday/today so knockout games that were missed
  // (e.g. during a CI outage) get backfilled instead of showing as unplayed.
  const dates = [];
  for (let d = 6; d >= -1; d--) dates.push(new Date(Date.now() - d * 86400000).toISOString().slice(0, 10).replace(/-/g, ''));
  const results = [];

  for (const dateStr of dates) {
    const url = `${ESPN_BASE}?dates=${dateStr}&limit=30`;
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
      const match = matchFixtureToResult(homeSlug, awaySlug, fixtures, koMatchups);
      if (!match) continue;

      // Use ESPN's state ('pre' | 'in' | 'post') and completed flag rather than
      // enumerating every status name — this covers finals decided in extra time
      // (STATUS_FINAL_AET) or on penalties (STATUS_FINAL_PEN) without a bespoke case.
      const type = comp.status?.type || {};
      let status = 'scheduled';
      if (type.completed || type.state === 'post') status = 'finished';
      else if (type.state === 'in') status = 'live';

      const hg = parseInt(home.score, 10);
      const ag = parseInt(away.score, 10);
      const hp = parseInt(home.shootoutScore, 10);
      const ap = parseInt(away.shootoutScore, 10);
      results.push(buildRow({
        match, homeSlug, awaySlug,
        feedHome: isNaN(hg) ? null : hg,
        feedAway: isNaN(ag) ? null : ag,
        feedHomePens: isNaN(hp) ? null : hp,
        feedAwayPens: isNaN(ap) ? null : ap,
        status,
        winnerId: home.winner ? homeSlug : away.winner ? awaySlug : null,
        minute: comp.status?.displayClock || null,
        kickoffUtc: event.date || null,
        venue: comp.venue?.fullName || null,
      }));
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Main export: fetchLiveResults()
// Returns normalised match array; throws only on total failure.
// ---------------------------------------------------------------------------
async function fetchLiveResults(fixtures, koMatchups = []) {
  const apiKey = process.env.SCORE_API_KEY;
  const fixtureList = fixtures.matches;

  if (apiKey) {
    try {
      console.log('[fetch] Trying football-data.org...');
      const r = await fetchFromFootballData(apiKey, fixtureList, koMatchups);
      if (r.length > 0) { console.log(`[fetch] football-data.org: ${r.length} matches`); return r; }
      console.log('[fetch] football-data.org returned 0 matches — falling through to ESPN');
    } catch (e) {
      console.warn('[fetch] football-data.org failed:', e.message);
    }
  }

  console.log('[fetch] Trying ESPN public API...');
  const espn = await fetchFromESPN(fixtureList, koMatchups);
  console.log(`[fetch] ESPN: ${espn.length} matches`);
  return espn;
}

module.exports = { fetchLiveResults };

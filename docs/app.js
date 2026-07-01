/**
 * WC 2026 Sweepstake — frontend app.
 * Polls data/*.json every 60s and re-renders in place.
 * No build step; no framework.
 */

'use strict';

// ── Country flags via Twemoji CDN (renders on all platforms incl. Windows) ──
const TWEMOJI = 'https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/svg/';
const FLAG_CODE = {
  ARG:'1f1e6-1f1f7', AUS:'1f1e6-1f1fa', AUT:'1f1e6-1f1f9', BEL:'1f1e7-1f1ea',
  BIH:'1f1e7-1f1e6', BRA:'1f1e7-1f1f7', CAN:'1f1e8-1f1e6', CIV:'1f1e8-1f1ee',
  COD:'1f1e8-1f1e9', COL:'1f1e8-1f1f4', CPV:'1f1e8-1f1fb', CRO:'1f1ed-1f1f7',
  CUW:'1f1e8-1f1fc', CZE:'1f1e8-1f1ff', DZA:'1f1e9-1f1ff', ECU:'1f1ea-1f1e8',
  EGY:'1f1ea-1f1ec', ENG:'1f3f4-e0067-e0062-e0065-e006e-e0067-e007f',
  ESP:'1f1ea-1f1f8', FRA:'1f1eb-1f1f7', GER:'1f1e9-1f1ea', GHA:'1f1ec-1f1ed',
  HTI:'1f1ed-1f1f9', IRN:'1f1ee-1f1f7', IRQ:'1f1ee-1f1f6', JOR:'1f1ef-1f1f4',
  JPN:'1f1ef-1f1f5', KOR:'1f1f0-1f1f7', KSA:'1f1f8-1f1e6', MAR:'1f1f2-1f1e6',
  MEX:'1f1f2-1f1fd', NED:'1f1f3-1f1f1', NOR:'1f1f3-1f1f4', NZL:'1f1f3-1f1ff',
  PAN:'1f1f5-1f1e6', PAR:'1f1f5-1f1fe', POR:'1f1f5-1f1f9', QAT:'1f1f6-1f1e6',
  SCO:'1f3f4-e0067-e0062-e0073-e0063-e0074-e007f',
  SEN:'1f1f8-1f1f3', SUI:'1f1e8-1f1ed', SWE:'1f1f8-1f1ea', TUN:'1f1f9-1f1f3',
  TUR:'1f1f9-1f1f7', URU:'1f1fa-1f1fe', USA:'1f1fa-1f1f8', UZB:'1f1fa-1f1ff',
  ZAF:'1f1ff-1f1e6',
};
function flag(teamId) {
  const c = FLAG_CODE[teamId];
  return c ? `<img class="team-flag" src="${TWEMOJI}${c}.svg" alt="" aria-hidden="true">` : '';
}

// ── Theme ──────────────────────────────────────────────────────────────────
function initTheme() {
  const saved = localStorage.getItem('twc-theme');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  applyTheme(saved || (prefersDark ? 'dark' : 'light'));
}
function applyTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
}
function toggleTheme() {
  const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  localStorage.setItem('twc-theme', next);
  applyTheme(next);
}

// ── State ─────────────────────────────────────────────────────────────────
let DATA = {
  fixtures:        null,
  teams:           null,
  participants:    null,
  results:         null,
  probs:           null,
  rankingsHistory: null,
  bracket:         null,
};

let currentView     = 'leaderboard';
let currentSort     = 'grouppts';
let currentMatchTab = 'today';

// ── Knockout stage helpers ─────────────────────────────────────────────────
const KO_ORDER    = ['r32', 'r16', 'qf', 'sf', 'final'];
const STAGE_LEVEL = { group: 0, r32: 1, r16: 2, qf: 3, sf: 4, final: 5 };
const STAGE_LABEL = { r32: 'Round of 32', r16: 'Round of 16', qf: 'Quarter-finals', sf: 'Semi-finals', final: 'Final', complete: 'Tournament complete' };
const STAGE_SHORT = { r32: 'R32', r16: 'R16', qf: 'QF', sf: 'SF', final: 'Final', complete: 'Champion' };

function inKnockout() { return DATA.bracket?.groupStageComplete === true; }

// teamId → knockout status, derived from the resolved bracket. A team that never
// appears in the bracket was eliminated in the group stage → returns null.
//   { reachedLevel, reachedStage, alive, eliminated, exitStage, champion }
let _teamKO = null;
function resetKOCache() { _teamKO = null; }
function teamKO(teamId) {
  if (!_teamKO) {
    _teamKO = {};
    for (const rd of DATA.bracket?.rounds || []) {
      const lvl = STAGE_LEVEL[rd.stage];
      for (const m of rd.matches) {
        for (const tid of [m.homeId, m.awayId]) {
          if (!tid) continue;
          const s = _teamKO[tid] || (_teamKO[tid] = { reachedLevel: 0, reachedStage: 'r32', alive: true, eliminated: false, exitStage: null, champion: false });
          if (lvl > s.reachedLevel) { s.reachedLevel = lvl; s.reachedStage = rd.stage; }
        }
        if (m.status === 'finished' && m.winnerId) {
          const loser = m.winnerId === m.homeId ? m.awayId : m.homeId;
          if (loser && _teamKO[loser]) { _teamKO[loser].eliminated = true; _teamKO[loser].alive = false; _teamKO[loser].exitStage = rd.stage; }
          if (rd.stage === 'final' && _teamKO[m.winnerId]) _teamKO[m.winnerId].champion = true;
        }
      }
    }
  }
  return _teamKO[teamId] || null;
}

// All knockout matches a team appears in, ordered r32 → final.
function teamKOMatches(teamId) {
  const out = [];
  for (const rd of DATA.bracket?.rounds || []) {
    for (const m of rd.matches) {
      if (m.homeId === teamId || m.awayId === teamId) out.push({ stage: rd.stage, m });
    }
  }
  return out;
}

// The single knockout match to feature for a team: its live match, else (if out)
// its exit match, else its next pending match, else its last appearance.
function featureKOMatch(teamId) {
  const ms = teamKOMatches(teamId);
  if (!ms.length) return null;
  const live = ms.find(x => x.m.status === 'live');
  if (live) return live;
  const ko = teamKO(teamId);
  if (ko && ko.eliminated) return [...ms].reverse().find(x => x.m.status === 'finished') || ms[ms.length - 1];
  return ms.find(x => x.m.status !== 'finished') || ms[ms.length - 1];
}

// Per-participant knockout summary used for ranking and card status.
function participantKO(p) {
  const koFor  = p.teams.map(t => teamKO(t));
  const levels = koFor.map(k => (k ? k.reachedLevel : 0));
  const alive  = koFor.map((k, i) => (k && k.alive ? levels[i] : null)).filter(v => v != null).sort((a, b) => b - a);
  return {
    aliveCount:     alive.length,
    bestAliveLevel: alive[0] || 0,
    sumAliveLevel:  alive.reduce((a, b) => a + b, 0),
    maxReached:     Math.max(0, ...levels),
    sumReached:     levels.reduce((a, b) => a + b, 0),
    bestElo:        Math.max(0, ...p.teams.map(t => DATA.teams[t]?.elo || 0)),
    champion:       koFor.some(k => k && k.champion),
  };
}

// ── Favourite ("this is me") ───────────────────────────────────────────────
const FAV_KEY = 'twc-favourite';
function getFavourite() { return localStorage.getItem(FAV_KEY); }
function setFavourite(id) {
  if (getFavourite() === id) localStorage.removeItem(FAV_KEY);
  else localStorage.setItem(FAV_KEY, id);
  renderLeaderboard();
}

// ── Bootstrap ─────────────────────────────────────────────────────────────
async function loadAll() {
  const base = window.location.pathname.replace(/\/[^/]*$/, '') + '/data/';
  const [fixtures, teams, participants, results, probs, rankingsHistory, bracket] = await Promise.all([
    fetch(base + 'fixtures.json').then(r => r.json()),
    fetch(base + 'teams.json').then(r => r.json()),
    fetch(base + 'participants.json').then(r => r.json()),
    fetch(base + 'results.json').then(r => r.json()),
    fetch(base + 'probabilities.json').then(r => r.json()),
    fetch(base + 'rankings_history.json?t=' + Date.now()).then(r => r.json()).catch(() => null),
    fetch(base + 'bracket.json?t=' + Date.now()).then(r => r.json()).catch(() => null),
  ]);
  DATA = { fixtures, teams: teams.teams, participants, results, probs, rankingsHistory, bracket };
  render();
}

async function refreshDynamic() {
  const base = window.location.pathname.replace(/\/[^/]*$/, '') + '/data/';
  try {
    const [results, probs, rankingsHistory, bracket] = await Promise.all([
      fetch(base + 'results.json?t=' + Date.now()).then(r => r.json()),
      fetch(base + 'probabilities.json?t=' + Date.now()).then(r => r.json()),
      fetch(base + 'rankings_history.json?t=' + Date.now()).then(r => r.json()).catch(() => null),
      fetch(base + 'bracket.json?t=' + Date.now()).then(r => r.json()).catch(() => null),
    ]);
    DATA.results = results;
    DATA.probs   = probs;
    if (rankingsHistory) DATA.rankingsHistory = rankingsHistory;
    if (bracket) DATA.bracket = bracket;
    render();
  } catch (e) { console.warn('Refresh failed:', e); }
}

// ── Format helpers ─────────────────────────────────────────────────────────
function fmtCurrency(n) {
  return 'CI$' + n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}
function fmtPct(p) {
  if (p >= 0.995) return '100%';
  if (p < 0.001)  return '<0.1%';
  return (p * 100).toFixed(1) + '%';
}
function fmtDate(iso) {
  return new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
}
function fmtDateShort(iso) {
  return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

// ── Result lookup ──────────────────────────────────────────────────────────
function getResult(matchId) {
  return DATA.results?.matches?.find(m => m.matchId === matchId) || null;
}

function isLive(r) { return r?.status === 'live'; }
function isFinished(r) { return r?.status === 'finished'; }

function anyLive() {
  return DATA.results?.matches?.some(m => m.status === 'live') || false;
}

// ── Current group standings (from results.json alone, not probs) ───────────
function buildCurrentTable(group) {
  const teams = Object.entries(DATA.teams)
    .filter(([,t]) => t.group === group)
    .map(([id]) => id);

  const table = {};
  for (const t of teams) table[t] = { pts: 0, gd: 0, gf: 0, ga: 0, played: 0 };

  const groupFixtures = DATA.fixtures.matches.filter(f => f.stage === 'group' && f.group === group);
  for (const f of groupFixtures) {
    const r = getResult(f.matchId);
    if (!r || !isFinished(r)) continue;
    const { homeId, awayId, homeGoals, awayGoals } = r;
    table[homeId].played++; table[awayId].played++;
    table[homeId].gf += homeGoals; table[homeId].ga += awayGoals;
    table[awayId].gf += awayGoals; table[awayId].ga += homeGoals;
    table[homeId].gd = table[homeId].gf - table[homeId].ga;
    table[awayId].gd = table[awayId].gf - table[awayId].ga;
    if (homeGoals > awayGoals)      { table[homeId].pts += 3; }
    else if (homeGoals === awayGoals){ table[homeId].pts += 1; table[awayId].pts += 1; }
    else                             { table[awayId].pts += 3; }
  }

  return { table, sorted: teams.sort((a, b) => {
    if (table[b].pts !== table[a].pts) return table[b].pts - table[a].pts;
    if (table[b].gd  !== table[a].gd)  return table[b].gd  - table[a].gd;
    return table[b].gf - table[a].gf;
  })};
}

// ── Team's most recent / current match ────────────────────────────────────
function latestMatchForTeam(teamId) {
  const teamFixes = DATA.fixtures.matches
    .filter(f => f.stage === 'group' && (f.homeId === teamId || f.awayId === teamId));
  // Prefer live, then most recent finished, then next scheduled
  for (const f of teamFixes) {
    const r = getResult(f.matchId);
    if (r && isLive(r)) return { fixture: f, result: r };
  }
  let lastFinished = null;
  for (const f of teamFixes) {
    const r = getResult(f.matchId);
    if (r && isFinished(r)) lastFinished = { fixture: f, result: r };
  }
  if (lastFinished) return lastFinished;
  // Next scheduled
  const future = teamFixes.filter(f => !getResult(f.matchId));
  if (future.length) return { fixture: future[0], result: null };
  return null;
}

function opponentOf(fixture, teamId) {
  return fixture.homeId === teamId ? fixture.awayId : fixture.homeId;
}

function scoreFor(fixture, result, teamId) {
  if (!result) return null;
  if (fixture.homeId === teamId) return { f: result.homeGoals, a: result.awayGoals };
  return { f: result.awayGoals, a: result.homeGoals };
}

// ── Difficulty label for remaining fixtures ────────────────────────────────
function difficulty(teamElo, opponentElo) {
  const diff = opponentElo - teamElo;
  if (diff > 100)  return 'hard';
  if (diff < -100) return 'easy';
  return 'even';
}

// ── Participant prob row from probs.json ───────────────────────────────────
function getProb(participantId) {
  return DATA.probs?.participants?.find(p => p.id === participantId) || null;
}

// ── Render helpers: team chip ──────────────────────────────────────────────
function renderTeamChip(teamId) {
  if (inKnockout()) return renderTeamChipKO(teamId);
  return renderTeamChipGroup(teamId);
}

// Knockout-stage chip: shows the team's KO status (alive/out + round) and its
// featured KO match. Eliminated teams (group or knockout) render greyed out.
function renderTeamChipKO(teamId) {
  const team = DATA.teams[teamId];
  if (!team) return `<div class="team-chip unconfirmed"><span class="team-name">${teamId}</span><span class="team-unconfirmed-label">⚠️ Unconfirmed</span></div>`;

  const ko = teamKO(teamId);
  const qualified = ko != null;
  const out = !qualified || ko.eliminated;

  let chipClass = 'team-chip team-chip--ko';
  if (out) chipClass += ' team-chip--eliminated';
  else chipClass += ' team-chip--alive';

  // Status line
  let statusHtml;
  if (ko?.champion) {
    statusHtml = `<span class="ko-status ko-status--champ">🏆 Champion</span>`;
  } else if (!qualified) {
    statusHtml = `<span class="ko-status ko-status--out">Out · Group stage</span>`;
  } else if (ko.eliminated) {
    statusHtml = `<span class="ko-status ko-status--out">Out · ${STAGE_SHORT[ko.exitStage] || ko.exitStage}</span>`;
  } else {
    statusHtml = `<span class="ko-status ko-status--alive">In · ${STAGE_LABEL[ko.reachedStage] || ko.reachedStage}</span>`;
  }

  // Featured match line
  let scoreHtml = '';
  const feat = featureKOMatch(teamId);
  if (feat) {
    const { m } = feat;
    const opp = m.homeId === teamId ? m.awayId : m.homeId;
    const oppName = opp ? (DATA.teams[opp]?.name || opp) : 'TBD';
    const oppFlag = opp ? flag(opp) : '';
    if (m.status === 'live') {
      const sc = m.homeId === teamId ? { f: m.homeGoals, a: m.awayGoals } : { f: m.awayGoals, a: m.homeGoals };
      chipClass += ' chip-live ' + (sc.f > sc.a ? 'chip-winning' : sc.f === sc.a ? 'chip-drawing' : 'chip-losing');
      scoreHtml = `<div class="team-score live">vs ${oppFlag}${oppName} ${sc.f}–${sc.a} <span class="live-pip"></span></div>`;
    } else if (m.status === 'finished') {
      const sc = m.homeId === teamId ? { f: m.homeGoals, a: m.awayGoals } : { f: m.awayGoals, a: m.homeGoals };
      const won = m.winnerId === teamId;
      const emoji = won ? '✅' : '❌';
      scoreHtml = `<div class="team-score finished">${emoji} ${STAGE_SHORT[feat.stage]} vs ${oppFlag}${oppName} ${sc.f}–${sc.a}</div>`;
    } else {
      scoreHtml = `<div class="team-score">${STAGE_SHORT[feat.stage]} vs ${oppFlag}${oppName} · ${fmtDateShort(m.kickoffUtc)}</div>`;
    }
  }

  return `
    <div class="${chipClass}">
      <div class="team-name">${flag(teamId)}${team.name}</div>
      <div class="team-group">${statusHtml}</div>
      ${scoreHtml}
    </div>`;
}

function renderTeamChipGroup(teamId) {
  const team = DATA.teams[teamId];
  if (!team) return `<div class="team-chip unconfirmed"><span class="team-name">${teamId}</span><span class="team-unconfirmed-label">⚠️ Unconfirmed</span></div>`;

  const latest = latestMatchForTeam(teamId);
  let scoreHtml = '';
  let teamPtsHtml = '';
  let chipClass = 'team-chip';

  if (latest) {
    const { fixture, result } = latest;
    const opp = opponentOf(fixture, teamId);
    const oppName = DATA.teams[opp]?.name || opp;
    const oppFlag = flag(opp);
    if (result && isLive(result)) {
      const sc = scoreFor(fixture, result, teamId);
      const state = sc.f > sc.a ? 'winning' : sc.f === sc.a ? 'drawing' : 'losing';
      chipClass += ` chip-${state} chip-live`;
      scoreHtml = `<div class="team-score live">vs ${oppFlag}${oppName} ${sc.f}–${sc.a} <span class="live-pip"></span></div>`;
    } else if (result && isFinished(result)) {
      const sc = scoreFor(fixture, result, teamId);
      const state = sc.f > sc.a ? 'winning' : sc.f === sc.a ? 'drawing' : 'losing';
      chipClass += ` chip-${state}`;
      const emoji = sc.f > sc.a ? '✅' : sc.f === sc.a ? '🟡' : '❌';
      scoreHtml = `<div class="team-score finished">${emoji} vs ${oppFlag}${oppName} ${sc.f}–${sc.a}</div>`;
    } else {
      scoreHtml = `<div class="team-score">vs ${oppFlag}${oppName} ${fmtDateShort(fixture.kickoffUtc)}</div>`;
    }
  }

  // Group points from real standings
  const gData = buildCurrentTable(team.group);
  const t = gData.table[teamId];
  if (t && t.played > 0) {
    const gd = t.gd >= 0 ? '+' + t.gd : '' + t.gd;
    teamPtsHtml = `<span class="team-pts">${t.pts}pt ${gd} GD · ${t.gf} GF</span>`;
  }

  return `
    <div class="${chipClass}">
      <div class="team-name">${flag(teamId)}${team.name}</div>
      <div class="team-group">Group ${team.group}</div>
      ${scoreHtml}
      ${teamPtsHtml}
    </div>`;
}

// ── Leaderboard ───────────────────────────────────────────────────────────
function renderLeaderboard() {
  const ko = inKnockout();

  // Relabel the primary sort button for the current stage.
  const primarySortBtn = document.querySelector('.sort-btn[data-sort="grouppts"]');
  if (primarySortBtn) primarySortBtn.textContent = ko ? 'Progress' : 'PTS';

  const list = document.getElementById('leaderboard-list');
  const hasProbs = DATA.probs?.participants?.length > 0;

  let participants = DATA.participants.map(p => ({ ...p, prob: getProb(p.id), ko: ko ? participantKO(p) : null }));

  // ── Sort ──────────────────────────────────────────────────────────────
  if (currentSort === 'p1st') {
    const probKey = ko ? 'pFinalWinner' : 'pGroupPrize';
    participants.sort((a, b) => (b.prob?.[probKey] ?? 0) - (a.prob?.[probKey] ?? 0));
  } else if (ko) {
    // Knockout ranking: most teams still alive, then furthest-advanced team,
    // then depth reached, then Elo. (currentSort === 'grouppts' → "Progress")
    participants.sort((a, b) => {
      const A = a.ko, B = b.ko;
      return (B.champion - A.champion)
          || (B.aliveCount - A.aliveCount)
          || (B.bestAliveLevel - A.bestAliveLevel)
          || (B.sumAliveLevel - A.sumAliveLevel)
          || (B.maxReached - A.maxReached)
          || (B.sumReached - A.sumReached)
          || (B.bestElo - A.bestElo)
          || a.name.localeCompare(b.name);
    });
  } else {
    participants.sort((a, b) => {
      const ap = a.prob, bp = b.prob;
      if ((bp?.currentGroupPts ?? 0) !== (ap?.currentGroupPts ?? 0)) return (bp?.currentGroupPts ?? 0) - (ap?.currentGroupPts ?? 0);
      if ((bp?.currentGroupGd ?? 0) !== (ap?.currentGroupGd ?? 0)) return (bp?.currentGroupGd ?? 0) - (ap?.currentGroupGd ?? 0);
      return (bp?.currentGroupGf ?? 0) - (ap?.currentGroupGf ?? 0);
    });
  }

  // Rank numbers assigned before the favourite is pinned, so a player's true
  // standing shows even when pinned to the top.
  participants.forEach((p, i) => { p._rank = i + 1; });

  const fav = getFavourite();
  if (fav) {
    const favIdx = participants.findIndex(p => p.id === fav);
    if (favIdx > 0) participants.unshift(participants.splice(favIdx, 1)[0]);
  }

  // Bar scaling
  const maxP1 = Math.max(...participants.map(p => p.prob?.pFinalWinner ?? 0), 0.001);
  const maxP2 = Math.max(...participants.map(p => p.prob?.pRunnerUp ?? 0), 0.001);
  const maxPG = Math.max(...participants.map(p => p.prob?.pGroupPrize ?? 0), 0.001);

  const prevRankMap = {};
  if (DATA.rankingsHistory?.rankings?.length) {
    DATA.rankingsHistory.rankings.forEach((r, i) => { prevRankMap[r.id] = i + 1; });
  }

  const infoEl = document.getElementById('leaderboard-info');
  if (infoEl) infoEl.innerHTML = '';

  list.innerHTML = participants.map(p => {
    const prob = p.prob;
    const pFW = prob?.pFinalWinner ?? 0;
    const pRU = prob?.pRunnerUp ?? 0;
    const pGP = prob?.pGroupPrize ?? 0;
    const pts = prob?.currentGroupPts ?? 0;
    const gd  = prob?.currentGroupGd  ?? 0;
    const gf  = prob?.currentGroupGf  ?? 0;
    const gdStr = gd >= 0 ? '+' + gd : '' + gd;
    const exp = prob?.expectedWinnings ?? 0;

    const currRank = p._rank;
    const prevRank = prevRankMap[p.id];
    let arrowHtml = '';
    if (prevRank != null && prevRank !== currRank) {
      if (currRank < prevRank) arrowHtml = `<span class="rank-arrow rank-up" title="Up ${prevRank - currRank} from 12h ago">▲${prevRank - currRank}</span>`;
      else                     arrowHtml = `<span class="rank-arrow rank-down" title="Down ${currRank - prevRank} from 12h ago">▼${currRank - prevRank}</span>`;
    }

    const hasLiveTeam = p.teams.some(teamId =>
      DATA.results?.matches?.some(r => isLive(r) && (r.homeId === teamId || r.awayId === teamId)));

    const isFav = getFavourite() === p.id;
    const allOut = ko && p.ko.aliveCount === 0 && !p.ko.champion;
    const cardClasses = ['participant-card', hasLiveTeam && 'participant-card--live', isFav && 'participant-card--favourite', allOut && 'participant-card--out'].filter(Boolean).join(' ');

    // Top-right badge: knockout status pill, or group points.
    let badgeHtml;
    if (ko) {
      const k = p.ko;
      let label, cls;
      if (k.champion)            { label = '🏆 Champion'; cls = 'ko-badge--champ'; }
      else if (k.aliveCount > 0) { label = `${k.aliveCount} in · ${STAGE_SHORT[levelStage(k.bestAliveLevel)]}`; cls = 'ko-badge--alive'; }
      else                       { label = 'Eliminated'; cls = 'ko-badge--out'; }
      badgeHtml = `<div class="ko-badge ${cls}">${label}</div>`;
    } else {
      badgeHtml = `<div class="card-pts-badge"><span class="card-pts-number">${pts}</span><span class="card-pts-label">points</span></div>`;
    }

    // Probability block
    let probHtml;
    if (!hasProbs) {
      probHtml = `<p style="font-size:12px;color:var(--text2);margin-top:6px">Simulation running…</p>`;
    } else if (ko) {
      probHtml = `
        <div class="card-probs">
          <div class="prob-row">
            <span class="prob-label">🥇 Wins Final</span>
            <div class="prob-bar-wrap"><div class="prob-bar p1" style="width:${(pFW/maxP1*100).toFixed(1)}%"></div></div>
            <span class="prob-value">${fmtPct(pFW)}</span>
          </div>
          <div class="prob-row">
            <span class="prob-label">🥈 Runner-up</span>
            <div class="prob-bar-wrap"><div class="prob-bar p2" style="width:${(pRU/maxP2*100).toFixed(1)}%"></div></div>
            <span class="prob-value">${fmtPct(pRU)}</span>
          </div>
        </div>`;
    } else {
      probHtml = `
        <div class="card-probs">
          <div class="prob-row">
            <span class="prob-label">🏅 Group Prize</span>
            <div class="prob-bar-wrap"><div class="prob-bar pgrp" style="width:${(pGP/maxPG*100).toFixed(1)}%"></div></div>
            <span class="prob-value">${fmtPct(pGP)}</span>
            <span class="info-trigger" tabindex="0" role="button" aria-label="What does this mean?">ℹ
              <span class="info-tooltip" role="tooltip">Where you sit now against how tough your run-in is</span>
            </span>
          </div>
        </div>`;
    }

    // Footer: expected payout (knockout) or PTS/GD/GF (group).
    const footerHtml = ko ? `
        <div class="card-footer">
          <div class="card-footer-single">
            <span class="ev-label">Expected payout</span>
            <span class="ev-value">${fmtCurrency(exp)}</span>
          </div>
        </div>` : `
        <div class="card-footer">
          <div class="card-footer-stats">
            <div class="footer-stat"><div class="group-pts-label">PTS</div><div class="group-pts-val">${pts}</div></div>
            <div class="footer-stat"><div class="group-pts-label">GD</div><div class="group-pts-val">${gdStr}</div></div>
            <div class="footer-stat"><div class="group-pts-label">GF</div><div class="group-pts-val">${gf}</div></div>
          </div>
        </div>`;

    return `
      <div class="${cardClasses}" data-id="${p.id}">
        <div class="card-header">
          <div>
            <span class="card-name">${p.name}</span>
            <div style="font-size:11px;color:var(--text2);margin-top:1px">#${currRank} ${arrowHtml}${isFav ? '<span class="fav-you-badge">you</span>' : ''}<button class="fav-btn${isFav ? ' fav-btn--active' : ''}" onclick="event.stopPropagation();setFavourite('${p.id}')" aria-label="Mark as me" title="This is me">★</button></div>
          </div>
          ${badgeHtml}
        </div>
        <div class="card-teams">
          ${renderTeamChip(p.teams[0])}
          ${renderTeamChip(p.teams[1])}
        </div>
        ${probHtml}
        ${footerHtml}
      </div>`;
  }).join('');

  list.querySelectorAll('.participant-card').forEach(card => {
    card.addEventListener('click', () => openDetail(card.dataset.id));
  });
}

// Inverse of STAGE_LEVEL — the stage name for a numeric level.
function levelStage(level) {
  return Object.keys(STAGE_LEVEL).find(k => STAGE_LEVEL[k] === level) || 'r32';
}

function computeRealGroupPts(p) {
  let pts = 0;
  for (const r of DATA.results.matches) {
    const fix = DATA.fixtures.matches.find(f => f.matchId === r.matchId);
    if (!fix || fix.stage !== 'group' || !isFinished(r)) continue;
    if (fix.homeId === p.teams[0] || fix.homeId === p.teams[1]) {
      pts += r.homeGoals > r.awayGoals ? 3 : r.homeGoals === r.awayGoals ? 1 : 0;
    }
    if (fix.awayId === p.teams[0] || fix.awayId === p.teams[1]) {
      pts += r.awayGoals > r.homeGoals ? 3 : r.homeGoals === r.awayGoals ? 1 : 0;
    }
  }
  return pts;
}

// ── Matches view ──────────────────────────────────────────────────────────
function todayLocalDate() {
  return new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD in local tz
}
function kickoffLocalDate(isoUtc) {
  return new Date(isoUtc).toLocaleDateString('en-CA');
}

// Unified match list across group + knockout stages. Group matches carry their
// teams directly; knockout matches take resolved teams/scores from the bracket.
function allDisplayMatches() {
  const out = [];
  for (const f of DATA.fixtures.matches) {
    if (f.stage !== 'group') continue;
    const r = getResult(f.matchId);
    out.push({
      matchId: f.matchId, stage: 'group', group: f.group, venue: f.venue, kickoffUtc: f.kickoffUtc,
      homeId: f.homeId, awayId: f.awayId,
      homeGoals: r?.homeGoals ?? null, awayGoals: r?.awayGoals ?? null,
      status: r?.status ?? 'scheduled', minute: r?.minute ?? null,
    });
  }
  for (const rd of DATA.bracket?.rounds || []) {
    for (const m of rd.matches) {
      if (!m.homeId || !m.awayId) continue; // skip fully-TBD matchups
      out.push({
        matchId: m.matchId, stage: rd.stage, group: null, venue: m.venue, kickoffUtc: m.kickoffUtc,
        homeId: m.homeId, awayId: m.awayId, homeGoals: m.homeGoals, awayGoals: m.awayGoals,
        homePens: m.homePens, awayPens: m.awayPens,
        status: m.status, minute: getResult(m.matchId)?.minute ?? null, winnerId: m.winnerId,
      });
    }
  }
  return out.sort((a, b) => new Date(a.kickoffUtc) - new Date(b.kickoffUtc));
}

function renderMatches() {
  const container = document.getElementById('matches-list');
  const today = todayLocalDate();

  const teamToOwner = {};
  for (const p of DATA.participants) {
    for (const t of p.teams) teamToOwner[t] = { name: p.name, id: p.id };
  }

  const all = allDisplayMatches();
  // Kickoff dates can lag the real schedule, so anchor on match STATUS where we
  // can. Date strings are YYYY-MM-DD, so string comparison is chronological.
  //   Today    = live, or not-yet-finished and due today or overdue.
  //   Previous = finished.
  //   Future   = scheduled with a strictly-future kickoff date (never past/today).
  let fixes;
  if (currentMatchTab === 'today') {
    fixes = all.filter(f => f.status === 'live' || (f.status !== 'finished' && kickoffLocalDate(f.kickoffUtc) <= today));
  } else if (currentMatchTab === 'previous') {
    fixes = all.filter(f => f.status === 'finished').reverse();
  } else {
    fixes = all.filter(f => f.status === 'scheduled' && kickoffLocalDate(f.kickoffUtc) > today);
  }

  if (fixes.length === 0) {
    const msgs = { today: 'No matches today.', previous: 'No completed matches yet.', future: 'No upcoming matches.' };
    container.innerHTML = `<p class="empty-tab-msg">${msgs[currentMatchTab]}</p>`;
    return;
  }

  container.innerHTML = fixes.map(f => renderMatchCard(f, teamToOwner)).join('');
}

function renderMatchCard(fix, teamToOwner) {
  const live = fix.status === 'live', finished = fix.status === 'finished';

  function sideInfo(teamId) {
    const owner = teamToOwner[teamId];
    const country = DATA.teams[teamId]?.name || teamId;
    const f = flag(teamId);
    if (owner) return { display: owner.name, ownerId: owner.id, sub: f + country };
    return { display: f + country, ownerId: null, sub: null };
  }

  const home = sideInfo(fix.homeId);
  const away = sideInfo(fix.awayId);

  // A finished knockout tie is decided by its winner (shootouts resolve a level
  // score), so tint by who advanced rather than by the 90-minute score.
  const shootout = fix.stage !== 'group' && finished && fix.winnerId && fix.homeGoals === fix.awayGoals;
  const pensLabel = (shootout && fix.homePens != null) ? ` (${fix.homePens}–${fix.awayPens})` : '';
  let homeClass = 'match-side', awayClass = 'match-side away';
  if (finished && fix.stage !== 'group' && fix.winnerId) {
    if (fix.winnerId === fix.homeId) { homeClass += ' side-winning'; awayClass += ' side-losing'; }
    else                             { homeClass += ' side-losing';  awayClass += ' side-winning'; }
  } else if (live || finished) {
    if (fix.homeGoals > fix.awayGoals)      { homeClass += ' side-winning'; awayClass += ' side-losing'; }
    else if (fix.homeGoals < fix.awayGoals) { homeClass += ' side-losing';  awayClass += ' side-winning'; }
    else                                    { homeClass += ' side-drawing'; awayClass += ' side-drawing'; }
  }

  let centreScore, centreStatus;
  if (live) {
    centreScore  = `<div class="match-score live">${fix.homeGoals}–${fix.awayGoals}</div>`;
    centreStatus = `<div class="match-status live"><span class="live-pip"></span>${fix.minute || 'LIVE'}</div>`;
  } else if (finished) {
    centreScore  = `<div class="match-score">${fix.homeGoals}–${fix.awayGoals}</div>`;
    centreStatus = `<div class="match-status">${shootout ? 'FT · pens' + pensLabel : 'FT'}</div>`;
  } else {
    const t = new Date(fix.kickoffUtc);
    centreScore  = `<div class="match-kickoff">${t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}</div>`;
    centreStatus = `<div class="match-status">${t.toLocaleDateString([], { month: 'short', day: 'numeric' })}</div>`;
  }

  const meta = fix.stage === 'group'
    ? `Grp ${fix.group} · ${fix.venue}`
    : `${STAGE_LABEL[fix.stage]}${fix.venue && fix.venue !== 'TBD' ? ' · ' + fix.venue : ''}`;

  return `
    <div class="match-card${live ? ' match-card--live' : ''}">
      <div class="match-row">
        <div class="${homeClass}">
          ${home.ownerId ? `<button class="participant-link" onclick="openDetail('${home.ownerId}')">${home.display}</button>` : `<div class="match-participant">${home.display}</div>`}
          ${home.sub ? `<div class="match-country">${home.sub}</div>` : ''}
        </div>
        <div class="match-score-box">
          ${centreScore}
          ${centreStatus}
        </div>
        <div class="${awayClass}">
          ${away.ownerId ? `<button class="participant-link" onclick="openDetail('${away.ownerId}')">${away.display}</button>` : `<div class="match-participant">${away.display}</div>`}
          ${away.sub ? `<div class="match-country">${away.sub}</div>` : ''}
        </div>
      </div>
      <div class="match-meta">${meta}</div>
    </div>`;
}

// ── Bracket view ────────────────────────────────────────────────────────────
function renderBracket() {
  const host = document.getElementById('bracket');
  if (!host) return;

  if (!DATA.bracket || !DATA.bracket.groupStageComplete) {
    host.innerHTML = `<p class="empty-tab-msg">The knockout bracket unlocks once the group stage is complete.</p>`;
    return;
  }

  const teamToOwner = {};
  for (const p of DATA.participants) for (const t of p.teams) teamToOwner[t] = p.name;

  const cur = DATA.bracket.currentStage;
  host.innerHTML = DATA.bracket.rounds.map(rd => `
    <div class="bracket-round${rd.stage === cur ? ' bracket-round--current' : ''}" data-stage="${rd.stage}">
      <div class="bracket-round-label">${STAGE_LABEL[rd.stage]}${rd.stage === cur ? ' <span class="bracket-now">NOW</span>' : ''}</div>
      <div class="bracket-matches">
        ${rd.matches.map(m => renderBracketMatch(m, teamToOwner)).join('')}
      </div>
    </div>`).join('');
}

function renderBracketMatch(m, teamToOwner) {
  return `
    <div class="bracket-match${m.status === 'live' ? ' bracket-match--live' : ''}">
      ${renderBracketTeam(m, 'home', teamToOwner)}
      ${renderBracketTeam(m, 'away', teamToOwner)}
    </div>`;
}

function renderBracketTeam(m, side, teamToOwner) {
  const tid   = side === 'home' ? m.homeId : m.awayId;
  const goals = side === 'home' ? m.homeGoals : m.awayGoals;
  const pens  = side === 'home' ? m.homePens : m.awayPens;
  if (!tid) return `<div class="bm-team bm-team--tbd"><span class="bm-name">TBD</span></div>`;

  const name  = DATA.teams[tid]?.name || tid;
  const owner = teamToOwner[tid];
  let cls = 'bm-team';
  if (m.status === 'finished' && m.winnerId) cls += m.winnerId === tid ? ' bm-team--winner' : ' bm-team--loser';
  if (owner) cls += ' bm-team--owned';

  const scoreHtml = goals != null
    ? `<span class="bm-score">${goals}${pens != null ? `<span class="bm-pens">(${pens})</span>` : ''}</span>`
    : '';
  return `
    <div class="${cls}">
      <span class="bm-name">${flag(tid)}<span class="bm-team-name">${name}</span>${owner ? `<span class="bm-owner">${owner}</span>` : ''}</span>
      ${scoreHtml}
    </div>`;
}

// ── Detail modal ──────────────────────────────────────────────────────────
function openDetail(participantId) {
  const p = DATA.participants.find(x => x.id === participantId);
  if (!p) return;
  const prob = getProb(participantId);
  const modal = document.getElementById('detail-modal');
  const content = document.getElementById('detail-content');

  const pot = DATA.fixtures.pot;
  const totalPot = pot.entryFee * pot.participants;
  const prize1 = totalPot * 0.50;
  const prize2 = totalPot * 0.30;
  const prize3 = totalPot * 0.20;

  const ko = inKnockout();
  // teamId → owner first name, for rivalry annotations ("beaten by Jeff's …").
  const ownerOf = {};
  for (const q of DATA.participants) for (const t of q.teams) ownerOf[t] = q.name;
  const teamLabel = tid => {
    const nm = DATA.teams[tid]?.name || tid;
    return ownerOf[tid] ? `${ownerOf[tid]}'s ${nm}` : nm;
  };

  let html = `<div class="detail-name">${p.name}</div>`;
  html += `<p class="detail-subtitle">Here's the full picture for ${p.name}. What's been played, what's still to come.</p>`;

  // Prize odds + expected payout summary.
  if (prob) {
    const cells = ko
      ? [['🥇 Wins Final', fmtPct(prob.pFinalWinner ?? 0)], ['🥈 Runner-up', fmtPct(prob.pRunnerUp ?? 0)], ['Expected payout', fmtCurrency(prob.expectedWinnings ?? 0)]]
      : [['🏅 Group Prize', fmtPct(prob.pGroupPrize ?? 0)], ['🥇 Wins Final', fmtPct(prob.pFinalWinner ?? 0)], ['Expected payout', fmtCurrency(prob.expectedWinnings ?? 0)]];
    html += `<div class="detail-odds">${cells.map(([l, v]) => `<div class="detail-odds-cell"><span class="detail-odds-label">${l}</span><span class="detail-odds-val">${v}</span></div>`).join('')}</div>`;
  }

  for (const teamId of p.teams) {
    const team = DATA.teams[teamId];
    if (!team) {
      html += `<div class="detail-section-title">⚠️ ${teamId} (unconfirmed)</div>`;
      continue;
    }

    // Title with knockout status badge.
    const k = ko ? teamKO(teamId) : null;
    let koTag = '';
    if (ko) {
      if (k?.champion)        koTag = `<span class="detail-ko-tag detail-ko-tag--champ">🏆 Champion</span>`;
      else if (!k)            koTag = `<span class="detail-ko-tag detail-ko-tag--out">Out · Group</span>`;
      else if (k.eliminated)  koTag = `<span class="detail-ko-tag detail-ko-tag--out">Out · ${STAGE_SHORT[k.exitStage]}</span>`;
      else                    koTag = `<span class="detail-ko-tag detail-ko-tag--alive">In · ${STAGE_SHORT[k.reachedStage]}</span>`;
    }
    html += `<div class="detail-section-title">${flag(teamId)}${team.name} · Group ${team.group} · Elo ${team.elo} ${koTag}</div>`;

    // Group fixtures
    const teamFixes = DATA.fixtures.matches.filter(f => f.stage === 'group' && (f.homeId === teamId || f.awayId === teamId));
    for (const f of teamFixes) {
      const opp = opponentOf(f, teamId);
      const oppTeam = DATA.teams[opp];
      const oppName = oppTeam?.name || opp;
      const r = getResult(f.matchId);
      let resultHtml = '', diffHtml = '';
      if (r && isFinished(r)) {
        const sc = scoreFor(f, r, teamId);
        resultHtml = `${sc.f > sc.a ? '✅' : sc.f === sc.a ? '🟡' : '❌'} ${sc.f}–${sc.a}`;
      } else if (r && isLive(r)) {
        const sc = scoreFor(f, r, teamId);
        resultHtml = `<span class="live-pip"></span>${sc.f}–${sc.a}`;
      } else {
        resultHtml = fmtDate(f.kickoffUtc);
        if (team && oppTeam) { const d = difficulty(team.elo, oppTeam.elo); diffHtml = `<span class="difficulty-badge difficulty-${d}">${d.toUpperCase()}</span>`; }
      }
      html += `
        <div class="detail-fixture-row">
          <div class="detail-fixture-teams">vs ${flag(opp)}${oppName} ${diffHtml}
            <div class="detail-fixture-status">Grp ${f.group} · ${f.venue}</div>
          </div>
          <div class="detail-fixture-result">${resultHtml}</div>
        </div>`;
    }

    // Knockout run
    const koMs = ko ? teamKOMatches(teamId) : [];
    if (koMs.length) {
      html += `<div class="detail-run-label">Knockout run</div>`;
      for (const { stage, m } of koMs) {
        const opp = m.homeId === teamId ? m.awayId : m.homeId;
        const oppName = opp ? (DATA.teams[opp]?.name || opp) : 'TBD';
        const oppOwner = opp && ownerOf[opp] ? `<span class="detail-owner-tag">${ownerOf[opp]}</span>` : '';
        const pens = (m.homePens != null && m.homeGoals === m.awayGoals)
          ? ` (${m.homeId === teamId ? m.homePens : m.awayPens}–${m.homeId === teamId ? m.awayPens : m.homePens} pens)` : '';
        let resultHtml;
        if (m.status === 'finished') {
          const sc = m.homeId === teamId ? { f: m.homeGoals, a: m.awayGoals } : { f: m.awayGoals, a: m.homeGoals };
          resultHtml = `${m.winnerId === teamId ? '✅' : '❌'} ${sc.f}–${sc.a}${pens}`;
        } else if (m.status === 'live') {
          const sc = m.homeId === teamId ? { f: m.homeGoals, a: m.awayGoals } : { f: m.awayGoals, a: m.homeGoals };
          resultHtml = `<span class="live-pip"></span>${sc.f}–${sc.a}`;
        } else {
          resultHtml = fmtDate(m.kickoffUtc);
        }
        html += `
          <div class="detail-fixture-row">
            <div class="detail-fixture-teams">vs ${opp ? flag(opp) : ''}${oppName} ${oppOwner}
              <div class="detail-fixture-status">${STAGE_LABEL[stage]}</div>
            </div>
            <div class="detail-fixture-result">${resultHtml}</div>
          </div>`;
      }

      // Rivalry line: who knocked this team out (or who it's beaten so far).
      if (k && k.eliminated) {
        const exit = koMs.find(x => x.m.status === 'finished' && x.m.winnerId && x.m.winnerId !== teamId);
        if (exit) {
          const victor = exit.m.winnerId;
          const pens = exit.m.homeGoals === exit.m.awayGoals ? ' on penalties' : '';
          html += `<p class="detail-rivalry">❌ Knocked out by ${flag(victor)}${teamLabel(victor)} in the ${STAGE_LABEL[exit.stage]}${pens}.</p>`;
        }
      } else if (k && !k.champion) {
        const beaten = koMs.filter(x => x.m.status === 'finished' && x.m.winnerId === teamId)
          .map(x => x.m.homeId === teamId ? x.m.awayId : x.m.homeId).filter(t => ownerOf[t]);
        if (beaten.length) {
          html += `<p class="detail-rivalry">⚔️ Knocked out ${beaten.map(t => `${flag(t)}${teamLabel(t)}`).join(', ')}.</p>`;
        }
      }
    }
  }

  content.innerHTML = html;
  modal.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closeDetail() {
  document.getElementById('detail-modal').classList.add('hidden');
  document.body.style.overflow = '';
}

// ── Header render ─────────────────────────────────────────────────────────
function renderHeader() {
  const pot = DATA.fixtures.pot;
  const totalPot = pot.entryFee * pot.participants;
  document.getElementById('pot-total').textContent = fmtCurrency(totalPot);
  document.getElementById('pot-1st').textContent   = fmtCurrency(totalPot * 0.50);
  document.getElementById('pot-2nd').textContent   = fmtCurrency(totalPot * 0.30);
  document.getElementById('pot-grp').textContent   = fmtCurrency(totalPot * 0.20);

  const live = anyLive();
  document.getElementById('live-alert').classList.toggle('hidden', !live);

  const updatedAt = DATA.results?.updatedUtc;
  document.getElementById('last-updated').textContent = updatedAt
    ? 'Updated ' + fmtDate(updatedAt)
    : 'Awaiting data';


  // Tournament status text
  const finishedCount = DATA.results?.matches?.filter(m => m.status === 'finished').length ?? 0;
  const totalGroup    = DATA.fixtures.matches.filter(f => f.stage === 'group').length;
  let status;
  if (live) {
    const liveCount = DATA.results.matches.filter(m => m.status === 'live').length;
    status = `${liveCount} match${liveCount !== 1 ? 'es' : ''} in play`;
  } else if (finishedCount === 0) {
    status = 'Pre-tournament';
  } else if (finishedCount < totalGroup) {
    status = `Group stage · ${finishedCount} of ${totalGroup} matches played`;
  } else if (DATA.bracket?.currentStage && DATA.bracket.currentStage !== 'complete') {
    status = STAGE_LABEL[DATA.bracket.currentStage] || 'Knockout stage';
  } else if (DATA.bracket?.currentStage === 'complete') {
    status = 'Tournament complete';
  } else {
    status = 'Knockout stage';
  }
  document.getElementById('tournament-status').textContent = status;
}

// ── Main render ────────────────────────────────────────────────────────────
function render() {
  resetKOCache();
  document.body.classList.toggle('is-knockout', inKnockout());
  renderHeader();
  renderLeaderboard();
  renderMatches();
  renderBracket();
}

// ── Wire up nav ────────────────────────────────────────────────────────────
document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    currentView = btn.dataset.view;
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
    btn.classList.add('active');
    document.getElementById('view-' + currentView).classList.remove('hidden');
    render();
  });
});

// ── Wire up sort buttons ───────────────────────────────────────────────────
document.querySelectorAll('.sort-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    currentSort = btn.dataset.sort;
    document.querySelectorAll('.sort-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    renderLeaderboard();
  });
});

// ── Wire up match sub-tabs ─────────────────────────────────────────────────
document.querySelectorAll('.match-tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    currentMatchTab = btn.dataset.mtab;
    document.querySelectorAll('.match-tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    renderMatches();
  });
});

// ── Wire up modal close ───────────────────────────────────────────────────
document.getElementById('modal-close').addEventListener('click', closeDetail);
document.getElementById('modal-backdrop').addEventListener('click', closeDetail);
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeDetail(); });

// ── Wire up theme toggle ──────────────────────────────────────────────────
document.getElementById('theme-toggle').addEventListener('click', toggleTheme);

// ── Init ──────────────────────────────────────────────────────────────────
initTheme();
loadAll().then(() => {
  setInterval(refreshDynamic, 60_000);
}).catch(e => {
  document.body.innerHTML = `<p class="loading-msg">Failed to load data.<br><small>${e.message}</small></p>`;
});

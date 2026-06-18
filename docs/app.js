/**
 * WC 2026 Sweepstake — frontend app.
 * Polls data/*.json every 60s and re-renders in place.
 * No build step; no framework.
 */

'use strict';

// ── Country flag emoji lookup ──────────────────────────────────────────────
const FLAGS = {
  ARG:'🇦🇷', AUS:'🇦🇺', AUT:'🇦🇹', BEL:'🇧🇪', BIH:'🇧🇦',
  BRA:'🇧🇷', CAN:'🇨🇦', COD:'🇨🇩', COL:'🇨🇴', CPV:'🇨🇻',
  CRO:'🇭🇷', CUW:'🇨🇼', CZE:'🇨🇿', DZA:'🇩🇿', ECU:'🇪🇨',
  EGY:'🇪🇬', ENG:'🏴󠁧󠁢󠁥󠁮󠁧󠁿', ESP:'🇪🇸', FRA:'🇫🇷', GER:'🇩🇪',
  GHA:'🇬🇭', HTI:'🇭🇹', IRN:'🇮🇷', IRQ:'🇮🇶', CIV:'🇨🇮',
  JPN:'🇯🇵', JOR:'🇯🇴', KOR:'🇰🇷', KSA:'🇸🇦', MAR:'🇲🇦',
  MEX:'🇲🇽', NED:'🇳🇱', NOR:'🇳🇴', NZL:'🇳🇿', PAN:'🇵🇦',
  PAR:'🇵🇾', POR:'🇵🇹', QAT:'🇶🇦', SCO:'🏴󠁧󠁢󠁳󠁣󠁴󠁿', SEN:'🇸🇳',
  SUI:'🇨🇭', SWE:'🇸🇪', TUN:'🇹🇳', TUR:'🇹🇷', URU:'🇺🇾',
  USA:'🇺🇸', UZB:'🇺🇿', ZAF:'🇿🇦',
};
function flag(teamId) { return FLAGS[teamId] ? `<span class="team-flag">${FLAGS[teamId]}</span>` : ''; }

// ── Theme ──────────────────────────────────────────────────────────────────
function initTheme() {
  const saved = localStorage.getItem('twc-theme');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  applyTheme(saved || (prefersDark ? 'dark' : 'light'));
}
function applyTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  const btn = document.getElementById('theme-toggle');
  if (btn) btn.textContent = t === 'dark' ? '☀️' : '🌙';
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
};

let currentView     = 'leaderboard';
let currentSort     = 'grouppts';
let currentMatchTab = 'today';

// ── Bootstrap ─────────────────────────────────────────────────────────────
async function loadAll() {
  const base = window.location.pathname.replace(/\/[^/]*$/, '') + '/data/';
  const [fixtures, teams, participants, results, probs, rankingsHistory] = await Promise.all([
    fetch(base + 'fixtures.json').then(r => r.json()),
    fetch(base + 'teams.json').then(r => r.json()),
    fetch(base + 'participants.json').then(r => r.json()),
    fetch(base + 'results.json').then(r => r.json()),
    fetch(base + 'probabilities.json').then(r => r.json()),
    fetch(base + 'rankings_history.json?t=' + Date.now()).then(r => r.json()).catch(() => null),
  ]);
  DATA = { fixtures, teams: teams.teams, participants, results, probs, rankingsHistory };
  render();
}

async function refreshDynamic() {
  const base = window.location.pathname.replace(/\/[^/]*$/, '') + '/data/';
  try {
    const [results, probs, rankingsHistory] = await Promise.all([
      fetch(base + 'results.json?t=' + Date.now()).then(r => r.json()),
      fetch(base + 'probabilities.json?t=' + Date.now()).then(r => r.json()),
      fetch(base + 'rankings_history.json?t=' + Date.now()).then(r => r.json()).catch(() => null),
    ]);
    DATA.results = results;
    DATA.probs   = probs;
    if (rankingsHistory) DATA.rankingsHistory = rankingsHistory;
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
    if (result && isLive(result)) {
      const sc = scoreFor(fixture, result, teamId);
      const state = sc.f > sc.a ? 'winning' : sc.f === sc.a ? 'drawing' : 'losing';
      chipClass += ` chip-${state}`;
      scoreHtml = `<div class="team-score live">vs ${oppName} ${sc.f}–${sc.a} 🔴</div>`;
    } else if (result && isFinished(result)) {
      const sc = scoreFor(fixture, result, teamId);
      const state = sc.f > sc.a ? 'winning' : sc.f === sc.a ? 'drawing' : 'losing';
      chipClass += ` chip-${state}`;
      const emoji = sc.f > sc.a ? '✅' : sc.f === sc.a ? '🟡' : '❌';
      scoreHtml = `<div class="team-score finished">${emoji} vs ${oppName} ${sc.f}–${sc.a}</div>`;
    } else {
      scoreHtml = `<div class="team-score">vs ${oppName} ${fmtDateShort(fixture.kickoffUtc)}</div>`;
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
      <div class="team-name">${team.name}</div>
      <div class="team-group">Group ${team.group}</div>
      ${scoreHtml}
      ${teamPtsHtml}
    </div>`;
}

// ── Leaderboard ───────────────────────────────────────────────────────────
function renderLeaderboard() {
  const list = document.getElementById('leaderboard-list');

  const hasProbs = DATA.probs?.participants?.length > 0;

  const totalGroupMatches    = DATA.fixtures.matches.filter(f => f.stage === 'group').length;
  const finishedGroupMatches = DATA.results?.matches?.filter(m => {
    const fix = DATA.fixtures.matches.find(f => f.matchId === m.matchId);
    return fix?.stage === 'group' && m.status === 'finished';
  }).length ?? 0;
  const groupStageComplete = finishedGroupMatches >= totalGroupMatches;

  const pot = DATA.fixtures.pot;
  const totalPot = pot.entryFee * pot.participants;
  const prize1 = totalPot * 0.50;
  const prize2 = totalPot * 0.30;
  const prize3 = totalPot * 0.20;

  let participants = DATA.participants.map(p => {
    const prob = getProb(p.id);
    const realPts = prob?.currentGroupPts ?? computeRealGroupPts(p);
    return { ...p, prob, realPts };
  });

  // Sort
  if (currentSort === 'p1st') {
    const probKey = groupStageComplete ? 'pFinalWinner' : 'pGroupPrize';
    participants.sort((a, b) => (b.prob?.[probKey] ?? 0) - (a.prob?.[probKey] ?? 0));
  } else if (currentSort === 'grouppts') {
    participants.sort((a, b) => {
      const ap = a.prob, bp = b.prob;
      if ((bp?.currentGroupPts ?? 0) !== (ap?.currentGroupPts ?? 0)) return (bp?.currentGroupPts ?? 0) - (ap?.currentGroupPts ?? 0);
      if ((bp?.currentGroupGd ?? 0) !== (ap?.currentGroupGd ?? 0)) return (bp?.currentGroupGd ?? 0) - (ap?.currentGroupGd ?? 0);
      return (bp?.currentGroupGf ?? 0) - (ap?.currentGroupGf ?? 0);
    });
  }

  // Max prob values for bar scaling
  const maxP1 = Math.max(...participants.map(p => p.prob?.pFinalWinner ?? 0), 0.001);
  const maxP2 = Math.max(...participants.map(p => p.prob?.pRunnerUp ?? 0), 0.001);
  const maxPG = Math.max(...participants.map(p => p.prob?.pGroupPrize ?? 0), 0.001);

  // Build previous rank map from history snapshot
  const prevRankMap = {};
  if (DATA.rankingsHistory?.rankings?.length) {
    DATA.rankingsHistory.rankings.forEach((r, i) => { prevRankMap[r.id] = i + 1; });
  }

  list.innerHTML = participants.map((p, idx) => {
    const prob = p.prob;
    const pFW = prob?.pFinalWinner ?? 0;
    const pRU = prob?.pRunnerUp ?? 0;
    const pGP = prob?.pGroupPrize ?? 0;
    const pts = prob?.currentGroupPts ?? 0;
    const gd  = prob?.currentGroupGd  ?? 0;
    const gf  = prob?.currentGroupGf  ?? 0;
    const gdStr = gd >= 0 ? '+' + gd : '' + gd;

    const currRank = idx + 1;
    const prevRank = prevRankMap[p.id];
    let arrowHtml = '';
    if (prevRank != null && prevRank !== currRank) {
      if (currRank < prevRank) {
        arrowHtml = `<span class="rank-arrow rank-up" title="Up ${prevRank - currRank} from 12h ago">▲${prevRank - currRank}</span>`;
      } else {
        arrowHtml = `<span class="rank-arrow rank-down" title="Down ${currRank - prevRank} from 12h ago">▼${currRank - prevRank}</span>`;
      }
    }

    return `
      <div class="participant-card" data-id="${p.id}">
        <div class="card-header">
          <div>
            <span class="card-name">${p.name}</span>
            <div style="font-size:11px;color:var(--text2);margin-top:1px">#${currRank} ${arrowHtml}</div>
          </div>
          <div class="card-pts-badge">
            <span class="card-pts-number">${pts}</span>
            <span class="card-pts-label">points</span>
          </div>
        </div>
        <div class="card-teams">
          ${renderTeamChip(p.teams[0])}
          ${renderTeamChip(p.teams[1])}
        </div>
        ${hasProbs ? `
        <div class="card-probs">
          ${groupStageComplete ? `
          <div class="prob-row">
            <span class="prob-label">🥇 Final Win</span>
            <div class="prob-bar-wrap"><div class="prob-bar p1" style="width:${(pFW/maxP1*100).toFixed(1)}%"></div></div>
            <span class="prob-value">${fmtPct(pFW)}</span>
          </div>
          <div class="prob-row">
            <span class="prob-label">🥈 Runner-up</span>
            <div class="prob-bar-wrap"><div class="prob-bar p2" style="width:${(pRU/maxP2*100).toFixed(1)}%"></div></div>
            <span class="prob-value">${fmtPct(pRU)}</span>
          </div>
          ` : `
          <div class="prob-row">
            <span class="prob-label">🏅 Group Prize</span>
            <div class="prob-bar-wrap"><div class="prob-bar pgrp" style="width:${(pGP/maxPG*100).toFixed(1)}%"></div></div>
            <span class="prob-value">${fmtPct(pGP)}</span>
          </div>
          `}
        </div>
        ` : `<p style="font-size:12px;color:var(--text2);margin-top:6px">Simulation running…</p>`}
        <div class="card-footer">
          <div>
            <div class="group-pts-label">Group pts · GD · GF</div>
            <div class="group-pts-val">${pts} · ${gdStr} · ${gf}</div>
          </div>
        </div>
      </div>`;
  }).join('');

  // Tap → detail modal
  list.querySelectorAll('.participant-card').forEach(card => {
    card.addEventListener('click', () => openDetail(card.dataset.id));
  });
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

function renderMatches() {
  const container = document.getElementById('matches-list');
  const today = todayLocalDate();

  // Build participant lookup: teamId → participant first name
  const teamToOwner = {};
  for (const p of DATA.participants) {
    for (const t of p.teams) teamToOwner[t] = p.name;
  }

  // Filter by active tab
  const allFixes = [...DATA.fixtures.matches]
    .filter(f => f.stage === 'group')           // only group stage for now
    .sort((a, b) => new Date(a.kickoffUtc) - new Date(b.kickoffUtc));

  let fixes;
  if (currentMatchTab === 'today') {
    fixes = allFixes.filter(f => {
      const r = getResult(f.matchId);
      return isLive(r) || kickoffLocalDate(f.kickoffUtc) === today;
    });
  } else if (currentMatchTab === 'previous') {
    fixes = allFixes.filter(f => {
      const r = getResult(f.matchId);
      return isFinished(r);
    });
  } else {
    fixes = allFixes.filter(f => {
      const r = getResult(f.matchId);
      return !isFinished(r) && !isLive(r) && kickoffLocalDate(f.kickoffUtc) !== today;
    });
  }

  if (fixes.length === 0) {
    const msgs = { today: 'No matches today.', previous: 'No completed matches yet.', future: 'No upcoming matches.' };
    container.innerHTML = `<p class="empty-tab-msg">${msgs[currentMatchTab]}</p>`;
    return;
  }

  container.innerHTML = fixes.map(f => renderMatchCard(f, teamToOwner)).join('');
}

function renderMatchCard(fix, teamToOwner) {
  const r = getResult(fix.matchId);

  // Resolve display name and subtitle for each side
  function sideInfo(teamId) {
    const owner = teamToOwner[teamId];
    const country = DATA.teams[teamId]?.name || teamId;
    if (owner) {
      return { display: owner, sub: country };
    } else {
      return { display: country, sub: null };
    }
  }

  const home = sideInfo(fix.homeId);
  const away = sideInfo(fix.awayId);

  // Determine result tint classes for each side
  let homeClass = 'match-side', awayClass = 'match-side away';
  if (r && (isLive(r) || isFinished(r))) {
    if (r.homeGoals > r.awayGoals)       { homeClass += ' side-winning'; awayClass += ' side-losing'; }
    else if (r.homeGoals < r.awayGoals)  { homeClass += ' side-losing';  awayClass += ' side-winning'; }
    else                                  { homeClass += ' side-drawing'; awayClass += ' side-drawing'; }
  }

  // Score / time centre
  let centreScore, centreStatus;
  if (r && isLive(r)) {
    centreScore  = `<div class="match-score live">${r.homeGoals}–${r.awayGoals}</div>`;
    centreStatus = `<div class="match-status live">🔴 ${r.minute || 'LIVE'}</div>`;
  } else if (r && isFinished(r)) {
    centreScore  = `<div class="match-score">${r.homeGoals}–${r.awayGoals}</div>`;
    centreStatus = `<div class="match-status">FT</div>`;
  } else {
    const t = new Date(fix.kickoffUtc);
    centreScore  = `<div class="match-kickoff">${t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}</div>`;
    centreStatus = `<div class="match-status">${t.toLocaleDateString([], { month: 'short', day: 'numeric' })}</div>`;
  }

  return `
    <div class="match-card">
      <div class="match-row">
        <div class="${homeClass}">
          <div class="match-participant">${home.display}</div>
          ${home.sub ? `<div class="match-country">${home.sub}</div>` : ''}
        </div>
        <div class="match-score-box">
          ${centreScore}
          ${centreStatus}
        </div>
        <div class="${awayClass}">
          <div class="match-participant">${away.display}</div>
          ${away.sub ? `<div class="match-country">${away.sub}</div>` : ''}
        </div>
      </div>
      <div class="match-meta">Grp ${fix.group} · ${fix.venue}</div>
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

  let html = `<div class="detail-name">${p.name}</div>`;

  if (prob) {
    html += `
      <div style="display:flex;gap:12px;flex-wrap:wrap;margin:8px 0 0">
        <span style="font-size:13px">🥇 ${fmtPct(prob.pFinalWinner)} &nbsp;·&nbsp; ${fmtCurrency(prize1 * prob.pFinalWinner)} exp</span>
        <span style="font-size:13px">🥈 ${fmtPct(prob.pRunnerUp)} &nbsp;·&nbsp; ${fmtCurrency(prize2 * prob.pRunnerUp)} exp</span>
        <span style="font-size:13px">🏅 ${fmtPct(prob.pGroupPrize)} &nbsp;·&nbsp; ${fmtCurrency(prize3 * prob.pGroupPrize)} exp</span>
      </div>
      <div style="font-size:15px;font-weight:700;color:var(--accent);margin-top:6px">Expected winnings: ${fmtCurrency(prob.expectedWinnings)}</div>`;
  }

  for (const teamId of p.teams) {
    const team = DATA.teams[teamId];
    if (!team) {
      html += `<div class="detail-section-title">⚠️ ${teamId} (unconfirmed)</div>`;
      continue;
    }
    html += `<div class="detail-section-title">${team.name} · Group ${team.group} · Elo ${team.elo}</div>`;

    const teamFixes = DATA.fixtures.matches.filter(f => f.stage === 'group' && (f.homeId === teamId || f.awayId === teamId));
    for (const f of teamFixes) {
      const opp = opponentOf(f, teamId);
      const oppTeam = DATA.teams[opp];
      const oppName = oppTeam?.name || opp;
      const r = getResult(f.matchId);
      let resultHtml = '';
      let diffHtml = '';

      if (r && isFinished(r)) {
        const sc = scoreFor(f, r, teamId);
        const emoji = sc.f > sc.a ? '✅' : sc.f === sc.a ? '🟡' : '❌';
        resultHtml = `${emoji} ${sc.f}–${sc.a}`;
      } else if (r && isLive(r)) {
        const sc = scoreFor(f, r, teamId);
        resultHtml = `🔴 ${sc.f}–${sc.a}`;
      } else {
        resultHtml = fmtDate(f.kickoffUtc);
        if (team && oppTeam) {
          const d = difficulty(team.elo, oppTeam.elo);
          diffHtml = `<span class="difficulty-badge difficulty-${d}">${d.toUpperCase()}</span>`;
        }
      }

      html += `
        <div class="detail-fixture-row">
          <div class="detail-fixture-teams">
            vs ${oppName} ${diffHtml}
            <div class="detail-fixture-status">Grp ${f.group} · ${f.venue}</div>
          </div>
          <div class="detail-fixture-result">${resultHtml}</div>
        </div>`;
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
  } else {
    status = 'Knockout stage';
  }
  document.getElementById('tournament-status').textContent = status;
}

// ── Main render ────────────────────────────────────────────────────────────
function render() {
  renderHeader();
  renderLeaderboard();
  renderMatches();
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

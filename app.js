// Routine - 루틴이 조용히 사라지지 않게 계속 보여 주는 앱
// 데이터는 이 폰의 localStorage에만 저장
const APP_VERSION = 'v1.4';
const STORE = 'routine-state';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------- 날짜 ----------
const pad = (n) => String(n).padStart(2, '0');
const keyOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = (k) => new Date(+k.slice(0, 4), +k.slice(5, 7) - 1, +k.slice(8, 10));
const todayKey = () => keyOf(new Date());
const diff = (a, b) => Math.round((parse(b) - parse(a)) / 86400000); // a에서 b까지 며칠
const addDays = (k, n) => { const d = parse(k); d.setDate(d.getDate() + n); return keyOf(d); };
const weekStart = (k) => addDays(k, -((parse(k).getDay() + 6) % 7)); // 월요일
const md = (k) => `${+k.slice(5, 7)}/${+k.slice(8, 10)}`;
const DOW = ['일', '월', '화', '수', '목', '금', '토'];

// ---------- 상태 ----------
function defaultState() {
  return {
    routines: [
      { id: 'r1', emoji: '🍳', name: '아침', kind: 'daily', menu: true, items: ['계란', '땅콩버터', '사과'] },
      { id: 'r2', emoji: '🏋️', name: '운동', kind: 'weekly', target: 2 },
      { id: 'r3', emoji: '🏃', name: '러닝', kind: 'weekly', target: 2 },
      { id: 'r4', emoji: '🏥', name: '병원', kind: 'interval', every: 90, due: '' },
    ],
    log: {}, // log[루틴 id][날짜] = { items: [...] }
    widget: false, autoSync: true, h1: 8, h2: 21, widgetSent: '',
  };
}
let state;
try { state = JSON.parse(localStorage.getItem(STORE)); } catch { state = null; }
if (!state || !Array.isArray(state.routines)) state = defaultState();
const save = () => localStorage.setItem(STORE, JSON.stringify(state));

const shown = () => state.routines.filter((r) => !r.hidden); // 숨긴 루틴은 오늘 화면·위젯에 안 나옴
const datesOf = (r) => Object.keys(state.log[r.id] || {}).sort();
const entry = (r, d) => (state.log[r.id] || {})[d];
function setEntry(r, d, val) {
  state.log[r.id] = state.log[r.id] || {};
  if (val) state.log[r.id][d] = val; else delete state.log[r.id][d];
}

// ---------- 상태 계산 (scriptable/Routine.js 의 calc 와 같은 규칙) ----------
// lvl: done(오늘 함) / ok(신경 안 써도 됨) / todo(오늘 할 차례) / warn(빠지기 시작) / red(사라지는 중)
function calc(r, dates, today) {
  const past = dates.filter((d) => d <= today);
  const last = past[past.length - 1] || null;
  const doneToday = last === today;
  const since = last ? diff(last, today) : null;

  if (r.kind === 'daily') {
    if (doneToday) return { lvl: 'done', score: -1, text: '오늘 완료 ✓', short: '✓' };
    if (since === null) return { lvl: 'todo', score: 1, text: '아직 기록이 없어요', short: '—' };
    if (since === 1) return { lvl: 'todo', score: 1, text: '오늘 아직 · 어제는 했어요', short: '오늘' };
    const miss = since - 1;
    return { lvl: miss >= 2 ? 'red' : 'warn', score: since, text: `${miss}일째 빠졌어요`, short: `${miss}일` };
  }

  if (r.kind === 'weekly') {
    const t = r.target || 1;
    const cnt = past.filter((d) => d >= weekStart(today)).length;
    const base = `이번 주 ${cnt}/${t}`;
    if (doneToday) return { lvl: 'done', score: -1, text: `오늘 완료 ✓ · ${base}`, short: '✓' };
    if (cnt >= t) return { lvl: 'ok', score: 0, text: `${base} 달성 · ${since}일 전`, short: `${cnt}/${t}` };
    if (since === null) return { lvl: 'todo', score: 1, text: `${base} · 아직 기록 없음`, short: '—' };
    const s = since / (7 / t);
    const daysLeft = 7 - ((parse(today).getDay() + 6) % 7); // 오늘 포함 이번 주 남은 날
    let lvl = s >= 2 ? 'red' : s >= 1 ? 'warn' : 'todo';
    if (lvl === 'todo' && t - cnt >= daysLeft) lvl = 'warn';
    const text = lvl === 'red' ? `${since}일째 안 했어요 · ${base}` : `${base} · 마지막 ${since}일 전`;
    return { lvl, score: Math.max(s, lvl === 'warn' ? 1 : 0), text, short: `${since}일` };
  }

  // interval: 병원처럼 며칠마다 / 예약일
  const every = r.every || 90;
  const due = r.due && (!last || r.due > last) ? r.due : last ? addDays(last, every) : null;
  if (doneToday) return { lvl: 'done', score: -1, text: `오늘 다녀왔어요 ✓${r.due > today ? ` · 다음 ${md(r.due)}` : ''}`, short: '✓' };
  if (!due) return { lvl: 'ok', score: 0, text: '다음 날짜를 정해 두세요', short: '—' };
  const left = diff(today, due);
  if (left < 0) return { lvl: 'red', score: 3 - left / 7, text: `${-left}일 지났어요 (${md(due)})`, short: `+${-left}일` };
  if (left === 0) return { lvl: 'red', score: 3, text: `오늘이에요! (${md(due)})`, short: '오늘' };
  if (left <= 3) return { lvl: 'warn', score: 1.5, text: `D-${left} (${md(due)})`, short: `D-${left}` };
  return { lvl: left <= 14 ? 'todo' : 'ok', score: left <= 14 ? 0.5 : 0.1, text: `D-${left} (${md(due)})`, short: `D-${left}` };
}
const statusOf = (r, today = todayKey()) => calc(r, datesOf(r), today);

const KIND_DESC = (r) => r.kind === 'daily' ? '매일' : r.kind === 'weekly' ? `일주일에 ${r.target || 1}번` : `${r.every || 90}일마다`;

// 메뉴 루틴: 지금까지 고른 메뉴를 많이 고른 순으로
function menuCandidates(r) {
  const count = {};
  for (const it of r.items || []) count[it] = (count[it] || 0) + 0.5;
  for (const e of Object.values(state.log[r.id] || {})) for (const it of e.items || []) count[it] = (count[it] || 0) + 1;
  return Object.keys(count).sort((a, b) => count[b] - count[a]);
}
function lastMenuBefore(r, d) {
  const ds = datesOf(r).filter((x) => x < d && (entry(r, x).items || []).length);
  const x = ds[ds.length - 1];
  return x ? { d: x, items: entry(r, x).items } : null;
}

// ---------- 오늘 화면 ----------
function renderToday() {
  const today = todayKey();
  const t = parse(today);
  $('#today-title').textContent = `${t.getMonth() + 1}월 ${t.getDate()}일 (${DOW[t.getDay()]})`;

  const list = shown().map((r) => ({ r, s: statusOf(r, today) }));
  // 순서는 설정에서 정한 그대로 (체크해도 자리가 바뀌지 않게)

  const reds = list.filter((x) => x.s.lvl === 'red');
  $('#fading').hidden = !reds.length;
  if (reds.length) $('#fading').textContent = `🔴 사라지는 중: ${reds.map((x) => x.r.name).join(', ')} — 오늘 하나만 해 볼까요?`;

  $('#routine-list').innerHTML = list.map(({ r, s }) => `
    <div class="rt ${s.lvl}" data-rid="${r.id}">
      <span class="emoji">${esc(r.emoji || '•')}</span>
      <span class="body">
        <div class="name">${esc(r.name)}</div>
        <div class="status">${esc(s.text)}</div>
        ${subLine(r, today) ? `<div class="sub">${esc(subLine(r, today))}</div>` : ''}
      </span>
      <button class="check" data-check aria-label="${s.lvl === 'done' ? '체크 해제' : '체크'}">${s.lvl === 'done' ? '✓' : ''}</button>
    </div>`).join('') || `<p class="muted center">${state.routines.length ? '보이는 루틴이 없어요. 설정에서 👁를 눌러 켜 주세요.' : '설정에서 루틴을 추가해 주세요.'}</p>`;
  renderWidgetButton();
}
function subLine(r, today) {
  if (r.menu) {
    const e = entry(r, today);
    if (e && (e.items || []).length) return `오늘: ${e.items.join(' · ')}`;
    const p = lastMenuBefore(r, today);
    return p ? `지난번(${md(p.d)}): ${p.items.join(' · ')}` : `기본: ${(r.items || []).join(' · ')}`;
  }
  const recent = datesOf(r).filter((d) => d <= today).slice(-3);
  return recent.length ? `최근: ${recent.map(md).join(', ')}` : '';
}

// 동그라미 = 바로 체크/해제, 카드의 나머지 부분 = 자세히 보기·고치기
$('#routine-list').onclick = (ev) => {
  const card = ev.target.closest('[data-rid]');
  if (!card) return;
  const r = state.routines.find((x) => x.id === card.dataset.rid);
  if (ev.target.closest('[data-check]')) toggle(r, todayKey());
  else openDetailSheet(r, todayKey());
};

function toggle(r, d) {
  if (entry(r, d)) {
    setEntry(r, d, null);
    toast(`${r.emoji} ${r.name} 체크를 풀었어요`);
  } else {
    setEntry(r, d, r.menu ? { items: [] } : {});
    toast(`${r.emoji} ${r.name} 체크했어요`);
  }
  changed();
}

// 기록이 바뀔 때마다: 저장 → 다시 그리기 → (켜져 있으면) 위젯 반영
function changed() {
  save();
  renderToday();
  if ($('#view-history').classList.contains('active')) renderHistory();
  if ($('#view-settings').classList.contains('active')) renderSettings();
  autoSync();
}

// ---------- 시트 ----------
function openSheet(html) {
  $('#sheet').onclick = null;
  $('#sheet').innerHTML = html;
  $('#sheet').hidden = false; $('#sheet-bg').hidden = false;
}
function closeSheet() { $('#sheet').hidden = true; $('#sheet-bg').hidden = true; }
$('#sheet-bg').onclick = closeSheet;

// 루틴 설정 칸 (자세히 보기와 루틴 추가에서 같이 씀)
function routineFieldsHtml(v) {
  return `
    <label class="field">이모지<input type="text" id="e-emoji" value="${esc(v.emoji || '')}" maxlength="4"></label>
    <label class="field">이름<input type="text" id="e-name" value="${esc(v.name)}" placeholder="예: 영양제"></label>
    <label class="field">얼마나 자주
      <select id="e-kind">
        <option value="daily" ${v.kind === 'daily' ? 'selected' : ''}>매일</option>
        <option value="weekly" ${v.kind === 'weekly' ? 'selected' : ''}>일주일에 몇 번</option>
        <option value="interval" ${v.kind === 'interval' ? 'selected' : ''}>며칠마다 (병원 등)</option>
      </select></label>
    <label class="field" id="f-target">일주일에 몇 번<input type="number" id="e-target" min="1" max="7" value="${v.target || 3}"></label>
    <label class="field" id="f-every">며칠마다<input type="number" id="e-every" min="1" max="730" value="${v.every || 30}"></label>
    <label class="switch-row" id="f-menu"><span>무엇을 했는지(메뉴) 고르기</span><input type="checkbox" switch id="e-menu" ${v.menu ? 'checked' : ''}></label>
    <label class="field" id="f-items">기본 메뉴 (쉼표로 구분)<input type="text" id="e-items" value="${esc((v.items || []).join(', '))}"></label>`;
}
function bindRoutineFields() {
  const sync = () => {
    const k = $('#e-kind').value;
    $('#f-target').hidden = k !== 'weekly';
    $('#f-every').hidden = k !== 'interval';
    $('#f-menu').hidden = k === 'interval';
    $('#f-items').hidden = k === 'interval' || !$('#e-menu').checked;
  };
  $('#e-kind').onchange = sync; $('#e-menu').onchange = sync; sync();
}
function readRoutineFields(r) {
  const name = $('#e-name').value.trim();
  if (!name) { toast('이름을 적어 주세요'); return null; }
  const kind = $('#e-kind').value;
  return {
    ...(r || { id: 'r' + Date.now().toString(36), due: '' }),
    emoji: $('#e-emoji').value.trim() || '•', name, kind,
    target: Math.min(7, Math.max(1, +$('#e-target').value || 1)),
    every: Math.max(1, +$('#e-every').value || 30),
    menu: kind !== 'interval' && $('#e-menu').checked,
    items: $('#e-items').value.split(',').map((x) => x.trim()).filter(Boolean),
  };
}
function deleteRoutine(r) {
  if (!confirm(`${r.name} 루틴과 기록을 모두 지울까요?`)) return;
  state.routines = state.routines.filter((x) => x !== r);
  delete state.log[r.id];
  closeSheet(); changed();
}

// 자세히 보기: 그날 기록(메뉴·예약일) + 루틴 설정을 한 화면에서 고치고 한 번에 저장
function openDetailSheet(r, d) {
  const today = todayKey();
  const had = entry(r, d);
  const sel = new Set(had ? had.items || [] : []);
  const s = statusOf(r, today);
  const prev = r.menu ? lastMenuBefore(r, d) : null;
  const recent = datesOf(r).filter((x) => x <= today).slice(-7).reverse();
  const chip = (c) => `<button class="chip ${sel.has(c) ? 'on' : ''}" data-chip="${esc(c)}">${esc(c)}</button>`;
  openSheet(`
    <h2>${esc(r.emoji)} ${esc(r.name)}</h2>
    <p class="muted small">${esc(s.text)} · ${KIND_DESC(r)}</p>
    ${r.menu ? `
      <h3>${d === today ? '오늘' : md(d)} 먹은 것</h3>
      <div class="chips" id="chips">${[...new Set([...menuCandidates(r), ...sel])].map(chip).join('')}</div>
      <div class="add-line"><input type="text" id="new-item" placeholder="새 메뉴 (예: 요거트)"><button class="btn" id="add-item">추가</button></div>
      ${prev ? `<button class="btn wide" id="same-prev">↺ 지난번과 같음 (${md(prev.d)}: ${esc(prev.items.join(' · '))})</button>` : ''}` : ''}
    ${r.kind === 'interval' ? `
      <label class="field">다음 예약일 (비워 두면 마지막 방문 ${r.every || 90}일 뒤)
        <input type="date" id="due" value="${r.due && r.due > today ? r.due : ''}"></label>` : ''}
    ${recent.length ? `<div class="recent"><h3>최근 기록</h3>${recent.map((x) => `<div class="menu-row"><span class="d">${md(x)} (${DOW[parse(x).getDay()]})</span><span>${r.menu ? esc((entry(r, x).items || []).join(' · ') || '체크만') : '✓'}</span></div>`).join('')}</div>` : ''}
    <h3 class="section">루틴 설정</h3>
    ${routineFieldsHtml(r)}
    <button class="btn primary wide" id="d-save">저장</button>
    <button class="btn danger wide" id="d-del">이 루틴 지우기</button>
  `);
  bindRoutineFields();
  if (r.menu) {
    // 칩은 그 자리에서만 바꿈 (시트를 다시 그리면 적던 설정 칸이 지워지니까)
    $('#chips').onclick = (ev) => {
      const b = ev.target.closest('[data-chip]');
      if (!b) return;
      const c = b.dataset.chip;
      sel.has(c) ? sel.delete(c) : sel.add(c);
      b.classList.toggle('on', sel.has(c));
    };
    const addChip = (v) => {
      sel.add(v);
      const old = $$('#chips [data-chip]').find((b) => b.dataset.chip === v);
      if (old) old.classList.add('on'); else $('#chips').insertAdjacentHTML('beforeend', chip(v));
    };
    const add = () => {
      const v = $('#new-item').value.trim();
      if (v) addChip(v);
      $('#new-item').value = '';
    };
    $('#add-item').onclick = add;
    $('#new-item').onkeydown = (e) => { if (e.key === 'Enter') add(); };
    if (prev) $('#same-prev').onclick = () => {
      sel.clear();
      $$('#chips [data-chip]').forEach((b) => b.classList.remove('on'));
      prev.items.forEach(addChip);
    };
  }
  $('#d-save').onclick = () => {
    const nr = readRoutineFields(r);
    if (!nr) return;
    // 메뉴를 골랐으면 그날 먹은 것이니 체크도 같이 됨
    if (r.menu && (had || sel.size)) setEntry(r, d, { items: [...sel] });
    if (r.kind === 'interval' && $('#due')) nr.due = $('#due').value || '';
    state.routines[state.routines.indexOf(r)] = nr;
    closeSheet(); toast('저장했어요'); changed();
  };
  $('#d-del').onclick = () => deleteRoutine(r);
}

// ---------- 기록 화면 ----------
// 한 달 달력 하나에 그날 한 루틴을 이모지로. 이모지가 많은 주는 그 주 칸만 높아짐
let histMonth = todayKey().slice(0, 7); // 'YYYY-MM'
let histFilter = null; // null = 전체, 아니면 루틴 id
const monthAdd = (ym, n) => { const d = new Date(+ym.slice(0, 4), +ym.slice(5, 7) - 1 + n, 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };

function renderHistory() {
  const today = todayKey();
  const rs = shown();
  if (histFilter && !rs.some((r) => r.id === histFilter)) histFilter = null;
  const visible = histFilter ? rs.filter((r) => r.id === histFilter) : rs;

  const first = `${histMonth}-01`;
  const last = addDays(`${monthAdd(histMonth, 1)}-01`, -1);
  const start = weekStart(first);
  const end = addDays(weekStart(last), 6);
  const days = Array.from({ length: diff(start, end) + 1 }, (_, i) => addDays(start, i));
  const inMonth = (d) => d >= first && d <= last;
  const counts = rs.map((r) => `${esc(r.emoji)} ${datesOf(r).filter(inMonth).length}번`).join(' · ');

  $('#history-grids').innerHTML = `<section class="card">
    <div class="month-bar">
      <button class="icon-btn" data-month="-1" aria-label="지난달">‹</button>
      <b>${+histMonth.slice(0, 4)}년 ${+histMonth.slice(5)}월</b>
      <button class="icon-btn" data-month="1" aria-label="다음 달" ${histMonth >= today.slice(0, 7) ? 'disabled' : ''}>›</button>
    </div>
    <div class="chips filter">
      <button class="chip ${histFilter ? '' : 'on'}" data-filter="">전체</button>
      ${rs.map((r) => `<button class="chip ${histFilter === r.id ? 'on' : ''}" data-filter="${r.id}">${esc(r.emoji)} ${esc(r.name)}</button>`).join('')}
    </div>
    <p class="muted small">이번 달: ${counts || '루틴이 없어요'}</p>
    <div class="cal-head">${['월', '화', '수', '목', '금', '토', '일'].map((x) => `<span>${x}</span>`).join('')}</div>
    <div class="cal">${days.map((d) => {
      if (!inMonth(d)) return '<span class="cell blank"></span>';
      const ems = visible.filter((r) => entry(r, d)).map((r) => `<span>${esc(r.emoji)}</span>`).join('');
      return `<button class="cell ${d === today ? 'today' : ''} ${d > today ? 'future' : ''}" data-day="${d}" ${d > today ? 'disabled' : ''}>
        <span class="n">${+d.slice(8)}</span><span class="em">${ems}</span></button>`;
    }).join('')}</div>
    <p class="muted small">날짜를 누르면 그날 기록을 넣거나 지울 수 있어요. (깜빡한 날 채우기)</p>
  </section>`;

  $('#menu-log').innerHTML = rs.filter((r) => r.menu).map((r) => {
    const ds = datesOf(r).filter((d) => d <= today).slice(-14).reverse();
    return `<section class="card"><h2>${esc(r.emoji)} ${esc(r.name)} 메뉴 (최근 14번)</h2>
      ${ds.map((d) => `<div class="menu-row"><span class="d">${md(d)} (${DOW[parse(d).getDay()]})</span><span>${esc((entry(r, d).items || []).join(' · ') || '체크만')}</span></div>`).join('') || '<p class="muted small">아직 없어요.</p>'}
    </section>`;
  }).join('');
}
$('#history-grids').onclick = (ev) => {
  const m = ev.target.closest('[data-month]');
  if (m) { histMonth = monthAdd(histMonth, +m.dataset.month); return renderHistory(); }
  const f = ev.target.closest('[data-filter]');
  if (f) { histFilter = f.dataset.filter || null; return renderHistory(); }
  const c = ev.target.closest('[data-day]');
  if (c) openDaySheet(c.dataset.day);
};

// 그날 루틴 목록: 동그라미로 바로 체크/해제, 이름을 누르면 그날 기준 자세히 보기
function openDaySheet(d) {
  const draw = () => {
    openSheet(`
      <h2>${md(d)} (${DOW[parse(d).getDay()]})</h2>
      ${shown().map((r) => {
        const e = entry(r, d);
        const sub = r.menu && e && (e.items || []).length ? e.items.join(' · ') : '';
        return `<div class="day-row ${e ? 'done' : ''}" data-rid="${r.id}">
          <span class="emoji">${esc(r.emoji)}</span>
          <span class="body"><b>${esc(r.name)}</b>${sub ? `<div class="desc">${esc(sub)}</div>` : ''}</span>
          <button class="check" data-check aria-label="${e ? '체크 해제' : '체크'}">${e ? '✓' : ''}</button>
        </div>`;
      }).join('')}
      <button class="btn wide" id="day-close">닫기</button>
    `);
    $('#day-close').onclick = closeSheet;
    $('#sheet').onclick = (ev) => {
      const row = ev.target.closest('.day-row');
      if (!row) return;
      const r = state.routines.find((x) => x.id === row.dataset.rid);
      if (ev.target.closest('[data-check]')) { toggle(r, d); draw(); }
      else openDetailSheet(r, d);
    };
  };
  draw();
}

// ---------- 설정 ----------
function renderSettings() {
  $('#routine-edit-list').innerHTML = state.routines.map((r) => `
    <div class="edit-item ${r.hidden ? 'off' : ''}">
      <span class="emoji">${esc(r.emoji || '•')}</span>
      <span class="body"><b>${esc(r.name)}</b><div class="desc">${KIND_DESC(r)}${r.menu ? ' · 메뉴 기록' : ''}</div></span>
      <button class="btn mini vis" data-vis="${r.id}" aria-label="${r.hidden ? '보이기' : '숨기기'}">${r.hidden ? '숨김' : '👁'}</button>
      <button class="btn mini" data-move="-1" data-id="${r.id}" aria-label="위로">▲</button>
      <button class="btn mini" data-move="1" data-id="${r.id}" aria-label="아래로">▼</button>
      <button class="btn mini" data-edit="${r.id}">고치기</button>
    </div>`).join('');
  $('#widget-toggle').checked = !!state.widget;
  $('#autosync-toggle').checked = !!state.autoSync;
  const opts = (v) => `<option value="0" ${!v ? 'selected' : ''}>끄기</option>` +
    Array.from({ length: 18 }, (_, i) => i + 6).map((h) => `<option value="${h}" ${v === h ? 'selected' : ''}>${h}시</option>`).join('');
  $('#h1').innerHTML = opts(state.h1); $('#h2').innerHTML = opts(state.h2);
  renderVersionInfo();
}
$('#routine-edit-list').onclick = (ev) => {
  const vis = ev.target.closest('[data-vis]');
  if (vis) {
    // 숨겨도 기록은 그대로 남음. 오늘 화면·위젯·알림에서만 빠지고 기록 탭에는 보임
    const r = state.routines.find((x) => x.id === vis.dataset.vis);
    r.hidden = !r.hidden;
    toast(r.hidden ? `${r.emoji} ${r.name} 숨겼어요 (기록은 남아 있어요)` : `${r.emoji} ${r.name} 다시 보여요`);
    return changed();
  }
  const mv = ev.target.closest('[data-move]');
  if (mv) {
    // 순서 바꾸기: 오늘 화면이 이 순서를 따름 (잠금화면 위젯은 칸이 3줄뿐이라 급한 순서 유지)
    const i = state.routines.findIndex((r) => r.id === mv.dataset.id);
    const j = i + Number(mv.dataset.move);
    if (j < 0 || j >= state.routines.length) return;
    [state.routines[i], state.routines[j]] = [state.routines[j], state.routines[i]];
    return changed();
  }
  const b = ev.target.closest('[data-edit]');
  if (b) openEditSheet(state.routines.find((r) => r.id === b.dataset.edit));
};
$('#add-routine').onclick = () => openEditSheet(null);

// 설정의 "고치기"는 자세히 보기로, "+ 루틴 추가"는 빈 설정 칸으로
function openEditSheet(r) {
  if (r) return openDetailSheet(r, todayKey());
  openSheet(`
    <h2>루틴 추가</h2>
    ${routineFieldsHtml({ emoji: '✨', name: '', kind: 'weekly', target: 3, every: 30, menu: false, items: [] })}
    <button class="btn primary wide" id="e-save">추가</button>
  `);
  bindRoutineFields();
  $('#e-save').onclick = () => {
    const nr = readRoutineFields(null);
    if (!nr) return;
    state.routines.push(nr);
    closeSheet(); changed();
  };
}

$('#widget-toggle').onchange = (e) => { state.widget = e.target.checked; save(); renderWidgetButton(); };
$('#autosync-toggle').onchange = (e) => { state.autoSync = e.target.checked; save(); };
$('#h1').onchange = (e) => { state.h1 = +e.target.value; save(); };
$('#h2').onchange = (e) => { state.h2 = +e.target.value; save(); };

// 백업
$('#export').onclick = async () => {
  const name = `routine-backup-${todayKey()}.json`;
  const file = new File([JSON.stringify(state)], name, { type: 'application/json' });
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) return await navigator.share({ files: [file] });
  } catch (e) { if (e.name === 'AbortError') return; }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file); a.download = name; a.click();
};
$('#import').onchange = async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  try {
    const s = JSON.parse(await f.text());
    if (!Array.isArray(s.routines) || typeof s.log !== 'object') throw new Error();
    if (!confirm('지금 기록을 파일 내용으로 바꿀까요?')) return;
    state = { ...defaultState(), ...s };
    save(); renderSettings(); renderToday(); toast('불러왔어요');
  } catch { toast('Routine 백업 파일이 아니에요'); }
  e.target.value = '';
};

// ---------- 잠금화면 위젯 (Scriptable) ----------
// 루틴마다 최근 기록 8개를 보내면 위젯이 날짜가 바뀌어도 알아서 다시 계산함
function widgetQuery() {
  const rs = shown().map((r) => {
    const ds = datesOf(r);
    return { e: r.emoji, n: r.name, k: r.kind[0], t: r.target || 1, v: r.every || 90, u: r.due || '', ds: ds.slice(-8) };
  });
  return `h1=${state.h1 || 0}&h2=${state.h2 || 0}&r=${encodeURIComponent(JSON.stringify(rs))}`;
}
function renderWidgetButton() {
  const btn = $('#widget-sync');
  btn.hidden = !state.widget;
  if (!state.widget) return;
  const q = widgetQuery();
  const done = q === state.widgetSent;
  btn.href = `scriptable:///run/Routine?${q}`;
  btn.textContent = done ? '✓ 잠금화면에 반영됨' : '🔒 잠금화면에 반영';
  btn.classList.toggle('pending', !done);
  btn.classList.toggle('done', done);
}
// iOS는 버튼을 누른 그 순간에만 다른 앱을 열 수 있어서, 기록 버튼 처리 안에서 부름
function autoSync() {
  if (!state.widget || !state.autoSync) return;
  const q = widgetQuery();
  if (q === state.widgetSent) return;
  state.widgetSent = q; save();
  location.href = `scriptable:///run/Routine?${q}`;
}
$('#widget-sync').onclick = () => { state.widgetSent = widgetQuery(); save(); setTimeout(renderWidgetButton, 300); };

let scriptText = '';
$$('[data-copy]').forEach((btn) => (btn.onclick = async () => {
  try {
    if (!scriptText) scriptText = await (await fetch('scriptable/Routine.js')).text();
    await navigator.clipboard.writeText(scriptText);
    toast('복사했어요! Scriptable에서 이름을 Routine으로');
  } catch { toast('복사 실패. 한 번 더 눌러 주세요'); }
}));

async function renderVersionInfo() {
  let sv = '?';
  try {
    if (!scriptText) scriptText = await (await fetch('scriptable/Routine.js')).text();
    sv = (scriptText.match(/버전: (\S+)/) || [])[1] || '?';
  } catch {}
  $('#version-info').innerHTML = `앱 <b>${APP_VERSION}</b> · 위젯 스크립트 <b>${sv}</b><br>Scriptable에 넣은 스크립트 맨 위 "버전"이 이 숫자와 같으면 최신이에요.`;
}

// ---------- 공통 ----------
let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 2200);
}

function showView(name) {
  $$('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${name}`));
  $$('.tabbar button').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
  if (name === 'today') renderToday();
  if (name === 'history') renderHistory();
  if (name === 'settings') renderSettings();
  window.scrollTo(0, 0);
}
$('.tabbar').onclick = (ev) => { const b = ev.target.closest('[data-view]'); if (b) showView(b.dataset.view); };

// 앱으로 돌아오면 날짜가 바뀌었을 수 있으니 다시 그림
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') renderToday();
});

if ('serviceWorker' in navigator) {
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController) location.reload(); });
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then((reg) => {
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update(); });
  });
}
renderToday();

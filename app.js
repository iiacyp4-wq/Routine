// Routine - 루틴이 조용히 사라지지 않게 계속 보여 주는 앱
// 데이터는 이 폰의 localStorage에만 저장
const APP_VERSION = 'v1.0';
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

  const list = state.routines.map((r) => ({ r, s: statusOf(r, today) }));
  list.sort((a, b) => b.s.score - a.s.score);

  const reds = list.filter((x) => x.s.lvl === 'red');
  $('#fading').hidden = !reds.length;
  if (reds.length) $('#fading').textContent = `🔴 사라지는 중: ${reds.map((x) => x.r.name).join(', ')} — 오늘 하나만 해 볼까요?`;

  $('#routine-list').innerHTML = list.map(({ r, s }) => `
    <button class="rt ${s.lvl}" data-rid="${r.id}">
      <span class="emoji">${esc(r.emoji || '•')}</span>
      <span class="body">
        <div class="name">${esc(r.name)}</div>
        <div class="status">${esc(s.text)}</div>
        ${subLine(r, today) ? `<div class="sub">${esc(subLine(r, today))}</div>` : ''}
      </span>
      <span class="check">${s.lvl === 'done' ? '✓' : ''}</span>
    </button>`).join('') || '<p class="muted center">설정에서 루틴을 추가해 주세요.</p>';
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

$('#routine-list').onclick = (ev) => {
  const b = ev.target.closest('[data-rid]');
  if (!b) return;
  const r = state.routines.find((x) => x.id === b.dataset.rid);
  tapRoutine(r, todayKey());
};

function tapRoutine(r, d) {
  if (r.menu) return openMenuSheet(r, d);
  if (r.kind === 'interval' && d === todayKey()) return openIntervalSheet(r);
  if (entry(r, d)) {
    if (!confirm(`${md(d)} ${r.name} 기록을 지울까요?`)) return;
    setEntry(r, d, null);
  } else {
    setEntry(r, d, {});
    toast(`${r.emoji} ${r.name} 기록했어요`);
  }
  changed();
}

// 기록이 바뀔 때마다: 저장 → 다시 그리기 → (켜져 있으면) 위젯 반영
function changed() {
  save();
  renderToday();
  if ($('#view-history').classList.contains('active')) renderHistory();
  autoSync();
}

// ---------- 시트 ----------
function openSheet(html) {
  $('#sheet').innerHTML = html;
  $('#sheet').hidden = false; $('#sheet-bg').hidden = false;
}
function closeSheet() { $('#sheet').hidden = true; $('#sheet-bg').hidden = true; }
$('#sheet-bg').onclick = closeSheet;

// 메뉴 고르기 (아침 등)
function openMenuSheet(r, d) {
  const had = entry(r, d);
  const sel = new Set(had ? had.items || [] : []);
  const draw = () => {
    const cands = [...new Set([...menuCandidates(r), ...sel])];
    const prev = lastMenuBefore(r, d);
    const recent = datesOf(r).filter((x) => x <= d).slice(-7).reverse();
    openSheet(`
      <h2>${esc(r.emoji)} ${esc(r.name)} · ${md(d)}</h2>
      <p class="muted small">먹은 걸 눌러서 고르세요.</p>
      <div class="chips">${cands.map((c) => `<button class="chip ${sel.has(c) ? 'on' : ''}" data-chip="${esc(c)}">${esc(c)}</button>`).join('')}</div>
      <div class="add-line"><input type="text" id="new-item" placeholder="새 메뉴 (예: 요거트)"><button class="btn" id="add-item">추가</button></div>
      ${prev ? `<button class="btn wide" id="same-prev">↺ 지난번과 같음 (${md(prev.d)}: ${esc(prev.items.join(' · '))})</button>` : ''}
      <button class="btn primary wide" id="save-menu">${had ? '고친 대로 저장' : '기록하기'}</button>
      ${had ? '<button class="btn danger wide" id="del-menu">이날 기록 지우기</button>' : ''}
      ${recent.length ? `<div class="recent"><h2>최근 메뉴</h2>${recent.map((x) => `<div class="menu-row"><span class="d">${md(x)} (${DOW[parse(x).getDay()]})</span><span>${esc((entry(r, x).items || []).join(' · ') || '기록만')}</span></div>`).join('')}</div>` : ''}
    `);
    $$('[data-chip]').forEach((b) => (b.onclick = () => { const c = b.dataset.chip; sel.has(c) ? sel.delete(c) : sel.add(c); draw(); }));
    const add = () => { const v = $('#new-item').value.trim(); if (v) { sel.add(v); draw(); } };
    $('#add-item').onclick = add;
    $('#new-item').onkeydown = (e) => { if (e.key === 'Enter') add(); };
    if (prev) $('#same-prev').onclick = () => { sel.clear(); prev.items.forEach((x) => sel.add(x)); draw(); };
    $('#save-menu').onclick = () => { setEntry(r, d, { items: [...sel] }); closeSheet(); toast(`${r.emoji} ${r.name} 기록했어요`); changed(); };
    if (had) $('#del-menu').onclick = () => { setEntry(r, d, null); closeSheet(); changed(); };
  };
  draw();
}

// 병원 등: 다녀옴 기록 + 다음 예약일
function openIntervalSheet(r) {
  const today = todayKey();
  const had = entry(r, today);
  const s = statusOf(r, today);
  openSheet(`
    <h2>${esc(r.emoji)} ${esc(r.name)}</h2>
    <p class="muted small">${esc(s.text)} · ${KIND_DESC(r)}</p>
    <label class="field">다음 예약일 (모르면 비워 두면 ${r.every || 90}일 뒤로 잡아요)
      <input type="date" id="due" value="${r.due && r.due > today ? r.due : ''}"></label>
    ${had ? '<button class="btn danger wide" id="undo">오늘 다녀온 기록 지우기</button>'
          : '<button class="btn primary wide" id="visit">오늘 다녀왔어요</button>'}
    <button class="btn wide" id="due-only">예약일만 저장</button>
  `);
  const saveDue = () => { r.due = $('#due').value || ''; };
  if (had) $('#undo').onclick = () => { setEntry(r, today, null); saveDue(); closeSheet(); changed(); };
  else $('#visit').onclick = () => { setEntry(r, today, {}); saveDue(); closeSheet(); toast(`${r.emoji} ${r.name} 기록했어요`); changed(); };
  $('#due-only').onclick = () => { saveDue(); closeSheet(); toast('예약일을 저장했어요'); changed(); };
}

// ---------- 기록 화면 ----------
function renderHistory() {
  const today = todayKey();
  const end = addDays(weekStart(today), 6);
  const start = addDays(end, -34); // 5주
  const days = Array.from({ length: 35 }, (_, i) => addDays(start, i));
  $('#history-grids').innerHTML = state.routines.map((r) => {
    const cnt30 = datesOf(r).filter((d) => d > addDays(today, -30) && d <= today).length;
    return `<section class="card grid-card">
      <h2>${esc(r.emoji)} ${esc(r.name)} <small>최근 30일 ${cnt30}번 · ${KIND_DESC(r)}</small></h2>
      <div class="days-head">${['월', '화', '수', '목', '금', '토', '일'].map((x) => `<span>${x}</span>`).join('')}</div>
      <div class="days">${days.map((d) => `<button class="day ${entry(r, d) ? 'on' : ''} ${d === today ? 'today' : ''} ${d > today ? 'future' : ''}"
        data-r="${r.id}" data-d="${d}" ${d > today ? 'disabled' : ''}>${+d.slice(8)}</button>`).join('')}</div>
    </section>`;
  }).join('');

  $('#menu-log').innerHTML = state.routines.filter((r) => r.menu).map((r) => {
    const ds = datesOf(r).filter((d) => d <= today).slice(-14).reverse();
    return `<section class="card"><h2>${esc(r.emoji)} ${esc(r.name)} 메뉴 (최근 14번)</h2>
      ${ds.map((d) => `<div class="menu-row"><span class="d">${md(d)} (${DOW[parse(d).getDay()]})</span><span>${esc((entry(r, d).items || []).join(' · ') || '기록만')}</span></div>`).join('') || '<p class="muted small">아직 없어요.</p>'}
    </section>`;
  }).join('');
}
$('#history-grids').onclick = (ev) => {
  const b = ev.target.closest('[data-d]');
  if (!b) return;
  const r = state.routines.find((x) => x.id === b.dataset.r);
  if (r.menu) return openMenuSheet(r, b.dataset.d);
  // 기록 화면에서는 병원도 바로 넣고 빼기 (지난 날 채우기용)
  setEntry(r, b.dataset.d, entry(r, b.dataset.d) ? null : {});
  changed();
};

// ---------- 설정 ----------
function renderSettings() {
  $('#routine-edit-list').innerHTML = state.routines.map((r) => `
    <div class="edit-item">
      <span class="emoji">${esc(r.emoji || '•')}</span>
      <span class="body"><b>${esc(r.name)}</b><div class="desc">${KIND_DESC(r)}${r.menu ? ' · 메뉴 기록' : ''}</div></span>
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
  const b = ev.target.closest('[data-edit]');
  if (b) openEditSheet(state.routines.find((r) => r.id === b.dataset.edit));
};
$('#add-routine').onclick = () => openEditSheet(null);

function openEditSheet(r) {
  const isNew = !r;
  const v = r || { emoji: '✨', name: '', kind: 'weekly', target: 3, every: 30, menu: false, items: [] };
  openSheet(`
    <h2>${isNew ? '루틴 추가' : '루틴 고치기'}</h2>
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
    <label class="field" id="f-items">기본 메뉴 (쉼표로 구분)<input type="text" id="e-items" value="${esc((v.items || []).join(', '))}"></label>
    <button class="btn primary wide" id="e-save">저장</button>
    ${isNew ? '' : '<button class="btn danger wide" id="e-del">이 루틴 지우기 (기록도 같이 지워져요)</button>'}
  `);
  const sync = () => {
    const k = $('#e-kind').value;
    $('#f-target').hidden = k !== 'weekly';
    $('#f-every').hidden = k !== 'interval';
    $('#f-menu').hidden = k === 'interval';
    $('#f-items').hidden = k === 'interval' || !$('#e-menu').checked;
  };
  $('#e-kind').onchange = sync; $('#e-menu').onchange = sync; sync();
  $('#e-save').onclick = () => {
    const name = $('#e-name').value.trim();
    if (!name) return toast('이름을 적어 주세요');
    const kind = $('#e-kind').value;
    const nr = {
      ...(r || { id: 'r' + Date.now().toString(36), due: '' }),
      emoji: $('#e-emoji').value.trim() || '•', name, kind,
      target: Math.min(7, Math.max(1, +$('#e-target').value || 1)),
      every: Math.max(1, +$('#e-every').value || 30),
      menu: kind !== 'interval' && $('#e-menu').checked,
      items: $('#e-items').value.split(',').map((x) => x.trim()).filter(Boolean),
    };
    if (isNew) state.routines.push(nr); else state.routines[state.routines.indexOf(r)] = nr;
    closeSheet(); changed(); renderSettings();
  };
  if (!isNew) $('#e-del').onclick = () => {
    if (!confirm(`${r.name} 루틴과 기록을 모두 지울까요?`)) return;
    state.routines = state.routines.filter((x) => x !== r);
    delete state.log[r.id];
    closeSheet(); changed(); renderSettings();
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
  const rs = state.routines.map((r) => {
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

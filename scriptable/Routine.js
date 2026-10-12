// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: deep-blue; icon-glyph: redo;

// Routine 잠금화면 위젯
// 버전: v1.0
// 이 스크립트 이름을 반드시 "Routine" 으로 저장하세요. (Routine 앱의 반영 버튼이 이 이름을 부릅니다)

const fm = FileManager.local();
const PATH = fm.joinPath(fm.documentsDirectory(), 'routine-data.json');

// ---------- 날짜 (앱과 같은 규칙) ----------
const pad = (n) => String(n).padStart(2, '0');
const keyOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = (k) => new Date(+k.slice(0, 4), +k.slice(5, 7) - 1, +k.slice(8, 10));
const diff = (a, b) => Math.round((parse(b) - parse(a)) / 86400000);
const addDays = (k, n) => { const d = parse(k); d.setDate(d.getDate() + n); return keyOf(d); };
const weekStart = (k) => addDays(k, -((parse(k).getDay() + 6) % 7));
const md = (k) => `${+k.slice(5, 7)}/${+k.slice(8, 10)}`;

// 1) Routine 앱의 반영 버튼으로 열렸을 때: 받은 내용을 저장
const q = args.queryParameters || {};
if (q.r) {
  try {
    const data = { at: Date.now(), h1: Number(q.h1) || 0, h2: Number(q.h2) || 0, r: JSON.parse(q.r) };
    fm.writeString(PATH, JSON.stringify(data));
  } catch (e) {}
}

function load() {
  try { if (fm.fileExists(PATH)) return JSON.parse(fm.readString(PATH)); } catch (e) {}
  return null;
}

// ---------- 상태 계산 (app.js 의 calc 와 같은 규칙) ----------
function calc(r, today) {
  const past = (r.ds || []).filter((d) => d <= today);
  const last = past[past.length - 1] || null;
  const doneToday = last === today;
  const since = last ? diff(last, today) : null;

  if (r.k === 'd') {
    if (doneToday) return { lvl: 'done', score: -1, short: '✓' };
    if (since === null) return { lvl: 'todo', score: 1, short: '—' };
    if (since === 1) return { lvl: 'todo', score: 1, short: '오늘' };
    const miss = since - 1;
    return { lvl: miss >= 2 ? 'red' : 'warn', score: since, short: `${miss}일째` };
  }
  if (r.k === 'w') {
    const t = r.t || 1;
    const cnt = past.filter((d) => d >= weekStart(today)).length;
    if (doneToday) return { lvl: 'done', score: -1, short: '✓' };
    if (cnt >= t) return { lvl: 'ok', score: 0, short: `${cnt}/${t}` };
    if (since === null) return { lvl: 'todo', score: 1, short: '—' };
    const s = since / (7 / t);
    const daysLeft = 7 - ((parse(today).getDay() + 6) % 7);
    let lvl = s >= 2 ? 'red' : s >= 1 ? 'warn' : 'todo';
    if (lvl === 'todo' && t - cnt >= daysLeft) lvl = 'warn';
    return { lvl, score: Math.max(s, lvl === 'warn' ? 1 : 0), short: `${since}일째` };
  }
  const due = r.u && (!last || r.u > last) ? r.u : last ? addDays(last, r.v || 90) : null;
  if (doneToday) return { lvl: 'done', score: -1, short: '✓' };
  if (!due) return { lvl: 'ok', score: 0, short: '—' };
  const left = diff(today, due);
  if (left < 0) return { lvl: 'red', score: 3 - left / 7, short: `+${-left}일` };
  if (left === 0) return { lvl: 'red', score: 3, short: '오늘' };
  if (left <= 3) return { lvl: 'warn', score: 1.5, short: `D-${left}` };
  return { lvl: left <= 14 ? 'todo' : 'ok', score: left <= 14 ? 0.5 : 0.1, short: `D-${left}` };
}

function rows(data) {
  const today = keyOf(new Date());
  const list = (data ? data.r : []).map((r) => ({ r, s: calc(r, today) }));
  list.sort((a, b) => b.s.score - a.s.score);
  return list;
}

// ---------- 위젯 ----------
const font = (size, bold) => bold
  ? (Font.boldRoundedSystemFont ? Font.boldRoundedSystemFont(size) : Font.boldSystemFont(size))
  : Font.semiboldSystemFont(size);
function text(stack, str, size, bold, alpha = 1) {
  const t = stack.addText(str);
  t.font = font(size, bold); t.lineLimit = 1; t.minimumScaleFactor = 0.6;
  t.textColor = new Color('#ffffff', alpha);
  return t;
}
const mark = (lvl) => (lvl === 'red' ? '!' : lvl === 'warn' ? '·' : '');

// 잠금화면 직사각형: 급한 순서로 3줄 (끝난 건 흐리게)
function rectWidget(list, n = 3, big = false) {
  const w = new ListWidget();
  w.setPadding(big ? 12 : 0, big ? 14 : 2, big ? 12 : 0, big ? 14 : 2);
  if (big) w.backgroundColor = new Color('#161b26');
  if (!list.length) { text(w, 'Routine 앱에서 반영을 눌러 주세요', 12, false); return w; }
  list.slice(0, n).forEach(({ r, s }, i) => {
    const line = w.addStack();
    line.centerAlignContent();
    const dim = s.lvl === 'done' || s.lvl === 'ok' ? 0.55 : 1;
    text(line, `${mark(s.lvl)}${r.e} ${r.n}`, big ? 15 : 13, s.lvl === 'red', dim);
    line.addSpacer();
    text(line, s.short, big ? 15 : 13, true, dim);
    if (i < n - 1) w.addSpacer(big ? 6 : 1);
  });
  return w;
}

// 잠금화면 원형: 가장 급한 루틴 하나
function circleWidget(list) {
  const w = new ListWidget();
  w.addAccessoryWidgetBackground = true;
  const top = list[0];
  const center = (str, size, bold) => { const l = w.addStack(); l.addSpacer(); text(l, str, size, bold); l.addSpacer(); };
  if (!top) { center('—', 16, true); return w; }
  const allDone = list.every((x) => x.s.lvl === 'done' || x.s.lvl === 'ok');
  center(allDone ? '👍' : top.r.e, 18, false);
  center(allDone ? '완료' : top.s.short, 12, true);
  return w;
}

// 시계 위 한 줄
function inlineWidget(list) {
  const w = new ListWidget();
  const todo = list.filter((x) => x.s.lvl !== 'done' && x.s.lvl !== 'ok').slice(0, 2);
  w.addText(todo.length ? todo.map(({ r, s }) => `${r.e}${r.n} ${s.short}`).join(' · ') : '오늘 루틴 다 했어요 👍');
  return w;
}

// ---------- 알림 ----------
// 위젯이 새로 고쳐질 때 확인: 정한 시각이 지났고 아직 안 한 루틴이 있으면 그 시각마다 하루 한 번 알림
async function remind(data, list) {
  if (!data) return;
  const now = new Date();
  const today = keyOf(now);
  const flag = fm.joinPath(fm.documentsDirectory(), 'routine-reminded.json');
  let sent = {};
  try { if (fm.fileExists(flag)) sent = JSON.parse(fm.readString(flag)); } catch (e) {}
  if (sent.d !== today) sent = { d: today, h: [] };
  const hours = [data.h1, data.h2].filter((h) => h && now.getHours() >= h && !sent.h.includes(h));
  if (!hours.length) return;
  sent.h.push(...hours);
  fm.writeString(flag, JSON.stringify(sent));
  const todo = list.filter((x) => ['red', 'warn', 'todo'].includes(x.s.lvl)).slice(0, 3);
  if (!todo.length) return;
  const n = new Notification();
  n.title = 'Routine';
  n.body = todo.map(({ r, s }) => `${r.e} ${r.n} ${s.short === '오늘' ? '오늘 아직' : s.short}`).join(' · ');
  n.openURL = 'scriptable:///run/Routine';
  await n.schedule();
}
async function askNotifyOnce() {
  const flag = fm.joinPath(fm.documentsDirectory(), 'routine-notify-ok.txt');
  if (fm.fileExists(flag)) return;
  fm.writeString(flag, '1');
  const n = new Notification();
  n.title = 'Routine';
  n.body = '루틴 알림이 켜졌어요.';
  await n.schedule();
}

// ---------- 실행 ----------
const data = load();
const list = rows(data);
try {
  if (config.runsInWidget) await remind(data, list);
  else if (q.r && (Number(q.h1) || Number(q.h2))) await askNotifyOnce();
} catch (e) {}

const fam = config.widgetFamily || '';
let widget;
if (fam === 'accessoryCircular') widget = circleWidget(list);
else if (fam === 'accessoryInline') widget = inlineWidget(list);
else if (fam === 'small') widget = rectWidget(list, 4, true);
else if (fam === 'medium' || fam === 'large') widget = rectWidget(list, fam === 'large' ? 8 : 4, true);
else widget = rectWidget(list);
widget.refreshAfterDate = new Date(Date.now() + 15 * 60 * 1000);

if (config.runsInWidget) {
  Script.setWidget(widget);
} else if (!q.r) {
  // Scriptable 안에서 직접 실행하면 미리보기
  if (widget.presentAccessoryRectangular) await widget.presentAccessoryRectangular();
  else await widget.presentSmall();
}
Script.complete();

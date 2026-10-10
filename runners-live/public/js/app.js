import { firebaseConfig, AUTO_SEND_MINUTES, STALE_MINUTES } from './firebase-config.js';
import { parseGPX, simplify, buildCourse, encodePts, decodePts, locateOnCourse } from './geo.js';
import { preparePhoto } from './photo.js';

const $ = (id) => document.getElementById(id);
const MIN = 60_000;
const STATUSES = {
  running: { label: '走行中', ic: '🏃' },
  resting: { label: '休憩中', ic: '☕' },
  help: { label: '要サポート', ic: '🆘' },
  retired: { label: 'リタイア', ic: '🏳️' },
  finished: { label: 'ゴール', ic: '🏁' },
};
const COLORS = ['#e53935', '#d81b60', '#8e24aa', '#3949ab', '#1e88e5', '#00897b', '#43a047', '#fb8c00', '#6d4c41', '#37474f'];
const LS = 'runnersLive.profile';

const params = new URLSearchParams(location.search);
const configured = !String(firebaseConfig.apiKey).startsWith('YOUR_');
const DEMO = !configured || params.get('demo') === '1';

const state = {
  backend: null,
  profile: null, // { name, color, room }
  members: new Map(),
  messages: [],
  course: null,
  myStatus: 'running',
  myKm: null,
  lastSentAt: 0,
  lastPos: null,
  joinedAt: Date.now(),
  seenAlerts: new Set(),
  unread: 0,
  tab: 'map',
  side: 'chat',
  wakeLock: null,
};

/* ---------- 小物 ---------- */
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const initial = (name) => (name || '?').trim().slice(0, 1).toUpperCase();
const hhmm = (t) => (t ? new Date(t).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' }) : '--:--');
function ago(t) {
  if (!t) return '未送信';
  const m = Math.floor((Date.now() - t) / MIN);
  if (m < 1) return 'たった今';
  if (m < 60) return `${m}分前`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}時間${m % 60 ? `${m % 60}分` : ''}前` : `${Math.floor(h / 24)}日前`;
}
let toastTimer;
function toast(text, ms = 2600) {
  const el = $('toast');
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, ms);
}
function randomRoom() {
  const words = ['trail', 'run', 'peak', 'ridge', 'forest', 'summit'];
  const w = words[Math.floor(Math.random() * words.length)];
  const n = crypto.getRandomValues(new Uint32Array(1))[0].toString(36).slice(0, 5);
  return `${w}-${n}`;
}
function loadProfile() {
  try { return JSON.parse(localStorage.getItem(LS)) || null; } catch { return null; }
}
function saveProfile(p) {
  try { localStorage.setItem(LS, JSON.stringify(p)); } catch { /* 保存できなくても動かす */ }
}

/* ---------- 参加画面 ---------- */
function showJoin(err) {
  $('app').hidden = true;
  $('joinScreen').hidden = false;
  $('demoNoteJoin').hidden = !DEMO;
  const saved = loadProfile() || {};
  $('joinName').value = saved.name || (DEMO ? 'わたし' : '');
  $('joinRoom').value = params.get('room') || saved.room || (DEMO ? 'demo-room' : '');
  const color = saved.color || COLORS[4];
  $('colorPicker').innerHTML = COLORS.map((c) => `
    <label title="${c}"><input type="radio" name="color" value="${c}" ${c === color ? 'checked' : ''}><span style="background:${c}"></span></label>`).join('');
  if (err) { $('joinError').textContent = err; $('joinError').hidden = false; }
}

$('genRoom').onclick = () => { $('joinRoom').value = randomRoom(); };
$('joinForm').onsubmit = async (e) => {
  e.preventDefault();
  const name = $('joinName').value.trim();
  const room = $('joinRoom').value.trim().toLowerCase();
  const color = (document.querySelector('input[name=color]:checked') || {}).value || COLORS[4];
  if (!name || !/^[a-z0-9_-]{4,32}$/.test(room)) return;
  const btn = e.submitter || $('joinForm').querySelector('button[type=submit]');
  btn.disabled = true;
  btn.textContent = '接続中…';
  try {
    await enterRoom({ name, room, color });
  } catch (err) {
    console.error(err);
    $('joinError').textContent = err.message || String(err);
    $('joinError').hidden = false;
  } finally {
    btn.disabled = false;
    btn.textContent = '参加する';
  }
};

/* ---------- 接続 ---------- */
async function getBackend() {
  if (state.backend) return state.backend;
  if (DEMO) {
    const { createDemoBackend } = await import('./backend-demo.js');
    state.backend = createDemoBackend();
  } else {
    const { createFirebaseBackend } = await import('./backend-firebase.js');
    try {
      state.backend = await createFirebaseBackend(firebaseConfig);
    } catch (e) {
      const code = e.code || '';
      if (code.includes('operation-not-allowed') || code.includes('admin-restricted')) {
        throw new Error('Firebaseの「匿名ログイン」が有効になっていません（README手順3）');
      }
      throw new Error(`Firebaseに接続できませんでした：${code || e.message}`);
    }
  }
  return state.backend;
}

async function enterRoom(profile) {
  const be = await getBackend();
  state.profile = profile;
  const prev = loadProfile();
  if (prev && prev.room === profile.room && prev.status) state.myStatus = prev.status;
  await be.join(profile.room, { name: profile.name, color: profile.color, status: state.myStatus });
  saveProfile({ ...profile, status: state.myStatus });
  state.joinedAt = Date.now();

  $('joinScreen').hidden = true;
  $('app').hidden = false;
  $('roomLabel').textContent = profile.room;
  $('demoBadge').hidden = !DEMO;
  if (!params.get('room')) {
    params.set('room', profile.room);
    history.replaceState(null, '', `?${params}`);
  }

  initMap();
  renderStatusButtons();
  setTab(innerWidth >= 900 ? 'chat' : 'map');

  be.onMembers((list) => { state.members = new Map(list.map((m) => [m.id, m])); renderMembers(); });
  be.onMessages((list) => onMessages(list));
  be.onCourse((c) => setCourse(c));

  sendPosition(false);
  setInterval(autoSendCheck, MIN);
  setInterval(() => { renderMembers(); renderPosInfo(); }, 30_000);
  if (DEMO) setTimeout(() => toast('デモモードです。40秒後に「要サポート」通知の例が流れます', 4000), 800);
}

/* ---------- 地図 ---------- */
let map;
let courseLayer;
let courseMarkers;
const memberMarkers = new Map();
const photoMarkers = new Map();

function initMap() {
  if (map) return;
  if (!window.L) {
    $('map').innerHTML = '<p style="padding:16px">地図を読み込めませんでした。電波の良い場所で再読み込みしてください。</p>';
    return;
  }
  map = L.map('map', { zoomControl: false }).setView([35.68, 139.76], 11);
  L.control.zoom({ position: 'bottomleft' }).addTo(map);
  const gsiAttr = '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank">国土地理院</a>';
  const layers = {
    '地理院地図（標準）': L.tileLayer('https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png', { maxZoom: 18, attribution: gsiAttr }),
    '地理院地図（淡色）': L.tileLayer('https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png', { maxZoom: 18, attribution: gsiAttr }),
    '航空写真': L.tileLayer('https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg', { maxZoom: 18, attribution: gsiAttr }),
    OpenStreetMap: L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' }),
  };
  layers['地理院地図（標準）'].addTo(map);
  L.control.layers(layers, null, { position: 'topright' }).addTo(map);
  courseLayer = L.layerGroup().addTo(map);
  courseMarkers = L.layerGroup().addTo(map);
}

function memberIcon(m) {
  const st = STATUSES[m.status] ? m.status : 'running';
  const stale = m.posAt && Date.now() - m.posAt > STALE_MINUTES * MIN;
  const cls = ['runner-dot', st === 'help' ? 'help' : '', m.id === state.backend.uid ? 'me' : '', stale ? 'stale' : ''].join(' ');
  return L.divIcon({
    className: 'runner-icon',
    iconSize: [34, 34],
    iconAnchor: [17, 17],
    html: `<div class="${cls}" style="background:${esc(m.color || '#555')}">${esc(initial(m.name))}<span class="st st-${st}">${STATUSES[st].ic}</span></div>`,
  });
}

function memberPopup(m) {
  const st = STATUSES[m.status] || STATUSES.running;
  const loc = memberKm(m);
  return `<div class="popup-name">${esc(m.name)}</div>
    <div>${st.ic} ${st.label}</div>
    ${loc ? `<div>${loc.km.toFixed(1)} km地点${loc.offM > 200 ? `（コースから約${Math.round(loc.offM)}m）` : ''}</div>` : ''}
    <div class="muted small">位置：${ago(m.posAt)}（${hhmm(m.posAt)}）${m.acc ? ` 誤差±${Math.round(m.acc)}m` : ''}</div>
    ${m.batt != null ? `<div class="muted small">電池 ${Math.round(m.batt * 100)}%</div>` : ''}`;
}

function updateMemberMarkers() {
  if (!map) return;
  const seen = new Set();
  for (const m of state.members.values()) {
    if (!Number.isFinite(m.lat) || !Number.isFinite(m.lng)) continue;
    seen.add(m.id);
    let mk = memberMarkers.get(m.id);
    if (!mk) {
      mk = L.marker([m.lat, m.lng], { icon: memberIcon(m), zIndexOffset: 500 }).addTo(map).bindPopup('');
      memberMarkers.set(m.id, mk);
    } else {
      mk.setLatLng([m.lat, m.lng]);
      mk.setIcon(memberIcon(m));
    }
    mk.setZIndexOffset(m.status === 'help' ? 2000 : m.id === state.backend.uid ? 1000 : 500);
    mk.setPopupContent(memberPopup(m));
  }
  for (const [id, mk] of memberMarkers) {
    if (!seen.has(id)) { mk.remove(); memberMarkers.delete(id); }
  }
}

let fittedOnce = false;
function fitAll() {
  if (!map) return;
  const pts = [...state.members.values()].filter((m) => Number.isFinite(m.lat)).map((m) => [m.lat, m.lng]);
  if (pts.length === 1) map.setView(pts[0], 14);
  else if (pts.length) map.fitBounds(pts, { padding: [50, 50], maxZoom: 15 });
}
function fitCourse() {
  if (map && state.course) map.fitBounds(state.course.pts, { padding: [30, 30] });
}
function focusMember(id) {
  const m = state.members.get(id);
  if (!m || !Number.isFinite(m.lat)) { toast('この人の位置はまだ届いていません'); return; }
  setTab('map');
  map.setView([m.lat, m.lng], Math.max(map.getZoom(), 15));
  const mk = memberMarkers.get(id);
  if (mk) mk.openPopup();
}
function focusPoint(lat, lng, html) {
  setTab('map');
  map.setView([lat, lng], Math.max(map.getZoom(), 15));
  L.popup().setLatLng([lat, lng]).setContent(html).openOn(map);
}
$('fitAllBtn').onclick = fitAll;
$('fitCourseBtn').onclick = () => (state.course ? fitCourse() : toast('コースが未登録です（メニューからGPXを読み込めます）'));
$('meBtn').onclick = () => focusMember(state.backend.uid);

/* ---------- コース ---------- */
function setCourse(doc) {
  if (!doc || !doc.pts) {
    state.course = null;
  } else {
    try { state.course = buildCourse(decodePts(doc.pts), doc.name || ''); } catch { state.course = null; }
  }
  if (!map) return;
  courseLayer.clearLayers();
  courseMarkers.clearLayers();
  if (state.course) {
    const c = state.course;
    L.polyline(c.pts, { color: '#fff', weight: 8, opacity: 0.8 }).addTo(courseLayer);
    L.polyline(c.pts, { color: '#e65100', weight: 4 }).addTo(courseLayer);
    const flag = (p, t) => L.marker(p, { icon: L.divIcon({ className: 'course-flag', html: t, iconSize: [24, 24], iconAnchor: [4, 22] }) }).addTo(courseMarkers);
    flag(c.pts[0], '🚩');
    flag(c.pts[c.pts.length - 1], '🏁');
    // 5kmごとの目印
    const step = c.total > 60000 ? 10 : 5;
    for (let km = step; km < c.total / 1000; km += step) {
      const i = c.cum.findIndex((d) => d >= km * 1000);
      if (i > 0) L.marker(c.pts[i], { icon: L.divIcon({ className: '', html: `<span class="km-label">${km}km</span>`, iconSize: null }), interactive: false }).addTo(courseMarkers);
    }
    if (!fittedOnce) { map.invalidateSize(); fitCourse(); fittedOnce = true; }
  }
  renderMembers();
}

$('gpxInput').onchange = async (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  try {
    const { name, points } = parseGPX(await f.text());
    const pts = simplify(points);
    const c = buildCourse(pts);
    const label = name || f.name.replace(/\.gpx$/i, '');
    if (!confirm(`「${label}」（${(c.total / 1000).toFixed(1)}km）をこのルームのコースにします。全員の表示が置き換わります。よろしいですか？`)) return;
    await state.backend.setCourse({ name: label, pts: encodePts(pts), total: c.total });
    fittedOnce = false;
    closeMenu();
    toast('コースを登録しました');
    setTimeout(fitCourse, 300);
  } catch (err) {
    alert(err.message || 'GPXを読み込めませんでした');
  }
};
$('clearCourseBtn').onclick = async () => {
  if (!state.course) { toast('コースは登録されていません'); return; }
  if (!confirm('このルームのコースを削除します。よろしいですか？')) return;
  await state.backend.clearCourse();
  closeMenu();
  toast('コースを削除しました');
};

function memberKm(m) {
  if (!state.course || !Number.isFinite(m.lat)) return null;
  return locateOnCourse(state.course, m.lat, m.lng, Number.isFinite(m.km) ? m.km : null);
}

/* ---------- メンバー一覧 ---------- */
const ORDER = { help: 0, running: 1, resting: 2, finished: 3, retired: 4 };
function renderMembers() {
  updateMemberMarkers();
  const total = state.course ? state.course.total / 1000 : null;
  $('courseSummary').innerHTML = state.course
    ? `🗺️ <b>${esc(state.course.name || 'コース')}</b>　全長 ${total.toFixed(1)} km`
    : '<span class="muted">コース未登録（メニュー ☰ からGPXを読み込むと「何km地点」が出ます）</span>';
  const list = [...state.members.values()].map((m) => ({ m, loc: memberKm(m) }));
  list.sort((a, b) => (ORDER[a.m.status] ?? 9) - (ORDER[b.m.status] ?? 9) || (b.loc?.km ?? -1) - (a.loc?.km ?? -1) || String(a.m.name).localeCompare(b.m.name, 'ja'));
  $('memberList').innerHTML = list.map(({ m, loc }) => {
    const st = STATUSES[m.status] || STATUSES.running;
    const me = m.id === state.backend.uid;
    const kmHtml = loc
      ? `${loc.km.toFixed(1)}<small>km地点</small>`
      : Number.isFinite(m.lat) ? '<small>位置あり</small>' : '<small>位置未送信</small>';
    const pct = loc && total ? Math.min(100, (loc.km / total) * 100) : null;
    return `<li class="member ${m.status === 'help' ? 'help' : ''}" data-id="${esc(m.id)}">
      <div class="avatar" style="background:${esc(m.color || '#555')}">${esc(initial(m.name))}</div>
      <div class="info">
        <div class="name">${esc(m.name)}${me ? '（自分）' : ''}<span class="chip st-${esc(m.status || 'running')}">${st.ic} ${st.label}</span></div>
        <div class="sub">位置 ${ago(m.posAt)}${m.posAt ? `（${hhmm(m.posAt)}）` : ''}${loc && loc.offM > 200 ? `・コース外 約${Math.round(loc.offM)}m` : ''}${m.batt != null ? `・🔋${Math.round(m.batt * 100)}%` : ''}</div>
        ${pct != null ? `<div class="progress"><i style="width:${pct.toFixed(1)}%"></i></div>` : ''}
      </div>
      <div class="km">${kmHtml}</div>
    </li>`;
  }).join('');
}
$('memberList').onclick = (e) => {
  const li = e.target.closest('.member');
  if (li) focusMember(li.dataset.id);
};

/* ---------- 位置送信 ---------- */
async function battery() {
  try { return navigator.getBattery ? (await navigator.getBattery()).level : null; } catch { return null; }
}

let sending = false;
function sendPosition(manual) {
  if (sending) return;
  if (!('geolocation' in navigator)) {
    if (manual) toast('この端末では位置情報が使えません');
    return;
  }
  sending = true;
  const btn = $('sendPosBtn');
  if (manual) { btn.disabled = true; btn.textContent = '📍 位置を取得中…'; }
  const done = () => { sending = false; btn.disabled = false; btn.textContent = '📍 今の位置を送信'; };
  navigator.geolocation.getCurrentPosition(async (pos) => {
    const { latitude: lat, longitude: lng, accuracy } = pos.coords;
    const fields = { lat, lng, acc: Math.round(accuracy), posAt: pos.timestamp || Date.now(), status: state.myStatus };
    if (state.course) {
      const loc = locateOnCourse(state.course, lat, lng, state.myKm);
      if (loc) { fields.km = Math.round(loc.km * 100) / 100; state.myKm = loc.km; }
    }
    const b = await battery();
    if (b != null) fields.batt = Math.round(b * 100) / 100;
    state.backend.updateMe(fields);
    state.lastSentAt = Date.now();
    state.lastPos = { lat, lng };
    renderPosInfo();
    done();
    if (manual) toast(navigator.onLine ? '位置を送信しました' : '圏外のため端末に保存しました。電波が戻ると自動で送信します', 3500);
  }, (err) => {
    done();
    if (DEMO && !state.lastPos) {
      // デモ：位置が取れない環境では、コース上の仮の位置を使う
      const c = state.backend.demoCourse;
      const p = c.pts[Math.floor(c.pts.length * 0.3)];
      state.backend.updateMe({ lat: p[0], lng: p[1], acc: 20, posAt: Date.now(), status: state.myStatus });
      state.lastSentAt = Date.now();
      state.lastPos = { lat: p[0], lng: p[1] };
      renderPosInfo();
      if (manual) toast('デモ：位置が取得できないため、コース上の仮の位置を使いました', 3500);
      return;
    }
    const msg = err.code === 1
      ? '位置情報の利用が許可されていません。ブラウザの設定で許可してください'
      : '位置を取得できませんでした。空の見える場所でもう一度お試しください';
    if (manual) alert(msg); else toast(msg, 4000);
  }, { enableHighAccuracy: true, timeout: 25_000, maximumAge: manual ? 0 : 60_000 });
}
function autoSendCheck() {
  if (document.visibilityState === 'visible' && Date.now() - state.lastSentAt >= AUTO_SEND_MINUTES * MIN) sendPosition(false);
  renderPosInfo();
}
function renderPosInfo() {
  const next = state.lastSentAt ? state.lastSentAt + AUTO_SEND_MINUTES * MIN : null;
  $('posInfo').textContent = state.lastSentAt
    ? `最終送信 ${hhmm(state.lastSentAt)}・次の自動送信 ${hhmm(next)}ごろ（画面表示中のみ）`
    : '位置はまだ送信されていません';
}
$('sendPosBtn').onclick = () => sendPosition(true);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state.backend && state.profile) {
    autoSendCheck();
    if ($('wakeToggle').checked) requestWake();
  }
});

/* ---------- 状態 ---------- */
function renderStatusButtons() {
  $('statusButtons').innerHTML = Object.entries(STATUSES).map(([k, s]) => `
    <button data-st="${k}" style="--c:var(--st-${k})" class="${k === state.myStatus ? 'active' : ''}"><span class="ic">${s.ic}</span>${s.label}</button>`).join('');
}
$('statusButtons').onclick = (e) => {
  const btn = e.target.closest('button[data-st]');
  if (!btn) return;
  const st = btn.dataset.st;
  if (st === state.myStatus) return;
  if (st === 'help' && !confirm('「要サポート」にすると、全員に通知が流れ、地図のマーカーが点滅します。\n本当に危険なときは、先に電話（110／119）や大会本部へ連絡してください。\n\n要サポートにしますか？')) return;
  if (st === 'retired' && !confirm('「リタイア」にしますか？')) return;
  const prev = state.myStatus;
  state.myStatus = st;
  renderStatusButtons();
  state.backend.updateMe({ status: st });
  saveProfile({ ...state.profile, status: st });
  const me = state.members.get(state.backend.uid) || {};
  const name = state.profile.name;
  if (st === 'help') {
    const loc = memberKm(me);
    state.backend.sendMessage({
      type: 'alert', name,
      text: `${name} さんが「要サポート」になりました${loc ? `（${loc.km.toFixed(1)}km地点）` : ''}`,
      ...(state.lastPos || {}),
    });
    sendPosition(true);
  } else {
    state.backend.sendMessage({
      type: 'system', name,
      text: prev === 'help' ? `${name} さんの「要サポート」が解除されました（${STATUSES[st].label}）` : `${name} さんが「${STATUSES[st].label}」になりました`,
    });
  }
};

/* ---------- チャット ---------- */
let lastRenderedCount = 0;
function onMessages(list) {
  const prevIds = new Set(state.messages.map((m) => m.id));
  state.messages = list;
  const fresh = list.filter((m) => !prevIds.has(m.id));
  for (const m of fresh) {
    if (m.type === 'alert' && m.uid !== state.backend.uid && !state.seenAlerts.has(m.id) && (m.clientAt || m.createdAt) > state.joinedAt - 5 * MIN) {
      state.seenAlerts.add(m.id);
      showAlert(m);
    }
  }
  const chatVisible = innerWidth >= 900 ? state.side === 'chat' : state.tab === 'chat';
  if (lastRenderedCount && !chatVisible) {
    state.unread += fresh.filter((m) => m.uid !== state.backend.uid).length;
  }
  lastRenderedCount = list.length;
  renderUnread();
  renderMessages();
  updatePhotoMarkers();
}

function renderMessages() {
  const ul = $('messages');
  const atBottom = ul.scrollHeight - ul.scrollTop - ul.clientHeight < 80;
  const me = state.backend.uid;
  ul.innerHTML = state.messages.map((m) => {
    const mine = m.uid === me;
    const cls = ['msg', mine ? 'mine' : '', m.type === 'system' ? 'system' : '', m.type === 'alert' ? 'alert' : '', m.pending ? 'pending' : ''].join(' ');
    if (m.type === 'system') return `<li class="${cls}"><div class="bubble">${esc(m.text)}・${hhmm(m.createdAt)}</div></li>`;
    const who = `<div class="who"><b>${esc(m.name)}</b> ${hhmm(m.createdAt)}${m.pending ? ' 送信待ち' : ''}</div>`;
    const hasLoc = Number.isFinite(m.lat) && Number.isFinite(m.lng);
    if (m.type === 'alert') {
      return `<li class="${cls}">${who}<div class="bubble">🆘 ${esc(m.text)}
        ${hasLoc ? `<br><button class="loc" data-loc="${m.id}">📍 地図で見る</button>` : ''}</div></li>`;
    }
    if (m.type === 'photo') {
      return `<li class="${cls}">${who}<div class="bubble">
        <img src="${esc(m.thumb)}" data-photo="${m.id}" alt="写真" loading="lazy">
        ${m.text ? `<div class="cap">${esc(m.text)}</div>` : ''}
        ${hasLoc ? `<button class="loc" data-loc="${m.id}">📍 撮影地点を見る</button>` : '<div class="muted small">位置情報なし</div>'}
      </div></li>`;
    }
    return `<li class="${cls}">${who}<div class="bubble text">${esc(m.text)}</div></li>`;
  }).join('');
  if (atBottom || !renderMessages.done) ul.scrollTop = ul.scrollHeight;
  renderMessages.done = true;
}

$('messages').onclick = (e) => {
  const photo = e.target.closest('[data-photo]');
  const loc = e.target.closest('[data-loc]');
  const id = (photo || loc)?.dataset.photo || loc?.dataset.loc;
  const m = state.messages.find((x) => x.id === id);
  if (!m) return;
  if (photo) openPhoto(m);
  else if (loc) showMessageOnMap(m);
};

function showMessageOnMap(m) {
  if (m.type === 'photo') {
    focusPoint(m.lat, m.lng, `<b>${esc(m.name)}</b> ${hhmm(m.createdAt)}<img class="popup-photo" src="${esc(m.thumb)}" data-popup-photo="${m.id}">${m.text ? `<div>${esc(m.text)}</div>` : ''}`);
  } else {
    focusPoint(m.lat, m.lng, `🆘 <b>${esc(m.name)}</b> ${hhmm(m.createdAt)}<br>${esc(m.text)}`);
  }
}
document.addEventListener('click', (e) => {
  const img = e.target.closest('[data-popup-photo]');
  if (img) {
    const m = state.messages.find((x) => x.id === img.dataset.popupPhoto);
    if (m) openPhoto(m);
  }
});

function updatePhotoMarkers() {
  if (!map) return;
  const ids = new Set();
  for (const m of state.messages) {
    if (m.type !== 'photo' || !Number.isFinite(m.lat)) continue;
    ids.add(m.id);
    if (photoMarkers.has(m.id)) continue;
    const mk = L.marker([m.lat, m.lng], { icon: L.divIcon({ className: 'photo-pin', html: '📷', iconSize: [24, 24], iconAnchor: [12, 12] }) })
      .addTo(map)
      .bindPopup(`<b>${esc(m.name)}</b> ${hhmm(m.createdAt)}<img class="popup-photo" src="${esc(m.thumb)}" data-popup-photo="${m.id}">${m.text ? `<div>${esc(m.text)}</div>` : ''}`);
    photoMarkers.set(m.id, mk);
  }
  for (const [id, mk] of photoMarkers) if (!ids.has(id)) { mk.remove(); photoMarkers.delete(id); }
}

$('chatForm').onsubmit = (e) => {
  e.preventDefault();
  const text = $('chatInput').value.trim();
  if (!text) return;
  state.backend.sendMessage({ type: 'text', name: state.profile.name, text });
  $('chatInput').value = '';
};

$('photoInput').onchange = async (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  if (!f.type.startsWith('image/')) { alert('画像ファイルを選んでください'); return; }
  toast('写真を圧縮しています…', 10_000);
  try {
    const { full, thumb, gps } = await preparePhoto(f);
    const where = gps || state.lastPos;
    const caption = prompt(`ひとこと添えますか？（空欄でもOK）${gps ? '' : where ? '\n※写真に位置情報がないため、最後に送信した現在地を撮影地点にします' : '\n※位置情報なしで投稿します'}`, '');
    if (caption === null) { toast('投稿を取り消しました'); return; }
    state.backend.sendPhoto({ name: state.profile.name, text: caption.trim().slice(0, 200), full, thumb, ...(where ? { lat: where.lat, lng: where.lng } : {}) });
    toast(`写真を投稿しました（${Math.round((full.length * 3) / 4 / 1024)}KB に圧縮）`);
  } catch (err) {
    console.error(err);
    alert('写真を処理できませんでした。別の写真でお試しください');
  }
};

async function openPhoto(m) {
  $('viewerImg').src = m.thumb;
  $('viewerMeta').textContent = `${m.name}・${hhmm(m.createdAt)}${m.text ? `「${m.text}」` : ''}`;
  $('viewerMap').hidden = !Number.isFinite(m.lat);
  $('viewerMap').onclick = () => { $('photoViewer').hidden = true; showMessageOnMap(m); };
  $('photoViewer').hidden = false;
  try {
    const full = await state.backend.getPhoto(m.photoId);
    if (full && !$('photoViewer').hidden) $('viewerImg').src = full;
    else if (!full) $('viewerMeta').textContent += '（高画質版はまだ届いていません）';
  } catch {
    $('viewerMeta').textContent += '（高画質版を読み込めませんでした）';
  }
}
$('viewerClose').onclick = () => { $('photoViewer').hidden = true; };
$('photoViewer').onclick = (e) => { if (e.target.id === 'photoViewer') $('photoViewer').hidden = true; };

/* ---------- 要サポート通知 ---------- */
let alertMsg = null;
function showAlert(m) {
  alertMsg = m;
  $('alertText').textContent = `🆘 ${m.text}`;
  $('alertShow').hidden = !Number.isFinite(m.lat);
  $('alertBanner').hidden = false;
  try { navigator.vibrate?.([300, 150, 300, 150, 300]); } catch { /* 非対応 */ }
  beep();
  if (document.visibilityState !== 'visible' && 'Notification' in window && Notification.permission === 'granted') {
    try { new Notification('ランナーズ・ライブ：要サポート', { body: m.text, tag: m.id }); } catch { /* 非対応 */ }
  }
}
function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [0, 0.35, 0.7].forEach((t) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = 880;
      g.gain.value = 0.15;
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + t);
      o.stop(ctx.currentTime + t + 0.2);
    });
  } catch { /* 音が出せない端末は無音 */ }
}
$('alertShow').onclick = () => {
  if (!alertMsg) return;
  const m = state.members.get(alertMsg.uid);
  if (m && Number.isFinite(m.lat)) focusMember(m.id);
  else showMessageOnMap(alertMsg);
};
$('alertClose').onclick = () => { $('alertBanner').hidden = true; };

/* ---------- タブ ---------- */
function setTab(tab) {
  if (innerWidth >= 900) {
    if (tab !== 'map') state.side = tab;
  } else {
    state.tab = tab;
  }
  document.body.classList.remove('tab-map', 'tab-chat', 'tab-members', 'side-chat', 'side-members');
  document.body.classList.add(`tab-${state.tab}`, `side-${state.side}`);
  document.querySelectorAll('.tabbar button').forEach((b) => b.classList.toggle('active', b.dataset.tab === state.tab));
  document.querySelectorAll('.side-tabs button').forEach((b) => b.classList.toggle('active', b.dataset.side === state.side));
  const chatVisible = innerWidth >= 900 ? state.side === 'chat' : state.tab === 'chat';
  if (chatVisible) {
    state.unread = 0;
    renderUnread();
    const ul = $('messages');
    requestAnimationFrame(() => { ul.scrollTop = ul.scrollHeight; });
  }
  if (map) setTimeout(() => map.invalidateSize(), 50);
}
function renderUnread() {
  $('unreadBadge').hidden = !state.unread;
  $('unreadBadge').textContent = state.unread > 99 ? '99+' : state.unread;
}
document.querySelectorAll('.tabbar button').forEach((b) => { b.onclick = () => setTab(b.dataset.tab); });
document.querySelectorAll('.side-tabs button').forEach((b) => { b.onclick = () => setTab(b.dataset.side); });
addEventListener('resize', () => { if (state.profile) setTab(innerWidth >= 900 ? state.side : state.tab); });

/* ---------- メニュー ---------- */
function closeMenu() { $('menu').hidden = true; }
$('menuBtn').onclick = () => {
  $('menuMe').textContent = `${state.profile.name}／ルーム #${state.profile.room}${DEMO ? '（デモモード）' : ''}`;
  $('notifyBtn').hidden = !('Notification' in window) || Notification.permission === 'granted';
  $('menu').hidden = false;
};
$('menuClose').onclick = closeMenu;
$('menu').onclick = (e) => { if (e.target.id === 'menu') closeMenu(); };
$('notifyBtn').onclick = async () => {
  try {
    const r = await Notification.requestPermission();
    toast(r === 'granted' ? '通知を許可しました（アプリを開いている間のみ届きます）' : '通知は許可されませんでした');
  } catch { toast('この端末ではブラウザ通知が使えません'); }
  closeMenu();
};
async function requestWake() {
  try {
    state.wakeLock = await navigator.wakeLock.request('screen');
  } catch {
    $('wakeToggle').checked = false;
    toast('この端末では画面の常時点灯が使えません');
  }
}
$('wakeToggle').onchange = async (e) => {
  if (e.target.checked) { await requestWake(); if (state.wakeLock) toast('画面を消さない設定にしました'); } else { await state.wakeLock?.release().catch(() => {}); state.wakeLock = null; }
};
$('copyLinkBtn').onclick = async () => {
  const url = `${location.origin}${location.pathname}?room=${encodeURIComponent(state.profile.room)}`;
  try { await navigator.clipboard.writeText(url); toast('招待リンクをコピーしました'); } catch { prompt('このリンクを共有してください', url); }
  closeMenu();
};
$('leaveBtn').onclick = async () => {
  if (!confirm('このルームを退出しますか？（地図とメンバー一覧から自分が消えます）')) return;
  await state.backend.leave();
  saveProfile({ ...state.profile, room: '', status: 'running' });
  params.delete('room');
  location.href = location.pathname + (params.toString() ? `?${params}` : '');
};

/* ---------- 通信状態 ---------- */
function renderNet() { $('netBadge').hidden = navigator.onLine; }
addEventListener('online', () => { renderNet(); toast('電波が戻りました。保存していた内容を送信します'); });
addEventListener('offline', renderNet);
renderNet();

/* ---------- 起動 ---------- */
(async () => {
  const saved = loadProfile();
  const room = (params.get('room') || '').toLowerCase();
  if (saved && saved.name && saved.room && (!room || room === saved.room)) {
    try {
      await enterRoom({ name: saved.name, room: saved.room, color: saved.color || COLORS[4] });
      return;
    } catch (e) {
      console.error(e);
      showJoin(e.message);
      return;
    }
  }
  showJoin();
})();

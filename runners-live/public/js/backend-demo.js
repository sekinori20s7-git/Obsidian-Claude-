// デモモード：Firebaseなしで、端末の中だけで動く。ダミーのメンバーがコース上を進む。
import { buildCourse, encodePts, pointAtKm } from './geo.js';
import { demoCoursePoints } from './demo-course.js';

const MIN = 60_000;

function demoPhoto(label, hue) {
  const c = document.createElement('canvas');
  c.width = 640;
  c.height = 480;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 480);
  grad.addColorStop(0, `hsl(${hue},70%,72%)`);
  grad.addColorStop(1, `hsl(${hue + 40},45%,38%)`);
  g.fillStyle = grad;
  g.fillRect(0, 0, 640, 480);
  g.fillStyle = 'rgba(30,50,40,.75)';
  g.beginPath();
  g.moveTo(0, 400); g.lineTo(180, 220); g.lineTo(300, 330); g.lineTo(450, 170); g.lineTo(640, 380); g.lineTo(640, 480); g.lineTo(0, 480);
  g.fill();
  g.fillStyle = '#fff';
  g.font = 'bold 40px sans-serif';
  g.fillText(label, 30, 70);
  g.font = '20px sans-serif';
  g.fillText('（デモ用の画像）', 30, 105);
  return c.toDataURL('image/jpeg', 0.8);
}

export function createDemoBackend() {
  const uid = 'me';
  const course = buildCourse(demoCoursePoints(), 'デモコース（高尾〜陣馬 付近の参考線）');
  const now = Date.now();
  const listeners = { members: [], messages: [], course: [] };
  const photos = new Map();
  let members = new Map();
  let messages = [];
  let seq = 0;
  const timers = [];

  const bots = [
    { id: 'bot1', name: 'さとう', color: '#e53935', km: 9.2, speed: 0.03, status: 'running' },
    { id: 'bot2', name: 'たなか', color: '#8e24aa', km: 6.4, speed: 0.025, status: 'running' },
    { id: 'bot3', name: 'すずき', color: '#fb8c00', km: 4.1, speed: 0.02, status: 'running' },
    { id: 'bot4', name: 'やまだ', color: '#3949ab', km: 7.7, speed: 0, status: 'resting' },
    { id: 'bot5', name: 'こばやし', color: '#00897b', km: course.total / 1000, speed: 0, status: 'finished' },
  ];

  const botDoc = (b, t = Date.now()) => {
    const p = pointAtKm(course, b.km);
    const j = Math.sin(t / 7000 + b.km) * 0.00008;
    return {
      id: b.id, name: b.name, color: b.color, status: b.status,
      lat: p[0] + j, lng: p[1] - j, acc: 12, posAt: t, updatedAt: t, km: b.km, batt: 0.4 + (b.km % 0.5),
    };
  };
  bots.forEach((b) => members.set(b.id, botDoc(b, now - Math.round(Math.random() * 8) * MIN)));

  const emitMembers = () => listeners.members.forEach((cb) => cb([...members.values()]));
  const emitMessages = () => listeners.messages.forEach((cb) => cb(messages.slice(-150)));
  const push = (m) => {
    const t = m.createdAt || Date.now();
    messages.push({ id: `m${++seq}`, createdAt: t, clientAt: t, ...m });
    messages.sort((a, b) => a.createdAt - b.createdAt);
    emitMessages();
  };

  // 最初から入っている会話
  const p1 = demoPhoto('高尾山 付近', 190);
  photos.set('p1', p1);
  const at = (km) => pointAtKm(course, km);
  [
    { uid: 'bot1', name: 'さとう', type: 'text', text: 'スタートしました！今日もよろしくお願いします', ago: 95 },
    { uid: 'bot2', name: 'たなか', type: 'text', text: '曇りで走りやすいです', ago: 70 },
    { uid: 'bot1', name: 'さとう', type: 'photo', photoId: 'p1', thumb: p1, text: '山頂付近、眺め良いです', lat: at(4.2)[0], lng: at(4.2)[1], ago: 48 },
    { uid: 'bot4', name: 'やまだ', type: 'system', text: 'やまだ さんが「休憩中」になりました', ago: 15 },
    { uid: 'bot4', name: 'やまだ', type: 'text', text: 'エイドで補給中。10分ほど休みます', ago: 14 },
    { uid: 'bot5', name: 'こばやし', type: 'system', text: 'こばやし さんが「ゴール」になりました', ago: 6 },
  ].forEach(({ ago, ...m }) => push({ ...m, createdAt: now - ago * MIN }));

  const chatter = ['給水ポイント通過', 'ここから登りきついです', '景色最高！', '少しペース落とします', 'ジェル補給しました'];

  const start = () => {
    // ダミーのメンバーを少しずつ進める
    timers.push(setInterval(() => {
      const t = Date.now();
      bots.forEach((b) => {
        if (b.status !== 'running') return;
        b.km = Math.min(course.total / 1000, b.km + b.speed);
        members.set(b.id, botDoc(b, t));
      });
      emitMembers();
    }, 3000));
    // ときどき発言する
    timers.push(setInterval(() => {
      const b = bots[Math.floor(Math.random() * 3)];
      push({ uid: b.id, name: b.name, type: 'text', text: chatter[Math.floor(Math.random() * chatter.length)] });
    }, 45_000));
    // 40秒後に「要サポート」の例を出し、80秒後に解除
    timers.push(setTimeout(() => {
      const b = bots[2];
      b.status = 'help';
      members.set(b.id, botDoc(b));
      emitMembers();
      const p = members.get(b.id);
      push({ uid: b.id, name: b.name, type: 'alert', text: `${b.name} さんが「要サポート」になりました（${b.km.toFixed(1)}km地点）`, lat: p.lat, lng: p.lng });
      push({ uid: b.id, name: b.name, type: 'text', text: '足をつりました。少し歩きます（これはデモの例です）' });
    }, 40_000));
    timers.push(setTimeout(() => {
      const b = bots[2];
      b.status = 'running';
      members.set(b.id, botDoc(b));
      emitMembers();
      push({ uid: b.id, name: b.name, type: 'system', text: `${b.name} さんが「走行中」になりました` });
    }, 80_000));
  };

  return {
    mode: 'demo',
    uid,
    demoCourse: course,

    async join(_room, profile) {
      members.set(uid, { id: uid, ...members.get(uid), ...profile, updatedAt: Date.now() });
      start();
    },
    updateMe(fields) {
      members.set(uid, { ...members.get(uid), ...fields, id: uid, updatedAt: Date.now() });
      setTimeout(emitMembers, 0);
    },
    onMembers(cb) { listeners.members.push(cb); setTimeout(emitMembers, 0); },
    onMessages(cb) { listeners.messages.push(cb); setTimeout(emitMessages, 0); },
    sendMessage(msg) {
      const id = `m${seq + 1}`;
      push({ ...msg, uid });
      return id;
    },
    sendPhoto({ full, thumb, ...msg }) {
      const pid = `p${Date.now()}`;
      photos.set(pid, full);
      return this.sendMessage({ ...msg, type: 'photo', photoId: pid, thumb });
    },
    async getPhoto(id) { return photos.get(id) || null; },
    onCourse(cb) {
      listeners.course.push(cb);
      setTimeout(() => cb(this._course === undefined ? { name: course.name, pts: encodePts(course.pts) } : this._course), 0);
    },
    async setCourse(c) { this._course = c; listeners.course.forEach((cb) => cb(c)); },
    async clearCourse() { this._course = null; listeners.course.forEach((cb) => cb(null)); },
    async leave() {
      timers.splice(0).forEach((t) => { clearInterval(t); clearTimeout(t); });
      listeners.members = []; listeners.messages = []; listeners.course = [];
      members = new Map(); messages = [];
    },
  };
}

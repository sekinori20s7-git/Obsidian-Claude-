// 位置・コース計算のユーティリティ

const R = 6371000; // 地球半径（m）
const rad = (d) => (d * Math.PI) / 180;

/** 2点間の距離（m） */
export function distance(a, b) {
  const dLat = rad(b[0] - a[0]);
  const dLng = rad(b[1] - a[1]);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** GPX文字列から [[lat,lng], ...] とコース名を取り出す（trk → rte → wpt の順に探す） */
export function parseGPX(text) {
  const xml = new DOMParser().parseFromString(text, 'application/xml');
  if (xml.getElementsByTagName('parsererror').length) throw new Error('GPXファイルを読み取れませんでした');
  let nodes = [...xml.getElementsByTagName('trkpt')];
  if (!nodes.length) nodes = [...xml.getElementsByTagName('rtept')];
  if (!nodes.length) nodes = [...xml.getElementsByTagName('wpt')];
  const points = nodes
    .map((n) => [parseFloat(n.getAttribute('lat')), parseFloat(n.getAttribute('lon'))])
    .filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b));
  if (points.length < 2) throw new Error('GPXにコースの座標が見つかりませんでした');
  const nameEl = xml.querySelector('trk > name, rte > name, metadata > name');
  return { name: nameEl ? nameEl.textContent.trim() : '', points };
}

/** 点を間引く（minDist m 未満の点を省き、最大 maxPoints 点に収める） */
export function simplify(points, minDist = 10, maxPoints = 5000) {
  let md = minDist;
  let out;
  do {
    out = [points[0]];
    for (let i = 1; i < points.length - 1; i++) {
      if (distance(out[out.length - 1], points[i]) >= md) out.push(points[i]);
    }
    out.push(points[points.length - 1]);
    md *= 1.5;
  } while (out.length > maxPoints);
  return out.map(([a, b]) => [Math.round(a * 1e5) / 1e5, Math.round(b * 1e5) / 1e5]);
}

/** 累積距離つきのコースを作る */
export function buildCourse(points, name = '') {
  const cum = [0];
  for (let i = 1; i < points.length; i++) cum.push(cum[i - 1] + distance(points[i - 1], points[i]));
  return { name, pts: points, cum, total: cum[cum.length - 1] };
}

/** 保存用の文字列 ⇔ 座標配列 */
export const encodePts = (pts) => pts.map(([a, b]) => `${a},${b}`).join(';');
export const decodePts = (s) => s.split(';').map((p) => p.split(',').map(Number));

/**
 * コース上の位置を求める。
 * 往復コースや周回コースで同じ場所を2回通る場合は、前回のkm（prevKm）に近い側を選ぶ。
 * @returns {{km:number, offM:number, point:[number,number]}|null}
 */
export function locateOnCourse(course, lat, lng, prevKm = null) {
  if (!course || course.pts.length < 2) return null;
  const k = Math.cos(rad(lat));
  const toXY = ([a, b]) => [rad(b) * k * R, rad(a) * R];
  const p = toXY([lat, lng]);
  const cands = [];
  let best = Infinity;
  for (let i = 0; i < course.pts.length - 1; i++) {
    const a = toXY(course.pts[i]);
    const b = toXY(course.pts[i + 1]);
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2)) : 0;
    const qx = a[0] + t * dx;
    const qy = a[1] + t * dy;
    const d = Math.hypot(p[0] - qx, p[1] - qy);
    const m = course.cum[i] + t * (course.cum[i + 1] - course.cum[i]);
    cands.push({ d, m, i, t });
    if (d < best) best = d;
  }
  // 最短距離＋50m以内の候補から選ぶ
  const near = cands.filter((c) => c.d <= best + 50);
  let pick;
  if (prevKm != null && near.length > 1) {
    const prevM = prevKm * 1000;
    // 少し戻る（-300m）までは許し、前回地点から先で一番近い候補
    const ahead = near.filter((c) => c.m >= prevM - 300).sort((x, y) => x.m - y.m);
    pick = ahead[0] || near.sort((x, y) => Math.abs(x.m - prevM) - Math.abs(y.m - prevM))[0];
  } else {
    pick = near.sort((x, y) => x.d - y.d || x.m - y.m)[0];
  }
  const a = course.pts[pick.i];
  const b = course.pts[pick.i + 1];
  return {
    km: pick.m / 1000,
    offM: pick.d,
    point: [a[0] + (b[0] - a[0]) * pick.t, a[1] + (b[1] - a[1]) * pick.t],
  };
}

/** コース上の指定km地点の座標 */
export function pointAtKm(course, km) {
  const m = km * 1000;
  for (let i = 1; i < course.cum.length; i++) {
    if (course.cum[i] >= m) {
      const seg = course.cum[i] - course.cum[i - 1] || 1;
      const t = (m - course.cum[i - 1]) / seg;
      const a = course.pts[i - 1];
      const b = course.pts[i];
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    }
  }
  return course.pts[course.pts.length - 1];
}

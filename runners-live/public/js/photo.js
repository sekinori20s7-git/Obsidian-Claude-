// 写真の圧縮と、撮影地点（EXIFのGPS）の読み取り

/** JPEGのEXIFからGPS座標を読む。なければ null */
export function readExifGps(buf) {
  try {
    const v = new DataView(buf);
    if (v.getUint16(0) !== 0xffd8) return null;
    let off = 2;
    while (off + 4 < v.byteLength) {
      const marker = v.getUint16(off);
      const size = v.getUint16(off + 2);
      if (marker === 0xffe1 && v.getUint32(off + 4) === 0x45786966) return parseTiff(v, off + 10);
      if ((marker & 0xff00) !== 0xff00) break;
      off += 2 + size;
    }
  } catch { /* 読めなければ位置なし */ }
  return null;
}

function parseTiff(v, start) {
  const le = v.getUint16(start) === 0x4949;
  const u16 = (o) => v.getUint16(start + o, le);
  const u32 = (o) => v.getUint32(start + o, le);
  const findTag = (ifd, tag) => {
    const n = u16(ifd);
    for (let i = 0; i < n; i++) {
      const e = ifd + 2 + i * 12;
      if (u16(e) === tag) return e;
    }
    return null;
  };
  const gpsEntry = findTag(u32(4), 0x8825);
  if (gpsEntry == null) return null;
  const gps = u32(gpsEntry + 8);
  const ref = (tag) => {
    const e = findTag(gps, tag);
    return e == null ? null : String.fromCharCode(v.getUint8(start + e + 8));
  };
  const dms = (tag) => {
    const e = findTag(gps, tag);
    if (e == null) return null;
    const o = u32(e + 8);
    const r = (i) => u32(o + i * 8) / (u32(o + i * 8 + 4) || 1);
    return r(0) + r(1) / 60 + r(2) / 3600;
  };
  let lat = dms(2);
  let lng = dms(4);
  if (lat == null || lng == null || (lat === 0 && lng === 0)) return null;
  if (ref(1) === 'S') lat = -lat;
  if (ref(3) === 'W') lng = -lng;
  return { lat, lng };
}

async function loadBitmap(file) {
  if ('createImageBitmap' in window) {
    try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { /* 下へ */ }
  }
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('画像を読み込めませんでした'));
    img.src = URL.createObjectURL(file);
  });
}

function toJpeg(src, maxEdge, quality) {
  const w = src.width;
  const h = src.height;
  const s = Math.min(1, maxEdge / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.round(w * s);
  c.height = Math.round(h * s);
  c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', quality);
}

/** 長辺と画質を下げながら、上限サイズ（文字数）に収める */
function fit(src, maxEdge, quality, maxChars) {
  let edge = maxEdge;
  let q = quality;
  let url = toJpeg(src, edge, q);
  while (url.length > maxChars && edge > 200) {
    if (q > 0.5) q -= 0.1; else edge = Math.round(edge * 0.8);
    url = toJpeg(src, edge, q);
  }
  return url;
}

/**
 * 投稿用に写真を処理する。
 * full: 表示用（約1280px、最大およそ600KB）／thumb: チャット一覧用（約320px、最大およそ40KB）
 */
export async function preparePhoto(file) {
  const [buf, bmp] = await Promise.all([file.arrayBuffer(), loadBitmap(file)]);
  const gps = readExifGps(buf);
  const full = fit(bmp, 1280, 0.75, 800_000);
  const thumb = fit(bmp, 320, 0.6, 50_000);
  if (bmp.close) bmp.close();
  return { full, thumb, gps };
}

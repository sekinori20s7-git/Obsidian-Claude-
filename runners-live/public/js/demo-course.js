// デモ用の架空コース（高尾山口 → 陣馬山 付近を結んだ、実際の登山道ではない参考線）

const WAYPOINTS = [
  [35.6325, 139.2700], // スタート（高尾山口 付近）
  [35.6280, 139.2560],
  [35.6251, 139.2436], // 高尾山 付近
  [35.6230, 139.2280],
  [35.6187, 139.2196], // 城山 付近
  [35.6250, 139.2110],
  [35.6312, 139.2042], // 景信山 付近
  [35.6380, 139.1980],
  [35.6427, 139.1926], // 明王峠 付近
  [35.6480, 139.1800],
  [35.6521, 139.1667], // ゴール（陣馬山 付近）
];

/** 経由点の間を細かく補間し、山道らしく少し蛇行させた座標列を返す */
export function demoCoursePoints() {
  const out = [];
  for (let i = 0; i < WAYPOINTS.length - 1; i++) {
    const [a1, b1] = WAYPOINTS[i];
    const [a2, b2] = WAYPOINTS[i + 1];
    const steps = 60;
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      const wig = Math.sin((i * steps + s) * 0.35) * 0.0007 * Math.sin(Math.PI * t);
      out.push([
        +(a1 + (a2 - a1) * t + wig * (b2 - b1 > 0 ? 1 : -1)).toFixed(5),
        +(b1 + (b2 - b1) * t - wig * 0.6).toFixed(5),
      ]);
    }
  }
  out.push(WAYPOINTS[WAYPOINTS.length - 1]);
  return out;
}

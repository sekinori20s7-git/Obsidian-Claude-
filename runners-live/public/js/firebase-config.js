// ▼ Firebaseコンソールの「プロジェクトの設定 → マイアプリ → SDK の設定と構成（構成）」の値に置き換えてください。
//   置き換えるまでは、自動的に「デモモード」で動きます。
//   ※ この値はWebアプリでは公開される前提のものです（秘密鍵ではありません）。
//     データの保護は firestore.rules（セキュリティルール）で行います。
export const firebaseConfig = {
  apiKey: 'YOUR_API_KEY',
  authDomain: 'YOUR_PROJECT_ID.firebaseapp.com',
  projectId: 'YOUR_PROJECT_ID',
  storageBucket: 'YOUR_PROJECT_ID.appspot.com',
  messagingSenderId: 'YOUR_SENDER_ID',
  appId: 'YOUR_APP_ID',
};

// 位置の自動送信間隔（分）。アプリを開いている間だけ動きます。
export const AUTO_SEND_MINUTES = 30;

// この時間（分）以上更新がないメンバーは、地図上で薄く表示します。
export const STALE_MINUTES = 60;

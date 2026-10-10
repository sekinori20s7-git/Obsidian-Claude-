// Firebase（匿名認証＋Cloud Firestore）でデータをやり取りする
// データ構成：
//   rooms/{room}/members/{uid}   … 名前・色・状態・位置・コース上のkm
//   rooms/{room}/messages/{id}   … チャット（text / photo / alert / system）
//   rooms/{room}/photos/{id}     … 写真本体（圧縮済みJPEGのdata URL）
//   rooms/{room}/meta/course     … GPXコース

const V = '10.12.2';
const BASE = `https://www.gstatic.com/firebasejs/${V}`;

export async function createFirebaseBackend(config) {
  const [{ initializeApp }, authMod, fs] = await Promise.all([
    import(`${BASE}/firebase-app.js`),
    import(`${BASE}/firebase-auth.js`),
    import(`${BASE}/firebase-firestore.js`),
  ]);
  const { getAuth, signInAnonymously } = authMod;
  const {
    initializeFirestore, persistentLocalCache, persistentMultipleTabManager, memoryLocalCache,
    doc, setDoc, deleteDoc, getDoc, collection, onSnapshot, query, orderBy, limit, serverTimestamp,
  } = fs;

  const app = initializeApp(config);
  const auth = getAuth(app);

  // 電波がない間の書き込みを端末に保存し、つながったら自動送信する
  let db;
  try {
    db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
  } catch {
    db = initializeFirestore(app, { localCache: memoryLocalCache() });
  }

  // 開発用：localhost で ?emulator=1 のときは Firebase エミュレーターにつなぐ
  const isLocal = ['localhost', '127.0.0.1'].includes(location.hostname);
  if (isLocal && new URLSearchParams(location.search).get('emulator') === '1') {
    authMod.connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    fs.connectFirestoreEmulator(db, '127.0.0.1', 8080);
  }

  await auth.authStateReady();
  if (!auth.currentUser) await signInAnonymously(auth);
  const uid = auth.currentUser.uid;

  let room = null;
  const unsubs = [];
  const col = (name) => collection(db, 'rooms', room, name);
  const ts = (d) => d.data({ serverTimestamps: 'estimate' });
  const millis = (t) => (t && t.toMillis ? t.toMillis() : null);
  const report = (e) => console.error('[firestore]', e);

  return {
    mode: 'firebase',
    uid,

    async join(roomCode, profile) {
      room = roomCode;
      await setDoc(doc(db, 'rooms', room, 'members', uid), { ...profile, updatedAt: serverTimestamp() }, { merge: true })
        .catch((e) => { throw new Error(`ルームに参加できませんでした（${e.code || e.message}）`); });
    },

    updateMe(fields) {
      // 送信完了（サーバー到達）を待たずに戻る。オフライン時は端末に保存され、後で送られる
      setDoc(doc(db, 'rooms', room, 'members', uid), { ...fields, updatedAt: serverTimestamp() }, { merge: true }).catch(report);
    },

    onMembers(cb) {
      unsubs.push(onSnapshot(col('members'), (snap) => {
        cb(snap.docs.map((d) => {
          const x = ts(d);
          return { ...x, id: d.id, updatedAt: millis(x.updatedAt) };
        }));
      }, report));
    },

    onMessages(cb) {
      const q = query(col('messages'), orderBy('createdAt', 'desc'), limit(150));
      unsubs.push(onSnapshot(q, { includeMetadataChanges: true }, (snap) => {
        const list = snap.docs.map((d) => {
          const x = ts(d);
          return { ...x, id: d.id, createdAt: millis(x.createdAt) || x.clientAt, pending: d.metadata.hasPendingWrites };
        });
        cb(list.reverse());
      }, report));
    },

    sendMessage(msg) {
      const ref = doc(col('messages'));
      setDoc(ref, { ...msg, uid, clientAt: Date.now(), createdAt: serverTimestamp() }).catch(report);
      return ref.id;
    },

    sendPhoto({ full, thumb, ...msg }) {
      const pref = doc(col('photos'));
      setDoc(pref, { uid, data: full, createdAt: serverTimestamp() }).catch(report);
      return this.sendMessage({ ...msg, type: 'photo', photoId: pref.id, thumb });
    },

    async getPhoto(id) {
      const snap = await getDoc(doc(db, 'rooms', room, 'photos', id));
      return snap.exists() ? snap.data().data : null;
    },

    onCourse(cb) {
      unsubs.push(onSnapshot(doc(db, 'rooms', room, 'meta', 'course'), (snap) => cb(snap.exists() ? snap.data() : null), report));
    },

    setCourse(course) {
      return setDoc(doc(db, 'rooms', room, 'meta', 'course'), { ...course, setBy: uid, updatedAt: serverTimestamp() });
    },

    clearCourse() {
      return deleteDoc(doc(db, 'rooms', room, 'meta', 'course'));
    },

    async leave() {
      unsubs.splice(0).forEach((u) => u());
      await deleteDoc(doc(db, 'rooms', room, 'members', uid)).catch(report);
      room = null;
    },
  };
}

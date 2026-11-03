// P2: Firestore にデータを置く版。store.js（この端末だけに保存する版）と同じ関数名で使える。
// firebase-config.js の設定があり、Firebase の SDK が読み込めていて、お試し版（COMIKET_EMBED）でないときだけ使う。
//
// Firestore の形（ルールは ../firestore.rules）
//   rooms/{roomId}                 name, days, open_from, open_until, owner_uid, created_at
//   rooms/{roomId}/members/{id}    name, order
//   rooms/{roomId}/uids/{uid}      member_id   … この端末（匿名ログインの uid）が誰か
//   rooms/{roomId}/items/{id}      購入物
// 部屋は URL の ?room=… で決まる。
(function () {
  'use strict';
  const cfg = window.COMIKET_FIREBASE;
  if (!cfg || window.COMIKET_EMBED || typeof firebase === 'undefined') return;

  const params = new URLSearchParams(location.search);
  // テスト用：localhost で ?emulator=1 のときだけ、この PC の偽の Firebase（エミュレーター）につなぐ。
  // プロジェクト名を demo- で始まるものにして、本物のプロジェクトには触れないようにする
  const EMU = !!params.get('emulator') && /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  firebase.initializeApp(EMU ? { ...cfg, projectId: 'demo-comiket' } : cfg);
  const auth = firebase.auth();
  const db = firebase.firestore();
  if (EMU) {
    auth.useEmulator('http://127.0.0.1:9099', { disableWarnings: true });
    db.useEmulator('127.0.0.1', 8080);
  }
  const FV = firebase.firestore.FieldValue;
  const TS = firebase.firestore.Timestamp;

  const listeners = [];
  const errorListeners = [];
  let roomId = params.get('room') || null;
  let uid = null;
  let status = roomId ? 'loading' : 'no-room'; // loading / ok / no-room / denied / error
  let state = { room: null, members: [], items: [] };
  let meId = null;
  let unsubs = [];

  const emit = () => listeners.forEach((f) => f(state));
  const fail = (e) => {
    console.error(e);
    errorListeners.forEach((f) => f(e));
  };
  const roomRef = () => db.collection('rooms').doc(roomId);
  const ms = (t) => (t && typeof t.toMillis === 'function' ? t.toMillis() : t);

  function newId(n) {
    const abc = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const r = crypto.getRandomValues(new Uint8Array(n));
    return Array.from(r, (x) => abc[x % abc.length]).join('');
  }

  function stopListening() {
    unsubs.forEach((u) => u());
    unsubs = [];
  }

  // 部屋・メンバー・自分・購入物を見張る。読めなくなったら（時間外など）status を変える
  function listen() {
    stopListening();
    let got = { room: false, members: false, me: false };
    const settle = () => {
      if (status === 'loading' && got.room && got.members && got.me) status = 'ok';
      if (!checkOpen()) emit();
    };
    const denied = (e) => {
      status = e && e.code === 'permission-denied' ? 'denied' : 'error';
      stopListening();
      state = { room: null, members: [], items: [] };
      emit();
    };
    unsubs.push(
      roomRef().onSnapshot((d) => {
        if (!d.exists) return denied({ code: 'permission-denied' });
        const r = d.data();
        state.room = { ...r, open_from: ms(r.open_from), open_until: ms(r.open_until) };
        got.room = true;
        if (isOwner()) listenItems(); // 進行役は名前を選ぶ前から購入物を読める
        settle();
      }, denied),
    );
    unsubs.push(
      roomRef()
        .collection('members')
        .onSnapshot((q) => {
          state.members = q.docs.map((d) => ({ id: d.id, ...d.data() }));
          got.members = true;
          settle();
        }, denied),
    );
    unsubs.push(
      roomRef()
        .collection('uids')
        .doc(uid)
        .onSnapshot({ includeMetadataChanges: true }, (d) => {
          if (d.exists) meId = d.data().member_id;
          else if (!d.metadata.hasPendingWrites) meId = null;
          got.me = true;
          // 自分の記録がサーバーに届いてから購入物を見る（ルール上、メンバーになるまで読めない。進行役は先に読める）
          if (d.exists && !d.metadata.hasPendingWrites) listenItems();
          settle();
        }, denied),
    );
  }

  // 開いたままの画面は、ルールだけでは時間で止まらない（新しい読み書きは止まる）。
  // そのため進行役以外は、時間外になったらこちらでも見張りをやめて画面を閉じる
  function checkOpen() {
    const r = state.room;
    if (status !== 'ok' || !r || isOwner()) return false;
    const now = Date.now();
    if (now >= r.open_from && now < r.open_until) return false;
    status = 'denied';
    stopListening();
    state = { room: null, members: [], items: [] };
    emit();
    return true;
  }
  setInterval(checkOpen, 15000);

  let itemsUnsub = null;
  function listenItems() {
    if (itemsUnsub) return;
    itemsUnsub = roomRef()
      .collection('items')
      .onSnapshot(
        (q) => {
          state.items = q.docs.map((d) => ({ id: d.id, ...d.data() }));
          emit();
        },
        (e) => {
          itemsUnsub = null;
          if (e.code === 'permission-denied') {
            status = 'denied';
            emit();
          } else fail(e);
        },
      );
    unsubs.push(() => {
      if (itemsUnsub) itemsUnsub();
      itemsUnsub = null;
    });
  }

  const ready = new Promise((resolve) => {
    auth.onAuthStateChanged((u) => {
      if (!u) return;
      uid = u.uid;
      if (roomId) listen();
      resolve();
    });
    auth.signInAnonymously().catch((e) => {
      status = 'error';
      fail(e);
      resolve();
    });
  });

  function setUrlRoom(id) {
    const u = new URL(location.href);
    if (id) u.searchParams.set('room', id);
    else u.searchParams.delete('room');
    history.replaceState(null, '', u.toString());
  }

  const isOwner = () => !!(state.room && uid && state.room.owner_uid === uid);
  const items = () => roomRef().collection('items');
  const write = (p) => p.catch(fail);

  const Store = {
    mode: 'cloud',
    ready: () => ready,
    status: () => status,
    get: () => state,
    saveFailed: () => false,
    subscribe(f) {
      listeners.push(f);
    },
    onError(f) {
      errorListeners.push(f);
    },
    deviceId: () => uid,
    isOwner,
    roomUrl() {
      const u = new URL(location.href);
      u.search = '';
      u.hash = '';
      u.searchParams.set('room', roomId);
      if (params.get('emulator')) u.searchParams.set('emulator', '1');
      return u.toString();
    },
    getMe: () => meId,
    // この端末を、メンバーの誰かとして登録する（null で選び直し）
    // null は「選び直し」：画面を名前選びに戻すだけで、記録は次に選んだときに上書きする
    // （記録を消すと、選び直す前に購入物が読めなくなるため）
    setMe(memberId) {
      meId = memberId;
      if (memberId && roomId && uid) {
        write(roomRef().collection('uids').doc(uid).set({ member_id: memberId }));
      }
      emit();
    },

    async createRoom(room, names) {
      roomId = newId(20);
      // 部屋を先に作る（ルールは「部屋の進行役か」を見るので、メンバーは部屋ができてから書く）
      await roomRef().set({
        name: room.name,
        days: room.days || [],
        open_from: TS.fromMillis(room.open_from),
        open_until: TS.fromMillis(room.open_until),
        owner_uid: uid,
        created_at: FV.serverTimestamp(),
      });
      const batch = db.batch();
      names.forEach((n, i) => batch.set(roomRef().collection('members').doc(newId(12)), { name: n, order: i }));
      await batch.commit();
      setUrlRoom(roomId);
      status = 'loading';
      meId = null;
      listen();
      return state;
    },
    updateRoom(patch) {
      const p = { ...patch };
      if ('open_from' in p) p.open_from = TS.fromMillis(p.open_from);
      if ('open_until' in p) p.open_until = TS.fromMillis(p.open_until);
      Object.assign(state.room, patch);
      write(roomRef().update(p));
      emit();
    },
    renameMember(id, name) {
      write(roomRef().collection('members').doc(id).update({ name }));
    },
    addMember(name) {
      if (state.members.length >= 10) return { ok: false, reason: 'full' };
      const order = state.members.reduce((a, m) => Math.max(a, m.order), -1) + 1;
      const id = newId(12);
      write(roomRef().collection('members').doc(id).set({ name, order }));
      return { ok: true, member: { id, name, order } };
    },
    removeMember(id) {
      const used = state.items.some((i) => !i.deleted && (i.assignee === id || (i.requests || {})[id] > 0));
      if (used) return { ok: false, reason: 'used' };
      write(roomRef().collection('members').doc(id).delete());
      return { ok: true };
    },

    addItem(data, by) {
      const now = Date.now();
      const ref = items().doc();
      const it = { ...data, created_by: by, created_at: now, updated_by: by, updated_at: now, version: 1, deleted: false };
      write(ref.set(it));
      return { ok: true, item: { id: ref.id, ...it } };
    },
    // 購入物・請負人・備考の変更。他の人が先に変えていたら conflict（トランザクションで確かめる）
    async updateItem(id, patch, baseVersion, by) {
      const ref = items().doc(id);
      try {
        return await db.runTransaction(async (tx) => {
          const d = await tx.get(ref);
          if (!d.exists) return { ok: false, reason: 'missing' };
          const cur = { id, ...d.data() };
          if (cur.version !== baseVersion) return { ok: false, reason: 'conflict', current: cur };
          tx.update(ref, { ...patch, updated_by: by, updated_at: Date.now(), version: cur.version + 1 });
          return { ok: true };
        });
      } catch (e) {
        fail(e);
        return { ok: false, reason: 'error' };
      }
    },
    // 依頼人 1 人分の個数だけを変える（requests.<id> の欄だけを書く。他の人の個数は消えない）
    setRequest(id, memberId, qty, by) {
      const upd = { updated_by: by, updated_at: Date.now() };
      upd[`requests.${memberId}`] = qty > 0 ? qty : FV.delete();
      write(items().doc(id).update(upd));
      return { ok: true };
    },
    setDeleted(id, deleted, by) {
      write(items().doc(id).update({ deleted, updated_by: by, updated_at: Date.now(), version: FV.increment(1) }));
      return { ok: true };
    },

    // 進行役だけ：部屋のデータをすべて消す
    async reset() {
      if (!roomId) return;
      if (isOwner()) {
        stopListening();
        for (const sub of ['items', 'members', 'uids']) {
          const q = await roomRef().collection(sub).get();
          for (let k = 0; k < q.docs.length; k += 400) {
            const b = db.batch();
            q.docs.slice(k, k + 400).forEach((d) => b.delete(d.ref));
            await b.commit();
          }
        }
        await roomRef().delete();
      }
      stopListening();
      roomId = null;
      meId = null;
      status = 'no-room';
      state = { room: null, members: [], items: [] };
      setUrlRoom(null);
      emit();
    },
  };

  window.Store = Store;
})();

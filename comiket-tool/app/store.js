// P1 のデータ置き場：この端末のブラウザ（localStorage）だけに保存する。
// P2 では同じ関数名のまま Firestore を使う版に差し替える。
// 同じ端末の別タブとは storage イベントで同期するので、同時編集の動きを 1 台でも試せる。
(function () {
  'use strict';
  const KEY = 'comiket-tool-p1-v2'; // v2: 開催日を曜日で持つ
  const ME_KEY = 'comiket-tool-p1-v2-me';
  const listeners = [];

  function empty() {
    return { room: null, members: [], items: [] };
  }
  // 読めなかったとき（プライベートブラウズ等で保存が使えない）は null を返す
  function load() {
    try {
      const s = localStorage.getItem(KEY);
      return s ? JSON.parse(s) : empty();
    } catch (e) {
      return null;
    }
  }
  let state = load() || empty();
  let saveFailed = false;

  function persist() {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
      saveFailed = false;
    } catch (e) {
      saveFailed = true; // プライベートブラウズなど。画面には残るが再読み込みで消える
    }
  }
  function emit() {
    listeners.forEach((f) => f(state));
  }
  function refresh() {
    // 書き込みの前に最新を読み直す（別タブの変更を取り込むため）。読めなければ手元の状態を使う
    const s = load();
    if (s) state = s;
  }
  function uid() {
    return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  }
  function commit() {
    persist();
    emit();
  }

  window.addEventListener('storage', (e) => {
    if (e.key === KEY) {
      state = load() || state;
      emit();
    }
  });

  let me = null;
  try {
    me = localStorage.getItem(ME_KEY);
  } catch (e) {}

  const Store = {
    mode: 'local',
    ready: () => Promise.resolve(),
    status: () => 'ok',
    onError() {},
    deviceId: () => null,
    isOwner: () => true, // この端末だけで使うときは、使う人が進行役
    roomUrl: () => null,
    getMe: () => me,
    setMe(id) {
      me = id;
      try {
        if (id) localStorage.setItem(ME_KEY, id);
        else localStorage.removeItem(ME_KEY);
      } catch (e) {}
      emit();
    },
    get: () => state,
    saveFailed: () => saveFailed,
    subscribe(f) {
      listeners.push(f);
    },

    createRoom(room, names) {
      state = { room, members: names.map((n, i) => ({ id: uid(), name: n, order: i })), items: [] };
      commit();
      return state;
    },
    updateRoom(patch) {
      refresh();
      Object.assign(state.room, patch);
      commit();
    },
    renameMember(id, name) {
      refresh();
      const m = state.members.find((x) => x.id === id);
      if (m) m.name = name;
      commit();
    },
    addMember(name) {
      refresh();
      if (state.members.length >= 10) return { ok: false, reason: 'full' };
      const order = state.members.reduce((a, m) => Math.max(a, m.order), -1) + 1;
      const m = { id: uid(), name, order };
      state.members.push(m);
      commit();
      return { ok: true, member: m };
    },
    removeMember(id) {
      refresh();
      const used = state.items.some((i) => !i.deleted && (i.assignee === id || (i.requests || {})[id] > 0));
      if (used) return { ok: false, reason: 'used' };
      state.members = state.members.filter((m) => m.id !== id);
      commit();
      return { ok: true };
    },

    addItem(data, by) {
      refresh();
      const now = Date.now();
      const it = Object.assign({}, data, {
        id: uid(),
        created_by: by,
        created_at: now,
        updated_by: by,
        updated_at: now,
        version: 1,
        deleted: false,
      });
      state.items.push(it);
      commit();
      return { ok: true, item: it };
    },

    // 購入物・請負人・備考の変更。他の人が先に変えていたら conflict を返す。
    updateItem(id, patch, baseVersion, by) {
      refresh();
      const it = state.items.find((x) => x.id === id);
      if (!it) return { ok: false, reason: 'missing' };
      if (it.version !== baseVersion) return { ok: false, reason: 'conflict', current: it };
      Object.assign(it, patch, { updated_by: by, updated_at: Date.now(), version: it.version + 1 });
      commit();
      return { ok: true, item: it };
    },

    // 依頼人 1 人分の個数だけを変える。他の人の個数や version には触らない。
    setRequest(id, memberId, qty, by) {
      refresh();
      const it = state.items.find((x) => x.id === id);
      if (!it) return { ok: false, reason: 'missing' };
      it.requests = it.requests || {};
      if (qty > 0) it.requests[memberId] = qty;
      else delete it.requests[memberId];
      it.updated_by = by;
      it.updated_at = Date.now();
      commit();
      return { ok: true, item: it };
    },

    setDeleted(id, deleted, by) {
      refresh();
      const it = state.items.find((x) => x.id === id);
      if (!it) return { ok: false, reason: 'missing' };
      it.deleted = deleted;
      it.updated_by = by;
      it.updated_at = Date.now();
      it.version += 1;
      commit();
      return { ok: true };
    },

    reset() {
      state = empty();
      try {
        localStorage.removeItem(KEY);
      } catch (e) {}
      emit();
    },
  };

  window.Store = Store;
})();

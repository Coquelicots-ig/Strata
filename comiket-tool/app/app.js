// 画面の組み立てと操作。データの読み書きは Store、計算は ComiketLogic に任せる。
(function () {
  'use strict';
  const L = window.ComiketLogic;
  const S = window.Store;
  const CAT = window.COMIKET_CATALOG || [];
  const DEMO = window.COMIKET_DEMO || [];
  const DAYS = [...new Set([1, 2, 3, ...CAT.map((c) => c.day)])].sort((a, b) => a - b);
  const ME_KEY = 'comiket-tool-p1-me';
  const MAX_MEMBERS = 10;
  // 1 つの HTML にまとめてブラウザ内のページとして開く版では、ダウンロードと印刷が使えないので隠す
  const EMBED = !!window.COMIKET_EMBED;

  // 確認ダイアログの代わり：1 回目で「もう一度押すと〜」に変わり、4 秒以内にもう一度押すと実行する
  function armed(b, label) {
    if (b.dataset.armed) return true;
    const old = b.textContent;
    b.dataset.armed = '1';
    b.textContent = label;
    setTimeout(() => {
      if (b.isConnected && b.dataset.armed) {
        delete b.dataset.armed;
        b.textContent = old;
      }
    }, 4000);
    return false;
  }

  let me = null;
  try {
    me = localStorage.getItem(ME_KEY);
  } catch (e) {}

  const ui = {
    tab: 'input',
    day: DAYS[0],
    kind: 'circle',
    hall: '東',
    ab: 'a',
    num: '', // 数字だけ（企業ブースも数字だけ）
    picked: null, // ブロック違いが複数あるときに選んだサークル番号
    manualBlock: '',
    manualName: '',
    editing: null, // { id, version, origRequests }
    form: null,
    listMode: 'assignee',
    fDay: 'all',
    fKind: 'all',
    fMember: 'all',
  };

  const $ = (s) => document.querySelector(s);
  const view = $('#view');
  const esc = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  const st = () => S.get();
  const members = () => L.sortedMembers(st().members);
  const mname = (id) => L.memberName(st().members, id);
  const liveItems = () => st().items.filter((i) => !i.deleted);

  function setMe(id) {
    me = id;
    try {
      if (id) localStorage.setItem(ME_KEY, id);
      else localStorage.removeItem(ME_KEY);
    } catch (e) {}
  }

  let toastTimer = null;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
  }

  // ---- 日時 ----
  const pad = (n) => String(n).padStart(2, '0');
  function toLocalInput(ms) {
    const d = new Date(ms);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  function fromLocalInput(s) {
    const t = new Date(s).getTime();
    return Number.isFinite(t) ? t : null;
  }
  function hm(ms) {
    const d = new Date(ms);
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  function defaultWindow() {
    const d = new Date();
    d.setHours(20, 0, 0, 0);
    const from = d.getTime();
    return { open_from: from, open_until: from + 4 * 3600 * 1000 };
  }

  // P1 では時間外でも操作できる（表示だけ）。制限は P3 でサーバ側のルールとして入れる。
  function renderBanner() {
    const b = $('#banner');
    const room = st().room;
    if (!room) {
      b.hidden = true;
      return;
    }
    const now = Date.now();
    b.hidden = false;
    b.className = '';
    if (now < room.open_from) {
      b.textContent = `${hm(room.open_from)} から公開（まだ開いていません）`;
      b.className = 'closed';
    } else if (now >= room.open_until) {
      b.textContent = `${hm(room.open_until)} で閉じました`;
      b.className = 'closed';
    } else {
      const left = Math.ceil((room.open_until - now) / 60000);
      if (left <= 30) {
        b.textContent = `${hm(room.open_until)} で閉じます（あと ${left} 分）。出力を済ませてください`;
        b.className = 'warn';
      } else {
        b.textContent = `公開中：${hm(room.open_until)} まで（あと ${left} 分）`;
      }
    }
  }

  // ---- 全体 ----
  function render() {
    const room = st().room;
    $('#roomName').textContent = room ? room.name : '買い物分担';
    renderBanner();
    const tabs = $('#tabs');
    if (!room) {
      tabs.hidden = true;
      return renderSetup();
    }
    if (!me || !st().members.some((m) => m.id === me)) {
      tabs.hidden = true;
      return renderWho();
    }
    tabs.hidden = false;
    tabs.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.tab === ui.tab));
    if (ui.tab === 'input') renderInput();
    else if (ui.tab === 'list') renderList();
    else if (ui.tab === 'export') renderExport();
    else renderSettings();
    if (S.saveFailed()) toast('この端末に保存できませんでした（プライベートブラウズ等）');
  }

  // ---- 部屋の作成 ----
  function renderSetup() {
    const w = defaultWindow();
    view.innerHTML = `
      <section class="card">
        <h2>部屋を作る（進行役）</h2>
        <label for="sName">部屋の名前</label>
        <input type="text" id="sName" value="コミケ買い出し会議">
        <label for="sMembers">メンバー（1 行に 1 人、最大 ${MAX_MEMBERS} 人。進行役も含める）</label>
        <textarea id="sMembers" rows="6" placeholder="Aさん&#10;Bさん&#10;Cさん"></textarea>
        <label for="sFrom">公開の開始</label>
        <input type="datetime-local" id="sFrom" value="${toLocalInput(w.open_from)}">
        <label for="sUntil">公開の終了</label>
        <input type="datetime-local" id="sUntil" value="${toLocalInput(w.open_until)}">
        <p class="hint">時間帯は後から設定画面でいつでも変えられます。</p>
        <p><button type="button" class="primary" data-act="create">作成する</button></p>
      </section>
      <section class="card">
        <h2>デモで試す</h2>
        <p class="muted">ダミーのメンバー（Aさん〜Eさん）と分担の例を入れて始めます。</p>
        <button type="button" data-act="demo">デモデータで始める</button>
      </section>`;
  }

  function createRoom() {
    const name = $('#sName').value.trim() || 'コミケ買い出し会議';
    const names = [...new Set($('#sMembers').value.split(/\r?\n/).map((s) => s.trim()).filter(Boolean))];
    if (!names.length) return toast('メンバーを 1 人以上入れてください');
    if (names.length > MAX_MEMBERS) return toast(`メンバーは最大 ${MAX_MEMBERS} 人です`);
    const from = fromLocalInput($('#sFrom').value);
    const until = fromLocalInput($('#sUntil').value);
    if (from == null || until == null) return toast('公開の開始と終了を入れてください');
    if (until <= from) return toast('終了は開始より後にしてください');
    setMe(null);
    S.createRoom({ name, open_from: from, open_until: until }, names);
    render();
  }

  function startDemo() {
    const names = ['Aさん', 'Bさん', 'Cさん', 'Dさん', 'Eさん'];
    const w = defaultWindow();
    const now = Date.now();
    // デモは今すぐ使えるよう、今から 4 時間を公開時間にする
    S.createRoom({ name: 'デモ：コミケ買い出し会議', open_from: Math.min(w.open_from, now), open_until: Math.max(w.open_until, now + 4 * 3600 * 1000) }, names);
    const byName = Object.fromEntries(st().members.map((m) => [m.name, m.id]));
    for (const d of DEMO) {
      const requests = {};
      for (const [n, q] of Object.entries(d.requests)) if (byName[n]) requests[byName[n]] = q;
      const hit = CAT.find((c) => c.day === d.day && c.kind === d.kind && c.circle_no === d.circle_no);
      S.addItem(
        {
          day: d.day,
          kind: d.kind,
          circle_no: d.circle_no,
          circle_name: hit ? hit.circle_name : d.circle_name,
          from_catalog: !!hit,
          item: d.item,
          requests,
          assignee: d.assignee ? byName[d.assignee] || null : null,
          note: d.note,
        },
        byName['Aさん'],
      );
    }
    setMe(null);
    render();
  }

  // ---- 自分を選ぶ ----
  function renderWho() {
    view.innerHTML = `
      <section class="card">
        <h2>あなたは誰？</h2>
        <p class="muted">自分の名前をタップしてください。この端末に記憶します。</p>
        <div class="chips">${members()
          .map((m) => `<button type="button" data-act="me" data-id="${m.id}">${esc(m.name)}</button>`)
          .join('')}</div>
      </section>`;
  }

  // ---- 入力 ----
  function newForm() {
    return { item: '新刊', requests: {}, assignee: null, note: '' };
  }

  // 入力から「どこの購入物か」を決める。null は未入力、pending はブロック違いから選ぶ必要がある状態。
  function target() {
    const base = { day: ui.day, kind: ui.kind };
    if (ui.kind === 'corporate') {
      const r = L.findCatalog(CAT, ui.day, 'corporate', ui.num);
      if (!r.no) return null;
      if (r.exact) return { ...base, circle_no: r.exact.circle_no, circle_name: r.exact.circle_name, from_catalog: true, matches: [r.exact] };
      return { ...base, circle_no: r.no, circle_name: ui.manualName.trim(), from_catalog: false, matches: [] };
    }
    const r = L.findBySpace(CAT, ui.day, ui.hall, ui.num, ui.ab);
    if (r.num == null) return null;
    const hit = r.matches.length === 1 ? r.matches[0] : r.matches.find((c) => c.circle_no === ui.picked);
    if (hit) return { ...base, circle_no: hit.circle_no, circle_name: hit.circle_name, from_catalog: true, matches: r.matches };
    if (r.matches.length > 1) return { ...base, pending: true, matches: r.matches };
    const block = ui.manualBlock.normalize('NFKC').trim();
    return { ...base, circle_no: L.buildCircleNo(ui.hall, block, r.num, ui.ab), circle_name: ui.manualName.trim(), from_catalog: false, matches: [] };
  }

  function segHTML(act, key, values, current, labels) {
    return `<div class="seg">${values
      .map((v, k) => `<button type="button" data-act="${act}" data-${key}="${v}" class="${String(v) === String(current) ? 'on' : ''}">${labels ? labels[k] : v}</button>`)
      .join('')}</div>`;
  }

  function renderInput() {
    if (!ui.form) ui.form = newForm();
    const circle = ui.kind === 'circle';
    view.innerHTML = `
      <section class="card">
        ${segHTML('day', 'day', DAYS, ui.day, DAYS.map((d) => d + '日目'))}
        ${segHTML('kind', 'kind', ['circle', 'corporate'], ui.kind, ['サークル', '企業'])}
        ${circle ? `<label>ホール</label>${segHTML('hall', 'hall', L.HALLS, ui.hall)}` : ''}
        <label for="numInput">${circle ? '番号（数字だけ）と a / b' : '企業ブース番号（数字だけ）'}</label>
        <div class="numrow">
          <input type="text" id="numInput" inputmode="numeric" pattern="[0-9]*" autocomplete="off"
            placeholder="${circle ? '例: 1' : '例: 101'}" value="${esc(ui.num)}">
          ${circle ? segHTML('ab', 'ab', ['a', 'b'], ui.ab) : ''}
        </div>
        <div id="lookup"></div>
      </section>
      <section id="existing"></section>
      <section id="formArea"></section>`;
    updateLookup();
  }

  function updateLookup() {
    const t = target();
    const box = $('#lookup');
    if (!t) {
      box.innerHTML = `<p class="hint">番号を入れるとサークル名が出ます。</p>`;
    } else if (t.matches.length > 1) {
      box.innerHTML = `
        <p class="hint">ブロック違いで ${t.matches.length} 件あります。タップして選んでください。</p>
        <div class="cands">${t.matches
          .map((x) => `<button type="button" data-act="pick" data-no="${esc(x.circle_no)}" class="${t.circle_no === x.circle_no ? 'on' : ''}">${esc(x.circle_no)}　${esc(x.circle_name)}</button>`)
          .join('')}</div>`;
    } else if (t.from_catalog) {
      box.innerHTML = `<div class="found">${esc(t.circle_name)}<small>${t.day}日目 ${esc(t.circle_no)}</small></div>`;
    } else {
      box.innerHTML = `
        <p class="notfound">カタログにありません</p>
        ${ui.kind === 'circle' ? `<label for="manualBlock">ブロック（分かれば。例: A）</label>
        <input type="text" id="manualBlock" value="${esc(ui.manualBlock)}" autocomplete="off">` : ''}
        <label for="manualName">名前を手で入れて登録できます</label>
        <input type="text" id="manualName" value="${esc(ui.manualName)}" placeholder="サークル名／出展者名">`;
    }
    const ready = t && !t.pending ? t : null;
    renderExisting(ready);
    renderForm(ready);
  }

  function itemsAt(t) {
    if (!t) return [];
    return liveItems()
      .filter((i) => i.day === t.day && i.kind === t.kind && i.circle_no === t.circle_no)
      .sort(L.compareItems);
  }

  function itemHTML(i, opts) {
    opts = opts || {};
    const reqs = L.requestList(i, st().members);
    const who = reqs.map((r) => `${esc(r.name)}×${r.qty}`).join('、');
    const asg = i.assignee ? esc(mname(i.assignee)) : '<span class="unassigned">未定</span>';
    const acts = [];
    if (opts.join && me && !(i.requests || {})[me]) acts.push(`<button type="button" class="small" data-act="join" data-id="${i.id}">自分も依頼</button>`);
    if (opts.edit) acts.push(`<button type="button" class="small" data-act="edit" data-id="${i.id}">編集</button>`);
    if (opts.restore) acts.push(`<button type="button" class="small" data-act="restore" data-id="${i.id}">元に戻す</button>`);
    return `
      <div class="item ${opts.tap ? 'tap' : ''}" ${opts.tap ? `data-act="edit" data-id="${i.id}"` : ''}>
        <div class="where">${i.day}日目 ${esc(i.circle_no)} ${esc(i.circle_name)}${i.kind === 'corporate' ? '<span class="badge">企業</span>' : ''}${i.from_catalog ? '' : '<span class="badge">手入力</span>'}</div>
        <div><span class="what">${esc(i.item)}</span> 計${L.totalQty(i)}${opts.mine != null ? `（自分 ${opts.mine}）` : ''}</div>
        <div class="who">依頼：${who || '—'}／請負：${asg}</div>
        ${i.note ? `<div class="note">備考：${esc(i.note)}</div>` : ''}
        ${acts.length ? `<div class="acts">${acts.join('')}</div>` : ''}
      </div>`;
  }

  function renderExisting(t) {
    const box = $('#existing');
    const list = itemsAt(t);
    if (!list.length) {
      box.innerHTML = '';
      return;
    }
    box.innerHTML = `<div class="card"><h2>ここの登録済み（${list.length}）</h2>${list.map((i) => itemHTML(i, { join: true, edit: true })).join('')}</div>`;
  }

  function reqBlockHTML() {
    const f = ui.form;
    return members()
      .map((m) => {
        const q = f.requests[m.id] || 0;
        return `<div class="req ${q ? 'on' : ''}">
          <span class="name">${esc(m.name)}${m.id === me ? '（自分）' : ''}</span>
          <button type="button" data-act="qty" data-id="${m.id}" data-d="-1" aria-label="${esc(m.name)} を減らす" ${q ? '' : 'disabled'}>−</button>
          <span class="qty">${q}</span>
          <button type="button" data-act="qty" data-id="${m.id}" data-d="1" aria-label="${esc(m.name)} を増やす">＋</button>
        </div>`;
      })
      .join('');
  }

  function asgBlockHTML() {
    const a = ui.form.assignee;
    return (
      members().map((m) => `<button type="button" data-act="asg" data-id="${m.id}" class="${a === m.id ? 'on' : ''}">${esc(m.name)}</button>`).join('') +
      `<button type="button" data-act="asg" data-id="" class="${a ? '' : 'on'}">未定</button>`
    );
  }

  function renderForm(t) {
    const box = $('#formArea');
    if (!t) {
      box.innerHTML = '';
      return;
    }
    const f = ui.form;
    const ed = ui.editing;
    box.innerHTML = `
      <div class="card">
        <h2>${ed ? '購入物を編集' : '購入物を追加'}</h2>
        <label for="fItem">購入物</label>
        <input type="text" id="fItem" value="${esc(f.item)}" placeholder="例: 新刊セット">
        <label>依頼人と個数</label>
        <div id="reqBlock">${reqBlockHTML()}</div>
        <label>請負人（1 人）</label>
        <div class="chips" id="asgBlock">${asgBlockHTML()}</div>
        <label for="fNote">備考（金額などもここに）</label>
        <textarea id="fNote" rows="2">${esc(f.note)}</textarea>
        <p><button type="button" class="primary" data-act="save">${ed ? '保存する' : '登録する'}</button></p>
        ${ed ? `<div class="row"><button type="button" data-act="cancel">やめる</button><button type="button" class="danger" data-act="del">削除</button></div>` : ''}
      </div>`;
  }

  function syncText() {
    const a = $('#fItem');
    const b = $('#fNote');
    if (a) ui.form.item = a.value;
    if (b) ui.form.note = b.value;
  }

  function resetForm() {
    ui.editing = null;
    ui.form = newForm();
  }

  function save() {
    syncText();
    const t = target();
    const f = ui.form;
    if (!t) return toast('番号を入れてください');
    if (t.pending) return toast('ブロック違いの候補から 1 つ選んでください');
    if (!t.from_catalog && !t.circle_name) return toast('カタログにない番号です。名前を入れてください');
    if (!f.item.trim()) return toast('購入物を入れてください');
    if (!Object.values(f.requests).some((q) => q > 0)) return toast('依頼人を 1 人以上選んでください');

    if (ui.editing) {
      const ed = ui.editing;
      const patch = { item: f.item.trim(), assignee: f.assignee, note: f.note.trim() };
      const changed = Object.keys(patch).some((k) => patch[k] !== ed.orig[k]);
      // 購入物・請負人・備考が変わったときだけ version を比べて保存する。
      // 依頼人の個数だけの変更では version を上げない（他の人の編集を止めないため）。
      const r = changed ? S.updateItem(ed.id, patch, ed.version, me) : { ok: true };
      if (!r.ok) {
        if (r.reason === 'conflict') {
          const by = mname(r.current.updated_by);
          toast(`${by} が先に更新しました。最新の内容を表示します`);
          openEdit(ed.id);
        } else toast('この購入物は見つかりません');
        return;
      }
      // 依頼人は変わった人の分だけ送る（他の人の同時の変更を消さない）
      const ids = new Set([...Object.keys(ed.origRequests), ...Object.keys(f.requests)]);
      for (const id of ids) {
        const before = ed.origRequests[id] || 0;
        const after = f.requests[id] || 0;
        if (before !== after) S.setRequest(ed.id, id, after, me);
      }
      toast('保存しました');
    } else {
      const requests = {};
      for (const [id, q] of Object.entries(f.requests)) if (q > 0) requests[id] = q;
      S.addItem(
        {
          day: t.day,
          kind: t.kind,
          circle_no: t.circle_no,
          circle_name: t.circle_name,
          from_catalog: t.from_catalog,
          item: f.item.trim(),
          requests,
          assignee: f.assignee,
          note: f.note.trim(),
        },
        me,
      );
      toast('登録しました');
    }
    resetForm();
    render();
  }

  function openEdit(id) {
    const i = st().items.find((x) => x.id === id);
    if (!i) return;
    ui.tab = 'input';
    ui.day = i.day;
    ui.kind = i.kind;
    ui.manualName = i.from_catalog ? '' : i.circle_name;
    ui.manualBlock = '';
    ui.picked = null;
    if (i.kind === 'corporate') ui.num = i.circle_no.replace(/^企業/, '');
    else {
      const p = L.parseSpace(i.circle_no);
      if (p) {
        ui.hall = p.hall;
        ui.ab = p.ab;
        ui.num = String(p.num);
        ui.picked = i.circle_no;
        if (!i.from_catalog) ui.manualBlock = p.block;
      }
    }
    ui.editing = {
      id: i.id,
      version: i.version,
      origRequests: Object.assign({}, i.requests),
      orig: { item: i.item, assignee: i.assignee || null, note: i.note || '' },
    };
    ui.form = { item: i.item, requests: Object.assign({}, i.requests), assignee: i.assignee || null, note: i.note || '' };
    render();
    const fa = $('#formArea');
    if (fa && fa.scrollIntoView) fa.scrollIntoView({ block: 'start' });
  }

  // ---- 一覧 ----
  function filtered() {
    return liveItems()
      .filter((i) => ui.fDay === 'all' || i.day === Number(ui.fDay))
      .filter((i) => ui.fKind === 'all' || i.kind === ui.fKind)
      .filter((i) => ui.fMember === 'all' || i.assignee === ui.fMember || (i.requests || {})[ui.fMember] > 0)
      .sort(L.compareItems);
  }

  function renderList() {
    const items = filtered();
    const unassigned = liveItems().filter((i) => !i.assignee).length;
    let body = '';
    if (ui.listMode === 'assignee') {
      for (const g of [null, ...members().map((m) => m.id)]) {
        const list = items.filter((i) => (i.assignee || null) === g);
        if (!list.length) continue;
        const qty = list.reduce((a, i) => a + L.totalQty(i), 0);
        body += `<div class="card group"><h3>${g ? esc(mname(g)) : '<span class="unassigned">請負人 未定</span>'}（${list.length} 件・計 ${qty} 点）</h3>${list.map((i) => itemHTML(i, { tap: true })).join('')}</div>`;
      }
    } else if (ui.listMode === 'requester') {
      for (const m of members()) {
        if (ui.fMember !== 'all' && ui.fMember !== m.id) continue;
        const list = items.filter((i) => (i.requests || {})[m.id] > 0);
        if (!list.length) continue;
        body += `<div class="card group"><h3>${esc(m.name)} の依頼（${list.length} 件）</h3>${list.map((i) => itemHTML(i, { tap: true, mine: i.requests[m.id] })).join('')}</div>`;
      }
    } else {
      body = items.length ? `<div class="card">${items.map((i) => itemHTML(i, { tap: true })).join('')}</div>` : '';
    }
    if (!body) body = `<p class="muted">該当する購入物はありません。</p>`;

    const deleted = st().items.filter((i) => i.deleted);
    view.innerHTML = `
      ${unassigned ? `<div class="alert">請負人が未定：${unassigned} 件</div>` : liveItems().length ? `<div class="okmsg">全件の請負人が決まりました</div>` : ''}
      <div class="seg">
        <button type="button" data-act="mode" data-mode="assignee" class="${ui.listMode === 'assignee' ? 'on' : ''}">請負人ごと</button>
        <button type="button" data-act="mode" data-mode="requester" class="${ui.listMode === 'requester' ? 'on' : ''}">依頼人ごと</button>
        <button type="button" data-act="mode" data-mode="order" class="${ui.listMode === 'order' ? 'on' : ''}">日・番号順</button>
      </div>
      <div class="filters">
        <select id="fDay" aria-label="日">${['all', ...DAYS].map((d) => `<option value="${d}" ${String(ui.fDay) === String(d) ? 'selected' : ''}>${d === 'all' ? '全日' : d + '日目'}</option>`).join('')}</select>
        <select id="fKind" aria-label="種別">${[['all', '全種別'], ['circle', 'サークル'], ['corporate', '企業']].map(([v, n]) => `<option value="${v}" ${ui.fKind === v ? 'selected' : ''}>${n}</option>`).join('')}</select>
        <select id="fMember" aria-label="メンバー"><option value="all">全員</option>${members().map((m) => `<option value="${m.id}" ${ui.fMember === m.id ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select>
      </div>
      <div class="list-wide">${body}</div>
      ${deleted.length ? `<details class="card"><summary>削除済み（${deleted.length}）</summary>${deleted.map((i) => itemHTML(i, { restore: true })).join('')}</details>` : ''}
      <p class="hint">行をタップすると編集できます。</p>`;
  }

  // ---- 出力 ----
  function fileStamp() {
    const d = new Date();
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
  }

  function renderExport() {
    const n = liveItems().length;
    const text = L.toText(st().items, st().members);
    view.innerHTML = `
      <section class="card">
        <h2>出力（${n} 件）</h2>
        <p class="muted">公開が終わるとツールから取り出せません。会議の終わりに各自で保存してください。</p>
        ${EMBED ? '' : `<p><button type="button" class="primary" data-act="csv">CSV をダウンロード</button></p>`}
        <div class="row">
          <button type="button" class="${EMBED ? 'primary' : ''}" data-act="copy">テキストをコピー</button>
          <button type="button" data-act="copyCsv">CSV をコピー</button>
          ${EMBED ? '' : `<button type="button" data-act="print">印刷用に表示</button>`}
        </div>
        ${EMBED ? `<p class="hint">お試し版ではファイルの保存と印刷はできません。「CSV をコピー」して、メモ帳やスプレッドシートに貼り付けてください。</p>` : ''}
      </section>
      <section class="card">
        <h2>コピーする内容</h2>
        <textarea id="exText" rows="14" readonly>${esc(text)}</textarea>
      </section>`;
  }

  function downloadCSV() {
    const csv = '﻿' + L.toCSV(st().items, st().members);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `comiket-buntan-${fileStamp()}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // 押した直後に呼ぶこと（クリップボードはボタン操作の中でしか書けない）
  function copyText(text, label) {
    const ta = $('#exText');
    ta.value = text;
    const fallback = () => {
      ta.focus();
      ta.select();
      let ok = false;
      try {
        ok = document.execCommand('copy');
      } catch (e) {}
      toast(ok ? `${label}をコピーしました` : '下の欄を長押しして全部選び、コピーしてください');
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => toast(`${label}をコピーしました`), fallback);
    } else fallback();
  }

  function printView() {
    const ms = st().members;
    const rows = liveItems()
      .sort(L.compareItems)
      .map(
        (i) => `<tr><td>${i.day}</td><td>${esc(L.KIND_LABEL[i.kind])}</td><td>${esc(i.circle_no)}</td><td>${esc(i.circle_name)}</td><td>${esc(i.item)}</td><td>${esc(L.formatRequests(i, ms, '、'))}</td><td>${L.totalQty(i)}</td><td>${i.assignee ? esc(mname(i.assignee)) : '未定'}</td><td>${esc(i.note)}</td></tr>`,
      )
      .join('');
    $('#print').innerHTML = `<h1>${esc(st().room.name)}</h1><table><thead><tr><th>日</th><th>種別</th><th>番号</th><th>名前</th><th>購入物</th><th>依頼人</th><th>計</th><th>請負人</th><th>備考</th></tr></thead><tbody>${rows}</tbody></table>`;
    window.print();
  }

  // ---- 設定（進行役） ----
  function renderSettings() {
    const room = st().room;
    const ms = members();
    view.innerHTML = `
      <section class="card">
        <h2>公開時間帯</h2>
        <label for="wFrom">開始</label>
        <input type="datetime-local" id="wFrom" value="${toLocalInput(room.open_from)}">
        <label for="wUntil">終了</label>
        <input type="datetime-local" id="wUntil" value="${toLocalInput(room.open_until)}">
        <p><button type="button" class="primary" data-act="wSave">時間帯を保存</button></p>
        <div class="row">
          <button type="button" data-act="wOpen">今すぐ開く</button>
          <button type="button" data-act="wClose">今すぐ閉じる</button>
          <button type="button" data-act="wExtend">30 分延長</button>
        </div>
        <p class="hint">試作（P1）では時間外でも操作できます。時間外の制限は P3 で入れます。</p>
      </section>
      <section class="card">
        <h2>メンバー（${ms.length}/${MAX_MEMBERS}）</h2>
        ${ms
          .map(
            (m) => `<div class="row" style="margin-bottom:6px">
              <input type="text" data-member="${m.id}" value="${esc(m.name)}" aria-label="名前">
              <button type="button" class="small danger" data-act="mDel" data-id="${m.id}" style="flex:0 0 auto">外す</button>
            </div>`,
          )
          .join('')}
        <div class="row">
          <button type="button" data-act="mSave">名前の変更を保存</button>
        </div>
        ${ms.length < MAX_MEMBERS ? `<div class="row" style="margin-top:8px">
          <input type="text" id="mNew" placeholder="追加する人の名前" aria-label="追加する人の名前">
          <button type="button" data-act="mAdd" style="flex:0 0 auto">追加</button>
        </div>` : ''}
      </section>
      <section class="card">
        <h2>この端末</h2>
        <p>あなた：<strong>${esc(mname(me))}</strong></p>
        <button type="button" data-act="who">別の人に切り替える</button>
        <p class="hint">「この端末の ID」（進行役の復旧用）は P2 で Firebase をつないだ後に表示します。</p>
      </section>
      <section class="card">
        <h2>データを消す</h2>
        <p class="muted">この端末に保存した部屋・メンバー・購入物をすべて消します。</p>
        <button type="button" class="danger" data-act="reset">すべて消す</button>
      </section>`;
  }

  function saveWindow(from, until) {
    if (from == null || until == null) return toast('開始と終了を入れてください');
    if (until <= from) return toast('終了は開始より後にしてください');
    S.updateRoom({ open_from: from, open_until: until });
    toast(`公開：${hm(from)}〜${hm(until)}`);
    render();
  }

  // ---- 操作の受け付け ----
  view.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b || b.disabled) return;
    const act = b.dataset.act;
    const id = b.dataset.id;
    const room = st().room;
    switch (act) {
      case 'create':
        return createRoom();
      case 'demo':
        return startDemo();
      case 'me':
        setMe(id);
        resetForm();
        return render();
      case 'day':
      case 'hall':
      case 'ab':
        syncText();
        if (act === 'day') ui.day = Number(b.dataset.day);
        else ui[act] = b.dataset[act];
        ui.picked = null;
        return renderInput();
      case 'kind':
        syncText();
        ui.kind = b.dataset.kind;
        ui.num = '';
        ui.picked = null;
        ui.manualName = '';
        ui.manualBlock = '';
        return renderInput();
      case 'pick':
        syncText();
        ui.picked = b.dataset.no;
        return updateLookup();
      case 'qty': {
        syncText();
        const q = Math.max(0, (ui.form.requests[id] || 0) + Number(b.dataset.d));
        if (q) ui.form.requests[id] = q;
        else delete ui.form.requests[id];
        $('#reqBlock').innerHTML = reqBlockHTML();
        return;
      }
      case 'asg':
        ui.form.assignee = id || null;
        $('#asgBlock').innerHTML = asgBlockHTML();
        return;
      case 'save':
        return save();
      case 'cancel':
        resetForm();
        return renderInput();
      case 'del':
        if (!armed(b, 'もう一度押すと削除')) return;
        S.setDeleted(ui.editing.id, true, me);
        resetForm();
        toast('削除しました');
        return render();
      case 'restore':
        S.setDeleted(id, false, me);
        toast('元に戻しました');
        return render();
      case 'join': {
        e.stopPropagation();
        S.setRequest(id, me, 1, me);
        toast('依頼人に加わりました（1 個）');
        return updateLookup();
      }
      case 'edit':
        return openEdit(id);
      case 'mode':
        ui.listMode = b.dataset.mode;
        return renderList();
      case 'csv':
        return downloadCSV();
      case 'copy':
        return copyText($('#exText').value, 'テキスト');
      case 'copyCsv':
        return copyText(L.toCSV(st().items, st().members), 'CSV');
      case 'print':
        return printView();
      case 'wSave':
        return saveWindow(fromLocalInput($('#wFrom').value), fromLocalInput($('#wUntil').value));
      case 'wOpen': {
        const now = Date.now();
        return saveWindow(now, Math.max(room.open_until, now + 30 * 60000));
      }
      case 'wClose': {
        const now = Date.now();
        return saveWindow(Math.min(room.open_from, now - 60000), now);
      }
      case 'wExtend':
        return saveWindow(room.open_from, Math.max(room.open_until, Date.now()) + 30 * 60000);
      case 'mSave': {
        const names = [...view.querySelectorAll('[data-member]')].map((i) => i.value.trim());
        if (names.some((n) => !n)) return toast('名前を空にはできません');
        if (new Set(names).size !== names.length) return toast('同じ名前が 2 人います');
        view.querySelectorAll('[data-member]').forEach((i) => S.renameMember(i.dataset.member, i.value.trim()));
        toast('保存しました');
        return render();
      }
      case 'mAdd': {
        const n = ($('#mNew').value || '').trim();
        if (!n) return toast('追加する人の名前を入れてください');
        if (st().members.some((m) => m.name === n)) return toast('同じ名前のメンバーがいます');
        const r = S.addMember(n);
        if (!r.ok) return toast(`メンバーは最大 ${MAX_MEMBERS} 人です`);
        return render();
      }
      case 'mDel': {
        if (id === me) return toast('自分自身は外せません');
        if (!armed(b, 'もう一度押す')) return;
        const r = S.removeMember(id);
        if (!r.ok) return toast('依頼人か請負人になっている購入物があるため外せません');
        return render();
      }
      case 'who':
        setMe(null);
        return render();
      case 'reset':
        if (!armed(b, 'もう一度押すと全部消えます')) return;
        setMe(null);
        resetForm();
        S.reset();
        return render();
    }
  });

  view.addEventListener('input', (e) => {
    if (e.target.id === 'numInput') {
      syncText();
      ui.num = e.target.value;
      ui.picked = null;
      updateLookup();
    } else if (e.target.id === 'manualBlock') {
      // 入力中の欄を書き換えないよう、下の 2 つだけ描き直す
      syncText();
      ui.manualBlock = e.target.value;
      const t = target();
      renderExisting(t);
      renderForm(t);
    } else if (e.target.id === 'manualName') {
      ui.manualName = e.target.value;
    }
  });

  view.addEventListener('change', (e) => {
    const id = e.target.id;
    if (id === 'fDay' || id === 'fKind' || id === 'fMember') {
      ui[id] = e.target.value;
      renderList();
    }
  });

  $('#tabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tab]');
    if (!b) return;
    if (ui.tab === 'input') syncText();
    ui.tab = b.dataset.tab;
    render();
    window.scrollTo(0, 0);
  });

  // 別タブ（P2 以降は別の端末）の変更を反映する。入力中の欄は書き換えない。
  S.subscribe(() => {
    const ready = st().room && me && st().members.some((m) => m.id === me);
    if (ui.tab === 'input' && ready && $('#existing')) {
      renderBanner();
      const t = target();
      renderExisting(t);
    } else render();
  });

  setInterval(renderBanner, 30000);
  render();
})();

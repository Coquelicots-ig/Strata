// 画面に依存しない処理（番号の正規化、検索、集計、出力）。ブラウザと Node の両方で読める。
(function (root) {
  'use strict';

  const KIND_LABEL = { circle: 'サークル', corporate: '企業' };

  // 開催日は曜日（'金' '土' '日' など）で持つ。並び順は setDayOrder で渡す。渡されなければ月〜日の順。
  let dayOrder = ['月', '火', '水', '木', '金', '土', '日'];
  function setDayOrder(list) {
    if (Array.isArray(list) && list.length) dayOrder = list.slice();
  }
  function dayRank(d) {
    const i = dayOrder.indexOf(d);
    return i < 0 ? dayOrder.length : i;
  }
  const dayLabel = (d) => `${d}曜`;

  // 全角→半角、空白と区切り記号を除く、数字を 2 桁に、末尾の a/b を小文字に。
  // 企業ブースの番号の実際の書き方は未確認。ここでは「企業」+数字の仮の形にそろえる。
  function normalizeNo(input, kind) {
    let s = String(input || '').normalize('NFKC').replace(/[\s\-‐−]/g, '');
    if (!s) return '';
    if (kind === 'corporate') {
      s = s.replace(/^企業/, '');
      return s ? '企業' + s : '';
    }
    const m = s.match(/^(.*?)(\d+)([abAB]?)$/);
    if (!m) return s;
    return m[1] + m[2].padStart(2, '0') + m[3].toLowerCase();
  }

  // 完全一致を探し、無ければ候補（大文字小文字の違い、ホール名の省略、a/b の省略）を最大 5 件返す。
  function findCatalog(catalog, day, kind, input) {
    const no = normalizeNo(input, kind);
    if (!no) return { no, exact: null, candidates: [] };
    const pool = catalog.filter((c) => c.day === day && c.kind === kind);
    const exact = pool.find((c) => c.circle_no === no) || null;
    let candidates = [];
    if (!exact) {
      const low = no.toLowerCase();
      candidates = pool
        .filter((c) => {
          const n = c.circle_no.toLowerCase();
          return n === low || (low.length >= 3 && (n.endsWith(low) || n.startsWith(low)));
        })
        .slice(0, 5);
    }
    return { no, exact, candidates };
  }

  const HALLS = ['東', '西', '南'];

  // カタログのサークル番号を「ホール・ブロック・数字・a/b」に分ける。形が違えば null。
  function parseSpace(no) {
    const m = String(no || '').match(/^(東|西|南)(.*?)(\d+)([ab])$/);
    return m ? { hall: m[1], block: m[2], num: parseInt(m[3], 10), ab: m[4] } : null;
  }

  function buildCircleNo(hall, block, num, ab) {
    return hall + (block || '') + String(num).padStart(2, '0') + ab;
  }

  // catalog.js は小さくするため [日, 種別(c/k), 番号, 名前] の配列で持つ。オブジェクトの形も受け付ける。
  function expandCatalog(raw) {
    return (raw || []).map((r) =>
      Array.isArray(r) ? { day: r[0], kind: r[1] === 'k' ? 'corporate' : 'circle', circle_no: r[2], circle_name: r[3] } : r,
    );
  }

  // 起動時に 1 回だけ作る索引。4〜5 万件でも、入力のたびに全件をなめないようにする。
  function createIndex(catalog) {
    const byKey = new Map(); // 日|種別|番号 → 行
    const bySpace = new Map(); // 日|ホール|数字|a/b → 行の配列（ブロック違い）
    const blocks = new Map(); // 日|ホール → ブロック文字の Set
    const corporate = [];
    for (const c of catalog) {
      byKey.set(`${c.day}|${c.kind}|${c.circle_no}`, c);
      if (c.kind === 'corporate') {
        corporate.push(c);
        continue;
      }
      const p = parseSpace(c.circle_no);
      if (!p) continue;
      c.block = p.block;
      const k = `${c.day}|${p.hall}|${p.num}|${p.ab}`;
      if (!bySpace.has(k)) bySpace.set(k, []);
      bySpace.get(k).push(c);
      const bk = `${c.day}|${p.hall}`;
      if (!blocks.has(bk)) blocks.set(bk, new Set());
      blocks.get(bk).add(p.block);
    }
    return { catalog, byKey, bySpace, blocks, corporate };
  }

  // 0: 大文字 1: 小文字 2: ひらがな 3: カタカナ 4: その他
  function blockType(b) {
    const ch = b.charAt(0);
    if (/[A-Z]/.test(ch)) return 0;
    if (/[a-z]/.test(ch)) return 1;
    if (/[\u3041-\u309F]/.test(ch)) return 2;
    if (/[\u30A0-\u30FF]/.test(ch)) return 3;
    return 4;
  }

  // その日・そのホールにあるブロックを、種類ごとの行に分けて返す（空の行は除く）。
  function blockGroups(index, day, hall) {
    const set = index.blocks.get(`${day}|${hall}`);
    const groups = [[], [], [], [], []];
    if (set) for (const b of set) groups[blockType(b)].push(b);
    groups.forEach((g) => g.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
    return groups.filter((g) => g.length);
  }

  // ホール・(ブロック)・数字・a/b で探す。block が null ならブロック違いをすべて返す。
  function findBySpace(index, day, hall, block, numInput, ab) {
    const digits = String(numInput || '').normalize('NFKC').replace(/\D/g, '');
    if (!digits) return { num: null, matches: [] };
    const num = parseInt(digits, 10);
    const all = index.bySpace.get(`${day}|${hall}|${num}|${ab}`) || [];
    const matches = block == null ? all.slice().sort((a, b) => (a.block < b.block ? -1 : 1)) : all.filter((c) => c.block === block);
    return { num, matches };
  }

  function totalQty(item) {
    return Object.values(item.requests || {}).reduce((a, b) => a + b, 0);
  }

  function memberName(members, id) {
    const m = members.find((x) => x.id === id);
    return m ? m.name : '(不明)';
  }

  function sortedMembers(members) {
    return members.slice().sort((a, b) => a.order - b.order);
  }

  // 依頼人をメンバー登録順に「名前×個数」で並べる。
  function requestList(item, members) {
    return sortedMembers(members)
      .filter((m) => (item.requests || {})[m.id] > 0)
      .map((m) => ({ id: m.id, name: m.name, qty: item.requests[m.id] }));
  }

  function formatRequests(item, members, sep) {
    return requestList(item, members).map((r) => `${r.name}×${r.qty}`).join(sep || ';');
  }

  function compareItems(a, b) {
    if (a.day !== b.day) return dayRank(a.day) - dayRank(b.day);
    if (a.kind !== b.kind) return a.kind === 'circle' ? -1 : 1;
    const c = a.circle_no.localeCompare(b.circle_no, 'ja');
    if (c) return c;
    return (a.created_at || 0) - (b.created_at || 0);
  }

  function csvCell(v) {
    const s = String(v ?? '');
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  const CSV_HEADER = ['曜日', '種別', 'サークル番号', 'サークル名', '購入物', '依頼人', '合計個数', '請負人', '備考'];

  function toCSV(items, members) {
    const rows = items
      .filter((i) => !i.deleted)
      .sort(compareItems)
      .map((i) => [
        i.day,
        KIND_LABEL[i.kind] || i.kind,
        i.circle_no,
        i.circle_name,
        i.item,
        formatRequests(i, members, ';'),
        totalQty(i),
        i.assignee ? memberName(members, i.assignee) : '',
        i.note || '',
      ]);
    return [CSV_HEADER, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
  }

  // ---- 重複 ----
  // 同じ曜日・場所で、購入物の名前が同じ（全角半角・空白・大文字小文字の違いは無視）なら重複とみなす
  function normItem(name) {
    return String(name || '').normalize('NFKC').replace(/\s+/g, '').toLowerCase();
  }
  function dupKey(i) {
    return `${i.day}|${i.kind}|${i.circle_no}|${normItem(i.item)}`;
  }
  // 重複している購入物の id の集合（削除済みは数えない）
  function findDuplicates(items) {
    const seen = new Map();
    for (const i of items) {
      if (i.deleted) continue;
      const k = dupKey(i);
      seen.set(k, (seen.get(k) || []).concat(i.id));
    }
    const ids = new Set();
    for (const list of seen.values()) if (list.length > 1) list.forEach((id) => ids.add(id));
    return ids;
  }
  // これから登録しようとしているもの（day, kind, circle_no, item）と同じものが既にあれば返す
  function findSame(items, draft) {
    const k = dupKey(draft);
    return items.find((i) => !i.deleted && dupKey(i) === k) || null;
  }

  // ---- 参加者ごとの確認 ----
  // memberId が「依頼したもの」（自分が依頼人）と「依頼されたもの」（自分が請負人）
  function memberReport(items, members, memberId) {
    const live = items.filter((i) => !i.deleted).sort(compareItems);
    const requested = live
      .filter((i) => (i.requests || {})[memberId] > 0)
      .map((i) => ({ item: i, qty: i.requests[memberId], to: i.assignee || null }));
    const assigned = live
      .filter((i) => i.assignee === memberId)
      .map((i) => ({ item: i, qty: totalQty(i), from: requestList(i, members) }));
    return { requested, assigned };
  }

  const MEMBER_CSV_HEADER = ['区分', '曜日', '種別', 'サークル番号', 'サークル名', '購入物', '個数', '相手', '内訳', '備考'];

  // 参加者 1 人ぶんの CSV。「依頼した」行の相手は請負人、「依頼された」行の相手は依頼人
  function toMemberCSV(items, members, memberId) {
    const { requested, assigned } = memberReport(items, members, memberId);
    const base = (i) => [i.day, KIND_LABEL[i.kind] || i.kind, i.circle_no, i.circle_name, i.item];
    const name = (id) => (id === memberId ? '自分' : memberName(members, id));
    const rows = [
      ...requested.map((r) => ['依頼した', ...base(r.item), r.qty, r.to ? name(r.to) : '未定', '', r.item.note || '']),
      ...assigned.map((r) => [
        '依頼された',
        ...base(r.item),
        r.qty,
        r.from.map((f) => name(f.id)).join(';'),
        r.from.map((f) => `${name(f.id)}×${f.qty}`).join(';'),
        r.item.note || '',
      ]),
    ];
    return [MEMBER_CSV_HEADER, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
  }

  function toMemberText(items, members, memberId) {
    const { requested, assigned } = memberReport(items, members, memberId);
    const name = (id) => (id === memberId ? '自分' : memberName(members, id));
    const where = (i) => `${dayLabel(i.day)} ${i.circle_no} ${i.circle_name}`;
    const out = [`■ ${memberName(members, memberId)} さん`, '', `【依頼したもの】${requested.length} 件`];
    for (const r of requested) {
      out.push(`・${where(r.item)}`);
      out.push(`  ${r.item.item} ×${r.qty} → ${r.to ? name(r.to) : '請負人 未定'}`);
      if (r.item.note) out.push(`  備考: ${r.item.note}`);
    }
    out.push('', `【依頼されたもの（買う物）】${assigned.length} 件`);
    for (const r of assigned) {
      out.push(`・${where(r.item)}`);
      out.push(`  ${r.item.item} 計${r.qty}（${r.from.map((f) => `${name(f.id)}×${f.qty}`).join('、')}）`);
      if (r.item.note) out.push(`  備考: ${r.item.note}`);
    }
    return out.join('\n') + '\n';
  }

  // LINE などに貼る、請負人ごとのテキスト。
  function toText(items, members) {
    const live = items.filter((i) => !i.deleted).sort(compareItems);
    const groups = [...sortedMembers(members).map((m) => m.id), null];
    const out = [];
    for (const g of groups) {
      const list = live.filter((i) => (i.assignee || null) === g);
      if (!list.length) continue;
      out.push(`■ ${g ? memberName(members, g) : '請負人 未定'}（${list.length} 件）`);
      for (const i of list) {
        out.push(`・${dayLabel(i.day)} ${i.circle_no} ${i.circle_name}`);
        out.push(`  ${i.item} 計${totalQty(i)}（${formatRequests(i, members, '、')}）`);
        if (i.note) out.push(`  備考: ${i.note}`);
      }
      out.push('');
    }
    return out.join('\n').trim() + '\n';
  }

  const api = { normItem, findDuplicates, findSame, memberReport, toMemberCSV, toMemberText, KIND_LABEL, setDayOrder, dayRank, dayLabel, HALLS, parseSpace, buildCircleNo, expandCatalog, createIndex, blockType, blockGroups, findBySpace, normalizeNo, findCatalog, totalQty, memberName, sortedMembers, requestList, formatRequests, compareItems, toCSV, toText };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ComiketLogic = api;
})(typeof window !== 'undefined' ? window : globalThis);

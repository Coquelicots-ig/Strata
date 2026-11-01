// 画面に依存しない処理（番号の正規化、検索、集計、出力）。ブラウザと Node の両方で読める。
(function (root) {
  'use strict';

  const KIND_LABEL = { circle: 'サークル', corporate: '企業' };

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
    if (a.day !== b.day) return a.day - b.day;
    if (a.kind !== b.kind) return a.kind === 'circle' ? -1 : 1;
    const c = a.circle_no.localeCompare(b.circle_no, 'ja');
    if (c) return c;
    return (a.created_at || 0) - (b.created_at || 0);
  }

  function csvCell(v) {
    const s = String(v ?? '');
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  const CSV_HEADER = ['何日目', '種別', 'サークル番号', 'サークル名', '購入物', '依頼人', '合計個数', '請負人', '備考'];

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
        out.push(`・${i.day}日目 ${i.circle_no} ${i.circle_name}`);
        out.push(`  ${i.item} 計${totalQty(i)}（${formatRequests(i, members, '、')}）`);
        if (i.note) out.push(`  備考: ${i.note}`);
      }
      out.push('');
    }
    return out.join('\n').trim() + '\n';
  }

  const api = { KIND_LABEL, normalizeNo, findCatalog, totalQty, memberName, sortedMembers, requestList, formatRequests, compareItems, toCSV, toText };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ComiketLogic = api;
})(typeof window !== 'undefined' ? window : globalThis);

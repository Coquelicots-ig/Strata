// 実行: node --test comiket-tool/tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const vm = require('node:vm');
const L = require('../app/logic.js');

function loadCatalog() {
  const ctx = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../app/catalog.js'), 'utf8'), ctx);
  return L.expandCatalog(JSON.parse(JSON.stringify(ctx.window.COMIKET_CATALOG))); // vm の別領域の配列を通常の配列に
}
function loadCatalogRaw() {
  return loadCatalog();
}

test('サークル番号の正規化', () => {
  assert.equal(L.normalizeNo('東A01a', 'circle'), '東A01a');
  assert.equal(L.normalizeNo('東Ａ１Ａ', 'circle'), '東A01a');
  assert.equal(L.normalizeNo(' 東 A-1 a ', 'circle'), '東A01a');
  assert.equal(L.normalizeNo('西あ5b', 'circle'), '西あ05b');
  assert.equal(L.normalizeNo('東A01', 'circle'), '東A01');
  assert.equal(L.normalizeNo('', 'circle'), '');
});

test('企業ブース番号の正規化（仮の形）', () => {
  assert.equal(L.normalizeNo('101', 'corporate'), '企業101');
  assert.equal(L.normalizeNo('１０１', 'corporate'), '企業101');
  assert.equal(L.normalizeNo('企業101', 'corporate'), '企業101');
});

test('検索：完全一致・日が違う同じ番号・候補', () => {
  const cat = loadCatalog();
  assert.equal(L.findCatalog(cat, '金', 'circle', '東a1a').exact, null);
  assert.equal(L.findCatalog(cat, '金', 'circle', '東A1a').exact.circle_name, 'ダミーサークル壱');
  assert.equal(L.findCatalog(cat, '土', 'circle', '東A01a').exact.circle_name, '土曜ダミー壱');
  assert.equal(L.findCatalog(cat, '金', 'corporate', '101').exact.circle_name, 'ダミー出版');
  // ホール名を省いた入力は候補に出る
  const r = L.findCatalog(cat, '金', 'circle', 'A1a');
  assert.equal(r.exact, null);
  assert.deepEqual(r.candidates.map((c) => c.circle_no), ['東A01a']);
  // a/b を省くと両方が候補に出る
  assert.deepEqual(L.findCatalog(cat, '金', 'circle', '東A1').candidates.map((c) => c.circle_no), ['東A01a', '東A01b']);
  // 大文字小文字の違いは候補に出る
  assert.deepEqual(L.findCatalog(cat, '金', 'circle', '東a01a').candidates.map((c) => c.circle_no), ['東A01a']);
});

const members = [
  { id: 'a', name: 'Aさん', order: 0 },
  { id: 'b', name: 'Bさん', order: 1 },
  { id: 'c', name: 'Cさん', order: 2 },
];
const items = [
  { id: '2', day: '土', kind: 'circle', circle_no: '東C07a', circle_name: 'X', item: '新刊', requests: { a: 1 }, assignee: null, note: '', deleted: false },
  { id: '1', day: '金', kind: 'corporate', circle_no: '企業101', circle_name: 'Y', item: 'グッズ, "限定"', requests: { b: 2, a: 1 }, assignee: 'c', note: '1000円', deleted: false },
  { id: '0', day: '金', kind: 'circle', circle_no: '東A01a', circle_name: 'Z', item: '本', requests: { c: 1 }, assignee: 'a', note: '', deleted: false },
  { id: '9', day: '金', kind: 'circle', circle_no: '東A01a', circle_name: 'Z', item: '消した', requests: { c: 1 }, assignee: 'a', note: '', deleted: true },
];

test('合計個数と依頼人の並び（メンバー登録順）', () => {
  assert.equal(L.totalQty(items[1]), 3);
  assert.equal(L.formatRequests(items[1], members), 'Aさん×1;Bさん×2');
});

test('CSV：見出し、並び順、削除済みを除く、エスケープ', () => {
  const lines = L.toCSV(items, members).trim().split('\r\n');
  assert.equal(lines[0], '曜日,種別,サークル番号,サークル名,購入物,依頼人,合計個数,請負人,備考');
  assert.equal(lines.length, 4);
  assert.equal(lines[1], '金,サークル,東A01a,Z,本,Cさん×1,1,Aさん,');
  assert.equal(lines[2], '金,企業,企業101,Y,"グッズ, ""限定""",Aさん×1;Bさん×2,3,Cさん,1000円');
  assert.equal(lines[3], '土,サークル,東C07a,X,新刊,Aさん×1,1,,');
});

test('テキスト：請負人ごと、未定は最後', () => {
  const t = L.toText(items, members);
  const heads = t.split('\n').filter((l) => l.startsWith('■'));
  assert.deepEqual(heads, ['■ Aさん（1 件）', '■ Cさん（1 件）', '■ 請負人 未定（1 件）']);
  assert.ok(!t.includes('消した'));
});

test('索引を使った検索（ブロックは指定してもしなくてもよい）', () => {
  const cat = L.expandCatalog(loadCatalogRaw());
  const idx = L.createIndex(cat);
  const no = (r) => r.matches.map((c) => c.circle_no);
  assert.deepEqual(no(L.findBySpace(idx, '金', '東', null, '12', 'a')), ['東B12a']);
  // ブロック指定なし：ブロック違い（東A01a と 東B01a）が 2 件
  assert.deepEqual(no(L.findBySpace(idx, '金', '東', null, '１', 'a')), ['東A01a', '東B01a']);
  // ブロック指定あり：1 件に絞れる
  assert.deepEqual(no(L.findBySpace(idx, '金', '東', 'B', '1', 'a')), ['東B01a']);
  assert.deepEqual(no(L.findBySpace(idx, '金', '東', 'A', '01', 'b')), ['東A01b']);
  assert.deepEqual(no(L.findBySpace(idx, '金', '西', null, '1', 'a')), []);
  assert.deepEqual(no(L.findBySpace(idx, '日', '西', 'う', '10', 'b')), ['西う10b']);
  assert.equal(L.findBySpace(idx, '金', '東', null, '', 'a').num, null);
  assert.equal(idx.byKey.get('金|corporate|企業101').circle_name, 'ダミー出版');
  assert.deepEqual(L.parseSpace('西あ05b'), { hall: '西', block: 'あ', num: 5, ab: 'b' });
  assert.equal(L.buildCircleNo('南', '', 7, 'a'), '南07a');
});

test('ブロックの並び：大文字・小文字・ひらがな・カタカナの行に分ける', () => {
  const idx = L.createIndex(L.expandCatalog(loadCatalogRaw()));
  assert.deepEqual(L.blockGroups(idx, '金', '東'), [['A', 'B', 'C'], ['ア', 'イ']]);
  assert.deepEqual(L.blockGroups(idx, '金', '西'), [['b'], ['あ']]);
  assert.deepEqual(L.blockGroups(idx, '土', '南'), [['f']]);
});

test('重複：同じ場所・同じ購入物（表記ゆれは無視）', () => {
  const base = { day: '金', kind: 'circle', circle_no: '東A01a', circle_name: 'Z', requests: { a: 1 }, assignee: null, note: '', deleted: false };
  const list = [
    { ...base, id: 'x', item: '新刊' },
    { ...base, id: 'y', item: ' 新刊 ' },
    { ...base, id: 'z', item: '既刊' },
    { ...base, id: 'w', item: '新刊', day: '土' },
    { ...base, id: 'd', item: '新刊', deleted: true },
  ];
  assert.deepEqual([...L.findDuplicates(list)].sort(), ['x', 'y']);
  assert.equal(L.findSame(list, { day: '金', kind: 'circle', circle_no: '東A01a', item: 'しんかん' }), null);
  assert.equal(L.findSame(list, { day: '金', kind: 'circle', circle_no: '東A01a', item: 'ＮＥＷ' }), null);
  assert.equal(L.findSame(list, { day: '金', kind: 'circle', circle_no: '東A01a', item: '既刊' }).id, 'z');
});

test('参加者ごと：依頼したもの・依頼されたもの', () => {
  const rep = L.memberReport(items, members, 'a');
  // a は 3 件を依頼（東C07a は請負人未定）、1 件を請け負う（東A01a）
  assert.deepEqual(rep.requested.map((r) => [r.item.id, r.qty, r.to]), [['1', 1, 'c'], ['2', 1, null]]);
  assert.deepEqual(rep.assigned.map((r) => [r.item.id, r.qty]), [['0', 1]]);
  const csv = L.toMemberCSV(items, members, 'a').trim().split('\r\n');
  assert.equal(csv[0], '区分,曜日,種別,サークル番号,サークル名,購入物,個数,相手,内訳,備考');
  assert.equal(csv[1], '依頼した,金,企業,企業101,Y,"グッズ, ""限定""",1,Cさん,,1000円');
  assert.equal(csv[2], '依頼した,土,サークル,東C07a,X,新刊,1,未定,,');
  assert.equal(csv[3], '依頼された,金,サークル,東A01a,Z,本,1,Cさん,Cさん×1,');
  assert.equal(csv.length, 4);
  // 自分で依頼して自分で買う場合は、相手が「自分」
  const self = [{ ...items[2], requests: { a: 2 }, assignee: 'a' }];
  assert.equal(L.toMemberCSV(self, members, 'a').trim().split('\r\n')[1], '依頼した,金,サークル,東A01a,Z,本,2,自分,,');
  const t = L.toMemberText(items, members, 'a');
  assert.match(t, /【依頼したもの】2 件/);
  assert.match(t, /【依頼されたもの（買う物）】1 件/);
});

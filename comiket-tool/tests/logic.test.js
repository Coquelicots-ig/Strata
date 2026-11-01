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
  return JSON.parse(JSON.stringify(ctx.window.COMIKET_CATALOG)); // vm の別領域の配列を通常の配列に
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
  assert.equal(L.findCatalog(cat, 1, 'circle', '東a1a').exact, null);
  assert.equal(L.findCatalog(cat, 1, 'circle', '東A1a').exact.circle_name, 'ダミーサークル壱');
  assert.equal(L.findCatalog(cat, 2, 'circle', '東A01a').exact.circle_name, '二日目ダミー壱');
  assert.equal(L.findCatalog(cat, 1, 'corporate', '101').exact.circle_name, 'ダミー出版');
  // ホール名を省いた入力は候補に出る
  const r = L.findCatalog(cat, 1, 'circle', 'A1a');
  assert.equal(r.exact, null);
  assert.deepEqual(r.candidates.map((c) => c.circle_no), ['東A01a']);
  // a/b を省くと両方が候補に出る
  assert.deepEqual(L.findCatalog(cat, 1, 'circle', '東A1').candidates.map((c) => c.circle_no), ['東A01a', '東A01b']);
  // 大文字小文字の違いは候補に出る
  assert.deepEqual(L.findCatalog(cat, 1, 'circle', '東a01a').candidates.map((c) => c.circle_no), ['東A01a']);
});

const members = [
  { id: 'a', name: 'Aさん', order: 0 },
  { id: 'b', name: 'Bさん', order: 1 },
  { id: 'c', name: 'Cさん', order: 2 },
];
const items = [
  { id: '2', day: 2, kind: 'circle', circle_no: '東C07a', circle_name: 'X', item: '新刊', requests: { a: 1 }, assignee: null, note: '', deleted: false },
  { id: '1', day: 1, kind: 'corporate', circle_no: '企業101', circle_name: 'Y', item: 'グッズ, "限定"', requests: { b: 2, a: 1 }, assignee: 'c', note: '1000円', deleted: false },
  { id: '0', day: 1, kind: 'circle', circle_no: '東A01a', circle_name: 'Z', item: '本', requests: { c: 1 }, assignee: 'a', note: '', deleted: false },
  { id: '9', day: 1, kind: 'circle', circle_no: '東A01a', circle_name: 'Z', item: '消した', requests: { c: 1 }, assignee: 'a', note: '', deleted: true },
];

test('合計個数と依頼人の並び（メンバー登録順）', () => {
  assert.equal(L.totalQty(items[1]), 3);
  assert.equal(L.formatRequests(items[1], members), 'Aさん×1;Bさん×2');
});

test('CSV：見出し、並び順、削除済みを除く、エスケープ', () => {
  const lines = L.toCSV(items, members).trim().split('\r\n');
  assert.equal(lines[0], '何日目,種別,サークル番号,サークル名,購入物,依頼人,合計個数,請負人,備考');
  assert.equal(lines.length, 4);
  assert.equal(lines[1], '1,サークル,東A01a,Z,本,Cさん×1,1,Aさん,');
  assert.equal(lines[2], '1,企業,企業101,Y,"グッズ, ""限定""",Aさん×1;Bさん×2,3,Cさん,1000円');
  assert.equal(lines[3], '2,サークル,東C07a,X,新刊,Aさん×1,1,,');
});

test('テキスト：請負人ごと、未定は最後', () => {
  const t = L.toText(items, members);
  const heads = t.split('\n').filter((l) => l.startsWith('■'));
  assert.deepEqual(heads, ['■ Aさん（1 件）', '■ Cさん（1 件）', '■ 請負人 未定（1 件）']);
  assert.ok(!t.includes('消した'));
});

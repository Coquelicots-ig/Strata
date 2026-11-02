// スマホ幅のブラウザで P1 の一連の操作を通す。
// 実行: node comiket-tool/tests/e2e.js [スクリーンショットの保存先フォルダ]
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '../app');
const SHOTS = process.argv[2] || null;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

function serve() {
  const srv = http.createServer((req, res) => {
    const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]).replace(/^\/$/, '/index.html'));
    if (!p.startsWith(ROOT) || !fs.existsSync(p)) {
      res.writeHead(404);
      return res.end();
    }
    res.writeHead(200, { 'content-type': (TYPES[path.extname(p)] || 'text/plain') + '; charset=utf-8' });
    fs.createReadStream(p).pipe(res);
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r(srv)));
}

// ブロックを「指定なし」にしてホールと a/b をタップし、数字を入れる。ブロック違いの候補が出たら pick のブロックを選ぶ
async function space(page, hall, num, ab, pick) {
  await page.click('#slot [data-slot="0"]');
  await page.click(`[data-act=hall][data-hall="${hall}"]`);
  await page.click(`[data-act=ab][data-ab="${ab}"]`);
  await page.fill('#numInput', num);
  if (pick) await page.click(`#lookup [data-act=block][data-block="${pick}"]`);
}

// スロットの中で hall・block の行をタップする（block が null なら「指定なし」）
async function pickBlock(page, hall, block) {
  const k = await page.evaluate(
    ([h, b]) =>
      [...document.querySelectorAll('#slot .slot-item')].findIndex((el) =>
        b == null ? el.classList.contains('none') : el.querySelector('.sh')?.textContent === h && el.querySelector('.sb')?.textContent === b,
      ),
    [hall, block],
  );
  assert.ok(k >= 0, `スロットに ${hall} ${block} がありません`);
  await page.click(`#slot [data-slot="${k}"]`);
}

async function selectedSlot(page) {
  return (await page.textContent('#slot .slot-item.on')).replace(/\s+/g, '');
}

async function plus(page, nth) {
  await page.click(`#reqBlock [data-act=qty][data-d="1"] >> nth=${nth}`);
}

async function shot(page, name) {
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name + '.png'), fullPage: true });
}

(async () => {
  const srv = await serve();
  const url = `http://127.0.0.1:${srv.address().port}/`;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, acceptDownloads: true });
  const errors = [];
  const p1 = await ctx.newPage();
  p1.on('pageerror', (e) => errors.push(e.message));

  // 部屋を作る
  await p1.goto(url);
  await p1.fill('#sMembers', 'Aさん\nBさん\nCさん');
  await shot(p1, '0-setup');
  await p1.click('[data-act=create]');
  await p1.click('[data-act=me]:has-text("Aさん")');

  // ホール・数字・a/b で探す。全角の数字でもよい。ブロック違いが 2 件あるので選ぶ
  await space(p1, '東', '１', 'a', 'A');
  assert.match(await p1.textContent('#lookup .found, #lookup .cands'), /ダミーサークル壱/);
  // 購入物は「新刊」、依頼人の個数は全員 0 で始まる
  assert.equal(await p1.inputValue('#fItem'), '新刊');
  assert.deepEqual(await p1.locator('#reqBlock .qty').allTextContents(), ['0', '0', '0']);
  await p1.click('[data-act=save]');
  assert.match(await p1.textContent('#toast'), /依頼人を 1 人以上/);
  await p1.fill('#fItem', '新刊セット');
  await plus(p1, 0); // Aさん +1
  await plus(p1, 1); // Bさん +1
  await plus(p1, 1); // Bさん +1
  await p1.click('#asgBlock button:has-text("Cさん")');
  await p1.fill('#fNote', '1000円');
  await shot(p1, '1-input');
  await p1.click('[data-act=save]');
  assert.equal(await p1.locator('#existing .item').count(), 1);
  assert.match(await p1.textContent('#existing .item'), /計3/);
  assert.equal(await p1.inputValue('#fItem'), '新刊'); // 登録後も新刊に戻る

  // 選んだブロック A は残るので、数字と b だけで東A01b が出る
  assert.equal(await selectedSlot(p1), '東A');
  await p1.click('[data-act=ab][data-ab="b"]');
  assert.match(await p1.textContent('#lookup .found'), /ダミーサークル弐/);
  // ブロック ア を選んで 3 と打つ
  await p1.click('[data-act=ab][data-ab="a"]');
  await pickBlock(p1, '東', 'ア');
  await p1.fill('#numInput', '3');
  assert.match(await p1.textContent('#lookup .found'), /アブロック堂/);
  // スロットを指で回したのと同じく、スクロールを止めた位置のブロックが選ばれ、ホールも変わる
  const westA = await p1.evaluate(() => [...document.querySelectorAll('#slot .slot-item')].findIndex((el) => el.textContent.replace(/\s+/g, '') === '西あ'));
  await p1.evaluate((k) => { document.querySelector('#slot').scrollTop = k * 48; }, westA);
  await p1.waitForFunction(() => document.querySelector('#hallSeg .on')?.textContent === '西');
  assert.equal(await selectedSlot(p1), '西あ');
  // ブロックを選んでいる時にホールをタップすると、そのホールの最初のブロックへ回る
  await p1.click('[data-act=hall][data-hall="南"]');
  assert.equal(await selectedSlot(p1), '南c');
  await pickBlock(p1, null, null);

  // 日曜
  await p1.click('[data-act=day][data-day="日"]');
  await space(p1, '西', '10', 'b');
  assert.match(await p1.textContent('#lookup .found'), /日曜サンプル/);
  await p1.click('[data-act=day][data-day="金"]');

  // カタログに無い番号 → 名前を手入力、請負人は未定
  await space(p1, '南', '99', 'a');
  assert.match(await p1.textContent('#lookup'), /カタログにありません/);
  await p1.fill('#fItem', '既刊');
  await plus(p1, 0);
  await p1.click('[data-act=save]');
  assert.match(await p1.textContent('#toast'), /名前を入れてください/);
  await p1.fill('#manualName', '手入力サークル');
  await p1.click('[data-act=save]');

  // 企業ブース
  await p1.click('[data-act=kind][data-kind=corporate]');
  assert.equal(await p1.locator('[data-act=hall]').count(), 0);
  await p1.fill('#numInput', '101');
  assert.match(await p1.textContent('#lookup .found'), /ダミー出版/);
  await p1.fill('#fItem', '限定グッズ');
  await plus(p1, 0);
  await p1.click('#asgBlock button:has-text("Aさん")');
  await p1.click('[data-act=save]');
  await p1.click('[data-act=kind][data-kind=circle]');

  // 一覧：未定 1 件
  await p1.click('#tabs [data-tab=list]');
  assert.match(await p1.textContent('.alert'), /未定：1 件/);
  await shot(p1, '2-list');

  // 2 台目（同じブラウザの別タブ）で B さんとして同時に操作する
  const p2 = await ctx.newPage();
  p2.on('pageerror', (e) => errors.push(e.message));
  await p2.goto(url);
  // 同じ端末なので「自分」は共有される。B さんに切り替える
  await p2.click('#tabs [data-tab=settings]');
  await p2.click('[data-act=who]');
  await p2.click('[data-act=me]:has-text("Bさん")');
  await p2.click('#tabs [data-tab=input]');

  // A さんが新刊セットを編集し始める
  await p1.click('.item.tap:has-text("新刊セット")');
  // その間に B さんが「自分も依頼」…は既に依頼済みなので、手入力サークルの既刊に加わる
  await space(p2, '南', '99', 'a');
  await p2.click('[data-act=join]');
  // B さんが新刊セットの備考を変えて保存
  await space(p2, '東', '1', 'a', 'A');
  await p2.click('#existing [data-act=edit]');
  await p2.fill('#fNote', '1000円・開場直後');
  await p2.click('[data-act=save]');
  // A さんの保存は衝突として止まる
  await p1.click('#asgBlock button:has-text("Aさん")');
  await p1.click('[data-act=save]');
  assert.match(await p1.textContent('#toast'), /Bさん が先に更新しました/);
  assert.equal(await p1.inputValue('#fNote'), '1000円・開場直後');
  // 最新の内容で選び直して保存できる
  await p1.click('#asgBlock button:has-text("Aさん")');
  await p1.click('[data-act=save]');
  assert.match(await p1.textContent('#toast'), /保存しました/);
  // 一覧から編集に来たので、保存後は一覧に戻る
  assert.equal(await p1.getAttribute('#tabs [data-tab=list]', 'class'), 'on');
  await p1.click('#tabs [data-tab=input]');

  // 依頼人の個数はキーごとの更新：A さんの編集中に B さんが加わっても消えない
  await space(p1, '南', '99', 'a');
  await p1.click('#existing [data-act=edit]');
  await space(p2, '南', '99', 'a');
  await p2.click('#existing [data-act=edit]');
  await p2.click('#reqBlock [data-act=qty][data-d="1"] >> nth=2'); // Cさん +1
  await p2.click('[data-act=save]');
  await p1.click('#reqBlock [data-act=qty][data-d="1"] >> nth=0'); // Aさん +1 → 2
  await p1.click('[data-act=save]');
  // version は依頼人の変更では上がらないので、A さんの保存は通る
  const items = await p1.evaluate(() => window.Store.get().items);
  const z = items.find((i) => i.circle_no === '南99a');
  const byName = Object.fromEntries((await p1.evaluate(() => window.Store.get().members)).map((m) => [m.name, m.id]));
  assert.equal(z.requests[byName['Aさん']], 2);
  assert.equal(z.requests[byName['Bさん']], 1);
  assert.equal(z.requests[byName['Cさん']], 1);

  // 出力：CSV
  await p1.click('#tabs [data-tab=export]');
  const [dl] = await Promise.all([p1.waitForEvent('download'), p1.click('[data-act=csv]')]);
  const csv = fs.readFileSync(await dl.path(), 'utf8');
  assert.ok(csv.startsWith('﻿曜日,種別,サークル番号'));
  const lines = csv.trim().split('\r\n');
  assert.equal(lines.length, 4);
  assert.ok(lines.includes('金,サークル,東A01a,ダミーサークル壱,新刊セット,Aさん×1;Bさん×2,3,Aさん,1000円・開場直後'), lines.join('\n'));
  assert.equal(lines[3], '金,企業,企業101,ダミー出版,限定グッズ,Aさん×1,1,Aさん,');
  await shot(p1, '3-export');

  // 設定：30 分延長でバナーの終了時刻が変わる
  await p1.click('#tabs [data-tab=settings]');
  const before = await p1.evaluate(() => window.Store.get().room.open_until);
  await p1.click('[data-act=wExtend]');
  const after = await p1.evaluate(() => window.Store.get().room.open_until);
  assert.equal(after - Math.max(before, Date.now() - 5000) >= 30 * 60000 - 10000, true);
  await shot(p1, '4-settings');

  // メンバー追加はページ内の入力欄で
  await p1.fill('#mNew', 'Dさん');
  await p1.click('[data-act=mAdd]');
  assert.equal(await p1.evaluate(() => window.Store.get().members.length), 4);

  // 開催日は部屋ごとに変えられる（土曜から 3 日間 → 土・日・月）
  await p1.selectOption('#dDayStart', '土');
  await p1.selectOption('#dDayCount', '3');
  assert.equal(await p1.textContent('#dDayPreview'), '土曜・日曜・月曜');
  await p1.click('[data-act=daysSave]');
  await p1.click('#tabs [data-tab=input]');
  assert.deepEqual(await p1.locator('[data-act=day]').allTextContents(), ['土曜', '日曜', '月曜']);
  await p1.click('#tabs [data-tab=settings]');

  // デモデータで始める
  await p1.click('[data-act=reset]');
  await p1.click('[data-act=reset]');
  await p1.click('[data-act=demo]');
  await p1.click('[data-act=me]:has-text("Aさん")');
  await p1.click('#tabs [data-tab=list]');
  assert.match(await p1.textContent('.alert'), /未定：1 件/);
  assert.equal(await p1.locator('.item.tap').count(), 10);

  // ---- 会議の流れ：重複・訂正・未定の後回し・参加者ごとの出力 ----
  await p1.click('#tabs [data-tab=input]');
  await p1.click('[data-act=day][data-day="金"]');
  await space(p1, '東', '1', 'a', 'A');
  await p1.fill('#fItem', '新刊セット'); // デモに同じ物がある
  await plus(p1, 3); // Dさん
  await p1.click('[data-act=save]');
  assert.match(await p1.textContent('#dupBox'), /同じ購入物が登録済みです/);
  assert.equal(await p1.locator('#existing .item').count(), 2); // まだ登録されていない
  await p1.click('[data-act=dupAdd]');
  assert.equal(await p1.locator('#existing .item').count(), 3);
  assert.equal(await p1.locator('#existing .badge.warnb').count(), 2);
  // 「ここの登録済み」から片方を削除（2 回押し）
  const dupDel = p1.locator('#existing .item:has(.badge.warnb) [data-act=delQuick]').last();
  await dupDel.click();
  await dupDel.click();
  assert.equal(await p1.locator('#existing .item').count(), 2);
  assert.equal(await p1.locator('#existing .badge.warnb').count(), 0);

  // 未定を後回しにして、一覧から決める。保存したら一覧に戻る
  await p1.click('#tabs [data-tab=list]');
  await p1.click('[data-act=onlyUnassigned]');
  assert.equal(await p1.locator('.item.tap').count(), 1);
  await p1.click('.item.tap');
  await p1.click('#asgBlock button:has-text("Bさん")');
  await p1.click('[data-act=save]');
  assert.equal(await p1.getAttribute('#tabs [data-tab=list]', 'class'), 'on');
  assert.match(await p1.textContent('.okmsg'), /全件の請負人が決まりました/);

  // 参加者ごとの出力（Aさん）
  await p1.click('#tabs [data-tab=export]');
  assert.match(await p1.inputValue('#exText'), /■ Aさん さん/);
  assert.match(await p1.inputValue('#exText'), /【依頼したもの】/);
  const [mdl] = await Promise.all([p1.waitForEvent('download'), p1.click('[data-act=mCsv]')]);
  assert.match(mdl.suggestedFilename(), /^comiket-buntan-member01-\d{8}-\d{4}\.csv$/);
  const mcsv = fs.readFileSync(await mdl.path(), 'utf8');
  assert.ok(mcsv.startsWith('﻿区分,曜日,種別,サークル番号,サークル名,購入物,個数,相手,内訳,備考'));
  assert.ok(mcsv.includes('依頼された,'), mcsv);
  // 別の参加者に切り替え
  await p1.selectOption('#exMember', { label: 'Eさん' });
  assert.match(await p1.inputValue('#exText'), /■ Eさん さん/);

  // 横にはみ出していないこと
  const overflow = await p1.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(overflow <= 0, `横スクロールが出ています: ${overflow}px`);

  assert.deepEqual(errors, []);
  await browser.close();
  srv.close();
  console.log('e2e: ok');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

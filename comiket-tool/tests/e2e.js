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
  p1.on('dialog', (d) => d.accept());

  // 部屋を作る
  await p1.goto(url);
  await p1.fill('#sMembers', 'Aさん\nBさん\nCさん');
  await shot(p1, '0-setup');
  await p1.click('[data-act=create]');
  await p1.click('[data-act=me]:has-text("Aさん")');

  // 全角・大文字小文字違いの入力 → 候補から選ぶ
  await p1.fill('#noInput', '東ａ１ａ');
  await p1.click('[data-act=pick]:has-text("東A01a")');
  assert.match(await p1.textContent('#lookup .found'), /ダミーサークル壱/);
  await p1.fill('#fItem', '新刊セット');
  await p1.click('[data-act=qty][data-d="1"] >> nth=1'); // Bさん +1
  await p1.click('[data-act=qty][data-d="1"] >> nth=1'); // Bさん +1
  await p1.click('#asgBlock button:has-text("Cさん")');
  await p1.fill('#fNote', '1000円');
  await shot(p1, '1-input');
  await p1.click('[data-act=save]');
  assert.equal(await p1.locator('#existing .item').count(), 1);
  assert.match(await p1.textContent('#existing .item'), /計3/);

  // カタログに無い番号 → 名前を手入力、請負人は未定
  await p1.fill('#noInput', '東Z99a');
  assert.match(await p1.textContent('#lookup'), /カタログにありません/);
  await p1.fill('#fItem', '既刊');
  await p1.click('[data-act=save]');
  assert.match(await p1.textContent('#toast'), /名前を入れてください/);
  await p1.fill('#manualName', '手入力サークル');
  await p1.click('[data-act=save]');

  // 企業ブース
  await p1.click('[data-act=kind][data-kind=corporate]');
  await p1.fill('#noInput', '101');
  assert.match(await p1.textContent('#lookup .found'), /ダミー出版/);
  await p1.fill('#fItem', '限定グッズ');
  await p1.click('#asgBlock button:has-text("Aさん")');
  await p1.click('[data-act=save]');

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
  await p2.fill('#noInput', '東Z99a');
  await p2.click('[data-act=join]');
  // B さんが新刊セットの備考を変えて保存
  await p2.fill('#noInput', '東A01a');
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

  // 依頼人の個数はキーごとの更新：A さんの編集中に B さんが加わっても消えない
  await p1.fill('#noInput', '東Z99a');
  await p1.click('#existing [data-act=edit]');
  await p2.fill('#noInput', '東Z99a');
  await p2.click('#existing [data-act=edit]');
  await p2.click('#reqBlock [data-act=qty][data-d="1"] >> nth=2'); // Cさん +1
  await p2.click('[data-act=save]');
  await p1.click('#reqBlock [data-act=qty][data-d="1"] >> nth=0'); // Aさん +1 → 2
  await p1.click('[data-act=save]');
  // version は依頼人の変更では上がらないので、A さんの保存は通る
  const items = await p1.evaluate(() => window.Store.get().items);
  const z = items.find((i) => i.circle_no === '東Z99a');
  const byName = Object.fromEntries((await p1.evaluate(() => window.Store.get().members)).map((m) => [m.name, m.id]));
  assert.equal(z.requests[byName['Aさん']], 2);
  assert.equal(z.requests[byName['Bさん']], 1);
  assert.equal(z.requests[byName['Cさん']], 1);

  // 出力：CSV
  await p1.click('#tabs [data-tab=export]');
  const [dl] = await Promise.all([p1.waitForEvent('download'), p1.click('[data-act=csv]')]);
  const csv = fs.readFileSync(await dl.path(), 'utf8');
  assert.ok(csv.startsWith('﻿何日目,種別,サークル番号'));
  const lines = csv.trim().split('\r\n');
  assert.equal(lines.length, 4);
  assert.equal(lines[1], '1,サークル,東A01a,ダミーサークル壱,新刊セット,Aさん×1;Bさん×2,3,Aさん,1000円・開場直後');
  assert.equal(lines[3], '1,企業,企業101,ダミー出版,限定グッズ,Aさん×1,1,Aさん,');
  await shot(p1, '3-export');

  // 設定：30 分延長でバナーの終了時刻が変わる
  await p1.click('#tabs [data-tab=settings]');
  const before = await p1.evaluate(() => window.Store.get().room.open_until);
  await p1.click('[data-act=wExtend]');
  const after = await p1.evaluate(() => window.Store.get().room.open_until);
  assert.equal(after - Math.max(before, Date.now() - 5000) >= 30 * 60000 - 10000, true);
  await shot(p1, '4-settings');

  // デモデータで始める
  await p1.click('[data-act=reset]');
  await p1.click('[data-act=demo]');
  await p1.click('[data-act=me]:has-text("Aさん")');
  await p1.click('#tabs [data-tab=list]');
  assert.match(await p1.textContent('.alert'), /未定：1 件/);
  assert.equal(await p1.locator('.item.tap').count(), 9);

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

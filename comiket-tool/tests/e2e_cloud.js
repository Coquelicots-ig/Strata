// Firestore 版（P2/P3）を、偽の Firebase（エミュレーター）で 2 台ぶん動かして確かめる。
// 実行（comiket-tool フォルダで）:
//   python3 tools/build_hosting.py --firebase <node_modules/firebase> --out <dist>
//   npx firebase emulators:exec --only auth,firestore --project demo-comiket "node tests/e2e_cloud.js <dist>"
// --project を demo- で始めると、本物の Firebase には一切つながらない。
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const DIST = path.resolve(process.argv[2]);
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

function serve() {
  const srv = http.createServer((req, res) => {
    const name = decodeURIComponent(req.url.split('?')[0]).replace(/^\/$/, '/index.html');
    const p = path.join(DIST, name);
    if (!p.startsWith(DIST) || !fs.existsSync(p)) {
      res.writeHead(404);
      return res.end();
    }
    res.writeHead(200, { 'content-type': (TYPES[path.extname(p)] || 'text/plain') + '; charset=utf-8' });
    fs.createReadStream(p).pipe(res);
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r(srv)));
}

const pad = (n) => String(n).padStart(2, '0');
function local(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

async function space(page, hall, num, ab) {
  await page.click('#slot [data-slot="0"]');
  await page.click(`[data-act=hall][data-hall="${hall}"]`);
  await page.click(`[data-act=ab][data-ab="${ab}"]`);
  await page.fill('#numInput', num);
}

(async () => {
  const srv = await serve();
  const base = `http://127.0.0.1:${srv.address().port}/?emulator=1`;
  const browser = await chromium.launch();
  const errors = [];
  const newPhone = async () => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errors.push(e.message));
    if (process.env.DEBUG) p.on('console', (m) => console.log('[page]', m.type(), m.text().slice(0, 300)));
    return p;
  };

  // ---- 進行役：部屋を作る ----
  const org = await newPhone();
  await org.goto(base);
  await org.waitForSelector('#sMembers');
  assert.equal(await org.locator('[data-act=demo]').count(), 0, 'Firestore 版ではデモを出さない');
  await org.fill('#sMembers', 'Aさん\nBさん\nCさん');
  await org.selectOption('#sDayStart', '金');
  await org.selectOption('#sDayCount', '3');
  const now = Date.now();
  await org.fill('#sFrom', local(now - 60 * 60000));
  await org.fill('#sUntil', local(now + 3 * 3600000));
  await org.click('[data-act=create]');
  await org.waitForSelector('[data-act=me]');
  assert.match(org.url(), /[?&]room=[A-Za-z0-9]{20}/);
  await org.click('[data-act=me]:has-text("Aさん")');
  await org.waitForSelector('#tabs:not([hidden])');
  await org.click('#tabs [data-tab=settings]');
  const roomUrl = await org.inputValue('#shareUrl');
  assert.match(roomUrl, /room=/);
  assert.ok(await org.locator('[data-act=daysSave]').count(), '進行役には開催日の設定が出る');
  console.log('部屋を作った:', roomUrl.replace(/room=\w+/, 'room=…'));

  // ---- メンバー：URL から入る ----
  const mem = await newPhone();
  await mem.goto(roomUrl);
  await mem.click('[data-act=me]:has-text("Bさん")');
  await mem.waitForSelector('#tabs:not([hidden])');
  await mem.click('#tabs [data-tab=settings]');
  assert.equal(await mem.locator('[data-act=daysSave]').count(), 0, 'メンバーには開催日の設定が出ない');
  assert.equal(await mem.locator('[data-act=reset]').count(), 0, 'メンバーには「すべて消す」が出ない');
  await mem.click('#tabs [data-tab=input]');

  // メンバーが登録 → 進行役の画面にすぐ出る
  await mem.click('[data-act=day][data-day="金"]');
  await space(mem, '南', '99', 'a');
  await mem.fill('#manualName', '手入力サークル');
  await mem.click('#reqBlock [data-act=qty][data-d="1"] >> nth=1'); // Bさん
  await mem.click('[data-act=save]');
  await org.click('#tabs [data-tab=list]');
  await org.waitForFunction(() => document.querySelectorAll('.item.tap').length === 1);
  assert.match(await org.textContent('.item.tap'), /手入力サークル/);
  console.log('メンバーの登録が進行役の画面に出た');

  // 依頼人の個数は、別の端末から同時に足しても消えない
  await org.click('.item.tap');
  await org.click('#reqBlock [data-act=qty][data-d="1"] >> nth=0'); // Aさん +1（保存はまだ）
  await mem.click('#existing [data-act=edit]');
  await mem.click('#reqBlock [data-act=qty][data-d="1"] >> nth=2'); // Cさん +1
  await mem.click('#asgBlock button:has-text("Bさん")');
  await mem.click('[data-act=save]');
  await org.waitForFunction(() => window.Store.get().items[0].version === 2);
  // 進行役は請負人を変えようとして保存 → 先に B さんが変えたので止まる
  await org.click('#asgBlock button:has-text("Aさん")');
  await org.click('[data-act=save]');
  await org.waitForFunction(() => /先に更新しました/.test(document.querySelector('#toast').textContent));
  // 最新の内容（請負人 Bさん）で開き直されている。A さんの個数を足して保存
  await org.click('#reqBlock [data-act=qty][data-d="1"] >> nth=0');
  await org.click('[data-act=save]');
  await org.waitForFunction(() => {
    const r = window.Store.get().items[0].requests;
    return Object.keys(r).length === 3;
  });
  const it = await org.evaluate(() => window.Store.get().items[0]);
  const ms = Object.fromEntries((await org.evaluate(() => window.Store.get().members)).map((m) => [m.name, m.id]));
  assert.equal(it.requests[ms['Aさん']], 1);
  assert.equal(it.requests[ms['Bさん']], 1);
  assert.equal(it.requests[ms['Cさん']], 1);
  assert.equal(it.assignee, ms['Bさん']);
  console.log('同時編集：依頼人は両方残り、請負人の上書きは止まった');

  // ---- ルール：メンバーは部屋の設定を変えられない ----
  const denied = await mem.evaluate(async () => {
    const rid = new URLSearchParams(location.search).get('room');
    try {
      await firebase.firestore().collection('rooms').doc(rid).update({ name: 'のっとり' });
      return 'ok';
    } catch (e) {
      return e.code;
    }
  });
  assert.equal(denied, 'permission-denied');
  // 部屋の一覧は誰も取れない
  const listDenied = await mem.evaluate(async () => {
    try {
      await firebase.firestore().collection('rooms').get();
      return 'ok';
    } catch (e) {
      return e.code;
    }
  });
  assert.equal(listDenied, 'permission-denied');
  // 名前を選んでいない端末は、購入物を読めない
  const stranger = await newPhone();
  await stranger.goto(roomUrl);
  await stranger.waitForSelector('[data-act=me]');
  const strangerRead = await stranger.evaluate(async () => {
    const rid = new URLSearchParams(location.search).get('room');
    try {
      await firebase.firestore().collection('rooms').doc(rid).collection('items').get();
      return 'ok';
    } catch (e) {
      return e.code;
    }
  });
  assert.equal(strangerRead, 'permission-denied');
  console.log('ルール：部屋の設定の変更・部屋の一覧・名前を選ぶ前の読み取りは拒否された');

  // ---- 時間外：進行役が「今すぐ閉じる」→ メンバーは開けなくなる。進行役は出力できる ----
  await org.click('#tabs [data-tab=settings]');
  await org.click('[data-act=wClose]');
  await mem.waitForFunction(() => /部屋を開けません/.test(document.querySelector('#view').textContent), null, { timeout: 15000 });
  const writeAfterClose = await mem.evaluate(async () => {
    const rid = new URLSearchParams(location.search).get('room');
    try {
      await firebase.firestore().collection('rooms').doc(rid).collection('items').doc('x').set({ item: 'a' });
      return 'ok';
    } catch (e) {
      return e.code;
    }
  });
  assert.equal(writeAfterClose, 'permission-denied');
  await org.click('#tabs [data-tab=export]');
  assert.match(await org.inputValue('#exText'), /手入力サークル/);
  console.log('時間外：メンバーは開けず書けない。進行役は出力できる');

  // 延長すると、メンバーは開き直せば戻れる
  await org.click('#tabs [data-tab=settings]');
  await org.click('[data-act=wExtend]');
  await org.waitForTimeout(500);
  await mem.reload();
  await mem.waitForSelector('#tabs:not([hidden])', { timeout: 15000 });
  console.log('延長後、メンバーは開き直して戻れた');

  // ---- 進行役が部屋を消す ----
  await org.click('[data-act=reset]');
  await org.click('[data-act=reset]');
  await org.waitForSelector('#sMembers', { timeout: 15000 });
  assert.doesNotMatch(org.url(), /room=/);
  await mem.reload();
  await mem.waitForFunction(() => /部屋を開けません/.test(document.querySelector('#view').textContent), null, { timeout: 15000 });
  console.log('進行役が部屋を消し、メンバーは開けなくなった');

  assert.deepEqual(errors, []);
  await browser.close();
  srv.close();
  console.log('e2e_cloud: ok');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

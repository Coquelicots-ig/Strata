// 会議のない期間のルール（firestore.closed.rules）で、何も読み書きできないことを確かめる。
// 実行（comiket-tool フォルダで）:
//   npx firebase emulators:exec --config firebase.closed.json --only auth,firestore --project demo-comiket "node tests/e2e_closed.js <dist>"
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const DIST = path.resolve(process.argv[2]);

(async () => {
  const srv = http.createServer((req, res) => {
    const p = path.join(DIST, decodeURIComponent(req.url.split('?')[0]).replace(/^\/$/, '/index.html'));
    if (!p.startsWith(DIST) || !fs.existsSync(p)) {
      res.writeHead(404);
      return res.end();
    }
    res.writeHead(200, { 'content-type': p.endsWith('.js') ? 'text/javascript' : p.endsWith('.css') ? 'text/css' : 'text/html' });
    fs.createReadStream(p).pipe(res);
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${srv.address().port}/?emulator=1`);
  await page.waitForFunction(() => window.Store && window.Store.deviceId());

  const tries = await page.evaluate(async () => {
    const db = firebase.firestore();
    const uid = firebase.auth().currentUser.uid;
    const now = Date.now();
    const T = firebase.firestore.Timestamp;
    const run = async (f) => {
      try {
        await f();
        return 'ok';
      } catch (e) {
        return e.code;
      }
    };
    return {
      createRoom: await run(() =>
        db.collection('rooms').doc('r1').set({ name: 'x', days: [], open_from: T.fromMillis(now - 1000), open_until: T.fromMillis(now + 99999), owner_uid: uid }),
      ),
      readRoom: await run(() => db.collection('rooms').doc('r1').get()),
      listRooms: await run(() => db.collection('rooms').get()),
      writeOther: await run(() => db.collection('anything').doc('a').set({ a: 1 })),
    };
  });
  assert.deepEqual(tries, { createRoom: 'permission-denied', readRoom: 'permission-denied', listRooms: 'permission-denied', writeOther: 'permission-denied' });

  // 画面から部屋を作ろうとしても作れない
  await page.fill('#sMembers', 'Aさん');
  await page.click('[data-act=create]');
  await page.waitForFunction(() => /部屋を作れませんでした/.test(document.querySelector('#toast').textContent));
  await browser.close();
  srv.close();
  console.log('e2e_closed: ok（部屋の作成・読み取り・一覧・ほかの書き込みはすべて拒否）');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

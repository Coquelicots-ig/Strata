// 大きなカタログでの起動と検索の時間を測る。
// 実行: node comiket-tool/tests/perf.js 大きいcatalog.js [CPU を何倍遅くするか(既定 4)]
// 大きい catalog.js は tools/make_synthetic_catalog.py → tools/convert_catalog.py で作る。
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '../app');
const BIG = process.argv[2];
const SLOW = Number(process.argv[3] || 4);
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

(async () => {
  const srv = http.createServer((req, res) => {
    const name = decodeURIComponent(req.url.split('?')[0]).replace(/^\/$/, '/index.html');
    const p = name === '/catalog.js' ? BIG : path.join(ROOT, name);
    if (!fs.existsSync(p)) {
      res.writeHead(404);
      return res.end();
    }
    res.writeHead(200, { 'content-type': (TYPES[path.extname(p)] || 'text/plain') + '; charset=utf-8' });
    fs.createReadStream(p).pipe(res);
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${srv.address().port}/`;
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: SLOW });

  const t0 = Date.now();
  await page.goto(url, { waitUntil: 'load' });
  const loadMs = Date.now() - t0;
  const n = await page.evaluate(() => window.COMIKET_CATALOG.length);

  // 索引づくりだけの時間（起動時に 1 回）
  const indexMs = await page.evaluate(() => {
    const L = window.ComiketLogic;
    const t = performance.now();
    L.createIndex(L.expandCatalog(window.COMIKET_CATALOG));
    return performance.now() - t;
  });

  // 画面を使えるようにして、番号を 1 文字打つたびの時間
  await page.click('[data-act=demo]');
  await page.click('[data-act=me] >> nth=0');
  // テンキーを 1 回押すごとの時間（押す → 検索 → 表示）
  const keyMs = await page.evaluate(async () => {
    const times = [];
    for (const k of ['clr', '1', '2', 'clr', '3', '3']) {
      const t = performance.now();
      document.querySelector(`.keypad [data-k="${k}"]`).click();
      times.push(performance.now() - t);
    }
    return times;
  });
  const blockMs = await page.evaluate(() => {
    const t = performance.now();
    document.querySelector('[data-act=hall][data-hall="西"]').click();
    return performance.now() - t;
  });

  console.log(`カタログ ${n} 件、CPU ${SLOW} 倍遅く`);
  console.log(`ページの読み込み（ローカル通信、索引づくりを含む）: ${loadMs} ms`);
  console.log(`索引づくりだけ: ${indexMs.toFixed(0)} ms`);
  console.log(`テンキーを 1 回押すごと: ${keyMs.map((x) => x.toFixed(1)).join(', ')} ms`);
  console.log(`ホールを切り替え（ブロックのボタンを描き直す）: ${blockMs.toFixed(1)} ms`);
  await browser.close();
  srv.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

// Headless end-to-end check: start screen -> YouTube + avatar sync -> mobile layout.
// PLAYWRIGHT_PACKAGE=<path to playwright package> node tests/browser_check.cjs [url] [videoId]
const { chromium } = require(process.env.PLAYWRIGHT_PACKAGE || 'playwright');
const assert = require('node:assert/strict');
const out = process.env.OUT_DIR || __dirname;
const site = process.argv[2] || 'http://127.0.0.1:8000/';
const video = process.argv[3] || 'DFzHl3hhexs';
(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const report = {};
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => m.type() === 'error' && errors.push('console: ' + m.text()));
    await page.goto(site);
    await page.screenshot({ path: out + '/shot_start.png' });
    await page.fill('#url', `https://www.youtube.com/watch?v=${video}`);
    await page.click('#startButton');
    await page.waitForFunction(() => window.signSite.timeline, null, { timeout: 180000 });
    await page.waitForFunction(() => window.signSite.yt?.getPlayerState, null, { timeout: 60000 });
    const info = await page.evaluate(() => ({ segments: window.signSite.segments.length, events: window.signSite.timeline.events.length,
      clips: window.signSite.timeline.events.filter(e => e.kind === 'clip').length, status: document.getElementById('playerStatus').textContent }));
    report.translate = info;
    assert.ok(info.clips > 0, 'no motion clips in timeline');
    // Seek to the first clip, paused: avatar must not be in rest pose and the gloss chip must be active.
    const firstClip = await page.evaluate(() => { const e = window.signSite.timeline.events.find(e => e.kind === 'clip'); return (e.t0 + e.t1) / 2; });
    await page.evaluate(t => { const p = window.signSite.yt; p.mute(); p.seekTo(t, true); p.pauseVideo(); }, firstClip);
    await page.waitForTimeout(2500);
    report.paused_seek = await page.evaluate(() => ({ t: window.signSite.yt.getCurrentTime(), state: window.signSite.yt.getPlayerState(),
      ko: document.getElementById('koCaption').textContent, active: document.querySelector('.chip.active')?.textContent || null,
      chips: [...document.querySelectorAll('.chip')].map(c => c.textContent + (c.classList.contains('missing') ? '(x)' : '')) }));
    await page.screenshot({ path: out + '/shot_desktop.png' });
    // Play: time advances and captions follow.
    await page.evaluate(() => window.signSite.yt.playVideo());
    await page.waitForTimeout(4000);
    report.playing = await page.evaluate(() => ({ t: window.signSite.yt.getCurrentTime(), state: window.signSite.yt.getPlayerState(),
      ko: document.getElementById('koCaption').textContent, active: document.querySelector('.chip.active')?.textContent || null }));
    await page.evaluate(() => window.signSite.yt.pauseVideo());
    // Mobile layout: panes stacked.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(800);
    report.mobile = await page.evaluate(() => { const [a, b] = document.querySelectorAll('.pane'); const r1 = a.getBoundingClientRect(), r2 = b.getBoundingClientRect();
      return { stacked: r2.top >= r1.bottom - 1, width: r1.width, scrollX: document.documentElement.scrollWidth > innerWidth }; });
    await page.screenshot({ path: out + '/shot_mobile.png', fullPage: true });
    report.errors = errors;
    console.log(JSON.stringify(report, null, 2));
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });

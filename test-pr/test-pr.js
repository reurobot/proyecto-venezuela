import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('https://proyecto-venezuela.vercel.app/');
   await page.waitForLoadState('networkidle');
   // Ensure UI is ready
   await page.waitForTimeout(1000);
   const loanBtn = await page.waitForSelector('button:has-text("Préstamos")', { timeout: 15000 });
   await loanBtn.click();
  await page.waitForTimeout(2000);
  // Check button visibility
  const display = await page.evaluate(() => {
    const btn = document.getElementById('consolidadoBtn');
    return btn ? window.getComputedStyle(btn).display : null;
  });
  console.log('display after Préstamos:', display);
  // Get position info (offset top relative to document)
  const rect = await page.evaluate(() => {
    const btn = document.getElementById('consolidadoBtn');
    if (!btn) return null;
    const r = btn.getBoundingClientRect();
    return {top: r.top, left: r.left, width: r.width, height: r.height};
  });
  console.log('rect:', rect);
  await browser.close();
})();

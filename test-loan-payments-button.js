const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto('https://proyecto-venezuela.vercel.app/');
  // login as admin
  await page.waitForSelector('input[placeholder="Usuario"]', { timeout: 15000 });
  await page.fill('input[placeholder="Usuario"]', 'admin');
  await page.fill('input[placeholder="Contraseña"]', '123');
  await page.click('button:has-text("Ingresar")');
  await page.waitForNavigation({ waitUntil: 'networkidle', timeout: 15000 });
  // navigate to Préstamos via button text
  await page.waitForSelector('button:has-text("Préstamos")', { timeout: 15000 });
  await page.click('button:has-text("Préstamos")');
  // wait some time for button to appear
  await page.waitForTimeout(2000);
  // check button display
  const display = await page.evaluate(() => {
    const btn = document.getElementById('consolidadoBtn');
    return btn ? btn.style.display : null;
  });
  console.log('Button display after navigation:', display);
  // click the button if visible
  if (display === 'block') {
    await page.click('#consolidadoBtn button');
    await page.waitForNavigation({ waitUntil: 'networkidle', timeout: 15000 });
    console.log('Navigated to loan payments page, URL:', page.url());
  } else {
    console.log('Button not visible, cannot click');
  }
  await browser.close();
})();

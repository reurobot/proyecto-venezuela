import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto('https://proyecto-venezuela.vercel.app/');
  // wait for page load
  await page.waitForLoadState('networkidle');
  // Perform login (admin credentials)
  const emailSel = 'input[type="email"], input[name="email"]';
  const passSel = 'input[type="password"], input[name="password"]';
  await page.waitForSelector(emailSel, { timeout: 10000 });
  await page.fill(emailSel, 'admin@ijinvestmentgroup.com');
  await page.fill(passSel, 'Admin123!');
  // click login button (first button?)
  const loginBtn = await page.waitForSelector('button[type="submit"], button', { timeout: 5000 });
  await loginBtn.click();
  await page.waitForNavigation({ waitUntil: 'networkidle', timeout: 15000 });
  // locate Nuevo Préstamo button
  const newLoanBtn = await page.waitForSelector('button:has-text("Nuevo Préstamo")', { timeout: 15000 });
  const classAttr = await newLoanBtn.getAttribute('class');
  console.log('Nuevo Préstamo button class:', classAttr);
  console.log('outerHTML:', await newLoanBtn.evaluate(node => node.outerHTML));
  await browser.close();
})();

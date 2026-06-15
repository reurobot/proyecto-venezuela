import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto('https://proyecto-venezuela.vercel.app/');

  // Ensure the page loaded
  await page.waitForTimeout(2000);

  // Helper to get button display style
  const getDisplay = async () => {
    return await page.evaluate(() => {
      const btn = document.getElementById('consolidadoBtn');
      return btn ? window.getComputedStyle(btn).display : null;
    });
  };

  // Navigate to Dashboard (should hide button)
  const dashboardBtn = await page.$('button:has-text("Dashboard")');
  if (dashboardBtn) {
    await dashboardBtn.click();
    await page.waitForTimeout(1000);
    console.log('After Dashboard, display =', await getDisplay());
  }

  // Navigate to Préstamos (loans)
  const loansBtn = await page.$('button:has-text("Préstamos")');
  if (loansBtn) {
    await loansBtn.click();
    // give time for toggle (500ms + reaction)
    await page.waitForTimeout(1500);
    console.log('After Préstamos, display =', await getDisplay());
  }

  // Navigate to Clientes (should hide again)
  const clientesBtn = await page.$('button:has-text("Clientes")');
  if (clientesBtn) {
    await clientesBtn.click();
    await page.waitForTimeout(1000);
    console.log('After Clientes, display =', await getDisplay());
  }

  await browser.close();
})();

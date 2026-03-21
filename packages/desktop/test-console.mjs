import { _electron as electron } from 'playwright';

(async () => {
  try {
    const electronApp = await electron.launch({
      args: ['.'],
      cwd: '/home/saran/phantom/packages/desktop'
    });

    const window = await electronApp.firstWindow();
    
    // Log all errors and console output from the Electron Chromium renderer!
    window.on('console', msg => console.log('ELECTRON_BROWSER_CONSOLE:', msg.text()));
    window.on('pageerror', err => console.log('ELECTRON_PAGE_ERROR:', err.message));
    
    await window.waitForTimeout(5000);
    
    const hasPhantom = await window.evaluate(() => !!(window).phantom);
    console.log("hasPhantom boolean over IPC eval:", hasPhantom);
    
    await electronApp.close();
  } catch (err) {
    console.error("Test failed: ", err);
    process.exit(1);
  }
})();

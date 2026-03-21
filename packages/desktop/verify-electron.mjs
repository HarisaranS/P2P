import { _electron as electron } from 'playwright';

(async () => {
  try {
    const electronApp = await electron.launch({
      args: ['.'],
      cwd: '/home/saran/phantom/packages/desktop'
    });

    const window = await electronApp.firstWindow();
    
    // Wait for React to load
    await window.waitForSelector('text=+ START NEW CHAT', { timeout: 15000 });
    console.log("ELECTRON UI RENDERED. Tor Daemon executing...");
    
    // Check Tor explicit boot 
    await window.waitForFunction(() => document.body.innerText.includes('Tor: CONNECTED'), { timeout: 20000 });
    console.log("TOR CIRCUIT BOUND EXPLICITLY TO SYSTEM DEAMON.");
    
    // Click Generate Identity
    await window.click('text=GENERATE IDENTITY');
    console.log("CRYPTOGRAPHIC GENERATION INITIATED.");
    
    // Wait for the ID string which indicates successful creation
    await window.waitForSelector('text=My ID:', { timeout: 5000 });
    console.log("IDENTITY GENERATED NATIVELY. UI UPDATED.");
    
    const idText = await window.textContent('text=My ID:');
    
    console.log("SUCCESSFULLY GENERATED P2P IDENTITY:", idText);
    
    await electronApp.close();
  } catch (err) {
    console.error("Test failed: ", err);
    process.exit(1);
  }
})();

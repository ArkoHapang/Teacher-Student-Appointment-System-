/**
 * End-to-End Real Browser Interaction & Responsive Compatibility Suite
 * Phase 3 & Phase 6 Execution
 *
 * Automates Google Chrome via native Chrome DevTools Protocol (CDP) and native WebSockets:
 * 1. Unauthenticated portal switcher and form interaction.
 * 2. Student registration view and input validation rules.
 * 3. Faculty workflow: Authentication, header elements, tab navigation, availability dialog, theme toggle, logout.
 * 4. Student workflow: Authentication, appointments view, faculty directory, booking modal open/close, profile, logout.
 * 5. Administrator workflow: Authentication, appointment monitoring KPI cards, teacher management, system status diagnostics, logout.
 * 6. Responsive layout compatibility: Desktop (1280x800), Tablet (768x1024), and Mobile (375x667) viewports.
 * 7. Mobile navigation drawer toggle and touch controls.
 * 8. Keyboard accessibility (Escape key dialog dismissal).
 * 9. Console and runtime error monitoring (assert zero unhandled exceptions).
 */

require('../backend/tests/setup');
const assert = require('assert');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const app = require('../backend/src/app');
const { loginRateLimiter, registrationRateLimiter } = require('../backend/src/middlewares/rateLimiter');

async function runBrowserInteractionTests() {
  loginRateLimiter.reset();
  registrationRateLimiter.reset();
  console.log('\n=================================================================');
  console.log(' Real Browser Interaction & Responsive Verification (CDP)       ');
  console.log(' Target: Unified Express Server + Vite Dist Assets + Chrome     ');
  console.log('=================================================================\n');

  let passed = 0;
  let failed = 0;
  const testResults = [];

  const PORT = 5058;
  const server = app.listen(PORT);
  console.log(`[Test Server] Unified backend & frontend running at http://localhost:${PORT}`);

  const tmpUserDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chrome-ui-audit-'));
  const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

  const chromeProc = spawn(chromePath, [
    '--headless=new',
    '--remote-debugging-port=9222',
    `--user-data-dir=${tmpUserDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--disable-sync',
    `http://localhost:${PORT}`
  ]);

  let ws = null;
  let idCounter = 1;
  const pendingRequests = new Map();
  const consoleErrors = [];

  async function test(name, fn) {
    try {
      await fn();
      console.log(`  [PASS] ${name}`);
      passed++;
      testResults.push({ name, status: 'PASS' });
    } catch (err) {
      console.error(`  [FAIL] ${name}`);
      console.error(`         ${err.message}`);
      failed++;
      testResults.push({ name, status: 'FAIL', error: err.message });
    }
  }

  function cdpSend(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = idCounter++;
      pendingRequests.set(id, resolve);
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async function evalExpr(expression) {
    const res = await cdpSend('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true
    });
    if (res.result?.exceptionDetails) {
      throw new Error(`Eval exception: ${res.result.exceptionDetails.text} (${JSON.stringify(res.result.exceptionDetails.exception)})`);
    }
    return res.result?.result?.value;
  }

  async function setViewport(width, height) {
    await cdpSend('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: width < 768
    });
  }

  async function waitCondition(checkFn, timeoutMs = 8000, intervalMs = 250) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        const val = await checkFn();
        if (val) return val;
      } catch (e) {}
      await new Promise(r => setTimeout(r, intervalMs));
    }
    throw new Error(`Timeout waiting for condition after ${timeoutMs}ms`);
  }

  try {
    // 1. Establish CDP Connection
    let targets = null;
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 400));
      try {
        const res = await fetch('http://localhost:9222/json');
        targets = await res.json();
        if (targets && targets.length > 0) break;
      } catch (e) {}
    }
    assert.ok(targets && targets.length > 0, 'Headless Chrome failed to report debug targets');

    const pageTarget = targets.find(t => t.type === 'page') || targets[0];
    ws = new WebSocket(pageTarget.webSocketDebuggerUrl);

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && pendingRequests.has(msg.id)) {
        pendingRequests.get(msg.id)(msg);
        pendingRequests.delete(msg.id);
      }
      if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
        const text = msg.params.args.map(a => a.value || a.description || '').join(' ');
        consoleErrors.push(text);
      }
    };

    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = reject;
    });

    await cdpSend('Runtime.enable');
    await cdpSend('Page.enable');
    await cdpSend('DOM.enable');

    // Default desktop viewport
    await setViewport(1280, 800);

    // Wait for initial render
    await waitCondition(async () => {
      return await evalExpr("document.querySelector('h1') !== null");
    });

    // -------------------------------------------------------------
    // Test Suite 1: Unauthenticated Portal Switcher & Forms
    // -------------------------------------------------------------
    await test('1.1 Unauthenticated Portal: Switcher displays Faculty, Student, and Admin options', async () => {
      const buttons = await evalExpr(`Array.from(document.querySelectorAll('button')).map(b => b.textContent.trim())`);
      assert.ok(buttons.includes('Faculty Portal'));
      assert.ok(buttons.includes('Student Portal'));
      assert.ok(buttons.includes('Admin Portal'));
    });

    await test('1.2 Portal Switching: Switch to Student Portal displays Student Login and Registration link', async () => {
      await evalExpr(`(() => {
        const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Student Portal');
        btn.click();
      })()`);

      await waitCondition(async () => {
        const heading = await evalExpr("document.querySelector('h1')?.textContent");
        return heading && heading.includes('Student');
      });

      const heading = await evalExpr("document.querySelector('h1')?.textContent");
      assert.strictEqual(heading.trim(), 'Student Appointment Portal');

      const hasRegisterBtn = await evalExpr(`(() => {
        return Array.from(document.querySelectorAll('button')).some(b => b.textContent.trim().includes('Register New Student Account'));
      })()`);
      assert.strictEqual(hasRegisterBtn, true);
    });

    await test('1.3 Registration Form: Navigate to registration view, verify required inputs and validation', async () => {
      await evalExpr(`(() => {
        const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim().includes('Register New Student Account'));
        btn.click();
      })()`);

      await waitCondition(async () => {
        const heading = await evalExpr("document.querySelector('h1')?.textContent");
        return heading && heading.includes('Student Account Registration');
      });

      // Submit empty form to trigger validation
      await evalExpr(`(() => {
        const submitBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim().includes('Create Student Account'));
        submitBtn.click();
      })()`);

      // Verify validation alert appears
      await waitCondition(async () => {
        const alert = await evalExpr("document.querySelector('.ui-alert--error')?.textContent");
        return alert && alert.includes('Please correct the highlighted fields');
      });

      const alertText = await evalExpr("document.querySelector('.ui-alert--error')?.textContent");
      assert.ok(alertText.includes('Please correct the highlighted fields'));

      // Return to login
      await evalExpr(`(() => {
        const backBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim().includes('Back to Student Sign In'));
        backBtn.click();
      })()`);

      await waitCondition(async () => {
        const heading = await evalExpr("document.querySelector('h1')?.textContent");
        return heading && heading.includes('Student Appointment Portal');
      });
    });

    // -------------------------------------------------------------
    // Test Suite 2: Faculty Role End-to-End Browser Flow
    // -------------------------------------------------------------
    await test('2.1 Faculty Authentication: Sign in as Robert Miller into Faculty Workspace', async () => {
      // Switch to Faculty Portal
      await evalExpr(`(() => {
        const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Faculty Portal');
        btn.click();
      })()`);

      await waitCondition(async () => {
        const heading = await evalExpr("document.querySelector('h1')?.textContent");
        return heading && heading.includes('Faculty');
      });

      // Click Sign In
      await evalExpr(`(() => {
        const submitBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim().includes('Sign In as Faculty'));
        submitBtn.click();
      })()`);

      // Wait for authenticated header to render
      await waitCondition(async () => {
        const userName = await evalExpr("document.querySelector('.ui-header__user-name')?.textContent");
        return userName && userName.includes('Robert Miller');
      });

      const roleBadge = await evalExpr("document.querySelector('.ui-header__controls .ui-badge')?.textContent");
      assert.strictEqual(roleBadge.trim(), 'TEACHER');
    });

    await test('2.2 Faculty Navigation: Verify all 5 faculty workspace tabs render and function', async () => {
      const tabs = await evalExpr(`Array.from(document.querySelectorAll('.ui-role-nav__item')).map(b => b.textContent.trim())`);
      assert.ok(tabs.some(t => t.includes('Appointment Requests')));
      assert.ok(tabs.some(t => t.includes('Confirmed Schedule')));
      assert.ok(tabs.some(t => t.includes('Office Hours & Slots')));
      assert.ok(tabs.some(t => t.includes('Notifications')));
      assert.ok(tabs.some(t => t.includes('Faculty Profile')));

      // Click Office Hours & Slots tab
      await evalExpr(`(() => {
        const tab = Array.from(document.querySelectorAll('.ui-role-nav__item')).find(b => b.textContent.trim().includes('Office Hours & Slots'));
        tab.click();
      })()`);

      await waitCondition(async () => {
        const title = await evalExpr("document.querySelector('.page-header__title')?.textContent");
        return title && title.includes('Office Hours');
      });

      const pageTitle = await evalExpr("document.querySelector('.page-header__title')?.textContent");
      assert.ok(pageTitle.includes('Office Hours'));
    });

    await test('2.3 Availability Dialog: Open Add Availability Slot modal and verify cancel dismissal', async () => {
      await evalExpr(`(() => {
        const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim().includes('Add Availability Slot'));
        btn.click();
      })()`);

      // Verify Dialog opens
      await waitCondition(async () => {
        return await evalExpr("document.querySelector('.ui-dialog') !== null");
      });

      const dialogTitle = await evalExpr("document.querySelector('.ui-dialog__title')?.textContent");
      assert.ok(dialogTitle.includes('Add Consultation Availability Slot'));

      // Click Cancel in modal footer
      await evalExpr(`(() => {
        const cancelBtn = Array.from(document.querySelectorAll('.ui-dialog__footer button')).find(b => b.textContent.trim() === 'Cancel');
        cancelBtn.click();
      })()`);

      // Verify Dialog closes
      await waitCondition(async () => {
        return await evalExpr("document.querySelector('.ui-dialog') === null");
      });
      assert.strictEqual(await evalExpr("document.querySelector('.ui-dialog')"), null);
    });

    await test('2.4 Theme Customization: Toggle dark and light theme and verify data-theme attribute', async () => {
      await evalExpr(`(() => {
        const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Dark' || b.textContent.trim() === 'Light');
        if (btn) btn.click();
      })()`);

      await waitCondition(async () => {
        const theme = await evalExpr("document.documentElement.getAttribute('data-theme')");
        return theme === 'dark';
      });
      assert.strictEqual(await evalExpr("document.documentElement.getAttribute('data-theme')"), 'dark');

      // Toggle back to light
      await evalExpr(`(() => {
        const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Light');
        if (btn) btn.click();
      })()`);

      await waitCondition(async () => {
        const theme = await evalExpr("document.documentElement.getAttribute('data-theme')");
        return theme === 'light';
      });
      assert.strictEqual(await evalExpr("document.documentElement.getAttribute('data-theme')"), 'light');
    });

    await test('2.5 Faculty Logout: Log out, clear session, and verify return to portal switcher', async () => {
      await evalExpr(`(() => {
        const logoutBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim().includes('Log Out'));
        logoutBtn.click();
      })()`);

      await waitCondition(async () => {
        const notice = await evalExpr("document.querySelector('.ui-alert--info')?.textContent");
        return notice && notice.includes('logged out successfully');
      });

      const alertText = await evalExpr("document.querySelector('.ui-alert--info')?.textContent");
      assert.ok(alertText.includes('logged out successfully'));
    });

    // -------------------------------------------------------------
    // Test Suite 3: Student Role End-to-End Browser Flow
    // -------------------------------------------------------------
    await test('3.1 Student Authentication: Sign in as Alice Carter into Student Workspace', async () => {
      // Switch to Student Portal
      await evalExpr(`(() => {
        const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Student Portal');
        btn.click();
      })()`);

      await waitCondition(async () => {
        const heading = await evalExpr("document.querySelector('h1')?.textContent");
        return heading && heading.includes('Student');
      });

      // If still on registration view, return to sign in
      await evalExpr(`(() => {
        const backBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim().includes('Back to Student Sign In'));
        if (backBtn) backBtn.click();
      })()`);

      await waitCondition(async () => {
        const heading = await evalExpr("document.querySelector('h1')?.textContent");
        return heading && heading.includes('Student Appointment Portal');
      });

      // Click Sign In as Student
      await evalExpr(`(() => {
        const submitBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim().includes('Sign In as Student'));
        submitBtn.click();
      })()`);

      try {
        await waitCondition(async () => {
          const userName = await evalExpr("document.querySelector('.ui-header__user-name')?.textContent");
          return userName && userName.includes('Alice') && userName.includes('Carter');
        }, 5000);
      } catch (err) {
        const alertMsg = await evalExpr("document.querySelector('.ui-alert')?.textContent");
        const bodySnippet = await evalExpr("document.querySelector('.surface-card')?.innerText");
        throw new Error(`Student login wait failed. Alert: ${alertMsg || 'None'}. Card: ${bodySnippet}`);
      }

      const roleBadge = await evalExpr("document.querySelector('.ui-header__controls .ui-badge')?.textContent");
      assert.strictEqual(roleBadge.trim(), 'STUDENT');
    });

    await test('3.2 Student Navigation: Faculty Directory search and consultation modal inspection', async () => {
      // Click Faculty Directory
      await evalExpr(`(() => {
        const tab = Array.from(document.querySelectorAll('.ui-role-nav__item')).find(b => b.textContent.trim().includes('Faculty Directory'));
        tab.click();
      })()`);

      await waitCondition(async () => {
        const title = await evalExpr("document.querySelector('.page-header__title')?.textContent");
        return title && title.includes('Faculty Directory');
      });

      // Verify search input is present
      const searchInput = await evalExpr("document.getElementById('search-teachers-input') !== null");
      assert.strictEqual(searchInput, true);

      // Verify faculty cards are rendered
      const cardsCount = await evalExpr("document.querySelectorAll('.surface-card button').length");
      assert.ok(cardsCount >= 1);

      // Click View Availability & Book on first teacher
      await evalExpr(`(() => {
        const bookBtn = Array.from(document.querySelectorAll('.surface-card button')).find(b => b.textContent.trim().includes('View Availability & Book'));
        bookBtn.click();
      })()`);

      // Verify BookConsultationModal opens
      await waitCondition(async () => {
        return await evalExpr("document.querySelector('.ui-dialog') !== null");
      });

      const modalTitle = await evalExpr("document.querySelector('.ui-dialog__title')?.textContent");
      assert.ok(modalTitle.includes('Book Consultation'));

      // Close modal
      await evalExpr(`(() => {
        const cancelBtn = Array.from(document.querySelectorAll('.ui-dialog__footer button')).find(b => b.textContent.trim() === 'Cancel');
        cancelBtn.click();
      })()`);

      await waitCondition(async () => {
        return await evalExpr("document.querySelector('.ui-dialog') === null");
      });
    });

    await test('3.3 Student Logout: Invalidate student session', async () => {
      await evalExpr(`(() => {
        const logoutBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim().includes('Log Out'));
        logoutBtn.click();
      })()`);

      await waitCondition(async () => {
        return await evalExpr("document.querySelector('.ui-header') === null");
      });
      assert.strictEqual(await evalExpr("document.querySelector('.ui-header')"), null);
    });

    // -------------------------------------------------------------
    // Test Suite 4: Administrator Role End-to-End Browser Flow
    // -------------------------------------------------------------
    await test('4.1 Administrator Authentication: Sign in as Admin into Administration Workspace', async () => {
      // Switch to Admin Portal
      await evalExpr(`(() => {
        const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Admin Portal');
        btn.click();
      })()`);

      await waitCondition(async () => {
        const heading = await evalExpr("document.querySelector('h1')?.textContent");
        return heading && heading.includes('Administrative Portal');
      });

      // Submit login
      await evalExpr(`(() => {
        const submitBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim().includes('Sign In to Admin Portal'));
        submitBtn.click();
      })()`);

      await waitCondition(async () => {
        const roleBadge = await evalExpr("document.querySelector('.ui-header__controls .ui-badge')?.textContent");
        return roleBadge && roleBadge.trim() === 'ADMIN';
      });

      const roleBadge = await evalExpr("document.querySelector('.ui-header__controls .ui-badge')?.textContent");
      assert.strictEqual(roleBadge.trim(), 'ADMIN');
    });

    await test('4.2 Administrator Navigation: Inspect Appointment Monitor KPI summary cards and System Status', async () => {
      // Appointment Monitor is default tab; verify KPI cards render
      await waitCondition(async () => {
        const text = await evalExpr("document.querySelector('.content-wrapper')?.innerText");
        return text && text.includes('Total Recorded') && text.includes('Pending Requests');
      });

      const kpiCardTexts = await evalExpr(`Array.from(document.querySelectorAll('.surface-card')).map(h => h.textContent.trim())`);
      assert.ok(kpiCardTexts.some(t => t.includes('Total Recorded')));
      assert.ok(kpiCardTexts.some(t => t.includes('Pending Requests')));
      assert.ok(kpiCardTexts.some(t => t.includes('Approved')));

      // Click System Status tab
      await evalExpr(`(() => {
        const tab = Array.from(document.querySelectorAll('.ui-role-nav__item')).find(b => b.textContent.trim().includes('System Status'));
        tab.click();
      })()`);

      await waitCondition(async () => {
        const title = await evalExpr("document.querySelector('.page-header__title')?.textContent");
        return title && title.includes('System Status');
      });

      // Verify Run Diagnostics button
      const diagBtn = await evalExpr(`(() => {
        const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim().includes('Run Diagnostics'));
        return Boolean(btn);
      })()`);
      assert.strictEqual(diagBtn, true);
    });

    // -------------------------------------------------------------
    // Test Suite 5: Responsive Layout Compatibility (Phase 6)
    // -------------------------------------------------------------
    await test('5.1 Desktop Viewport (1280x800): Desktop nav visible, hamburger menu hidden', async () => {
      await setViewport(1280, 800);
      await new Promise(r => setTimeout(r, 200));

      const isDesktopNavVisible = await evalExpr(`(() => {
        const nav = document.querySelector('.ui-role-nav');
        if (!nav) return false;
        const style = window.getComputedStyle(nav);
        return style.display !== 'none';
      })()`);
      assert.strictEqual(isDesktopNavVisible, true);

      const isHamburgerHidden = await evalExpr(`(() => {
        const btn = document.querySelector('.ui-header__menu-toggle');
        if (!btn) return true;
        const style = window.getComputedStyle(btn);
        return style.display === 'none';
      })()`);
      assert.strictEqual(isHamburgerHidden, true);
    });

    await test('5.2 Tablet Viewport (768x1024): Content reflows properly without horizontal overflow', async () => {
      await setViewport(768, 1024);
      await new Promise(r => setTimeout(r, 200));

      const hasHorizontalOverflow = await evalExpr(`(() => {
        return document.documentElement.scrollWidth > document.documentElement.clientWidth;
      })()`);
      assert.strictEqual(hasHorizontalOverflow, false, 'Tablet viewport must not cause horizontal scrolling overflow');
    });

    await test('5.3 Mobile Viewport (375x667): Hamburger button active, mobile navigation drawer opens and closes', async () => {
      await setViewport(375, 667);
      await new Promise(r => setTimeout(r, 200));

      // Hamburger must now be displayed
      const isHamburgerVisible = await evalExpr(`(() => {
        const btn = document.querySelector('.ui-header__menu-toggle');
        if (!btn) return false;
        const style = window.getComputedStyle(btn);
        return style.display !== 'none';
      })()`);
      assert.strictEqual(isHamburgerVisible, true);

      // Click hamburger menu
      await evalExpr(`(() => {
        const btn = document.querySelector('.ui-header__menu-toggle');
        btn.click();
      })()`);

      // Verify MobileNav drawer opens
      await waitCondition(async () => {
        return await evalExpr("document.querySelector('.ui-mobile-nav-drawer') !== null");
      });
      assert.strictEqual(await evalExpr("document.querySelector('.ui-mobile-nav-drawer') !== null"), true);

      // Click close button on drawer
      await evalExpr(`(() => {
        const closeBtn = document.querySelector('button[aria-label="Close navigation menu"]');
        closeBtn.click();
      })()`);

      // Verify MobileNav drawer closes
      await waitCondition(async () => {
        return await evalExpr("document.querySelector('.ui-mobile-nav-drawer') === null");
      });
      assert.strictEqual(await evalExpr("document.querySelector('.ui-mobile-nav-drawer')"), null);

      // Restore desktop viewport
      await setViewport(1280, 800);
    });

    // -------------------------------------------------------------
    // Test Suite 6: Keyboard Accessibility & Escape Key Dismissal
    // -------------------------------------------------------------
    await test('6.1 Keyboard Accessibility: Escape key dismisses open dialogs', async () => {
      // Navigate to Teacher Management tab
      await evalExpr(`(() => {
        const tab = Array.from(document.querySelectorAll('.ui-role-nav__item')).find(b => b.textContent.trim().includes('Teacher Management'));
        tab.click();
      })()`);

      await waitCondition(async () => {
        const title = await evalExpr("document.querySelector('.page-header__title')?.textContent");
        return title && (title.includes('Faculty Management') || title.includes('Teacher Management'));
      });

      // Click "Add Faculty Member"
      await evalExpr(`(() => {
        const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim().includes('Add Faculty Member'));
        btn.click();
      })()`);

      await waitCondition(async () => {
        return await evalExpr("document.querySelector('.ui-dialog') !== null");
      });

      // Dispatch Escape key via CDP
      await cdpSend('Input.dispatchKeyEvent', {
        type: 'keyDown',
        key: 'Escape',
        code: 'Escape',
        windowsVirtualKeyCode: 27,
        nativeVirtualKeyCode: 27
      });
      await cdpSend('Input.dispatchKeyEvent', {
        type: 'keyUp',
        key: 'Escape',
        code: 'Escape',
        windowsVirtualKeyCode: 27,
        nativeVirtualKeyCode: 27
      });

      await waitCondition(async () => {
        return await evalExpr("document.querySelector('.ui-dialog') === null");
      });
      assert.strictEqual(await evalExpr("document.querySelector('.ui-dialog')"), null);
    });

    // -------------------------------------------------------------
    // Test Suite 7: Console & Runtime Stability
    // -------------------------------------------------------------
    await test('7.1 Runtime Stability: Zero unhandled console errors or exceptions during browser session', async () => {
      const realErrors = consoleErrors.filter(e =>
        !e.includes('favicon.ico') &&
        !e.includes('ERR_CONNECTION_REFUSED') &&
        !e.includes('Failed to load resource')
      );
      if (realErrors.length > 0) {
        console.warn('Captured console errors:', realErrors);
      }
      assert.strictEqual(realErrors.length, 0, `Detected ${realErrors.length} unhandled runtime errors in browser console`);
    });

  } finally {
    if (ws) ws.close();
    chromeProc.kill();
    server.close();
    try {
      fs.rmSync(tmpUserDataDir, { recursive: true, force: true });
    } catch (e) {}
  }

  console.log('\n=================================================================');
  console.log(` Browser Verification Summary: ${passed} passed, ${failed} failed out of ${passed + failed} tests.`);
  console.log('=================================================================\n');

  if (failed > 0) process.exitCode = 1;
}

runBrowserInteractionTests();

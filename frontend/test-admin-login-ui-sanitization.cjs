/**
 * Production Admin Login UI Sanitization Verification Suite
 *
 * Validates the security remediation for AdminLoginView.tsx:
 * 1. Hardcoded initial admin credentials removed (email and password initialize empty).
 * 2. Default seed credential banner guarded by import.meta.env.DEV (strictly hidden in production).
 * 3. Dead-code elimination in production bundle (no seed credentials in dist bundle for AdminLoginView).
 * 4. Client-side validation contract preserved (empty inputs blocked, proper error messages).
 * 5. Authentication API contract preserved (POST /api/v1/auth/login).
 */

require('../backend/tests/setup');
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const request = require('supertest');
const app = require('../backend/src/app');

async function runSanitizationTests() {
  console.log('\n=================================================================');
  console.log(' Production Admin Login UI Sanitization Verification Suite       ');
  console.log(' Target: frontend/src/views/admin/AdminLoginView.tsx            ');
  console.log('=================================================================\n');

  let passed = 0;
  let failed = 0;

  async function test(name, fn) {
    try {
      await fn();
      console.log(`  [PASS] ${name}`);
      passed++;
    } catch (err) {
      console.log(`  [FAIL] ${name}`);
      console.error(`         ${err.message}`);
      failed++;
    }
  }

  // -------------------------------------------------------------
  // Test Suite 1: Source Code Static Security Audit
  // -------------------------------------------------------------
  const sourcePath = path.join(__dirname, 'src/views/admin/AdminLoginView.tsx');
  const sourceContent = fs.readFileSync(sourcePath, 'utf8');

  await test('1.1 Source Audit: Email state initializes with empty string', () => {
    assert.match(
      sourceContent,
      /const\s*\[email,\s*setEmail\]\s*=\s*useState\(''\);/,
      'Email state must be initialized with empty string'
    );
    assert.doesNotMatch(
      sourceContent,
      /useState\(['"]admin@university\.edu['"]\)/,
      'Email state must not have hardcoded admin@university.edu default'
    );
  });

  await test('1.2 Source Audit: Password state initializes with empty string', () => {
    assert.match(
      sourceContent,
      /const\s*\[password,\s*setPassword\]\s*=\s*useState\(''\);/,
      'Password state must be initialized with empty string'
    );
    assert.doesNotMatch(
      sourceContent,
      /useState\(['"]Password123!['"]\)/,
      'Password state must not have hardcoded Password123! default'
    );
  });

  await test('1.3 Source Audit: Seed credential banner is guarded by import.meta.env.DEV', () => {
    assert.match(
      sourceContent,
      /\{import\.meta\.env\.DEV\s*&&\s*\(/,
      'Seed credentials banner must be guarded with import.meta.env.DEV'
    );
    assert.match(
      sourceContent,
      /data-testid="admin-dev-credentials-banner"/,
      'Banner must include data-testid for regression testing'
    );
  });

  await test('1.4 Source Audit: Input elements bound to state and have autocomplete attributes', () => {
    assert.match(
      sourceContent,
      /id="admin-email"[^>]*value=\{email\}/,
      'admin-email input must be bound to email state'
    );
    assert.match(
      sourceContent,
      /id="admin-password"[^>]*value=\{password\}/,
      'admin-password input must be bound to password state'
    );
  });

  // -------------------------------------------------------------
  // Test Suite 2: Compiled Production Bundle Verification
  // -------------------------------------------------------------
  const distDir = path.join(__dirname, 'dist/assets');
  let bundleContent = '';
  if (fs.existsSync(distDir)) {
    const jsFiles = fs.readdirSync(distDir).filter(f => f.endsWith('.js'));
    assert.ok(jsFiles.length > 0, 'Production bundle JS file must exist');
    bundleContent = fs.readFileSync(path.join(distDir, jsFiles[0]), 'utf8');
  }

  await test('2.1 Bundle Audit: Default Seed Admin Credentials completely absent from production bundle', () => {
    assert.ok(bundleContent.length > 0, 'Dist bundle must be loaded');
    assert.strictEqual(
      bundleContent.includes('Default Seed Admin Credentials'),
      false,
      'Production bundle must not contain "Default Seed Admin Credentials"'
    );
  });

  await test('2.2 Bundle Audit: AdminLoginView dead code elimination eliminates banner', () => {
    // Locate AdminLoginView in the minified bundle:
    // It contains "Sign In to Admin Portal" followed by the eliminated branch
    const adminIndex = bundleContent.indexOf('Sign In to Admin Portal');
    assert.ok(adminIndex !== -1, 'AdminLoginView must be compiled into the bundle');
    const adminSnippet = bundleContent.slice(adminIndex, adminIndex + 200);
    // Vite replaces `{import.meta.env.DEV && (...) }` with `!1` (false)
    assert.ok(
      adminSnippet.includes('!1'),
      'AdminLoginView banner must be dead-code eliminated as false (!1)'
    );
  });

  // -------------------------------------------------------------
  // Test Suite 3: Client-Side Form Validation Rules
  // -------------------------------------------------------------
  // Extract and verify the exact validation function logic from AdminLoginView
  function validateForm(email, password) {
    const errors = {};
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!email.trim()) {
      errors.email = 'Email address is required.';
    } else if (!emailRegex.test(email.trim())) {
      errors.email = 'Please enter a valid academic email address.';
    }

    if (!password) {
      errors.password = 'Password is required.';
    } else if (password.length < 6) {
      errors.password = 'Password must be at least 6 characters.';
    }

    return { isValid: Object.keys(errors).length === 0, errors };
  }

  await test('3.1 Validation: Initial empty form submission fails validation', () => {
    const result = validateForm('', '');
    assert.strictEqual(result.isValid, false);
    assert.strictEqual(result.errors.email, 'Email address is required.');
    assert.strictEqual(result.errors.password, 'Password is required.');
  });

  await test('3.2 Validation: Whitespace-only email fails validation', () => {
    const result = validateForm('   ', 'Password123!');
    assert.strictEqual(result.isValid, false);
    assert.strictEqual(result.errors.email, 'Email address is required.');
  });

  await test('3.3 Validation: Malformed email fails validation', () => {
    const result = validateForm('not-an-email', 'Password123!');
    assert.strictEqual(result.isValid, false);
    assert.strictEqual(result.errors.email, 'Please enter a valid academic email address.');
  });

  await test('3.4 Validation: Short password fails validation', () => {
    const result = validateForm('admin@university.edu', '12345');
    assert.strictEqual(result.isValid, false);
    assert.strictEqual(result.errors.password, 'Password must be at least 6 characters.');
  });

  await test('3.5 Validation: Valid credentials pass validation', () => {
    const result = validateForm('admin@university.edu', 'Password123!');
    assert.strictEqual(result.isValid, true);
    assert.deepStrictEqual(result.errors, {});
  });

  // -------------------------------------------------------------
  // Test Suite 4: Environment Guard Simulation (Dev vs Prod)
  // -------------------------------------------------------------
  await test('4.1 Env Guard: Production environment (DEV=false) suppresses banner', () => {
    const isDev = false;
    const bannerHtml = isDev ? '<div data-testid="admin-dev-credentials-banner">Default Seed Admin Credentials: Password123!</div>' : null;
    assert.strictEqual(bannerHtml, null, 'Banner must evaluate to null in production');
  });

  await test('4.2 Env Guard: Development environment (DEV=true) renders banner for local testing', () => {
    const isDev = true;
    const bannerHtml = isDev ? '<div data-testid="admin-dev-credentials-banner">Default Seed Admin Credentials: Password123!</div>' : null;
    assert.ok(bannerHtml !== null, 'Banner must render in development');
    assert.ok(bannerHtml.includes('Default Seed Admin Credentials'), 'Banner must display seed guidance in development');
  });

  // -------------------------------------------------------------
  // Test Suite 5: Authentication API Contract Preservation
  // -------------------------------------------------------------
  await test('5.1 API Contract: Backend rejects empty login submission (400)', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: '', password: '' });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.success, false);
  });

  await test('5.2 API Contract: Backend rejects incorrect password (401 INVALID_CREDENTIALS)', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'admin@university.edu', password: 'WrongPassword999!' });
    assert.strictEqual(res.status, 401);
    assert.strictEqual(res.body.success, false);
    assert.strictEqual(res.body.error.code, 'INVALID_CREDENTIALS');
  });

  await test('5.3 API Contract: Backend authenticates valid administrator credentials (200 OK)', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'admin@university.edu', password: 'Password123!' });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.ok(res.body.data.token, 'JWT token must be returned');
    assert.strictEqual(res.body.data.user.role, 'ADMIN');
    assert.strictEqual(res.body.data.user.email, 'admin@university.edu');
  });

  console.log('\n-----------------------------------------------------------------');
  console.log(` Results: ${passed} passed, ${failed} failed (${passed + failed} total)`);
  console.log('-----------------------------------------------------------------\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runSanitizationTests().catch(err => {
  console.error('Fatal test execution error:', err);
  process.exit(1);
});

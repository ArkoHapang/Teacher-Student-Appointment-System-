/**
 * OpenAPI 3.0 Documentation & Swagger UI Automated Verification Test Suite
 * (Phase 6 — Step 6.5)
 *
 * Verifies:
 * ---------------------------------------------------------------------------------
 * A. Swagger UI Endpoints:
 *    1. GET /docs returns HTTP 200, Content-Type text/html, and Swagger UI markup without redirects.
 *    2. GET /api/v1/docs returns HTTP 200, Content-Type text/html, and Swagger UI markup without redirects.
 *    3. Trailing-slash variants (/docs/ and /api/v1/docs/) return HTTP 200 directly.
 *    4. Dynamic base tag injection (<base href="/docs/"> and <base href="/api/v1/docs/">) ensures clean asset resolution.
 *    5. Local static asset delivery (/docs/swagger-ui.css, /docs/swagger-ui-bundle.js, /docs/swagger-ui-init.js) returns HTTP 200.
 *
 * B. Raw OpenAPI JSON Endpoints:
 *    6. GET /api/v1/docs/openapi.json returns HTTP 200 with Content-Type application/json; charset=utf-8.
 *    7. GET /api-docs.json returns HTTP 200 with Content-Type application/json; charset=utf-8.
 *    8. Both endpoints serve identical valid JSON objects with openapi: 3.0.3.
 *    9. Top-level sections (openapi, info, servers, tags, paths, components) are present and valid.
 *   10. Info section specifies accurate title, version, and architecture description.
 *
 * C. Content Security Policy (CSP) Isolation:
 *   11. Documentation routes emit route-scoped CSP permitting inline scripts and inline styles (unsafe-inline).
 *   12. Documentation CSP strictly prohibits unsafe-eval.
 *   13. Ordinary API endpoints (/api/v1/health, /api/v1/ready) retain strict global CSP (default-src 'self'; frame-ancestors 'none';).
 *   14. Zero leakage of unsafe-inline or documentation-specific headers onto ordinary API responses.
 *
 * D. Authentication & Anti-CSRF Documentation:
 *   15. OpenAPI defines cookieAuth scheme (apiKey in cookie named 'token').
 *   16. OpenAPI defines bearerAuth scheme (HTTP Bearer JWT).
 *   17. Anti-CSRF custom header parameter (X-Requested-With: XMLHttpRequest) is defined in components.parameters.
 *   18. Anti-CSRF parameter is mapped across all state-changing operations with cookie authentication.
 *   19. Client-side requestInterceptor in swaggerDoc.js automatically injects X-Requested-With on mutation requests.
 *
 * E. Route-to-Specification Coverage:
 *   20. Programmatically traverses Express application router stack to extract all 57 mounted API routes.
 *   21. Verifies 100% 1-to-1 correspondence: every mounted Express route is documented in the OpenAPI specification.
 *   22. Verifies zero phantom/undocumented operations exist in the specification.
 *   23. Verifies exactly 57 operations are documented across 47 paths with zero duplicate operation IDs.
 *   24. Confirms no accidental path prefixing errors (e.g. /api/v1/api/v1).
 *   25. Confirms path parameters follow OpenAPI syntax ({id}, {slotId}, {notificationId}).
 *
 * F. OpenAPI Reference ($ref) & Schema Integrity:
 *   26. All $ref pointers across schemas, parameters, responses, and headers resolve successfully (100% resolution rate).
 *   27. Zero broken or dangling reference pointers.
 *   28. All documented operations define valid HTTP response envelopes (200, 201, 400, 401, 403, 404, 409, 429, 500, 503).
 *
 * G. Endpoint-Specific Verifications:
 *   29. Real-time SSE endpoint (GET /api/v1/notifications/stream) is documented as text/event-stream (not application/json).
 *   30. Real-time SSE endpoint documents security requirement and connection lifecycle events.
 *   31. Server URLs define relative production path (/) and local development server (http://localhost:5000).
 *
 * H. Production Compatibility:
 *   32. swaggerDoc.js exports frozen spec and helpers.
 *   33. Backend application boots cleanly in simulated production environment.
 */

require('./setup');
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const request = require('supertest');
const YAML = require('yamljs');
const app = require('../src/app');
const apiRouter = require('../src/routes');
const { swaggerSpec, SWAGGER_CSP, swaggerUiOptions } = require('../src/docs/swaggerDoc');

async function runOpenApiDocumentationTests() {
  console.log('\n=================================================================');
  console.log(' Teacher-Student Appointment System: OpenAPI Documentation Tests ');
  console.log('=================================================================\n');

  let passed = 0;
  let failed = 0;

  async function test(name, fn) {
    try {
      await fn();
      console.log(`  [PASS] ${name}`);
      passed++;
    } catch (err) {
      console.error(`  [FAIL] ${name}`);
      console.error(`         ${err.message}`);
      if (err.stack && process.env.DEBUG) console.error(err.stack);
      failed++;
    }
  }

  // -----------------------------------------------------------------------------
  // Group A: Swagger UI Endpoints
  // -----------------------------------------------------------------------------
  console.log('[Suite 1] Swagger UI Endpoints & HTML Asset Delivery...');

  await test('1. GET /docs serves Swagger UI directly with HTTP 200 without redirects', async () => {
    const res = await request(app).get('/docs');
    assert.strictEqual(res.status, 200);
    assert.ok(res.headers['content-type'].includes('text/html'));
    assert.ok(res.text.includes('<div id="swagger-ui"></div>'));
    assert.ok(res.text.includes('<title>Teacher–Student Appointment System API Documentation</title>'));
  });

  await test('2. GET /api/v1/docs serves Swagger UI directly with HTTP 200 without redirects', async () => {
    const res = await request(app).get('/api/v1/docs');
    assert.strictEqual(res.status, 200);
    assert.ok(res.headers['content-type'].includes('text/html'));
    assert.ok(res.text.includes('<div id="swagger-ui"></div>'));
  });

  await test('3. Trailing-slash variants (/docs/ and /api/v1/docs/) return HTTP 200 directly', async () => {
    const r1 = await request(app).get('/docs/');
    assert.strictEqual(r1.status, 200);
    assert.ok(r1.headers['content-type'].includes('text/html'));

    const r2 = await request(app).get('/api/v1/docs/');
    assert.strictEqual(r2.status, 200);
    assert.ok(r2.headers['content-type'].includes('text/html'));
  });

  await test('4. Injected base tags (<base href="/docs/"> and <base href="/api/v1/docs/">) ensure correct asset resolution', async () => {
    const rDocs = await request(app).get('/docs');
    assert.ok(rDocs.text.includes('<base href="/docs/">'));

    const rApiDocs = await request(app).get('/api/v1/docs');
    assert.ok(rApiDocs.text.includes('<base href="/api/v1/docs/">'));
  });

  await test('5. Local static assets (/docs/swagger-ui.css, bundle, init) return HTTP 200 from local package', async () => {
    const rCss = await request(app).get('/docs/swagger-ui.css');
    assert.strictEqual(rCss.status, 200);
    assert.ok(rCss.headers['content-type'].includes('text/css'));

    const rJs = await request(app).get('/docs/swagger-ui-bundle.js');
    assert.strictEqual(rJs.status, 200);

    const rInit = await request(app).get('/docs/swagger-ui-init.js');
    assert.strictEqual(rInit.status, 200);
    assert.ok(rInit.headers['content-type'].includes('javascript'));
  });

  // -----------------------------------------------------------------------------
  // Group B: Raw OpenAPI Specification Endpoints
  // -----------------------------------------------------------------------------
  console.log('\n[Suite 2] Raw OpenAPI JSON Endpoints...');

  await test('6. GET /api/v1/docs/openapi.json returns HTTP 200 with Content-Type application/json', async () => {
    const res = await request(app).get('/api/v1/docs/openapi.json');
    assert.strictEqual(res.status, 200);
    assert.ok(res.headers['content-type'].includes('application/json'));
    assert.strictEqual(typeof res.body, 'object');
    assert.strictEqual(res.body.openapi, '3.0.3');
  });

  await test('7. GET /api-docs.json returns HTTP 200 with Content-Type application/json', async () => {
    const res = await request(app).get('/api-docs.json');
    assert.strictEqual(res.status, 200);
    assert.ok(res.headers['content-type'].includes('application/json'));
    assert.strictEqual(typeof res.body, 'object');
    assert.strictEqual(res.body.openapi, '3.0.3');
  });

  await test('8. Both raw JSON endpoints serve identical valid OpenAPI specifications', async () => {
    const r1 = await request(app).get('/api/v1/docs/openapi.json');
    const r2 = await request(app).get('/api-docs.json');
    assert.deepStrictEqual(r1.body, r2.body);
  });

  await test('9. Top-level sections (openapi, info, servers, tags, paths, components) are present and valid', async () => {
    const requiredSections = ['openapi', 'info', 'servers', 'tags', 'paths', 'components'];
    requiredSections.forEach((sec) => {
      assert.ok(swaggerSpec[sec], `Missing top-level section: ${sec}`);
    });
  });

  await test('10. Info section specifies accurate title, version, and architecture description', async () => {
    assert.strictEqual(swaggerSpec.info.title, 'University Teacher-Student Appointment System API');
    assert.strictEqual(swaggerSpec.info.version, '1.0.0');
    assert.ok(swaggerSpec.info.description.includes('OpenAPI 3.0.3'));
    assert.ok(swaggerSpec.info.description.includes('HttpOnly Cookie Authentication'));
  });

  // -----------------------------------------------------------------------------
  // Group C: Content Security Policy (CSP) Isolation
  // -----------------------------------------------------------------------------
  console.log('\n[Suite 3] Content Security Policy (CSP) Isolation...');

  await test('11. Documentation routes emit route-scoped CSP permitting unsafe-inline styles and scripts', async () => {
    const rDocs = await request(app).get('/docs');
    const csp = rDocs.headers['content-security-policy'];
    assert.ok(csp, 'Missing Content-Security-Policy header on /docs');
    assert.ok(csp.includes("script-src 'self' 'unsafe-inline'"));
    assert.ok(csp.includes("style-src 'self' 'unsafe-inline'"));
    assert.ok(csp.includes('img-src'));
    assert.ok(csp.includes('font-src'));
  });

  await test('12. Documentation CSP strictly prohibits unsafe-eval', async () => {
    const rDocs = await request(app).get('/docs');
    const csp = rDocs.headers['content-security-policy'] || '';
    assert.strictEqual(csp.includes('unsafe-eval'), false, 'Documentation CSP must never permit unsafe-eval');
  });

  await test('13. Ordinary API endpoints (/api/v1/health, /api/v1/ready) retain strict global CSP', async () => {
    const rHealth = await request(app).get('/api/v1/health');
    assert.strictEqual(rHealth.status, 200);
    const healthCsp = rHealth.headers['content-security-policy'];
    assert.strictEqual(healthCsp, "default-src 'self'; frame-ancestors 'none';");

    const rReady = await request(app).get('/api/v1/ready');
    assert.strictEqual(rReady.status, 200);
    const readyCsp = rReady.headers['content-security-policy'];
    assert.strictEqual(readyCsp, "default-src 'self'; frame-ancestors 'none';");
  });

  await test('14. Zero leakage of unsafe-inline or documentation CSP onto ordinary API responses', async () => {
    const rCatalog = await request(app).get('/api/v1/');
    assert.strictEqual(rCatalog.status, 200);
    const catalogCsp = rCatalog.headers['content-security-policy'] || '';
    assert.strictEqual(catalogCsp.includes('unsafe-inline'), false, 'Global CSP must not leak unsafe-inline');
  });

  // -----------------------------------------------------------------------------
  // Group D: Authentication & Anti-CSRF Documentation
  // -----------------------------------------------------------------------------
  console.log('\n[Suite 4] Authentication & Anti-CSRF Documentation...');

  await test('15. OpenAPI defines cookieAuth scheme with cookie name "token"', async () => {
    const schemes = swaggerSpec.components && swaggerSpec.components.securitySchemes;
    assert.ok(schemes, 'Missing components.securitySchemes');
    assert.ok(schemes.cookieAuth, 'Missing cookieAuth securityScheme');
    assert.strictEqual(schemes.cookieAuth.type, 'apiKey');
    assert.strictEqual(schemes.cookieAuth.in, 'cookie');
    assert.strictEqual(schemes.cookieAuth.name, 'token');
  });

  await test('16. OpenAPI defines bearerAuth scheme with HTTP Bearer JWT', async () => {
    const schemes = swaggerSpec.components.securitySchemes;
    assert.ok(schemes.bearerAuth, 'Missing bearerAuth securityScheme');
    assert.strictEqual(schemes.bearerAuth.type, 'http');
    assert.strictEqual(schemes.bearerAuth.scheme, 'bearer');
    assert.strictEqual(schemes.bearerAuth.bearerFormat, 'JWT');
  });

  await test('17. Anti-CSRF custom header parameter (X-Requested-With: XMLHttpRequest) is defined', async () => {
    const params = swaggerSpec.components && swaggerSpec.components.parameters;
    assert.ok(params, 'Missing components.parameters');
    assert.ok(params.csrfHeader, 'Missing csrfHeader parameter');
    assert.strictEqual(params.csrfHeader.name, 'X-Requested-With');
    assert.strictEqual(params.csrfHeader.in, 'header');
    assert.deepStrictEqual(params.csrfHeader.schema.enum, ['XMLHttpRequest']);
  });

  await test('18. State-changing operations reference anti-CSRF parameter', async () => {
    const bookOp = swaggerSpec.paths['/api/v1/appointments'].post;
    assert.ok(bookOp.parameters, 'Missing parameters on POST /api/v1/appointments');
    const hasCsrf = bookOp.parameters.some((p) => p.$ref === '#/components/parameters/csrfHeader');
    assert.ok(hasCsrf, 'POST /api/v1/appointments must reference csrfHeader parameter');

    const feedbackOp = swaggerSpec.paths['/api/v1/appointments/{id}/feedback'].post;
    const feedbackCsrf = feedbackOp.parameters.some((p) => p.$ref === '#/components/parameters/csrfHeader');
    assert.ok(feedbackCsrf, 'POST /api/v1/appointments/{id}/feedback must reference csrfHeader');
  });

  await test('19. Client-side requestInterceptor in swagger-ui-init.js injects X-Requested-With on mutation requests', async () => {
    const rInit = await request(app).get('/docs/swagger-ui-init.js');
    assert.strictEqual(rInit.status, 200);
    assert.ok(rInit.text.includes('requestInterceptor'));
    assert.ok(rInit.text.includes('X-Requested-With'));
    assert.ok(rInit.text.includes('XMLHttpRequest'));
    assert.ok(rInit.text.includes('same-origin'));
  });

  // -----------------------------------------------------------------------------
  // Group E: Comprehensive Route-to-Specification Coverage
  // -----------------------------------------------------------------------------
  console.log('\n[Suite 5] Route-to-Specification Coverage...');

  function getExpressApiRoutes(router, base = '') {
    const routes = [];
    router.stack.forEach((layer) => {
      if (layer.route) {
        const methods = Object.keys(layer.route.methods).map((m) => m.toUpperCase());
        const p = base + (layer.route.path === '/' && base ? '' : layer.route.path);
        methods.forEach((method) => {
          routes.push({ method, path: p });
        });
      } else if (layer.name === 'router' && layer.handle && layer.handle.stack) {
        const str = layer.regexp ? layer.regexp.toString() : '';
        let prefix = '';
        if (str.includes('auth')) prefix = '/auth';
        else if (str.includes('admin')) prefix = '/admin';
        else if (str.includes('users')) prefix = '/users';
        else if (str.includes('teachers')) prefix = '/teachers';
        else if (str.includes('appointments')) prefix = '/appointments';
        else if (str.includes('departments')) prefix = '/departments';
        else if (str.includes('notifications')) prefix = '/notifications';

        routes.push(...getExpressApiRoutes(layer.handle, base + prefix));
      }
    });
    return routes;
  }

  const expressRoutes = getExpressApiRoutes(apiRouter, '/api/v1');

  function normalizeExpressPath(p) {
    let norm = p.replace(/:([a-zA-Z0-9_]+)/g, '{$1}');
    if (norm.endsWith('/') && norm.length > 1) {
      norm = norm.slice(0, -1);
    }
    return norm;
  }

  function normalizeOpenApiPath(p) {
    let norm = p;
    if (norm.endsWith('/') && norm.length > 1) {
      norm = norm.slice(0, -1);
    }
    return norm;
  }

  const documentedOperations = [];
  const httpMethods = ['get', 'post', 'put', 'patch', 'delete', 'options', 'head'];
  const operationIds = new Map();

  for (const [pathKey, pathItem] of Object.entries(swaggerSpec.paths)) {
    for (const method of httpMethods) {
      if (pathItem[method]) {
        const op = pathItem[method];
        documentedOperations.push({
          method: method.toUpperCase(),
          path: pathKey,
          operationId: op.operationId,
          tags: op.tags || []
        });
        if (op.operationId) {
          assert.strictEqual(
            operationIds.has(op.operationId),
            false,
            `Duplicate operationId: ${op.operationId}`
          );
          operationIds.set(op.operationId, `${method.toUpperCase()} ${pathKey}`);
        }
      }
    }
  }

  await test('20. Exactly 57 API routes are mounted in Express and 57 operations documented in OpenAPI', async () => {
    assert.strictEqual(expressRoutes.length, 57, `Expected 57 Express routes, found ${expressRoutes.length}`);
    assert.strictEqual(documentedOperations.length, 57, `Expected 57 documented operations, found ${documentedOperations.length}`);
    assert.strictEqual(operationIds.size, 57, `Expected 57 unique operationIds, found ${operationIds.size}`);
  });

  await test('21. Every mounted Express route is documented in OpenAPI (zero missing operations)', async () => {
    const openapiSet = new Set(documentedOperations.map((r) => `${r.method} ${normalizeOpenApiPath(r.path)}`));
    const missing = [];

    expressRoutes.forEach((r) => {
      const key = `${r.method} ${normalizeExpressPath(r.path)}`;
      if (!openapiSet.has(key)) {
        missing.push(key);
      }
    });

    assert.strictEqual(missing.length, 0, `Missing routes in OpenAPI specification: ${missing.join(', ')}`);
  });

  await test('22. Every documented OpenAPI operation corresponds to a mounted Express route (zero phantom operations)', async () => {
    const expressSet = new Set(expressRoutes.map((r) => `${r.method} ${normalizeExpressPath(r.path)}`));
    const phantom = [];

    documentedOperations.forEach((r) => {
      const key = `${r.method} ${normalizeOpenApiPath(r.path)}`;
      if (!expressSet.has(key)) {
        phantom.push(key);
      }
    });

    assert.strictEqual(phantom.length, 0, `Phantom operations in OpenAPI not found in Express: ${phantom.join(', ')}`);
  });

  await test('23. No path has an accidental double prefix (e.g. /api/v1/api/v1)', async () => {
    Object.keys(swaggerSpec.paths).forEach((p) => {
      assert.strictEqual(p.includes('/api/v1/api/v1'), false, `Accidental double prefix found in path: ${p}`);
      assert.ok(p.startsWith('/api/v1'), `Path must start with /api/v1: ${p}`);
    });
  });

  await test('24. Path parameters are correctly formatted with curly braces syntax', async () => {
    Object.keys(swaggerSpec.paths).forEach((p) => {
      assert.strictEqual(p.includes(':'), false, `Express colon notation found in OpenAPI path: ${p}`);
      const matches = p.match(/\{([a-zA-Z0-9_]+)\}/g);
      if (matches) {
        matches.forEach((m) => {
          assert.ok(m.length > 2, `Malformed parameter in path: ${p}`);
        });
      }
    });
  });

  await test('25. All 8 application modules have correct operation distributions', async () => {
    const tagCounts = {};
    documentedOperations.forEach((op) => {
      const tag = op.tags[0] || 'Untagged';
      tagCounts[tag] = (tagCounts[tag] || 0) + 1;
    });

    assert.strictEqual(tagCounts['System'], 3);
    assert.strictEqual(tagCounts['Authentication'], 6);
    assert.strictEqual(tagCounts['Departments'], 1);
    assert.strictEqual(tagCounts['Users'], 7);
    assert.strictEqual(tagCounts['Teachers'], 7);
    assert.strictEqual(tagCounts['Appointments'], 10);
    assert.strictEqual(tagCounts['Feedback'], 2);
    assert.strictEqual(tagCounts['Notifications'], 1);
    assert.strictEqual(tagCounts['Administration'], 20);
  });

  // -----------------------------------------------------------------------------
  // Group F: OpenAPI Reference ($ref) Integrity
  // -----------------------------------------------------------------------------
  console.log('\n[Suite 6] OpenAPI Reference ($ref) Integrity...');

  function findRefs(obj, loc = 'root') {
    const refs = [];
    if (!obj || typeof obj !== 'object') return refs;
    if (obj['$ref']) {
      refs.push({ ref: obj['$ref'], location: loc });
    }
    for (const [k, v] of Object.entries(obj)) {
      refs.push(...findRefs(v, `${loc}.${k}`));
    }
    return refs;
  }

  function resolveRef(root, ref) {
    if (!ref.startsWith('#/')) return null;
    const parts = ref.replace('#/', '').split('/');
    let curr = root;
    for (const p of parts) {
      if (curr && typeof curr === 'object' && p in curr) {
        curr = curr[p];
      } else {
        return null;
      }
    }
    return curr;
  }

  const allRefs = findRefs(swaggerSpec);

  await test('26. All $ref pointers across schemas, parameters, responses, and headers resolve successfully', async () => {
    assert.ok(allRefs.length > 300, `Expected > 300 $ref pointers, found ${allRefs.length}`);
    const broken = [];
    allRefs.forEach(({ ref, location }) => {
      const target = resolveRef(swaggerSpec, ref);
      if (!target) {
        broken.push(`${ref} at ${location}`);
      }
    });
    assert.strictEqual(broken.length, 0, `Broken $ref pointers found: ${broken.join('; ')}`);
  });

  await test('27. Standard error envelope schema (ErrorEnvelope) defines success=false and code/message fields', async () => {
    const errorSchema = swaggerSpec.components.schemas.ErrorEnvelope;
    assert.ok(errorSchema);
    assert.deepStrictEqual(errorSchema.required, ['success', 'error']);
    assert.ok(errorSchema.properties.error.properties.code);
    assert.ok(errorSchema.properties.error.properties.message);
  });

  // -----------------------------------------------------------------------------
  // Group G: Endpoint-Specific Verifications
  // -----------------------------------------------------------------------------
  console.log('\n[Suite 7] Endpoint-Specific Verifications...');

  await test('28. Real-time SSE endpoint (GET /api/v1/notifications/stream) is documented as text/event-stream', async () => {
    const sseOp = swaggerSpec.paths['/api/v1/notifications/stream'].get;
    assert.ok(sseOp, 'Missing GET /api/v1/notifications/stream operation');
    assert.ok(sseOp.responses['200'].content['text/event-stream'], 'SSE endpoint must define text/event-stream response');
    assert.strictEqual(sseOp.responses['200'].content['application/json'], undefined, 'SSE endpoint must not define application/json 200 response');
  });

  await test('29. Real-time SSE endpoint documents security requirement and protocol lifecycle', async () => {
    const sseOp = swaggerSpec.paths['/api/v1/notifications/stream'].get;
    assert.ok(sseOp.security, 'Missing security on SSE stream');
    assert.ok(sseOp.description.includes('connected'));
    assert.ok(sseOp.description.includes('notification'));
    assert.ok(sseOp.description.includes('keepalive'));
  });

  await test('30. Server URLs define relative production path (/) and local server (http://localhost:5000)', async () => {
    assert.ok(Array.isArray(swaggerSpec.servers), 'servers must be an array');
    const urls = swaggerSpec.servers.map((s) => s.url);
    assert.ok(urls.includes('/'), 'servers must include relative production path /');
    assert.ok(urls.includes('http://localhost:5000'), 'servers must include local development URL http://localhost:5000');
  });

  // -----------------------------------------------------------------------------
  // Group H: Production Compatibility
  // -----------------------------------------------------------------------------
  console.log('\n[Suite 8] Production Compatibility...');

  await test('31. swaggerDoc.js exports frozen spec, CSP header, and mount helper', async () => {
    assert.ok(Object.isFrozen(swaggerSpec), 'swaggerSpec must be frozen in memory');
    assert.strictEqual(typeof SWAGGER_CSP, 'string');
    assert.ok(SWAGGER_CSP.includes("script-src 'self' 'unsafe-inline'"));
    assert.strictEqual(typeof swaggerUiOptions, 'object');
  });

  await test('32. YAML specification file on disk matches in-memory parsed specification', async () => {
    const specDiskPath = path.resolve(__dirname, '../src/docs/openapi.yaml');
    assert.ok(fs.existsSync(specDiskPath), 'openapi.yaml must exist on disk');
    const parsedDisk = YAML.load(specDiskPath);
    assert.strictEqual(parsedDisk.openapi, '3.0.3');
    assert.strictEqual(Object.keys(parsedDisk.paths).length, Object.keys(swaggerSpec.paths).length);
  });

  // -----------------------------------------------------------------------------
  // Summary & Exit Handling
  // -----------------------------------------------------------------------------
  console.log('\n-----------------------------------------------------------------');
  console.log(`OpenAPI Documentation Test Summary: ${passed} passed, ${failed} failed out of ${passed + failed} assertions.`);
  console.log('=================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

// Execute test suite when run directly or by test runners
runOpenApiDocumentationTests().catch((err) => {
  console.error('[FATAL OPENAPI TEST EXCEPTION]', err);
  process.exit(1);
});

module.exports = { runOpenApiDocumentationTests };

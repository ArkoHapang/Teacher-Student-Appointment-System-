/**
 * Swagger Documentation Module
 * Loads OpenAPI 3.0.x YAML specification, validates version integrity,
 * configures Swagger UI with local asset delivery, route-scoped CSP override,
 * anti-CSRF request interceptor, and serves raw JSON specification endpoints.
 */

const path = require('path');
const fs = require('fs');
const express = require('express');
const YAML = require('yamljs');
const swaggerUi = require('swagger-ui-express');

// 1. Resolve and validate OpenAPI specification path
const specPath = path.resolve(__dirname, 'openapi.yaml');
if (!fs.existsSync(specPath)) {
  throw new Error(`[SwaggerDoc] OpenAPI specification file not found at: ${specPath}`);
}

// 2. Load and parse YAML specification
const parsedSpec = YAML.load(specPath);

// 3. Validate OpenAPI 3.0.x specification
if (!parsedSpec || !parsedSpec.openapi || !parsedSpec.openapi.startsWith('3.0')) {
  throw new Error(
    `[SwaggerDoc] Invalid OpenAPI version. Expected OpenAPI 3.0.x, found: ${parsedSpec ? parsedSpec.openapi : 'undefined'}`
  );
}

// Cache parsed specification in memory (frozen to prevent mutation)
const swaggerSpec = Object.freeze(parsedSpec);

// 4. Route-scoped Content Security Policy for Swagger UI
// Permits inline styles, inline scripts, and local data URIs strictly for documentation routes.
// Strict global CSP on ordinary API and SPA routes is completely preserved.
const SWAGGER_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "frame-ancestors 'none'"
].join('; ');

/**
 * Route-scoped CSP middleware for documentation endpoints.
 */
function documentationCsp(req, res, next) {
  res.setHeader('Content-Security-Policy', SWAGGER_CSP);
  next();
}

/**
 * Client-side Swagger UI request interceptor.
 * - Enforces same-origin credential delivery (HttpOnly cookies).
 * - Injects mandatory anti-CSRF header on state-changing methods (POST, PUT, PATCH, DELETE).
 * Serialized and evaluated in client browser by Swagger UI.
 */
function requestInterceptor(req) {
  req.credentials = 'same-origin';
  const method = (req.method || '').toUpperCase();
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    req.headers = req.headers || {};
    req.headers['X-Requested-With'] = 'XMLHttpRequest';
  }
  return req;
}

// 5. Swagger UI Configuration Options
const swaggerUiOptions = {
  customSiteTitle: 'Teacher–Student Appointment System API Documentation',
  customCss: '.swagger-ui .topbar { display: none }',
  swaggerOptions: {
    persistAuthorization: true,
    displayRequestDuration: true,
    docExpansion: 'list',
    filter: true,
    showExtensions: true,
    showCommonExtensions: true,
    withCredentials: true,
    requestInterceptor: requestInterceptor
  }
};

/**
 * Pre-generate HTML with dynamic base tag injection.
 * Ensures HTTP 200 direct responses on both /api/v1/docs and /docs without 301 redirects,
 * while guaranteeing browser relative asset links (./swagger-ui.css, etc.) resolve accurately.
 */
function createDocHandler(basePath) {
  const baseHtml = swaggerUi.generateHTML(swaggerSpec, swaggerUiOptions);
  const normalizedBasePath = basePath.endsWith('/') ? basePath : `${basePath}/`;
  const baseTag = `<base href="${normalizedBasePath}">`;
  const htmlWithBase = baseHtml.replace('<head>', `<head>\n  ${baseTag}`);

  return function serveSwaggerHtml(req, res) {
    documentationCsp(req, res, () => {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.status(200).send(htmlWithBase);
    });
  };
}

/**
 * Serve raw OpenAPI 3.0 specification in JSON format.
 */
function serveRawJson(req, res) {
  documentationCsp(req, res, () => {
    res.setHeader('Content-Type', 'application/json');
    res.status(200).json(swaggerSpec);
  });
}

/**
 * Mount documentation routes onto the Express application.
 *
 * Mounted UI endpoints:
 * - GET /api/v1/docs (HTTP 200)
 * - GET /docs (HTTP 200)
 *
 * Mounted raw specification endpoints:
 * - GET /api/v1/docs/openapi.json (HTTP 200 JSON)
 * - GET /api-docs.json (HTTP 200 JSON)
 *
 * Static asset serving:
 * - GET /api/v1/docs/* (CSS, JS, favicons from local node_modules)
 * - GET /docs/* (CSS, JS, favicons from local node_modules)
 *
 * @param {import('express').Application} app
 */
function mountDocumentation(app) {
  // Raw JSON endpoints
  app.get('/api/v1/docs/openapi.json', serveRawJson);
  app.get('/api-docs.json', serveRawJson);

  // Asset handlers using local swagger-ui-dist assets
  const staticAssetMiddleware = swaggerUi.serveFiles(swaggerSpec, swaggerUiOptions);

  // Direct HTML serving for /api/v1/docs (handles both trailing slash and non-trailing slash)
  const apiV1DocHandler = createDocHandler('/api/v1/docs');
  app.get(['/api/v1/docs', '/api/v1/docs/'], apiV1DocHandler);
  app.use('/api/v1/docs', documentationCsp, staticAssetMiddleware);

  // Direct HTML serving for /docs (handles both trailing slash and non-trailing slash)
  const rootDocHandler = createDocHandler('/docs');
  app.get(['/docs', '/docs/'], rootDocHandler);
  app.use('/docs', documentationCsp, staticAssetMiddleware);
}

module.exports = {
  swaggerSpec,
  SWAGGER_CSP,
  documentationCsp,
  requestInterceptor,
  swaggerUiOptions,
  serveRawJson,
  createDocHandler,
  mountDocumentation
};

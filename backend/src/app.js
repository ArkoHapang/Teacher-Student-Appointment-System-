/**
 * Express Application Setup
 * Registers middlewares, versioned routes, request logging, and error handling.
 */

const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const env = require('./config/env');
const requestLogger = require('./middlewares/requestLogger');
const { notFoundHandler, errorHandler } = require('./middlewares/errorHandler');
const apiV1Router = require('./routes');

const app = express();

// 0. Defensive HTTP Security Headers
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-XSS-Protection', '0');
  res.setHeader('Content-Security-Policy', "default-src 'self'; frame-ancestors 'none';");
  if (env.isProduction || req.secure) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
});

// 1. Cross-Origin Resource Sharing (CORS)
app.use(cors({
  origin: env.cors.origin,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']
}));

// 2. Request Body Parsing
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// 3. Request Logging with Automatic PII Redaction
app.use(requestLogger);

// 4. API Routes Mounting (/api/v1)
app.use(env.apiPrefix, apiV1Router);

// 5. Static Frontend Asset Serving (Unified Production / Cloud Hosting)
const frontendDist = path.resolve(__dirname, '../../frontend/dist');
if (fs.existsSync(frontendDist)) {
  app.use(express.static(frontendDist));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith(env.apiPrefix)) {
      return next();
    }
    res.sendFile(path.join(frontendDist, 'index.html'));
  });
} else {
  app.get('/', (req, res) => {
    res.redirect(env.apiPrefix);
  });
}

// 6. 404 Route Not Found Handler
app.use(notFoundHandler);

// 7. Centralized Error Handler
app.use(errorHandler);

module.exports = app;

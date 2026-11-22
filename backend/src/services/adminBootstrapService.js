/**
 * Administrator Credential Security & Bootstrap Service (BLK-01 Remediation)
 * Ensures that the production initialization process never exposes known default credentials.
 * Implements one-time atomic administrator provisioning and fail-closed startup validation.
 */

const db = require('../config/database');
const env = require('../config/env');
const logger = require('../config/logger');
const passwordService = require('./passwordService');
const { AppError } = require('../middlewares/errorHandler');
const HTTP_STATUS = require('../constants/httpStatusCodes');

const DISABLED_HASH_PREFIX = '$2b$10$DISABLED_PENDING_BOOTSTRAP';
const DEFAULT_SEED_HASH = '$2b$10$wvnNLhxJGUPSd/4nZ7Xwk.sZVZ4Zxy5Awge.GZiY594x4miJEA55m';
const MOCK_DEV_HASH = '$2b$10$T1K7fGkKqm9p/4.2G9oB9.aI8q/k8v9tYp/a7.b6c5d4e3f2g1h0';

const adminBootstrapService = {
  /**
   * Inspect current administrative bootstrap status.
   * @returns {Promise<Object>}
   */
  async getBootstrapStatus() {
    let bootstrapRecords = [];
    try {
      bootstrapRecords = await db.query('SELECT * FROM admin_bootstrap_state ORDER BY id DESC;');
    } catch {
      // Table may not exist if migrations have not run yet
    }

    const admins = await db.query(
      `SELECT u.id, u.email, u.password_hash, u.status, u.first_name, u.last_name
       FROM users u
       JOIN roles r ON u.role_id = r.id
       WHERE r.name = 'ADMIN';`
    );

    const hasAdmins = admins.length > 0;
    const hasDefaultCredentials = admins.some(a =>
      a.password_hash === DEFAULT_SEED_HASH || a.password_hash === MOCK_DEV_HASH
    );
    const hasDisabledCredentials = admins.some(a =>
      a.password_hash.startsWith(DISABLED_HASH_PREFIX)
    );
    const hasActiveLegitimateAdmin = admins.some(a =>
      a.status === 'ACTIVE' &&
      !a.password_hash.startsWith(DISABLED_HASH_PREFIX) &&
      a.password_hash !== DEFAULT_SEED_HASH &&
      a.password_hash !== MOCK_DEV_HASH
    );

    const isBootstrapped = bootstrapRecords.length > 0 || hasActiveLegitimateAdmin;

    return {
      isBootstrapped,
      adminCount: admins.length,
      hasDefaultCredentials,
      hasDisabledCredentials,
      hasActiveLegitimateAdmin,
      bootstrapRecordsCount: bootstrapRecords.length,
      primaryAdmin: admins[0] || null
    };
  },

  /**
   * Atomically provision the initial administrator.
   * Strictly one-time: fails if an administrator is already securely provisioned.
   * @param {Object} params
   * @param {string} params.email
   * @param {string} params.password
   * @param {string} [params.firstName]
   * @param {string} [params.lastName]
   * @param {string} [params.ipAddress]
   * @param {boolean} [params.isCli]
   */
  async bootstrapAdministrator({
    email,
    password,
    firstName = 'System',
    lastName = 'Administrator',
    ipAddress = '127.0.0.1',
    isCli = false
  }) {
    // 1. Validate Email
    if (!email || typeof email !== 'string' || !email.trim()) {
      throw new AppError('Administrator email is required.', HTTP_STATUS.BAD_REQUEST, 'VALIDATION_ERROR');
    }
    const normalizedEmail = email.trim().toLowerCase();
    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    if (!emailRegex.test(normalizedEmail) || normalizedEmail.includes('..') || normalizedEmail.startsWith('.') || normalizedEmail.endsWith('.')) {
      throw new AppError('Invalid administrator email format.', HTTP_STATUS.BAD_REQUEST, 'VALIDATION_ERROR');
    }

    // 2. Validate Password Presence
    if (!password || typeof password !== 'string' || !password.trim()) {
      throw new AppError('Administrator password is required.', HTTP_STATUS.BAD_REQUEST, 'VALIDATION_ERROR');
    }

    // 3. Validate Password Complexity
    const complexity = passwordService.validateComplexity(password);
    if (!complexity.isValid) {
      throw new AppError(complexity.message, HTTP_STATUS.BAD_REQUEST, 'WEAK_PASSWORD');
    }

    // 4. Validate Anti-Dictionary / Anti-Default Rules
    if (password === 'Password123!' ||
        password.toLowerCase().includes('admin123') ||
        password.toLowerCase().includes('change_me')) {
      throw new AppError(
        'Password cannot be a default or easily guessable password.',
        HTTP_STATUS.BAD_REQUEST,
        'WEAK_PASSWORD'
      );
    }

    // 5. Pre-check bootstrap state
    const currentStatus = await this.getBootstrapStatus();
    if (currentStatus.isBootstrapped && currentStatus.hasActiveLegitimateAdmin) {
      throw new AppError(
        'Administrator is already securely provisioned. Repeated bootstrap is prohibited.',
        HTTP_STATUS.CONFLICT,
        'ALREADY_BOOTSTRAPPED'
      );
    }

    // 6. Hash password with bcrypt
    const passwordHash = await passwordService.hashPassword(password);

    // 7. Execute atomic bootstrap transaction
    const bootstrapResult = await db.transaction(async (tx) => {
      // Within transaction: lock and re-verify bootstrap state to prevent concurrent races
      const insideStatus = await tx.queryOne(
        `SELECT u.id, u.email, u.password_hash, u.status
         FROM users u
         JOIN roles r ON u.role_id = r.id
         WHERE r.name = 'ADMIN'
         LIMIT 1;`
      );

      const insideLedger = await tx.queryOne(
        'SELECT id FROM admin_bootstrap_state LIMIT 1;'
      );

      if (insideLedger || (insideStatus && insideStatus.status === 'ACTIVE' &&
          !insideStatus.password_hash.startsWith(DISABLED_HASH_PREFIX) &&
          insideStatus.password_hash !== DEFAULT_SEED_HASH &&
          insideStatus.password_hash !== MOCK_DEV_HASH)) {
        throw new AppError(
          'Administrator is already securely provisioned. Concurrent bootstrap rejected.',
          HTTP_STATUS.CONFLICT,
          'ALREADY_BOOTSTRAPPED'
        );
      }

      let adminId;
      if (insideStatus) {
        // Update existing default/disabled seed administrator
        adminId = insideStatus.id;
        await tx.execute(
          `UPDATE users
           SET email = ?,
               password_hash = ?,
               first_name = ?,
               last_name = ?,
               status = 'ACTIVE',
               updated_at = CURRENT_TIMESTAMP
           WHERE id = ?;`,
          [normalizedEmail, passwordHash, firstName.trim(), lastName.trim(), adminId]
        );
      } else {
        // Insert new administrator
        const adminRole = await tx.queryOne("SELECT id FROM roles WHERE name = 'ADMIN';");
        const roleId = adminRole ? adminRole.id : 3;

        const insertRes = await tx.execute(
          `INSERT INTO users (role_id, email, password_hash, first_name, last_name, status)
           VALUES (?, ?, ?, ?, ?, 'ACTIVE');`,
          [roleId, normalizedEmail, passwordHash, firstName.trim(), lastName.trim()]
        );
        adminId = insertRes.lastInsertRowid;
      }

      // Record in admin_bootstrap_state
      const methodLabel = isCli ? 'OPERATOR_CLI' : 'OPERATOR_ENV_BOOTSTRAP';
      await tx.execute(
        `INSERT INTO admin_bootstrap_state (admin_id, bootstrapped_by, ip_address)
         VALUES (?, ?, ?);`,
        [adminId, methodLabel, ipAddress]
      );

      // Invalidate any lingering tokens for this user in revoked_tokens
      try {
        await tx.execute(
          'DELETE FROM revoked_tokens WHERE user_id = ?;',
          [adminId]
        );
      } catch {
        // revoked_tokens cleanup is non-blocking
      }

      // Record in audit_logs (never recording password or secret values)
      try {
        await tx.execute(
          `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, details, ip_address)
           VALUES (?, 'ADMIN_BOOTSTRAP', 'USER', ?, ?, ?);`,
          [adminId, String(adminId), JSON.stringify({ email: normalizedEmail, method: methodLabel }), ipAddress]
        );
      } catch (auditErr) {
        logger.warn(`[AdminBootstrap] Failed to write audit log: ${auditErr.message}`);
      }

      return {
        adminId,
        email: normalizedEmail
      };
    });

    logger.info(`[AdminBootstrap] Administrator account successfully provisioned for: ${bootstrapResult.email}`);
    return {
      success: true,
      message: 'Administrator successfully provisioned.',
      adminId: bootstrapResult.adminId,
      email: bootstrapResult.email
    };
  },

  /**
   * Fail-closed server startup verification.
   * Ensures that production refused to start if no administrator is securely provisioned.
   */
  async ensureAdminProvisioned() {
    const status = await this.getBootstrapStatus();

    // Case 1: Already provisioned with legitimate active administrator
    if (status.isBootstrapped && status.hasActiveLegitimateAdmin && !status.hasDisabledCredentials && !status.hasDefaultCredentials) {
      if (env.admin.initialPassword) {
        logger.info('[AdminBootstrap] Administrator already securely provisioned; ADMIN_INITIAL_PASSWORD in environment is ignored.');
      }
      return true;
    }

    // Case 2: Production environment checks
    if (env.isProduction) {
      // Must bootstrap if credentials are provided
      if (env.admin.initialPassword) {
        try {
          await this.bootstrapAdministrator({
            email: env.admin.initialEmail,
            password: env.admin.initialPassword,
            firstName: env.admin.initialFirstName,
            lastName: env.admin.initialLastName,
            ipAddress: '127.0.0.1',
            isCli: false
          });
          logger.info('[AdminBootstrap] Production administrator initialized successfully via environment.');
          return true;
        } catch (err) {
          logger.error(`[AdminBootstrap] Production administrator bootstrap failed: ${err.message}`);
          throw new Error(`[AdminBootstrap] FATAL: Production bootstrap failed: ${err.message}`);
        }
      }

      // Neither provisioned nor credentials provided: FAIL CLOSED
      logger.error('[AdminBootstrap] [CRITICAL SECURITY REFUSAL] Production startup refused! No secure administrator provisioned and ADMIN_INITIAL_PASSWORD is not configured.');
      throw new Error('[AdminBootstrap] Production startup refused: administrator is not provisioned and ADMIN_INITIAL_PASSWORD is not configured.');
    }

    // Case 3: Development / test environment
    if (env.admin.initialPassword) {
      try {
        await this.bootstrapAdministrator({
          email: env.admin.initialEmail,
          password: env.admin.initialPassword,
          firstName: env.admin.initialFirstName,
          lastName: env.admin.initialLastName,
          ipAddress: '127.0.0.1',
          isCli: false
        });
      } catch (err) {
        logger.warn(`[AdminBootstrap] Development bootstrap skipped or failed: ${err.message}`);
      }
    } else {
      logger.info('[AdminBootstrap] Development environment active; server permitted to start.');
    }

    return true;
  }
};

module.exports = adminBootstrapService;

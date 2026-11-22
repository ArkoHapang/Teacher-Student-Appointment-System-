/**
 * Department Controller
 * Exposes public academic department queries.
 */

const departmentService = require('../services/departmentService');
const HTTP_STATUS = require('../constants/httpStatusCodes');

const departmentController = {
  /**
   * GET /api/v1/departments
   * Public directory of academic departments
   */
  async listDepartments(req, res, next) {
    try {
      const departments = await departmentService.listDepartments();
      return res.status(HTTP_STATUS.OK).json({
        success: true,
        data: {
          total: departments.length,
          departments
        }
      });
    } catch (error) {
      next(error);
    }
  }
};

module.exports = departmentController;

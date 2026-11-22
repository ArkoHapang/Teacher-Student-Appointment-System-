/**
 * Department Service
 * Handles querying academic faculties and departments.
 */

const db = require('../config/database');

const departmentService = {
  /**
   * Retrieve all departments eligible for student registration and faculty affiliations.
   * Sorted alphabetically by department code.
   * @returns {Promise<Array<{ id: number, code: string, name: string }>>}
   */
  async listDepartments() {
    const departments = await db.query(
      `SELECT id, code, name
       FROM departments
       ORDER BY code ASC;`
    );
    return departments;
  },

  /**
   * Find a department by numeric ID.
   * @param {number|string} departmentId
   * @returns {Promise<{ id: number, code: string, name: string }|null>}
   */
  async getDepartmentById(departmentId) {
    const id = parseInt(departmentId, 10);
    if (!id || isNaN(id)) return null;
    return db.queryOne(
      `SELECT id, code, name
       FROM departments
       WHERE id = ?
       LIMIT 1;`,
      [id]
    );
  }
};

module.exports = departmentService;

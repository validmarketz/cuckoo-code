const { Tool, ToolResult } = require('./ToolRegistry');
const mysql = require('mysql2/promise');

/**
 * MySQL 数据库Tool
 * for连接 MySQL 数据库andexecute SQL 查询
 */
class MySQLTool extends Tool {
  constructor() {
    super(
      'mysql',
      '连接 MySQL 数据库andexecute SQL 查询。missing连接Parameterwhenshould先询问user。',
      {
        type: 'object',
        properties: {
          host: { type: 'string', description: 'MySQL 服务器主机of址' },
          port: { type: 'integer', description: 'MySQL 服务器端口，default 3306' },
          user: { type: 'string', description: '登录user名' },
          password: { type: 'string', description: '登录密码' },
          database: { type: 'string', description: '要连接of数据库name' },
          query: { type: 'string', description: '要executeof SQL 查询语句' },
          params: { type: 'array', description: 'SQL Parameter化查询ofParameterarray（可选）' }
        },
        required: ['host', 'user', 'password', 'database', 'query']
      },
      'mysql(options)'
    );
  }

  /**
   * execute MySQL 操作
   * @param {Object} params - Parameterobject
   * @param {string} params.host - 主机
   * @param {number} params.port - 端口
   * @param {string} params.user - user名
   * @param {string} params.password - 密码
   * @param {string} params.database - 数据库名
   * @param {string} params.query - SQL 查询
   * @param {Array} params.params - Parameter化查询Parameter
   * @returns {Promise<ToolResult>}
   */
  async execute(params) {
    // check必要Parameter
    const required = ['host', 'user', 'password', 'database', 'query'];
    const missing = required.filter(field => !params[field]);
    if (missing.length > 0) {
      return ToolResult.error(`missing必要Parameter: ${missing.join(', ')}。please提供completeof MySQL 连接信息（host, user, password, database）and查询语句。`);
    }

    const { host, port = 3306, user, password, database, query, params: queryParams = [] } = params;

    let connection;
    try {
      // Create连接
      connection = await mysql.createConnection({
        host,
        port,
        user,
        password,
        database,
        // 可选：set连接超when、字符集等
        connectTimeout: 10000,
        charset: 'utf8mb4'
      });

      // execute查询
      const [rows, fields] = await connection.execute(query, queryParams);

      // 关闭连接
      await connection.end();

      // returnresult（限制数据量prevent过大）
      const result = {
        rowCount: rows.length,
        fields: fields ? fields.map(f => f.name) : [],
        rows: rows.slice(0, 1000) // 最多return 1000 行
      };

      return ToolResult.success(result);
    } catch (err) {
      // ensure连接关闭
      if (connection) {
        try { await connection.end(); } catch (_) {}
      }
      return ToolResult.error(`MySQL Execution failed: ${err.message}`);
    }
  }
}

module.exports = { MySQLTool };
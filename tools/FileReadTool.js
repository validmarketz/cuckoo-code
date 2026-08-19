const { Tool, ToolResult } = require('./ToolRegistry');
const fs = require('fs');
const path = require('path');

/**
 * fileReadingTool
 * forReadingprojectinoffilecontent
 */
class FileReadTool extends Tool {
  constructor() {
    super(
      'file_read', 'Reading指定fileofcontent，returnstring。超过 1MB 只return前 1MB。',
      {
        type: 'object',
        properties: {
          file_path: {
            type: 'string',
            description: 'fileofrelativepathor绝对path'
          },
          encoding: {
            type: 'string',
            description: 'file编码，default utf-8',
            default: 'utf-8'
          },
          format: {
            type: 'string',
            description: 'Outputformat: plain (原始content) or escaped (escapeasJSONstring)',
            default: 'plain',
            enum: ['plain', 'escaped']
          },
          line_numbers: {
            type: 'boolean',
            description: 'whether在每行前添加行号（for AI 阅读），default false',
            default: false
          }
        },
        required: ['file_path'],
        additionalProperties: false
      },
      'readFile(file_path, encoding?)'
    );
  }

  /**
   * executefileReading
   * @param {Object} params - { file_path, encoding?, format? }
   * @returns {Promise<ToolResult>}
   */
  async execute(params) {
    const { file_path, encoding = 'utf-8', projectDir, format = 'plain', line_numbers = false } = params;

    try {
      // 规范化path：will正斜杠转换asbackslash（Windowscompatible）
      const normalizedPath = file_path.replace(/\//g, path.sep);

      // if是relativepath且有projectdirectory，thenrelative于projectdirectoryparse
      let resolvedPath = normalizedPath;
      if (!path.isAbsolute(normalizedPath) && projectDir) {
        resolvedPath = path.join(projectDir, normalizedPath);
      } else if (!path.isAbsolute(normalizedPath)) {
        // relativepath但Noneprojectdirectory，usecurrentworkdirectory
        resolvedPath = path.resolve(normalizedPath);
      } else {
        resolvedPath = normalizedPath;
      }

      // checkfilewhetherexists
      if (!fs.existsSync(resolvedPath)) {
        return ToolResult.error(`filenotexists: ${resolvedPath}`);
      }

      // checkwhether是file
      const stat = fs.statSync(resolvedPath);
      if (!stat.isFile()) {
        return ToolResult.error(`not是file: ${resolvedPath}`);
      }

      // 限制Reading大小 1MB，avoid超大file
      const MAX_SIZE = 1024 * 1024; // 1MB
      const isTruncated = stat.size > MAX_SIZE;

      let content;
      if (isTruncated) {
        // 只Reading前 1MB
        const fd = fs.openSync(resolvedPath, 'r');
        const buffer = Buffer.alloc(MAX_SIZE);
        fs.readSync(fd, buffer, 0, MAX_SIZE, 0);
        fs.closeSync(fd);
        content = buffer.toString(encoding);
        // 去除possibleof截断导致of半count字符
        content = content.replace(/�/g, '');
      } else {
        content = fs.readFileSync(resolvedPath, encoding);
      }

      // 可选：添加行号（readFileWithLines use）
      if (line_numbers) {
        content = content.split(/\r?\n/).map((line, idx) => (idx + 1) + ': ' + line).join('\n');
      }

      const absolutePath = path.resolve(resolvedPath);
      console.log('[FileReadTool] file已Reading:', absolutePath, '大小:', stat.size, 'bytes, format:', format);
      // directlyreturnfilecontentstring，not包装额外字段
      // if format as 'escaped'，returnescape后ofstring（facilitate在 JSON inuse）
      if (format === 'escaped') {
        return ToolResult.success(JSON.stringify(content));
      } else {
        return ToolResult.success(content);
      }
    } catch (err) {
      return ToolResult.error(`ReadingfileFailed: ${err.message}`);
    }
  }
}

module.exports = { FileReadTool };
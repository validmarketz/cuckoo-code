const { Tool, ToolResult } = require('./ToolRegistry');
const fs = require('fs');
const path = require('path');

/**
 * file写入Tool - 仿照 Claude Code of FileWriteTool
 * forCreate新fileor覆盖现有file
 */
class FileWriteTool extends Tool {
  constructor() {
    super(
      'file_write', 'Create新fileor覆盖已有file。父directorynotexistswhen自动Create。',
      {
        type: 'object',
        properties: {
          file_path: {
            type: 'string',
            description: 'fileof绝对pathorrelativepath'
          },
          content: {
            type: 'string',
            description: '要写入offilecontent'
          },
          encoding: {
            type: 'string',
            description: 'file编码，default utf-8',
            default: 'utf-8'
          }
        },
        required: ['file_path', 'content'],
        additionalProperties: false
      },
      'writeFile(file_path, content, encoding?)'
    );
  }

  /**
   * executefile写入
   * @param {Object} params - { file_path, content, encoding? }
   * @returns {Promise<ToolResult>}
   */
  async execute(params) {
    const { file_path, content, encoding = 'utf-8', projectDir } = params;

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

      // ensuredirectoryexists
      const dir = path.dirname(resolvedPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // 写入file
      fs.writeFileSync(resolvedPath, content, encoding);

      // get绝对path
      const absolutePath = path.resolve(resolvedPath);
      console.log('[FileWriteTool] file已写入:', absolutePath);
      console.log('[FileWriteTool] file大小:', Buffer.byteLength(content, encoding), 'bytes');
      console.log('[FileWriteTool] 编码:', encoding);

      return ToolResult.success({
        message: `file已写入: ${absolutePath}`,
        bytes: Buffer.byteLength(content, encoding),
        path: absolutePath
      });
    } catch (err) {
      return ToolResult.error(`写入fileFailed: ${err.message}`);
    }
  }
}

module.exports = { FileWriteTool };
const { Tool, ToolResult } = require('./ToolRegistry');
const fs = require('fs');
const path = require('path');

/**
 * file删除Tool
 * for删除指定offile（not可恢复）
 */
class FileDeleteTool extends Tool {
  constructor() {
    super(
      'file_delete',
      '删除指定file。not可恢复，pleasecarefullyuse。',
      {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: '要删除offileofrelativepath（relative于projectdirectory）' }
        },
        required: ['file_path']
      },
      'deleteFile(file_path)'
    );
  }

  async execute(params) {
    const { file_path, projectDir } = params;
    if (!file_path) {
      return ToolResult.error('missingParameter file_path');
    }

    // parse绝对path
    let absolutePath = file_path;
    if (!path.isAbsolute(absolutePath) && projectDir) {
      absolutePath = path.join(projectDir, file_path);
    } else if (!path.isAbsolute(absolutePath)) {
      absolutePath = path.resolve(file_path);
    }

    try {
      // checkfilewhetherexists
      await fs.promises.access(absolutePath, fs.constants.F_OK);
      // checkwhetherasfile（not是directory）
      const stat = await fs.promises.stat(absolutePath);
      if (!stat.isFile()) {
        return ToolResult.error(`pathnot是file: ${absolutePath}`);
      }
      // 删除file
      await fs.promises.unlink(absolutePath);
      return ToolResult.success({ message: `file已删除: ${absolutePath}`, path: absolutePath });
    } catch (err) {
      return ToolResult.error(`删除fileFailed: ${err.message}`);
    }
  }
}

module.exports = { FileDeleteTool };
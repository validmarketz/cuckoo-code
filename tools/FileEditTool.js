const { Tool, ToolResult } = require('./ToolRegistry');
const fs = require('fs');
const path = require('path');

/**
 * file编辑Tool - 仿照 Claude Code of Edit Tool
 * 在filein精确替换一段text（old_string → new_string）
 */
class FileEditTool extends Tool {
  constructor() {
    super(
      'file_edit', '在filein精确查找旧textand替换as新text（old_string → new_string），for修改fileof部分content。',
      {
        type: 'object',
        properties: {
          file_path: {
            type: 'string',
            description: 'fileofrelativepathor绝对path'
          },
          old_string: {
            type: 'string',
            description: '要查找of旧text，必须精确匹配filecontent'
          },
          new_string: {
            type: 'string',
            description: '要替换成of新text'
          },
          replace_all: {
            type: 'boolean',
            description: '出现多次whenwhether全部替换，default false',
            default: false
          }
        },
        required: ['file_path', 'old_string', 'new_string'],
        additionalProperties: false
      },
      'editFile(file_path, old_string, new_string, replace_all?)'
    );
  }

  /**
   * executefile编辑（精确替换）
   * @param {Object} params - { file_path, old_string, new_string, replace_all? }
   * @returns {Promise<ToolResult>}
   */
  async execute(params) {
    let { file_path, old_string, new_string, replace_all = false, projectDir } = params;

    try {
      if (old_string === undefined || old_string === null || old_string === '') {
        return ToolResult.error('old_string not能empty');
      }
      if (new_string === undefined || new_string === null) {
        return ToolResult.error('new_string not能empty');
      }

      // 规范化path：will正斜杠转换asbackslash（Windowscompatible）
      const normalizedPath = file_path.replace(/\//g, path.sep);
      // if是relativepath且有projectdirectory，thenrelative于projectdirectoryparse
      let resolvedPath = normalizedPath;
      if (!path.isAbsolute(normalizedPath) && projectDir) {
        resolvedPath = path.join(projectDir, normalizedPath);
      } else if (!path.isAbsolute(normalizedPath)) {
        resolvedPath = path.resolve(normalizedPath);
      } else {
        resolvedPath = normalizedPath;
      }

      // checkfilewhetherexists
      if (!fs.existsSync(resolvedPath)) {
        return ToolResult.error(`filenotexists: ${resolvedPath}`);
      }

      // Readingfilecontent
      const content = fs.readFileSync(resolvedPath, 'utf-8');
      console.log("content",JSON.stringify(content))
      console.log("old_string",JSON.stringify(old_string))
      new_string = new_string.replace(/\r?\n/g, '\r\n');

      // check old_string 出现of次数
      let occurrences = content.split(old_string).length - 1;
      if (occurrences === 0) {
        old_string = old_string.replace(/\r?\n/g, '\r\n');
        occurrences = content.split(old_string).length - 1;
      }
      console.log("old_string",JSON.stringify(old_string))
      if (occurrences === 0) {
        return ToolResult.error(`not found要替换oftext，pleasecheck old_string whether与filecontent精确匹配。filepath: ${resolvedPath}`);
      }


      if (occurrences > 1 && !replace_all) {
        return ToolResult.error(`old_string 在filein出现 ${occurrences} 次，please提供更长of唯一片段，orset replace_all: true`);
      }

      // execute替换
      const newContent = replace_all
        ? content.split(old_string).join(new_string)
        : content.replace(old_string, new_string);

      // 写回file
      fs.writeFileSync(resolvedPath, newContent, 'utf-8');

      const absolutePath = path.resolve(resolvedPath);
      console.log(`[FileEditTool] file已编辑: ${absolutePath}, 替换 ${occurrences} 处`);

      return ToolResult.success({
        message: `file已编辑: ${absolutePath}`,
        path: absolutePath,
        replacedCount: occurrences,
        bytes: Buffer.byteLength(newContent, 'utf-8')
      });
    } catch (err) {
      return ToolResult.error(`编辑fileFailed: ${err.message}`);
    }
  }
}

module.exports = { FileEditTool };
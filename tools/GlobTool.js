const { Tool, ToolResult } = require('./ToolRegistry');
const fs = require('fs');
const path = require('path');

// needignoreofdirectory（与 main.js of getDirectoryTree 一致）
const IGNORED_DIRS = new Set([
  'node_modules', 'target', 'build', 'dist', 'out',
  '.git', '.svn', '.hg',
  '__pycache__', '.pytest_cache', '.coverage',
  'vendor', 'bower_components', 'jspm_packages',
  '.idea', '.vscode', '.vs',
  'logs', 'tmp', 'temp',
  'bin', 'obj',
]);

// 匹配result上限，prevent超大directory爆炸
const MAX_RESULTS = 1000;

/**
 * will glob pattern转换as正then表达式
 * support：* 匹配单层internal任意字符、** 匹配任意层directory、? 匹配单count字符
 */
function globToRegex(pattern) {
  let regex = '';
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i];
    if (ch === '*') {
      if (pattern[i + 1] === '*') {
        if (pattern[i + 2] === '/') { regex += '(?:.*/)?'; i += 3; continue; } // **/
        regex += '.*'; i += 2; continue; // **
      }
      regex += '[^/]*'; i++; continue; // *
    }
    if (ch === '?') { regex += '[^/]'; i++; continue; }
    if ('\\.+()[]{}^$|'.includes(ch)) { regex += '\\' + ch; i++; continue; }
    regex += ch; i++;
  }
  return new RegExp('^' + regex + '$');
}

/**
 * 递归遍历directory，收集匹配 glob patternoffile
 */
function walkDir(dir, baseDir, regex, results) {
  if (results.length >= MAX_RESULTS) return;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    return; // None权限等，skip
  }
  for (const entry of entries) {
    if (results.length >= MAX_RESULTS) return;
    if (entry.name.startsWith('.')) continue; // hidefile
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      walkDir(fullPath, baseDir, regex, results);
    } else if (entry.isFile()) {
      // 统一use / 分隔符匹配
      const rel = path.relative(baseDir, fullPath).split(path.sep).join('/');
      if (regex.test(rel)) {
        results.push(rel);
      }
    }
  }
}

/**
 * Glob 搜索Tool - 仿照 Claude Code of Glob Tool
 * 按 glob pattern递归搜索projectinoffile
 */
class GlobTool extends Tool {
  constructor() {
    super(
      'file_glob', '按 glob pattern递归搜索projectfile，return匹配ofrelativepathlist（自动skip node_modules 等directory）。',
      {
        type: 'object',
        properties: {
          pattern: {
            type: 'string',
            description: 'glob 匹配pattern，如 **/*.java、src/**/*.js、*.json'
          },
          path: {
            type: 'string',
            description: '搜索of起始directory（relativepath），defaultproject根directory'
          }
        },
        required: ['pattern'],
        additionalProperties: false
      },
      'glob(pattern, path?)'
    );
  }

  /**
   * execute glob 搜索
   * @param {Object} params - { pattern, path?, projectDir? }
   * @returns {Promise<ToolResult>}
   */
  async execute(params) {
    const { pattern, path: searchPath, projectDir } = params;

    try {
      if (!pattern || typeof pattern !== 'string') {
        return ToolResult.error('pattern not能empty');
      }

      // determine搜索起始directory
      let baseDir;
      if (searchPath) {
        const normalized = searchPath.replace(/\//g, path.sep);
        baseDir = path.isAbsolute(normalized)
          ? normalized
          : (projectDir ? path.join(projectDir, normalized) : path.resolve(normalized));
      } else if (projectDir) {
        baseDir = projectDir;
      } else {
        baseDir = path.resolve('.');
      }

      if (!fs.existsSync(baseDir)) {
        return ToolResult.error(`directorynotexists: ${baseDir}`);
      }
      if (!fs.statSync(baseDir).isDirectory()) {
        return ToolResult.error(`not是directory: ${baseDir}`);
      }

      const regex = globToRegex(pattern);
      const results = [];
      walkDir(baseDir, baseDir, regex, results);
      results.sort((a, b) => a.localeCompare(b));

      console.log(`[GlobTool] 搜索complete: pattern=${pattern}, baseDir=${baseDir}, 匹配 ${results.length} countfile`);

      return ToolResult.success({
        message: `找to ${results.length} count匹配file`,
        pattern: pattern,
        baseDir: baseDir,
        files: results,
        truncated: results.length >= MAX_RESULTS
      });
    } catch (err) {
      return ToolResult.error(`Glob 搜索Failed: ${err.message}`);
    }
  }
}

module.exports = { GlobTool };
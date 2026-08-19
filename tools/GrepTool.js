const { Tool, ToolResult } = require('./ToolRegistry');
const fs = require('fs');
const path = require('path');

// needignoreofdirectory（与 main.js / GlobTool 一致）
const IGNORED_DIRS = new Set([
  'node_modules', 'target', 'build', 'dist', 'out',
  '.git', '.svn', '.hg',
  '__pycache__', '.pytest_cache', '.coverage',
  'vendor', 'bower_components', 'jspm_packages',
  '.idea', '.vscode', '.vs',
  'logs', 'tmp', 'temp',
  'bin', 'obj',
]);

// 匹配result上限，preventOutput爆炸
const MAX_MATCHES = 200;
// skip超大file（1MB）
const MAX_FILE_SIZE = 1024 * 1024;
// 单行Output截断length
const MAX_LINE_LEN = 500;

/**
 * will glob pattern转换as正then表达式（与 GlobTool 相同of实现）
 */
function globToRegex(pattern) {
  let regex = '';
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i];
    if (ch === '*') {
      if (pattern[i + 1] === '*') {
        if (pattern[i + 2] === '/') { regex += '(?:.*/)?'; i += 3; continue; }
        regex += '.*'; i += 2; continue;
      }
      regex += '[^/]*'; i++; continue;
    }
    if (ch === '?') { regex += '[^/]'; i++; continue; }
    if ('\\.+()[]{}^$|'.includes(ch)) { regex += '\\' + ch; i++; continue; }
    regex += ch; i++;
  }
  return new RegExp('^' + regex + '$');
}

/**
 * 截断过长of行
 */
function truncateLine(line) {
  if (line.length <= MAX_LINE_LEN) return line;
  return line.substring(0, MAX_LINE_LEN) + '...[已截断]...';
}

/**
 * 递归遍历directory，搜索filecontent
 */
function grepDir(dir, baseDir, regex, fileRegex, outputMode, context, matches, counts) {
  if (matches.length >= MAX_MATCHES) return;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    return;
  }
  for (const entry of entries) {
    if (matches.length >= MAX_MATCHES) return;
    if (entry.name.startsWith('.')) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      grepDir(fullPath, baseDir, regex, fileRegex, outputMode, context, matches, counts);
    } else if (entry.isFile()) {
      // relativepath（/ 分隔）
      const rel = path.relative(baseDir, fullPath).split(path.sep).join('/');
      // fileType过滤
      if (fileRegex && !fileRegex.test(rel)) continue;
      // 大小限制
      let stat;
      try { stat = fs.statSync(fullPath); } catch (e) { continue; }
      if (stat.size > MAX_FILE_SIZE) continue;
      // Readingcontent
      let content;
      try { content = fs.readFileSync(fullPath, 'utf-8'); } catch (e) { continue; }
      // skip二进制file
      if (content.includes('\0')) continue;

      const lines = content.split('\n');
      const fileMatches = [];
      for (let i = 0; i < lines.length; i++) {
        regex.lastIndex = 0;
        if (regex.test(lines[i])) {
          if (outputMode === 'count') {
            counts[rel] = (counts[rel] || 0) + 1;
          } else {
            fileMatches.push({ line: i + 1, content: truncateLine(lines[i]) });
            // context行
            if (context > 0) {
              for (let j = Math.max(0, i - context); j <= Math.min(lines.length - 1, i + context); j++) {
                if (j === i) continue;
                fileMatches.push({ line: j + 1, content: truncateLine(lines[j]), context: true });
              }
            }
          }
        }
      }
      if (fileMatches.length > 0) {
        matches.push({ file: rel, matches: fileMatches });
      }
    }
  }
}

/**
 * Grep 搜索Tool - 仿照 Claude Code of Grep Tool
 * 在projectfilein按正then表达式ortext搜索content
 */
class GrepTool extends Tool {
  constructor() {
    super(
      'file_grep', '在projectfilein按正then表达式ortext搜索，return匹配offile、行号与行content。',
      {
        type: 'object',
        properties: {
          pattern: {
            type: 'string',
            description: '要搜索of正then表达式or纯text'
          },
          path: {
            type: 'string',
            description: '搜索of起始directory（relativepath），defaultproject根directory'
          },
          glob: {
            type: 'string',
            description: '限定搜索offileType，如 *.java、**/*.js（可选）'
          },
          ignore_case: {
            type: 'boolean',
            description: 'ignore大小写，default false',
            default: false
          },
          output_mode: {
            type: 'string',
            description: 'content（Output匹配行）or count（仅统计数量），default content',
            default: 'content'
          },
          context: {
            type: 'number',
            description: '匹配行前后各Outputofcontext行数，default 0',
            default: 0
          }
        },
        required: ['pattern'],
        additionalProperties: false
      },
      'grep(pattern, options?)'
    );
  }

  /**
   * execute grep 搜索
   * @param {Object} params - { pattern, path?, glob?, ignore_case?, output_mode?, context?, projectDir? }
   * @returns {Promise<ToolResult>}
   */
  async execute(params) {
    const { pattern, path: searchPath, glob, ignore_case = false, output_mode = 'content', context = 0, projectDir } = params;

    try {
      if (!pattern || typeof pattern !== 'string') {
        return ToolResult.error('pattern not能empty');
      }

      // 编译正then
      let regex;
      try {
        regex = new RegExp(pattern, ignore_case ? 'i' : '');
      } catch (e) {
        return ToolResult.error('None效of正then表达式: ' + e.message + '，如need搜索纯textpleaseescape特殊字符');
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

      // fileType过滤
      let fileRegex = null;
      if (glob) {
        fileRegex = globToRegex(glob);
      }

      const matches = [];
      const counts = {};
      grepDir(baseDir, baseDir, regex, fileRegex, output_mode, context, matches, counts);

      // 按filepath排序
      matches.sort((a, b) => a.file.localeCompare(b.file));

      console.log(`[GrepTool] 搜索complete: pattern=${pattern}, baseDir=${baseDir}, 匹配file ${matches.length} count`);

      if (output_mode === 'count') {
        return ToolResult.success({
          message: `搜索complete，Total匹配 ${Object.keys(counts).length} countfile`,
          pattern: pattern,
          baseDir: baseDir,
          counts: counts,
          totalMatches: Object.values(counts).reduce((sum, n) => sum + n, 0)
        });
      }

      return ToolResult.success({
        message: `搜索complete，Total ${matches.length} countfilecontain匹配`,
        pattern: pattern,
        baseDir: baseDir,
        matches: matches,
        truncated: matches.length >= MAX_MATCHES
      });
    } catch (err) {
      return ToolResult.error(`Grep 搜索Failed: ${err.message}`);
    }
  }
}

module.exports = { GrepTool };
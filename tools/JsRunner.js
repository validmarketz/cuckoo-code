/**
 * JsRunner - 在受限of Node vm 沙箱inexecute AI generated JavaScript Tool代码
 *
 * 设计要点：
 * - through vm.createContext Create沙箱，禁用string代码generate（eval / Function 构造器allbe禁用）
 * - AI 代码None法访问 require / process / global 等 Node 能力，只能use注入ofToolfunction
 * - Toolfunction（readFile / readFileWithLines / writeFile / editFile / glob / grep / bash / deleteFile / mysql / log）
 *   through唯一of __hostBridge 桥接function回tomain processexecute，宿主functionfromnot向沙箱抛出宿主object
 * - 每countToolcall都带execute截止when间check，prevent死循环；整体run有 60 秒超when
 */

const vm = require('vm');
const { exec } = require('child_process');
const path = require('path');
const { DANGEROUS_CMDS } = require('./BashTool');
const { decodeOutput, normalizeCommand } = require('./decodeOutput');

// 同步execute超when（vm timeout，覆盖None await of死循环）
const SYNC_TIMEOUT = 30 * 1000;
// 整体run截止when间（配合宿主桥接check，覆盖 async 死循环）
const RUN_DEADLINE = 60 * 1000;
// Outputlength上限
const OUTPUT_LIMIT = 20000;

/**
 * 沙箱initializescript：在沙箱contextinternal定义allToolfunction
 * Note：thisscriptrun在沙箱 realm internal，其抛出of Error 也是沙箱 realm object，None逃逸risk
 */
const BOOTSTRAP = [
"'use strict';",
"(function () {",
"  globalThis.__logs = [];",
"",
"  function __stringify(value) {",
"    if (typeof value === 'string') return value;",
"    try { return JSON.stringify(value, null, 2); } catch (e) { return String(value); }",
"  }",
"",
"  globalThis.log = function () {",
"    var parts = [];",
"    for (var i = 0; i < arguments.length; i++) parts.push(__stringify(arguments[i]));",
"    globalThis.__logs.push(parts.join(' '));",
"  };",
"",
"  globalThis.projectDir = __projectDir;",
"",
"  async function __call(name, args) {",
"    var resText = await __hostBridge(name, JSON.stringify(args == null ? {} : args));",
"    var res;",
"    try { res = JSON.parse(resText); } catch (e) { throw new Error('ToolresultparseFailed: ' + e.message); }",
"    if (!res || res.success !== true) {",
"      throw new Error((res && res.error) || ('Tool ' + name + ' Execution failed'));",
"    }",
"    return res.data;",
"  }",
"",
"  globalThis.readFile = async function (filePath, encoding) {",
"    return await __call('file_read', { file_path: filePath, encoding: encoding || 'utf-8' });",
"  };",
"  globalThis.readFileWithLines = async function (filePath, encoding) {",
"    return await __call('file_read', { file_path: filePath, encoding: encoding || 'utf-8', line_numbers: true });",
"  };",
"  globalThis.writeFile = async function (filePath, content, encoding) {",
"    return await __call('file_write', { file_path: filePath, content: content, encoding: encoding || 'utf-8' });",
"  };",
"  globalThis.editFile = async function (filePath, oldString, newString, replaceAll) {",
"    return await __call('file_edit', { file_path: filePath, old_string: oldString, new_string: newString, replace_all: replaceAll === true });",
"  };",
"  globalThis.glob = async function (pattern, searchPath) {",
"    var data = await __call('file_glob', { pattern: pattern, path: searchPath });",
"    return (data && data.files) || [];",
"  };",
"  globalThis.grep = async function (pattern, options) {",
"    options = options || {};",
"    return await __call('file_grep', {",
"      pattern: pattern,",
"      path: options.path,",
"      glob: options.glob,",
"      ignore_case: options.ignoreCase === true,",
"      output_mode: options.outputMode || 'content',",
"      context: options.context || 0",
"    });",
"  };",
"  globalThis.bash = async function (command, options) {",
"    options = options || {};",
"    return await __call('__bash', { command: command, cwd: options.cwd, timeout: options.timeout });",
"  };",
"  globalThis.deleteFile = async function (filePath) {",
"    return await __call('file_delete', { file_path: filePath });",
"  };",
"  globalThis.mysql = async function (options) {",
"    options = options || {};",
"    return await __call('mysql', options);",
"  };",
"  globalThis.webFetch = async function (url, options) {",
"    options = options || {};",
"    var args = Object.assign({}, options, { url: url });",
"    return await __call('web_fetch', args);",
"  };",
"",
"  if (!globalThis.projectDir) {",
"    globalThis.log('[prompt] 尚notInitialize Projectdirectory，relativepathwill基于systemdirectoryparse。可点击overlay“Initialize Project”。');",
"  }",
"})();",
"",
].join('\n');

/**
 * parsecommandworkdirectory（relativepath基于projectdirectory）
 */
function resolveDir(dir, projectDir) {
  if (!dir) return projectDir || process.env.USERPROFILE || path.resolve('.');
  const normalized = String(dir).replace(/\//g, path.sep);
  if (path.isAbsolute(normalized)) return normalized;
  if (projectDir) return path.join(projectDir, normalized);
  return path.resolve(normalized);
}

/**
 * execute shell command（JS API 专用实现）
 * 与 JSON Toolof bash not同：非零退出码nottreat asFailed，而是through exitCode/error 字段return，
 * 让 AI 代码can像普通 shell 一样judgeresult。
 */
function runBash(args, projectDir) {
  const command = normalizeCommand(String(args.command || '').trim());
  if (!command) return Promise.resolve({ success: false, error: 'command not能empty' });
  if (DANGEROUS_CMDS.some((pattern) => pattern.test(command))) {
    return Promise.resolve({ success: false, error: 'commandbe安全策略拒绝（危险command）: ' + command });
  }
  const timeout = typeof args.timeout === 'number' && args.timeout > 0 ? args.timeout : 30000;
  const cwd = resolveDir(args.cwd, projectDir);

  return new Promise((resolve) => {
    exec(command, { cwd, timeout, maxBuffer: 1024 * 1024, windowsHide: true, encoding: 'buffer' }, (error, stdout, stderr) => {
      const out = decodeOutput(stdout);
      const err = decodeOutput(stderr);
      if (error) {
        resolve({
          success: true,
          data: {
            command,
            cwd,
            stdout: out,
            stderr: err,
            exitCode: typeof error.code === 'number' ? error.code : 1,
            error: error.killed ? 'commandexecute超whenorbe终止' : (err && err.trim() ? err.trim() : ('Command execution failed (exit code ' + (typeof error.code === 'number' ? error.code : 'unknown') + ')')),
          },
        });
      } else {
        resolve({
          success: true,
          data: { command, cwd, stdout: out, stderr: err, exitCode: 0, error: null },
        });
      }
    });
  });
}

/**
 * 安全of JSON 序列化（处理循环引用等exception）
 */
function safeStringify(value) {
  try {
    return JSON.stringify(value, null, 2);
  } catch (e) {
    try {
      return String(value);
    } catch (e2) {
      return '[None法序列化ofreturn值]';
    }
  }
}

class JsRunner {
  /**
   * @param {import('./ToolRegistry').ToolRegistry} registry Tool注册表
   */
  constructor(registry) {
    this.registry = registry;
  }

  /**
   * execute AI generated JS Tool代码
   * @param {string} code - AI generated JavaScript 代码（Noneneedfunction包裹，support顶层 await）
   * @param {string|null} projectDir - currentprojectdirectory（relativepath基准）
   * @returns {Promise<{success: boolean, output?: string, error?: string}>}
   */
  async run(code, projectDir) {
    if (!code || typeof code !== 'string' || !code.trim()) {
      return { success: false, error: 'None效of JS 代码' };
    }

    const startTime = Date.now();
    const deadlineMs = RUN_DEADLINE;

    // 唯一跨域桥接function：AI 代码inof每countToolcall都through它回tomain processexecute。
    // Note：thisfunction绝not向沙箱抛出宿主object（Error一律包装成 { success:false, error } result），
    // avoid沙箱internal出现宿主 realm of Error / Function 逃逸通道。
    const hostBridge = async (op, argsJson) => {
      if (Date.now() - startTime > deadlineMs) {
        return JSON.stringify({ success: false, error: 'JS scriptexecute超when（' + Math.round(deadlineMs / 1000) + ' 秒）' });
      }
      let args = {};
      try {
        args = JSON.parse(argsJson || '{}');
      } catch (e) {
        args = {};
      }

      let result;
      if (op === '__bash') {
        result = await runBash(args, projectDir);
      } else {
        const tool = this.registry.get(op);
        if (!tool) {
          result = { success: false, error: 'Unknown tool: ' + op };
        } else {
          try {
            result = await tool.execute(Object.assign({}, args, { projectDir }));
          } catch (err) {
            result = { success: false, error: 'Tool ' + op + ' execution exception: ' + (err.message || String(err)) };
          }
        }
      }
      return JSON.stringify(result);
    };

    // ========== 沙箱构建与加固 ==========
    const sandbox = {};
    Object.defineProperty(sandbox, '__hostBridge', {
      value: hostBridge, enumerable: true, writable: false, configurable: false,
    });
    Object.defineProperty(sandbox, '__projectDir', {
      value: projectDir || null, enumerable: true, writable: false, configurable: false,
    });
    // 截断沙箱object与桥接functionof原型链，阻止经 constructor/__proto__ 逃逸to宿主 realm
    try { Object.setPrototypeOf(sandbox, null); } catch (e) { /* 尽力而as */ }
    try { Object.setPrototypeOf(hostBridge, null); } catch (e) { /* 尽力而as */ }

    let context;
    try {
      context = vm.createContext(sandbox, {
        codeGeneration: { strings: false, wasm: false },
        name: 'cuckoo-js-sandbox',
      });
    } catch (err) {
      // fallback：极少数environment下 null 原型沙箱not可用
      const fallback = {};
      fallback.__hostBridge = hostBridge;
      fallback.__projectDir = projectDir || null;
      context = vm.createContext(fallback, {
        codeGeneration: { strings: false, wasm: false },
        name: 'cuckoo-js-sandbox',
      });
    }

    try {
      vm.runInContext(BOOTSTRAP, context, { filename: 'cuckoo-js-api.js' });
    } catch (err) {
      return { success: false, error: '沙箱initializeFailed: ' + (err.message || String(err)) };
    }

    // 包装as async IIFE：support顶层 await、return return值
    const script = new vm.Script('(async () => {\n' + code + '\n})()', { filename: 'cuckoo-js-tool-script.js' });

    let settleTimer = null;
    try {
      const deadline = new Promise((_resolve, reject) => {
        settleTimer = setTimeout(
          () => reject(new Error('JS scriptexecute超when（' + Math.round(deadlineMs / 1000) + ' 秒）')),
          deadlineMs
        );
      });

      const ret = await Promise.race([script.runInContext(context, { timeout: SYNC_TIMEOUT }), deadline]);

      // 收集 log() Output
      let logs = [];
      try {
        const logsJson = vm.runInContext('JSON.stringify(globalThis.__logs || [])', context);
        logs = JSON.parse(logsJson);
      } catch (e) { /* ignorelog收集Failed */ }

      const parts = [];
      if (Array.isArray(logs) && logs.length > 0) {
        parts.push(logs.join('\n'));
      }
      if (ret !== undefined && ret !== null) {
        parts.push(typeof ret === 'string' ? ret : safeStringify(ret));
      }

      let output = parts.filter(Boolean).join('\n\n');
      if (output.length > OUTPUT_LIMIT) {
        output = output.slice(0, OUTPUT_LIMIT) + '\n...[Output过长已截断]...';
      }

      return { success: true, output: output || '(Script execution completed, no output)' };
    } catch (err) {
      console.error('[JsRunner] scriptExecution failed:', err && err.stack ? err.stack : String(err));
      console.error('[JsRunner] [Diagnosis] Failed代码(JSONescape): ' + JSON.stringify(code));
      return { success: false, error: err && err.message ? err.message : String(err) };
    } finally {
      if (settleTimer) clearTimeout(settleTimer);
    }
  }
}

module.exports = { JsRunner };

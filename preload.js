const { contextBridge, ipcRenderer } = require('electron');

console.log('[Cuckoo Code] Preload script starting');

// ========== Unified Tool System (inlined into preload) ==========

/**
 * Tool execution result wrapper class
 */
class ToolResult {
  /**
   * Create a tool execution result instance
   * @param {boolean} success - Whether execution was successful
   * @param {*} data - Data returned on successful execution
   * @param {string|null} error - Error message on failed execution
   */
  constructor(success, data, error) {
    this.success = success;
    this.data = data;
    this.error = error;
  }

  /**
   * Create a successful tool execution result
   * @param {*} data - Data returned from execution
   * @returns {ToolResult} Success result instance
   */
  static success(data) { return new ToolResult(true, data, null); }

  /**
   * Create a failed tool execution result
   * @param {string} error - Error message
   * @returns {ToolResult} Failure result instance
   */
  static error(error) { return new ToolResult(false, null, error); }
}

/**
 * Unified Tool Manager
 * Responsible for registering, managing, parsing and executing all tool calls
 */
class UnifiedToolManager {
  /**
   * Create tool manager instance and automatically register built-in tools
   */
  constructor() {
    this.tools = new Map();
    this.registerBuiltinTools();
  }

  /**
   * Register all built-in tools
   * Includes: file_write, file_read, file_edit, file_glob, file_grep, bash
   */
  registerBuiltinTools() {
    this.register('file_write', {
      name: 'file_write',
      description: 'Create a new file or overwrite an existing file. If the parent directory does not exist, it will be created automatically.',
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: 'Absolute or relative path of the file' },
          content: { type: 'string', description: 'Content to write to the file' },
          encoding: { type: 'string', description: 'File encoding, default utf-8', default: 'utf-8' }
        },
        required: ['file_path', 'content'],
        additionalProperties: false
      }
    });
    this.register('file_read', {
      name: 'file_read',
      description: 'Read the content of a specified file. If the file does not exist or reading fails, an error message will be returned.',
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: 'Relative or absolute path of the file' },
          encoding: { type: 'string', description: 'File encoding, default utf-8', default: 'utf-8' }
        },
        required: ['file_path'],
        additionalProperties: false
      }
    });
    this.register('file_edit', {
      name: 'file_edit',
      description: 'Find and replace a piece of text in a file (old_string → new_string), used for modifying part of a file content.',
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: 'Relative or absolute path of the file' },
          old_string: { type: 'string', description: 'The old text to find, must match the file content exactly' },
          new_string: { type: 'string', description: 'The new text to replace with' },
          replace_all: { type: 'boolean', description: 'Whether to replace all occurrences when multiple matches exist, default false', default: false }
        },
        required: ['file_path', 'old_string', 'new_string'],
        additionalProperties: false
      }
    });
    this.register('file_glob', {
      name: 'file_glob',
      description: 'Recursively search for files in the project using glob pattern, return a list of matched file relative paths.',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Glob matching pattern, e.g., **/*.java, src/**/*.js, *.json' },
          path: { type: 'string', description: 'Starting directory for search (relative path), defaults to project root' }
        },
        required: ['pattern'],
        additionalProperties: false
      }
    });
    this.register('file_grep', {
      name: 'file_grep',
      description: 'Search content in project files by regular expression or text, return matched files, line numbers and line contents.',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Regular expression or plain text to search for' },
          path: { type: 'string', description: 'Starting directory for search (relative path), defaults to project root' },
          glob: { type: 'string', description: 'Limit file types to search, e.g., *.java, **/*.js (optional)' },
          ignore_case: { type: 'boolean', description: 'Ignore case, default false', default: false },
          output_mode: { type: 'string', description: 'content (output matched lines) or count (only count), default content', default: 'content' },
          context: { type: 'number', description: 'Number of context lines to output before and after matched lines, default 0', default: 0 }
        },
        required: ['pattern'],
        additionalProperties: false
      }
    });
    this.register('bash', {
      name: 'bash',
      description: 'Execute shell commands (Windows uses cmd.exe), return stdout/stderr output. Can be used to view directories, run builds, install dependencies, git operations, etc.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Shell command to execute' },
          cwd: { type: 'string', description: 'Working directory for the command (relative path), defaults to project root' },
          timeout: { type: 'number', description: 'Timeout in milliseconds, default 30000', default: 30000 }
        },
        required: ['command'],
        additionalProperties: false
      }
    });
    this.register('web_fetch', {
      name: 'web_fetch',
      description: 'Access web pages or APIs. Uses Node.js built-in fetch to get http/https URL responses. Suitable for fetching web page text, JSON data, API responses, etc. Note: Does not execute JavaScript; if page content is dynamically rendered by JS, use other browser tools.',
      parameters: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'URL to access, supports http/https'
          },
          method: {
            type: 'string',
            description: 'HTTP method, default GET',
            default: 'GET',
            enum: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS']
          },
          headers: {
            type: 'object',
            description: 'Request headers, e.g., { "Authorization": "Bearer xxx" }',
            default: {}
          },
          body: {
            type: 'string',
            description: 'Request body (used for POST/PUT etc.), string'
          },
          timeout: {
            type: 'number',
            description: 'Timeout in milliseconds, default 15000',
            default: 15000
          },
          maxSize: {
            type: 'number',
            description: 'Maximum bytes for response body, default 512000 (500KB), truncated if exceeded',
            default: 512000
          },
          responseType: {
            type: 'string',
            description: 'Return format: auto (based on content-type), json, text',
            default: 'auto',
            enum: ['auto', 'json', 'text']
          }
        },
        required: ['url'],
        additionalProperties: false
      }
    });
  }

  /**
   * Register a tool
   * @param {string} name - Tool name
   * @param {Object} definition - Tool definition, containing fields like name, description, parameters, etc.
   */
  register(name, definition) {
    this.tools.set(name, definition);
  }

  /**
   * Get text descriptions of all tools (for prompts)
   * @returns {string} Formatted list of tool descriptions
   */
  getToolsDescription() {
    return Array.from(this.tools.values()).map((t, i) => {
      const params = t.parameters.properties ? Object.keys(t.parameters.properties).join(', ') : 'None';
      return `${i + 1}. **${t.name}** - ${t.description}\n   Parameter: ${params}`;
    }).join('\n\n');
  }

  /**
   * Get JSON Schema definitions of all tools
   * @returns {Object} Object with tool names as keys and parameter schemas as values
   */
  getToolsSchema() {
    const schemas = {};
    for (const [name, tool] of this.tools) {
      schemas[name] = tool.parameters;
    }
    return schemas;
  }

  /**
   * Parse tool call
   * Strictly parse input content, only recognize JSON in ```jsontool code blocks, and verify if tool exists
   * @param {string|Object} input - Input content, can be string or object
   * @returns {Object|null} Parsed tool call object containing toolName, params, callId, or null
   */
  parseToolCall(input) {
    if (!input) return null;
    let parsed = null;

    if (typeof input === 'object' && input !== null) {
      parsed = input;
    } else if (typeof input === 'string') {
      const str = input.trim();
      // 严格pattern：整count输入必须only contains一count ```jsontool code block（允许前后empty白）
      // 匹配整countstring（^...$），其incontaincode block，且noother非empty白字符
      // Note：允许code block前后有empty白，但other非empty白字符会导致Failed
      const codeBlockMatch = str.match(/^\s*```jsontool\s*\n?(\{[\s\S]*?\})\s*```\s*$/);
      if (codeBlockMatch) {
        // checkwhether只有code block（即匹配后剩余stringempty）
        // 由于use了 ^ and $，已经ensure整countstring就是code block
        try { parsed = JSON.parse(codeBlockMatch[1]); } catch (e) { return null; }
      } else {
        // not再尝试directlyparse JSON（avoid误trigger），也notsupport纯 JSON object（as了严格）
        // 只有 ```jsontool 块才会be identified
        return null;
      }
    }
    if (!parsed || !parsed.toolName) return null;
    // ValidateToolwhetherexists（ifToolnotexists，thenignore）
    if (!this.tools.has(parsed.toolName)) {
      console.warn(`[Cuckoo Code] Ignoring unknown tool call: ${parsed.toolName}`);
      return null;
    }
    return {
      toolName: parsed.toolName,
      params: parsed.params || parsed.parameters || parsed.arguments || {},
      callId: parsed.callId || `call_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    };
  }

  /**
   * Validate tool parameters against schema definition
   * @param {string} toolName - Tool name
   * @param {Object} params - Parameter object to validate
   * @returns {Object} Validation result containing valid (boolean) and errors (error array)
   */
  validateParams(toolName, params) {
    const tool = this.tools.get(toolName);
    if (!tool) return { valid: false, errors: [`Unknown tool: ${toolName}`] };
    const schema = tool.parameters;
    if (!schema || !schema.properties) return { valid: true, errors: [] };
    const errors = [];
    const required = schema.required || [];
    for (const field of required) {
      if (params[field] === undefined || params[field] === null) {
        errors.push(`Missing required parameter: ${field}`);
      }
    }
    for (const [key, value] of Object.entries(params)) {
      const propSchema = schema.properties[key];
      if (!propSchema) continue;
      if (propSchema.type === 'string' && typeof value !== 'string') {
        errors.push(`Parameter ${key} must be a string`);
      }
    }
    return { valid: errors.length === 0, errors };
  }

  /**
   * Execute tool call
   * Route to corresponding tool implementation based on toolName, communicate with main process via IPC to perform actual operation
   * @param {Object} toolCall - Tool call object
   * @param {string} toolCall.toolName - Tool name
   * @param {Object} toolCall.params - ToolParameter
   * @param {string} toolCall.callId - Call ID
   * @returns {Promise<Object>} Execution result containing success, data and error fields
   */
  async execute(toolCall) {
    const { toolName, params, callId } = toolCall;
    const validation = this.validateParams(toolName, params);
    if (!validation.valid) return { success: false, error: `Parameter validation failed: ${validation.errors.join(', ')}` };

    if (toolName === 'file_write') {
      // Execute file write via IPC
      return window.electronAPI?.executeTool?.('file_write', { file_path: toolCall.params.file_path, content: toolCall.params.content, encoding: toolCall.params.encoding }, toolCall.callId)
        .then(r => ({ success: r.success, data: r.data, error: r.error }))
        .catch(e => ({ success: false, error: e.message }));
    }
    if (toolName === 'file_read') {
      // Execute file read via IPC
      return window.electronAPI?.executeTool?.('file_read', { file_path: toolCall.params.file_path, encoding: toolCall.params.encoding }, toolCall.callId)
        .then(r => ({ success: r.success, data: r.data, error: r.error }))
        .catch(e => ({ success: false, error: e.message }));
    }
    if (toolName === 'file_edit') {
      // Execute file edit via IPC
      return window.electronAPI?.executeTool?.('file_edit', {
        file_path: toolCall.params.file_path,
        old_string: toolCall.params.old_string,
        new_string: toolCall.params.new_string,
        replace_all: toolCall.params.replace_all
      }, toolCall.callId)
        .then(r => ({ success: r.success, data: r.data, error: r.error }))
        .catch(e => ({ success: false, error: e.message }));
    }
    if (toolName === 'file_glob') {
      // Execute glob search via IPC
      return window.electronAPI?.executeTool?.('file_glob', {
        pattern: toolCall.params.pattern,
        path: toolCall.params.path
      }, toolCall.callId)
        .then(r => ({ success: r.success, data: r.data, error: r.error }))
        .catch(e => ({ success: false, error: e.message }));
    }
    if (toolName === 'file_grep') {
      // Execute grep search via IPC
      return window.electronAPI?.executeTool?.('file_grep', {
        pattern: toolCall.params.pattern,
        path: toolCall.params.path,
        glob: toolCall.params.glob,
        ignore_case: toolCall.params.ignore_case,
        output_mode: toolCall.params.output_mode,
        context: toolCall.params.context
      }, toolCall.callId)
        .then(r => ({ success: r.success, data: r.data, error: r.error }))
        .catch(e => ({ success: false, error: e.message }));
    }
    if (toolName === 'bash') {
      // Execute shell command via IPC
      return window.electronAPI?.executeTool?.('bash', {
        command: toolCall.params.command,
        cwd: toolCall.params.cwd,
        timeout: toolCall.params.timeout
      }, toolCall.callId)
        .then(r => ({ success: r.success, data: r.data, error: r.error }))
        .catch(e => ({ success: false, error: e.message }));
    }
    if (toolName === 'web_fetch') {
      // Execute web page access via IPC
      return window.electronAPI?.executeTool?.('web_fetch', {
        url: toolCall.params.url,
        method: toolCall.params.method,
        headers: toolCall.params.headers,
        body: toolCall.params.body,
        timeout: toolCall.params.timeout,
        maxSize: toolCall.params.maxSize,
        responseType: toolCall.params.responseType
      }, toolCall.callId)
        .then(r => ({ success: r.success, data: r.data, error: r.error }))
        .catch(e => ({ success: false, error: e.message }));
    }
    return { success: false, error: `Unimplemented tool: ${toolName}` };
  }

  // getSystemPrompt() {
  //   const tools = Array.from(this.tools.values());
  //   let prompt = '# Available Tools\n\n';
  //   for (const tool of this.tools.values()) {
  //     prompt += `## ${tool.name}\n${tool.description}\n\n`;
  //     if (tool.parameters && tool.parameters.properties) {
  //       prompt += '**Parameters:**\n';
  //       for (const [key, schema] of Object.entries(tool.parameters.properties)) {
  //         const required = tool.parameters.required?.includes(key) ? ' (required)' : ' (optional)';
  //         prompt += `- \`${key}\`${required}: ${schema.description} (Type: ${schema.type})\n`;
  //       }
  //       prompt += '\n';
  //     }
  //     prompt += '---\n\n';
  //   }
  //   prompt += '## Call Format\n\npleasewillToolcall JSON Output在 以```jsontoolasbeginning,以```asendperform mark，仅Output JSON，do not include other text，and ensure correctescape（newline\\n、quotes\\"、backslash\\\\）：\n\n```jsontool\n{"toolName": "file_write", "params": { "file_path": "src/example.js", "content": "console.log(\"Hello\");" }, "callId": "call_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9) + '"}\n```\n';
  //   return prompt;
  // }
}

// Instantiate tool manager
const toolManager = new UnifiedToolManager();

// ========== API exposed to renderer process ==========
// Try contextBridge, if fails then mount directly to window (as fallback)
let electronAPI = {
  executeCommand: (command, id) => {
    return ipcRenderer.invoke('execute-command', { command, id });
  },
  initProject: () => {
    return ipcRenderer.invoke('init-project', { skipPrompt: false });
  },
  updateProjectDir: () => {
    return ipcRenderer.invoke('init-project', { skipPrompt: true });
  },
  executeTool: (toolName, params, callId) => {
    return ipcRenderer.invoke('execute-tool', { toolName, params, callId });
  },
  executeJs: (code, callId) => {
    return ipcRenderer.invoke('execute-js', { code, callId });
  },
  listSessions: () => {
    return ipcRenderer.invoke('list-sessions');
  },
  navigateSession: (sessionId) => {
    return ipcRenderer.invoke('navigate-session', { sessionId });
  },
};

try {
  contextBridge.exposeInMainWorld('electronAPI', electronAPI);
} catch (err) {
  console.error('[Cuckoo Code] contextBridge.exposeInMainWorld Failed:', err);
}

// None论 contextBridge whethersuccess，都directly挂载to window 作as备选
window.electronAPI = electronAPI;

// ========== overlay UI 注入 ==========

const OVERLAY_HTML = `
<div id="cuckoo-overlay" class="cuckoo-overlay cuckoo-hidden">
  <div class="cuckoo-header">
    <span class="cuckoo-title">Cuckoo Code - Command Detection</span>
    <button id="cuckoo-btn-minimize" class="cuckoo-btn-icon">—</button>
  </div>
  <div class="cuckoo-body">
    <!-- Current project directory display area -->
    <div class="cuckoo-section cuckoo-project-dir-section">
      <div class="cuckoo-project-dir-row">
        <span class="cuckoo-label">Current Project Directory</span>
        <button id="cuckoo-btn-change-dir" class="cuckoo-btn-change-dir" title="Click to change project directory">🔄 Change</button>
      </div>
      <div id="cuckoo-project-dir-display" class="cuckoo-project-dir-display">
        <span class="cuckoo-dir-path">Not selected</span>
      </div>
    </div>
    <div class="cuckoo-divider"></div>
    <!-- Session list area -->
    <div class="cuckoo-section cuckoo-session-section">
      <div class="cuckoo-session-header">
        <span class="cuckoo-label">Session List</span>
        <button id="cuckoo-btn-refresh-sessions" class="cuckoo-btn-refresh-sessions" title="Refresh session list">🔄 Refresh</button>
      </div>
      <div id="cuckoo-session-list" class="cuckoo-session-list">
        <div class="cuckoo-session-empty">No sessions</div>
      </div>
    </div>
    <div class="cuckoo-divider"></div>
    <div class="cuckoo-section">
      <label class="cuckoo-label">Detected Task: <span id="cuckoo-task-status" class="cuckoo-task-status cuckoo-hidden"><span class="cuckoo-spinner"></span>Executing</span></label>
      <pre id="cuckoo-cmd-preview" class="cuckoo-cmd-preview">None</pre>
    </div>
    <div class="cuckoo-actions">
      <button id="cuckoo-btn-init" class="cuckoo-btn cuckoo-btn-primary">Initialize Project</button>
    </div>
    <div class="cuckoo-actions">
      <button id="cuckoo-btn-send-prompt" class="cuckoo-btn cuckoo-btn-secondary">Send System Prompt</button>
      <button id="cuckoo-btn-gen-doc" class="cuckoo-btn cuckoo-btn-primary" title="Let AI generate project documentation (CUCKOO.md)">Generate Project Docs</button>
    </div>
    <div class="cuckoo-actions">
      <button id="cuckoo-btn-manual-parse" class="cuckoo-btn cuckoo-btn-secondary" title="Manually trigger parsing of tool calls in current page content">Manual Parse</button>
    </div>
    <div id="cuckoo-result-section" class="cuckoo-section cuckoo-hidden">
      <label class="cuckoo-label">Execution Result:</label>
      <div id="cuckoo-result-status" class="cuckoo-result-status"></div>
      <pre id="cuckoo-result-output" class="cuckoo-result-output"></pre>
    </div>
    <div class="cuckoo-section">
      <details id="cuckoo-history">
        <summary class="cuckoo-label">History</summary>
        <div id="cuckoo-history-list" class="cuckoo-history-list"></div>
        <button id="cuckoo-btn-clear" class="cuckoo-btn-text">Clear History</button>
      </details>
    </div>
  </div>
</div>
<div id="cuckoo-status-badge">
  <span id="cuckoo-status-dot"></span> Cuckoo Code Running
</div>
`;

const OVERLAY_CSS = `
:root {
  --ck-bg: rgba(17, 19, 34, 0.97);
  --ck-surface: rgba(255, 255, 255, 0.04);
  --ck-surface-hover: rgba(255, 255, 255, 0.08);
  --ck-border: rgba(255, 255, 255, 0.08);
  --ck-primary: #8b93ff;
  --ck-primary-strong: #6d76ff;
  --ck-text: #dde1ff;
  --ck-text-dim: #8a90b8;
  --ck-green: #4ade80;
  --ck-red: #ff6b7a;
  --ck-code-bg: rgba(0, 0, 0, 0.35);
}
.cuckoo-overlay {
  position: fixed; top: 16px; right: 16px; width: 384px; height: calc(100vh - 32px);
  background: var(--ck-bg);
  border: 1px solid var(--ck-border);
  border-radius: 20px;
  backdrop-filter: blur(28px);
  -webkit-backdrop-filter: blur(28px);
  z-index: 2147483647;
  display: flex; flex-direction: column;
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.45), 0 0 0 1px rgba(139, 147, 255, 0.06);
  transition: transform 0.35s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.3s ease;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif;
  color: var(--ck-text); font-size: 13px; line-height: 1.55;
  overflow: hidden;
}
.cuckoo-overlay.cuckoo-hidden { transform: translateX(calc(100% + 32px)); opacity: 0; pointer-events: none; }
.cuckoo-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 16px 20px 14px; flex-shrink: 0;
  border-bottom: 1px solid var(--ck-border);
  background: rgba(255, 255, 255, 0.02);
}
.cuckoo-title { font-size: 14px; font-weight: 700; color: #c8ccff; letter-spacing: 0.4px; }
.cuckoo-btn-icon {
  background: var(--ck-surface); border: 1px solid var(--ck-border); color: #8a90b8;
  cursor: pointer; font-size: 14px; width: 26px; height: 26px; border-radius: 8px;
  display: flex; align-items: center; justify-content: center; transition: all 0.2s;
}
.cuckoo-btn-icon:hover { background: var(--ck-surface-hover); color: #fff; }
.cuckoo-body { padding: 16px 18px; overflow-y: auto; flex: 1; display: flex; flex-direction: column; gap: 14px; }
.cuckoo-section { display: flex; flex-direction: column; gap: 8px; }
.cuckoo-label { font-size: 11px; font-weight: 700; color: var(--ck-text-dim); text-transform: uppercase; letter-spacing: 1px; cursor: pointer; }
.cuckoo-cmd-preview {
  background: var(--ck-code-bg); border: 1px solid var(--ck-border);
  border-radius: 12px; padding: 12px 14px;
  font-family: 'Cascadia Code', 'Fira Code', 'Consolas', monospace;
  font-size: 12.5px; color: #a7f3c0; line-height: 1.5;
  max-height: 200px; overflow: auto; white-space: pre-wrap; word-break: break-all; margin: 0;
}
.cuckoo-actions { display: flex; gap: 8px; width: 100%; }
.cuckoo-actions .cuckoo-btn { flex: 1 1 auto; }
.cuckoo-btn {
  flex: 1; padding: 11px 16px; border: 1px solid transparent; border-radius: 12px;
  font-size: 13px; font-weight: 600; cursor: pointer;
  transition: all 0.22s ease; letter-spacing: 0.3px;
}
.cuckoo-btn:active { transform: scale(0.98); }
.cuckoo-btn-primary {
  background: linear-gradient(135deg, #8b93ff, #6d76ff); color: #fff;
  box-shadow: 0 6px 18px rgba(109, 118, 255, 0.25);
}
.cuckoo-btn-primary:hover { box-shadow: 0 8px 22px rgba(109, 118, 255, 0.4); transform: translateY(-1px); }
.cuckoo-btn-primary:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }
.cuckoo-btn-secondary {
  background: var(--ck-surface); color: #c8ccff;
  border-color: var(--ck-border);
}
.cuckoo-btn-secondary:hover { background: var(--ck-surface-hover); color: #fff; border-color: rgba(139, 147, 255, 0.4); }
#cuckoo-btn-send-prompt { background: rgba(139, 147, 255, 0.16); color: #a8afff; border-color: rgba(139, 147, 255, 0.24); }
#cuckoo-btn-send-prompt:hover { background: rgba(139, 147, 255, 0.28); color: #fff; }
.cuckoo-btn-text {
  background: none; border: none; color: var(--ck-text-dim); padding: 4px 0;
  text-align: left; font-size: 11px; cursor: pointer; transition: color 0.2s;
}
.cuckoo-btn-text:hover { color: var(--ck-red); }
.cuckoo-result-status { font-size: 12px; font-weight: 600; padding: 2px 0; }
.cuckoo-result-status.success { color: var(--ck-green); }
.cuckoo-result-status.error { color: var(--ck-red); }
.cuckoo-result-output {
  background: var(--ck-code-bg); border: 1px solid var(--ck-border);
  border-radius: 12px; padding: 12px 14px;
  font-family: 'Cascadia Code', 'Fira Code', 'Consolas', monospace;
  font-size: 11.5px; color: #c8ccff; line-height: 1.5;
  max-height: 250px; overflow: auto; white-space: pre-wrap; word-break: break-all; margin: 0;
}
.cuckoo-history-list { max-height: 180px; overflow-y: auto; display: flex; flex-direction: column; gap: 6px; }
.cuckoo-history-item {
  background: var(--ck-surface); border-radius: 10px; padding: 8px 10px;
  font-size: 12px; cursor: pointer; transition: background 0.2s;
}
.cuckoo-history-item:hover { background: rgba(139, 147, 255, 0.18); }
.cuckoo-history-item .cuckoo-cmd-text {
  font-family: 'Consolas', monospace; color: #a7f3c0; font-size: 12px;
  display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.cuckoo-history-item .cuckoo-cmd-status { font-size: 11px; margin-top: 2px; display: block; }
.cuckoo-history-item .cuckoo-cmd-status.success { color: var(--ck-green); }
.cuckoo-history-item .cuckoo-cmd-status.error { color: var(--ck-red); }
.cuckoo-history-item .cuckoo-cmd-time { font-size: 10px; color: #5d6280; margin-top: 2px; display: block; }
#cuckoo-status-badge {
  position: fixed; bottom: 20px; left: 20px; z-index: 2147483647;
  background: rgba(139, 147, 255, 0.18); border: 1px solid rgba(139, 147, 255, 0.32);
  border-radius: 999px; padding: 6px 14px; font-size: 11px; color: #a8afff;
  display: flex; align-items: center; gap: 6px; cursor: pointer;
  transition: background 0.2s, border-color 0.2s;
}
#cuckoo-status-badge:hover { background: rgba(139, 147, 255, 0.3); border-color: rgba(139, 147, 255, 0.6); }
#cuckoo-status-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--ck-green); animation: cuckoo-pulse 2s infinite; }
.cuckoo-toast {
  position: fixed; top: 18px; left: 50%; transform: translateX(-50%) translateY(-8px);
  z-index: 2147483648; min-width: 200px; max-width: 380px; text-align: center;
  background: rgba(22, 24, 44, 0.92); backdrop-filter: blur(18px);
  -webkit-backdrop-filter: blur(18px);
  border: 1px solid rgba(139, 147, 255, 0.28); border-radius: 12px;
  padding: 10px 16px; font-size: 13px; color: #dde1ff;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.35);
  opacity: 0; pointer-events: none; transition: opacity 0.22s ease, transform 0.22s ease;
}
.cuckoo-toast.show { opacity: 1; transform: translateX(-50%) translateY(0); }
.cuckoo-task-status {
  display: inline-flex; align-items: center; gap: 5px;
  color: #a8afff; font-size: 11px; font-weight: 600;
}
.cuckoo-spinner {
  width: 11px; height: 11px; border-radius: 50%;
  border: 2px solid rgba(139,147,255,0.25); border-top-color: #8b93ff;
  animation: cuckoo-spin 0.8s linear infinite;
}
@keyframes cuckoo-spin { to { transform: rotate(360deg); } }
@keyframes cuckoo-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
.cuckoo-hidden { display: none !important; }
.cuckoo-home-mode .cuckoo-header .cuckoo-btn-icon,
.cuckoo-home-mode .cuckoo-body .cuckoo-section,
.cuckoo-home-mode .cuckoo-body .cuckoo-actions:not(:has(#cuckoo-btn-init)),
.cuckoo-home-mode .cuckoo-divider {
  display: none !important;
}
.cuckoo-overlay ::-webkit-scrollbar { width: 6px; }
.cuckoo-overlay ::-webkit-scrollbar-track { background: transparent; }
.cuckoo-overlay ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.15); border-radius: 3px; }
.cuckoo-overlay ::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.25); }
.cuckoo-project-dir-section {
  background: var(--ck-surface); border-radius: 12px;
  padding: 10px 12px; border: 1px solid var(--ck-border);
}
.cuckoo-project-dir-row { display: flex; justify-content: space-between; align-items: center; }
.cuckoo-btn-change-dir {
  background: rgba(139,147,255,0.2); border: none;
  color: #a8afff; padding: 2px 10px; border-radius: 6px;
  cursor: pointer; font-size: 11px; font-weight: 600;
}
.cuckoo-btn-change-dir:hover { background: rgba(139,147,255,0.4); }
.cuckoo-project-dir-display { margin-top: 4px; font-size: 12px; font-family: 'Consolas', monospace; color: #8a90b8; word-break: break-all; }
.cuckoo-dir-path { color: #a7f3c0; }
.cuckoo-divider { border-top: 1px solid var(--ck-border); margin: 2px 0; }
.cuckoo-session-section {
  background: var(--ck-surface); border-radius: 12px;
  padding: 10px 12px; border: 1px solid var(--ck-border);
}
.cuckoo-session-header { display: flex; justify-content: space-between; align-items: center; }
.cuckoo-btn-refresh-sessions {
  background: rgba(139,147,255,0.2); border: none;
  color: #a8afff; padding: 2px 10px; border-radius: 6px;
  cursor: pointer; font-size: 11px; font-weight: 600;
}
.cuckoo-btn-refresh-sessions:hover { background: rgba(139,147,255,0.4); }
.cuckoo-session-list { max-height: 120px; overflow-y: auto; margin-top: 4px; display: flex; flex-direction: column; gap: 4px; }
.cuckoo-session-item { background: rgba(255,255,255,0.05); border-radius: 8px; padding: 6px 10px; font-size: 12px; font-family: 'Consolas', monospace; color: #ccc; cursor: pointer; transition: background 0.2s; }
.cuckoo-session-item:hover { background: rgba(139,147,255,0.2); }
.cuckoo-session-item .session-id { color: #a8afff; font-size: 11px; }
.cuckoo-session-item .session-action { color: #a7f3c0; font-size: 11px; font-weight: 600; }
.cuckoo-session-empty { color: #5d6280; font-size: 12px; font-style: italic; padding: 8px 0; text-align: center; }
`;

// ========== inject styles ==========
/**
 * inject overlay CSS 样式topage头部
 */
function injectCSS() {
  const style = document.createElement('style');
  style.textContent = OVERLAY_CSS;
  document.head.appendChild(style);
}

// ========== inject overlay HTML ==========
/**
 * inject overlay HTML topage body
 * Create cuckoo-root 容器and填充 OVERLAY_HTML content
 */
function injectOverlay() {
  const container = document.createElement('div');
  container.id = 'cuckoo-root';
  container.innerHTML = OVERLAY_HTML;
  document.body.appendChild(container);
  document.getElementById('cuckoo-status-badge')?.remove();
}

// ========== overlay逻辑 ==========

let currentCommand = null;
let isExecuting = false;
let commandIdCounter = 0;
const commandHistory = [];

/**
 * generate唯一command ID
 * @returns {string} formatas cmd_when间戳_序号 of唯一标识
 */
function generateId() {
  return `cmd_${Date.now()}_${++commandIdCounter}`;
}

/**
 * format化when间戳as HH:mm:ss format
 * @param {number} ts - when间戳（毫秒）
 * @returns {string} format化后ofwhen间string
 */
function formatTime(ts) {
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/**
 * 截断textto指定length，超出部分以 ... end
 * @param {string} text - 要截断oftext
 * @param {number} maxLen - 最大length，default 50
 * @returns {string} 截断后oftext
 */
function truncate(text, maxLen = 50) {
  if (!text || text.length <= maxLen) return text || '';
  return text.substring(0, maxLen) + '...';
}

/**
 * HTML escape，prevent XSS 攻击
 * @param {string} text - 要escapeoftext
 * @returns {string} escape后of HTML string
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Show toast notification
 * @param {string} text - Notification text
 * @param {number} duration - Display duration (milliseconds), default 2200
 */
function showToast(text, duration = 2200) {
  let toast = document.getElementById('cuckoo-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'cuckoo-toast';
    toast.className = 'cuckoo-toast';
    document.body.appendChild(toast);
  }
  toast.textContent = text;
  requestAnimationFrame(() => toast.classList.add('show'));
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => {
    toast.classList.remove('show');
  }, duration);
}

/**
 * Set task status (Detected Task: Executing indicator)
 * @param {boolean} running - Whether executing
 */
function setTaskStatus(running) {
  const status = document.getElementById('cuckoo-task-status');
  if (status) {
    status.classList.toggle('cuckoo-hidden', !running);
  }
}

/**
 * Show overlay (remove hidden class)
 */
function showOverlay() {
  const el = document.getElementById('cuckoo-overlay');
  if (el) el.classList.remove('cuckoo-hidden');
}

/**
 * Hide overlay (add hidden class)
 */
function hideOverlay() {
  const el = document.getElementById('cuckoo-overlay');
  if (el) el.classList.add('cuckoo-hidden');
}

/**
 * Display command preview and expand overlay
 * @param {Object} cmdData - Command data object, containing command, timestamp, id, etc.
 */
function displayCommand(cmdData) {
  currentCommand = cmdData;
  const preview = document.getElementById('cuckoo-cmd-preview');
  const resultSection = document.getElementById('cuckoo-result-section');
  if (preview) preview.textContent = cmdData.command;
  if (resultSection) resultSection.classList.add('cuckoo-hidden');
  showToast('Executable command detected');
  showOverlay();
}
/**
 * confirmexecutecurrentshowofcommand
 * 已移除：confirmexecutebutton及相关交互。保留emptyfunction以防other引用。
 */
async function handleExecute() {
}

/**
 * ignorecurrentcommand
 * 已移除：ignorebutton及相关交互。保留emptyfunction以防other引用。
 */
function handleIgnore() {
}

/**
 * sendsystem promptbutton click handler
 */
function handleSendPrompt() {
  if (!systemPromptContent) {
    alert('system promptcontentempty');
    return;
  }
  sendSystemPromptToInput();
}

/**
 * generateproject说明documentbutton click handler
 */
function handleGenerateDoc() {
  const message = 'according tocurrentprojectgenerate一count类似 claude.md ofproject说明file，andwillfile放tocurrentproject .cuckooCode/CUCKOO.md';
  if (!sendToChat(message, 'generatedocument', 300)) {
    alert('not foundinput box，pleaseensure已open聊天界面');
  }
}

/**
 * 添加一item历史record
 * @param {Object} entry - 历史recordobject，contain id、command、success、canceled、output、timestamp 等字段
 */
function addHistory(entry) {
  commandHistory.unshift(entry);
  if (commandHistory.length > 50) commandHistory.pop();
  renderHistory();
}

/**
 * Render history list
 * Render records from commandHistory to the interface and bind click events for each record to view details
 */
function renderHistory() {
  const list = document.getElementById('cuckoo-history-list');
  if (!list) return;

  if (commandHistory.length === 0) {
    list.innerHTML = '<div style="color:#666;font-size:12px;font-style:italic;padding:8px 0;">No records</div>';
    return;
  }

  const items = commandHistory.slice(0, 20);
  list.innerHTML = items.map((item) => `
    <div class="cuckoo-history-item" data-id="${escapeHtml(item.id)}">
      <span class="cuckoo-cmd-text">${escapeHtml(truncate(item.command, 60))}</span>
      <span class="cuckoo-cmd-status ${item.canceled ? '' : item.success ? 'success' : 'error'}">
        ${item.canceled ? '⏹ Ignored' : item.success ? '✅ Success' : '❌ Failed'}
      </span>
      <span class="cuckoo-cmd-time">${formatTime(item.timestamp)}</span>
    </div>
  `).join('');

  list.querySelectorAll('.cuckoo-history-item').forEach((el) => {
    el.addEventListener('click', () => {
      const id = el.dataset.id;
      const entry = commandHistory.find((h) => h.id === id);
      if (entry) {
        const preview = document.getElementById('cuckoo-cmd-preview');
        const resultSection = document.getElementById('cuckoo-result-section');
        const resultStatus = document.getElementById('cuckoo-result-status');
        const resultOutput = document.getElementById('cuckoo-result-output');
        if (preview) preview.textContent = entry.command;
        if (entry.output && resultSection) {
          resultSection.classList.remove('cuckoo-hidden');
          if (resultStatus) {
            resultStatus.textContent = entry.canceled ? '⏹ Ignored' : entry.success ? '✅ Execution successful' : '❌ Execution failed';
            resultStatus.className = `cuckoo-result-status ${entry.success ? 'success' : 'error'}`;
          }
          if (resultOutput) resultOutput.textContent = entry.output || '(No output)';
        }
        showOverlay();
      }
    });
  });
}

/**
 * 绑定overlayall UI 事件
 * 包括button点击、keyboard shortcuts、状态徽章点击等
 */
function bindEvents() {
  const minimizeBtn = document.getElementById('cuckoo-btn-minimize');
  const initBtn = document.getElementById('cuckoo-btn-init');
  const sendPromptBtn = document.getElementById('cuckoo-btn-send-prompt');
  const clearBtn = document.getElementById('cuckoo-btn-clear');

  minimizeBtn?.addEventListener('click', hideOverlay);
  initBtn?.addEventListener('click', handleInitProject);
  sendPromptBtn?.addEventListener('click', handleSendPrompt);
  clearBtn?.addEventListener('click', () => {
    commandHistory.length = 0;
    renderHistory();
  });

  // Manual Parsebutton
  const manualParseBtn = document.getElementById('cuckoo-btn-manual-parse');
  manualParseBtn?.addEventListener('click', handleManualParse);

  // generateproject说明documentbutton
  const genDocBtn = document.getElementById('cuckoo-btn-gen-doc');
  genDocBtn?.addEventListener('click', handleGenerateDoc);

  // 刷新sessionlistbutton
  const refreshSessionsBtn = document.getElementById('cuckoo-btn-refresh-sessions');
  refreshSessionsBtn?.addEventListener('click', renderSessions);

  // 状态徽章点击showoverlay
  const statusBadge = document.getElementById('cuckoo-status-badge');
  statusBadge?.addEventListener('click', () => {
    const overlay = document.getElementById('cuckoo-overlay');
    if (overlay && overlay.classList.contains('cuckoo-hidden')) {
      showOverlay();
    }
  });

  // keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    // Ctrl+Shift+C 切换overlayshow
    if (e.ctrlKey && e.shiftKey && (e.key === 'C' || e.key === 'c')) {
      e.preventDefault();
      const overlay = document.getElementById('cuckoo-overlay');
      if (overlay) {
        if (overlay.classList.contains('cuckoo-hidden')) {
          showOverlay();
        } else {
          hideOverlay();
        }
      }
    }
    // Esc hideoverlay
    if (e.key === 'Escape') {
      hideOverlay();
    }
  });
}

// ========== sessionlist功能 ==========

/**
 * 渲染currentprojectdirectoryassociated withofsessionlist
 */
async function renderSessions() {
  const listContainer = document.getElementById('cuckoo-session-list');
  if (!listContainer) return;

  try {
    if (!window.electronAPI || !window.electronAPI.listSessions) {
      listContainer.innerHTML = '<div class="cuckoo-session-empty">API unavailable</div>';
      return;
    }

    const result = await window.electronAPI.listSessions();
    if (!result.success) {
      listContainer.innerHTML = '<div class="cuckoo-session-empty">Loading failed</div>';
      return;
    }

    const sessions = result.sessions || [];
    if (sessions.length === 0) {
      listContainer.innerHTML = '<div class="cuckoo-session-empty">No sessions yet</div>';
      return;
    }

    listContainer.innerHTML = sessions.map((sessionId) => `
      <div class="cuckoo-session-item" data-session-id="${escapeHtml(sessionId)}">
        <span class="session-id">${escapeHtml(sessionId)}</span>
        <span class="session-action">▶ 跳转</span>
      </div>
    `).join('');

    // 绑定点击事件
    listContainer.querySelectorAll('.cuckoo-session-item').forEach((item) => {
      item.addEventListener('click', () => {
        const sessionId = item.dataset.sessionId;
        if (sessionId) handleNavigateSession(sessionId);
      });
    });
  } catch (err) {
    console.error('[Cuckoo Code] Failed to render session list:', err);
    listContainer.innerHTML = '<div class="cuckoo-session-empty">Loading error</div>';
  }
}

/**
 * navigateto指定session
 */
async function handleNavigateSession(sessionId) {
  if (!sessionId) return;

  try {
    if (!window.electronAPI || !window.electronAPI.navigateSession) {
      alert('Navigation API unavailable');
      return;
    }

    const result = await window.electronAPI.navigateSession(sessionId);
    if (result.success) {
      console.log('[Cuckoo Code] 已Navigate to session:', sessionId);
      // navigatesuccess后，overlaycankeepopen，但userpossible会看topage跳转
      // 小延迟后刷新sessionlist
      setTimeout(renderSessions, 2000);
    } else {
      alert('Navigation failed: ' + (result.error || 'Unknown error'));
    }
  } catch (err) {
    console.error('[Cuckoo Code] Failed to navigate to session:', err);
    alert('Navigation failed: ' + err.message);
  }
}

/**
 * Initialize Projectbutton click handler
 */
async function handleInitProject() {
  const initBtn = document.getElementById('cuckoo-btn-init');
  if (initBtn) {
    initBtn.disabled = true;
    initBtn.textContent = '⏳ Initializing...';
  }

  try {
    // callmain processof init-project IPC
    if (!window.electronAPI || !window.electronAPI.initProject) {
      throw new Error('window.electronAPI.initProject notexists');
    }
    const result = await window.electronAPI.initProject();
    if (result && !result.success) {
      alert(result.message || 'Initialization failed');
    }
  } catch (err) {
    console.error('[Cuckoo Code] Initialize ProjectFailed:', err);
    alert('Initialization failed: ' + err.message);
  } finally {
    if (initBtn) {
      initBtn.disabled = false;
      initBtn.textContent = 'Initialize Project';
    }
  }
}

/**
 * Manual Parsebutton click handler
 * user点击后，仅parselast one AI replyinofToolcallandexecute
 */
async function handleManualParse() {
  const btn = document.getElementById('cuckoo-btn-manual-parse');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Parsing...';
  }

  try {
    // 复用自动parse逻辑：仅parselast one AI reply
    processLatestAIResponse(0, true);
    alert('Manual parse of last AI reply triggered');
  } catch (err) {
    console.error('[Cuckoo Code] Manual Parse出错:', err);
    alert('Manual parse error: ' + err.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Manual Parse';
    }
  }
}

// ========== DOM 监测：detect ```cmd code block ==========

/**
 * fromcode blockelementextract fromlanguagemark（compatible多种 DeepSeek DOM 结构）
 * 1. pre[data-language] / div[data-language]（旧结构）
 * 2. language-* class（如 language-cmd）
 * 3. .md-code-block > .md-code-block-banner 里oflanguage span（新结构，languageas纯text，如 "cuckoo"）
 * Note：not依赖 d813de27 这类 hash class，只依赖语义化 class
 * @param {Element} pre - pre element（or其祖先容器）
 * @returns {string} 小写languagemark，找nottoreturn ''
 */
function getCodeBlockLanguage(pre) {
  if (!pre) return '';

  // 1. data-language attribute（旧结构compatible）
  let lang = pre.getAttribute('data-language') || '';
  if (!lang) {
    const parentDiv = pre.closest('div[data-language]');
    if (parentDiv) lang = parentDiv.getAttribute('data-language') || '';
  }

  // 2. language-* class
  if (!lang) {
    const codeEl = pre.querySelector('code');
    const els = [codeEl, pre].filter(Boolean);
    for (const el of els) {
      const cls = Array.from(el.classList).find((c) => c.startsWith('language-'));
      if (cls) { lang = cls.replace('language-', ''); break; }
    }
  }

  // 3. 新结构：.md-code-block 容器internal banner oflanguage span（skipbuttoninternalof"copy/下载"text）
  if (!lang) {
    const block = pre.closest('.md-code-block');
    if (block) {
      const banner = block.querySelector('.md-code-block-banner');
      if (banner) {
        const spans = banner.querySelectorAll('span');
        for (const span of spans) {
          if (span.closest('button')) continue;
          const t = (span.textContent || '').trim();
          if (/^[a-zA-Z0-9_+#.-]{1,20}$/.test(t)) {
            lang = t;
            break;
          }
        }
      }
    }
  }

  return (lang || '').toLowerCase();
}

/**
 * fromcode blockelementindetectandextract cmd/powershell/batch command
 * support多种languagemark方式：data-language attribute、language-* class、md-code-block banner、第一行mark
 * @param {Element} element - 要detectof DOM element
 * @returns {string|null} extractofcommandcontent，ifnotdetectedthenreturn null
 */
function detectCmdInCodeBlock(element) {
  // 新 DOM 结构in代码在 pre > span 里，no code element
  const codeEl = element.tagName === 'CODE' ? element : element.querySelector('code');
  const pre = codeEl
    ? codeEl.closest('pre')
    : (element.tagName === 'PRE' ? element : element.querySelector('pre'));
  if (!pre) return null;
  const contentEl = codeEl || pre;

  // 统一language识别
  let language = getCodeBlockLanguage(pre);

  // fallback：代码第一行mark（```cmd 等）
  const text = contentEl.textContent || '';
  const firstLine = text.split('\n')[0].trim();
  if (!language) {
    const langMatch = firstLine.match(/^(```|;;|#|<!--)\s*(cmd|powershell|pwsh|batch|bat|dos)\s*/i);
    if (langMatch) language = langMatch[2].toLowerCase();
  }

  // judgewhetherassupportofscriptlanguage
  const validLangs = ['cmd', 'powershell', 'pwsh', 'batch', 'bat', 'dos'];
  if (!language || !validLangs.includes(language.toLowerCase())) return null;

  // extractcommandcontent
  const lines = text.split('\n');
  if (lines[0].match(/^(```|;;|#|<!--)\s*(cmd|powershell|pwsh|batch|bat|dos)/i)) {
    lines.shift();
  }
  if (lines.length > 0 && lines[lines.length - 1].trim() === '```') {
    lines.pop();
  }

  return lines.join('\n').trim() || null;
}

/**
 * forrecord已detect过ofnode，avoid重复处理
 */
const detectedSet = new WeakSet();

/**
 * 扫描给定of DOM nodelist，extract其inofcommand
 * @param {NodeList|Array} nodes - 要扫描of DOM nodelist
 * @returns {string[]} extracttoofcommandarray
 */
function scanForCommands(nodes) {
  const commands = [];
  for (const node of nodes) {
    if (node.nodeType !== Node.ELEMENT_NODE) continue;

    // checknodethis身
    if (['PRE', 'CODE', 'DIV'].includes(node.tagName)) {
      if (!detectedSet.has(node)) {
        detectedSet.add(node);
        const cmd = detectCmdInCodeBlock(node);
        if (cmd) commands.push(cmd);
      }
    }

    // check子node
    const codeBlocks = node.querySelectorAll('pre, code');
    for (const block of codeBlocks) {
      if (!detectedSet.has(block)) {
        detectedSet.add(block);
        const cmd = detectCmdInCodeBlock(block);
        if (cmd) commands.push(cmd);
      }
    }
  }
  return commands;
}

/**
 * 扫描Toolcall
 * 专门fordetect AI replyinofToolcall
 */
function scanForToolCalls(nodes) {
  const toolCalls = [];
  for (const node of nodes) {
    if (node.nodeType !== Node.ELEMENT_NODE) continue;

    // skipusermessage区域：usermessageincontainsystem promptofexample JSON，notshouldbe当作Toolcall
    if (isInsideUserMessage(node)) {
      continue;
    }

    // check pre/code code block
    if (['PRE', 'CODE'].includes(node.tagName)) {
      if (!detectedSet.has(node)) {
        detectedSet.add(node);
        const text = (node.textContent || node.innerText || '').trim();
        console.log(text);
        if (text.includes('toolName') || text.includes('"tool"') || text.includes('file_write')) {
          const toolCall = tryParseToolCall(text);
          if (toolCall) toolCalls.push(toolCall);
        }
      }
    }

    // check子nodeinof pre/code
    const codeBlocks = node.querySelectorAll('pre, code');
    for (const block of codeBlocks) {
      if (!detectedSet.has(block)) {
        detectedSet.add(block);
        const text = (block.textContent || block.innerText || '').trim();
        console.log(text);
        if (text.includes('toolName') || text.includes('"tool"') || text.includes('file_write')) {
          const toolCall = tryParseToolCall(text);
          if (toolCall) toolCalls.push(toolCall);
        }
      }
    }

    // check markdown 渲染后ofcontent（仅限 AI reply区域）
    if (node.tagName === 'DIV') {
      const text = (node.textContent || node.innerText || '').trim();
      if (text.includes('toolName') || text.includes('"tool"') || text.includes('file_write')) {
        console.log(text);
        const toolCall = tryParseToolCall(text);
        if (toolCall) toolCalls.push(toolCall);
      }
    }
  }
  return toolCalls;
}

/**
 * checknodewhether在usermessage区域internal
 * usermessageincontainsystem promptexample JSON，shouldbe排除
 */
function isInsideUserMessage(node) {
  // method1: checknodeor其祖先whetherasusermessageelement
  let current = node;
  while (current) {
    const role = current.getAttribute?.('data-role') || current.getAttribute?.('data-author') || '';
    if (role === 'user' || role === 'human') return true;

    // check常见ofusermessage class
    const cls = current.className || '';
    if (typeof cls === 'string' && (cls.includes('user-message') || cls.includes('message-user') || cls.includes('human'))) {
      return true;
    }

    current = current.parentElement;
  }

  // method2: checktextcontentwhethercontainusermessageof显著feature
  const text = (node.textContent || node.innerText || '').substring(0, 200);
  if (text.includes('我已selectdirectory：') || text.includes('system prompt：') || text.includes('Toolusage rules：')) {
    return true;
  }

  return false;
}

// ========== AI replycompletedetect ==========
/**
 * detect AI whethercompletedreply
 * rules：detectlast one AI messagein出现操作button组（copy/重新generate等），treat asreplyend
 * @returns {boolean} true 表示 AI completedreply
 */
const STOP_BTN_SELECTOR =
  '.ds-button.ds-button--primary.ds-button--filled.ds-button--circle.ds-button--m' +
  '.ds-button--icon-relative-m.ds-button--disabled';

const ACTION_BTN_SELECTOR =
  '[role="button"].ds-button--iconLabelTertiary';

function isAIResponseComplete() {
  try {
    // 必须同when满足两countitem件才判定ascomplete：
    // 1. last one AI message出现操作button组（copy/重新generate等，≥2 count）
    // 2. pageexists disabled ofstopbutton
    let btnCount = 0;
    const hasActionButtons = (() => {
      const messages = document.querySelectorAll('.ds-message');
      if (messages.length === 0) return false;
      const lastMessage = messages[messages.length - 1];
      // 操作button组现在位于 .ds-message of父容器in，not在messageelementinternal部
      const scope = lastMessage.parentElement || lastMessage;
      const actionButtons = scope.querySelectorAll(ACTION_BTN_SELECTOR);
      btnCount = actionButtons.length;
      return btnCount >= 2;
    })();

    const stopBtn = document.querySelector(STOP_BTN_SELECTOR);
    const hasStopBtn = !!stopBtn;

    if (hasActionButtons && hasStopBtn) {
      console.log('[Cuckoo Code] ✅ replycompleted（操作button组 + disabled stopbutton同when满足）');
      return true;
    }

    return false;
  } catch (err) {
    console.error('[Cuckoo Code] ❌ detect AI complete状态出错:', err);
    return false;
  }
}
// ========== MutationObserver ==========

// 已处理过ofmessagenode集合（avoid重复处理）
const processedMessages = new WeakSet();

// 正在做 JS code blockstability checkofmessage，prevent 800ms 窗口internalbe重复调度
const pendingJsChecks = new WeakSet();

// contentincompletewhenof最大重试次数（AI generate长contentpossibleneed 30 秒+）
const MAX_RETRY_COUNT = 2;
// 重试interval（ms）
const RETRY_INTERVAL = 2000;
// JS code blockstability checkof最大复查次数（1.2 秒/次，约 48 秒）
const JS_STABILITY_MAX_RETRY = 40;

/**
 * generate 2-4 秒ofrandom waitwhen间（ms）
 */
function randomDelay() {
  return Math.floor(Math.random() * 2000) + 2000; // 2000-3999ms
}

/**
 * checkstringwhetheras"suspectedToolcall但contentincomplete"
 * rules：textcontain { 且含Toolcall characteristics（toolName/Tool名/大括号beginning），
 * thenfrom第一count { startcheck括号配对；配对incompletereturn false（need重试）
 */
function isJsonBalanced(str) {
  const trimmed = (str || '').trim();
  // without { ornoToolcall characteristics → not是Toolcall，directlythrough
  if (!trimmed.includes('{')) return true;
  if (!/toolName|"tool"|file_|jsoncopy|```/.test(trimmed) && !trimmed.trimStart().startsWith('{')) {
    return true;
  }
  // from第一count { startcheck括号配对
  const jsonPart = trimmed.substring(trimmed.indexOf('{'));
  let braceCount = 0;
  let inString = false;
  let escapeNext = false;
  for (const char of jsonPart) {
    if (escapeNext) { escapeNext = false; continue; }
    if (char === '\\') { escapeNext = true; continue; }
    if (char === '"') { inString = !inString; continue; }
    if (!inString) {
      if (char === '{') braceCount++;
      else if (char === '}') {
        braceCount--;
        if (braceCount < 0) return true; // 多出of }，treat asexception但not再等
      }
    }
  }
  return braceCount === 0;
}

/**
 * replyend后，get最新 .ds-message > .ds-markdown ofcontentandParse tool call
 * @param {number} retryCount current重试次数（contentincompletewhen延迟重试）
 */
function processLatestAIResponse(retryCount = 0, force = false) {
  const messages = document.querySelectorAll('.ds-message');
  if (messages.length === 0) {
    console.log('[Cuckoo Code] not found .ds-message node');
    return;
  }

  // 取last onemessage
  const lastMessage = messages[messages.length - 1];
  const markdown = lastMessage.querySelector(':scope > .ds-markdown');
  if (!markdown) {
    console.log('[Cuckoo Code] 最新messageinno .ds-markdown');
    return;
  }

  if (!force && processedMessages.has(lastMessage)) {
    return; // 已处理过，skip
  }

  // skipusermessage（其incontainsystem prompt里ofexamplecode block，notshouldbeexecute）
  if (isInsideUserMessage(lastMessage)) {
    processedMessages.add(lastMessage);
    console.log('[Cuckoo Code] ⏭ skipusermessage（containsystem promptexample）');
    return;
  }

  // 优先detect JS Toolcode block（cuckoo code block / callToolfunctionof js code block）
  const jsBlocks = getJsCodeBlocksFromMarkdown(markdown);
  if (jsBlocks.length > 0) {
    // stable性双读校验：DeepSeek streaming渲染期间code block只渲染了一半（曾导致 "const content"
    // 这样of残缺代码beexecute → SyntaxError）。interval 1.2 秒复查content，仍在变化就重新调度。
    if (!force && pendingJsChecks.has(lastMessage)) {
      console.log('[Cuckoo Code] ⏭ thismessage已在stability checkin，skip重复调度');
      return;
    }
    if (!force) pendingJsChecks.add(lastMessage);
    if (!force && retryCount > JS_STABILITY_MAX_RETRY) {
      console.log('[Cuckoo Code] ⚠️ code block持续notstable（' + retryCount + ' 次复查），放弃this次处理');
      pendingJsChecks.delete(lastMessage);
      processedMessages.add(lastMessage);
      return;
    }
    const snapshot = markdown.textContent || '';
    const snapshotBlocks = jsBlocks.map((b) => b.length).join(',');
    console.log('[Cuckoo Code] ⏳ detected JS Toolcode block，stability checkin（' + (retryCount + 1) + '/' + JS_STABILITY_MAX_RETRY + '）...');
    if (force) {
      console.log('[Cuckoo Code] Manual Parsepattern，skipstability check');
      (async () => {
        const results = [];
        for (const code of jsBlocks) {
          const r = await handleJsToolScript(code);
          if (r) results.push(r);
        }
        const hasIncompleteFailure = results.some(item => item && item.result && !item.result.success && looksLikeIncompleteCodeError(item.result.error));
        if (hasIncompleteFailure) {
          alert('⚠️ Auto-parse may fail due to incomplete code.\n\nPlease click the "Manual Parse" button on the overlay to try again.');
          return;
        }
        if (results.length > 0) sendCombinedJsResultsToChat(results);
      })();
      return;
    }

    setTimeout(() => {
      const jsBlocksNow = getJsCodeBlocksFromMarkdown(markdown);
      const stable = (markdown.textContent || '') === snapshot &&
        jsBlocksNow.length === jsBlocks.length &&
        jsBlocksNow.map((b) => b.length).join(',') === snapshotBlocks;
      if (!stable) {
        console.log('[Cuckoo Code] ⏳ code block仍在streaming更新（快照not一致），重新调度');
        pendingJsChecks.delete(lastMessage);
        processLatestAIResponse(retryCount + 1);
        return;
      }
      if (!force) processedMessages.add(lastMessage);
      pendingJsChecks.delete(lastMessage);
      console.log('[Cuckoo Code] ✅ code blockstable，detected JS Toolcode block（' + jsBlocks.length + ' count），startexecute');
      (async () => {
        const results = [];
        for (const code of jsBlocks) {
          const r = await handleJsToolScript(code);
          if (r) results.push(r);
        }
        const hasIncompleteFailure = results.some(item => item && item.result && !item.result.success && looksLikeIncompleteCodeError(item.result.error));
        if (hasIncompleteFailure) {
          alert('⚠️ Auto-parse may fail due to incomplete code.\n\nPlease click the "Manual Parse" button on the overlay to try again.');
          return;
        }
        if (results.length > 0) sendCombinedJsResultsToChat(results);
      })();
    }, 800);
    return;
  }

  // extracttext：优先from pre code extract（code blockcontent天然without json/copy/下载等buttontext）
  let text = '';
  const codeEl = markdown.querySelector('pre code');
  if (codeEl) {
    text = (codeEl.textContent || codeEl.innerText || '').trim();
    console.log('[Cuckoo Code] extract方式: pre code element');
  } else {
    // Nonecode block：克隆nodeandremovepossibleofTool栏element
    const clone = markdown.cloneNode(true);
    clone.querySelectorAll('button, [class*="toolbar"], [class*="copy"], [class*="download"], [class*="code-block-header"], [class*="lang"], [class*="header"]').forEach(el => el.remove());
    text = (clone.textContent || clone.innerText || '').trim();
    console.log('[Cuckoo Code] extract方式: 克隆node(removeTool栏)');
  }

  if (!text) return;
  console.log(text);
  // whetherassuspectedToolcontent（for控制详细log与prompt文案）
  const looksToolish = text.includes(FENCE) ||
    /toolName|"tool"|file_|await\s+(?:readFile|writeFile|editFile|glob|grep|bash|deleteFile|mysql)\s*\(/.test(text);

  // length必打；原文/escape仅在suspectedToolcontentwhen打印（普通聊天replynot再刷屏）
  console.log('[Cuckoo Code] replytextlength: ' + text.length + (looksToolish ? '（suspectedToolcontent）' : '（普通text）'));
  if (looksToolish) {
    console.log('[Cuckoo Code] replycompletecontent(原文):');
    console.log(text);
    console.log('[Cuckoo Code] replycompletecontent(escapeshow):');
    console.log(JSON.stringify(text));
  }

  // contentincomplete（suspectedstreamingOutputnot真正end）：延迟重试，avoid处理截断of JSON
  if (!force && !isJsonBalanced(text)) {
    if (retryCount < MAX_RETRY_COUNT) {
      console.log('[Cuckoo Code] ⏳ JSON incomplete(suspectedstreamingnotend)，' + (retryCount + 1) + '/' + MAX_RETRY_COUNT + ' 次延迟重试, currentlength=' + text.length + '...');
      setTimeout(() => processLatestAIResponse(retryCount + 1), RETRY_INTERVAL);
      return; // notmark processed，允许重试
    }
    console.log('[Cuckoo Code] ⚠️ JSON 持续incomplete（20次重试仍截断），放弃this次处理，currentlength=' + text.length);
    // return AI，让它重新completeOutput
    sendToolResultToChat(
      { toolName: 'not知', callId: 'incomplete' },
      { success: false, error: 'receivedincompleteofToolcall JSON（contentbe截断），please重新completeOutputToolcall。' }
    );
  }

  if (!force) processedMessages.add(lastMessage);

  const toolCall = tryParseToolCall(text);
  if (toolCall) {
    // Validate toolName whether在Tool库in
    const available = toolManager.tools.has(toolCall.toolName);
    if (!available) {
      console.log('[Cuckoo Code] ⚠️ Toolnotexists: ' + toolCall.toolName + ', Available Tools: ' + Array.from(toolManager.tools.keys()).join(', '));
      // return AI，告知Toolnotexists
      sendToolResultToChat(
        toolCall,
        { success: false, error: 'Tool ' + toolCall.toolName + ' notexists，Available Tools: ' + Array.from(toolManager.tools.keys()).join(', ') }
      );
      return;
    }
    console.log('[Cuckoo Code] ✅ Toolexists: ' + toolCall.toolName + ', startexecute');
    notifyToolCallDetected(toolCall);
    handleToolCall(toolCall);
  } else {
    if (looksToolish) {
      // suspectedToolcontent但 JS 块detect与 JSON parse都没命in → 打印Diagnosis，help定位
      console.log('[Cuckoo Code] ⚠️ replysuspectedToolcall但notbe identified（JS code blocknot匹配 / JSON parseFailed）');
      const pres = markdown.querySelectorAll('pre');
      if (pres.length > 0) {
        for (const p of pres) {
          const lang = getCodeBlockLanguage(p);
          console.log('[Cuckoo Code] [Diagnosis] code block language=' + (lang || '(None)') + ', content前80字符=' + ((p.textContent || '').trim().slice(0, 80)));
        }
      } else {
        console.log('[Cuckoo Code] [Diagnosis] messageinnoany pre code block');
      }
    } else {
      console.log('[Cuckoo Code] ℹ️ 正常textreply，notdetectedToolcall（Noneneed处理）');
    }
  }
}

// Reading防抖定when器
let responseReadTimer = null;

function startObserver() {
  const observer = new MutationObserver((mutations) => {
    let hasNewContent = false;
    for (const mutation of mutations) {
      if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
        // 扫描command
        const commands = scanForCommands(mutation.addedNodes);
        for (const cmd of commands) {
          displayCommand({ command: cmd, timestamp: Date.now(), id: generateId() });
        }
        hasNewContent = true;
      }
    }

    // replyend后处理最新 AI reply（detected操作button组后立即处理）
    if (hasNewContent && isAIResponseComplete()) {
      clearTimeout(responseReadTimer);
      console.log('[Cuckoo Code] ✅ detectedreplyend，立即Readingreply');
      processLatestAIResponse();
    }
  });

  const target = document.body || document.documentElement;
  if (target) {
    observer.observe(target, { childList: true, subtree: true });
  }
}

/**
 * 通知userdetectedToolcall（blinking status badge + 展开overlay）
 */
function notifyToolCallDetected(toolCall) {
  showOverlay();
  // 更新预览区域showdetectedofToolcall
  const preview = document.getElementById('cuckoo-cmd-preview');
  if (preview) {
    preview.textContent = `[Tool] ${toolCall.toolName}\nParameter: ${JSON.stringify(toolCall.params, null, 2)}`;
  }
  // blinking status badge
  flashBadge('Cuckoo Code - Toolcalldetected');
}

// ========== system prompt ==========

let systemPromptContent = '';
let initialPromptContent = '';
let pendingSystemPrompt = false; // whether有待sendof system prompt
let pendingInitialPrompt = false; // whether有待sendofinitialprompt（directory tree+systemPrompt）
let pendingToolCall = null; // 待executeofToolcall

// ========== Toolcallparse与execute ==========

/**
 * 尝试Parse tool call
 * supportformat：
 * 1. standard format: {"toolName": "...", "params": {...}, "callId": "..."}
 * 2. code blockformat: ```json {...} ``` or ```tool {...} ```
 * 3. contain额外textof混合content
 */
/**
 * 宽容parse JSON：先严格parse，Failed后修复常见formatproblem再parse
 * 常见problem：string值internalnotescapeofnewline、tab、quotes（AI generated JSON 经常忘记escape）
 */
/**
 * 宽容parse JSON：先严格parse，Failed后修复常见formatproblem再parse
 * 常见problem：string值internalnotescapeofnewline、tab、quotes（AI generated JSON 经常忘记escape）
 * @param {string} str - 待parseof JSON string
 * @returns {Object|null} parse后ofobject，parseFailedreturn null
 */
function parseJsonWithRepair(str) {
  if (!str) return null;
  try {
    return JSON.parse(str);
  } catch (e) {
    // 修复：把string值internal裸ofnewline/tab escapeas \n \t
    const repaired = repairJsonString(str);
    try {
      return JSON.parse(repaired);
    } catch (e2) {
      return null;
    }
  }
}

/**
 * 修复 JSON string：逐字符扫描，把string值internalof裸newline、\r、\t escape，
 * and把明显是content而非边界of裸quotesescapeas \"
 */
function repairJsonString(str) {
  let result = '';
  let inString = false;
  let escapeNext = false;

  for (let i = 0; i < str.length; i++) {
    const ch = str[i];

    if (escapeNext) {
      result += ch;
      escapeNext = false;
      continue;
    }

    if (ch === '\\') {
      result += ch;
      escapeNext = true;
      continue;
    }

    if (ch === '"') {
      if (inString) {
        // stringinternal遇toofquotes：judge是边界还是content
        const nextChar = str[i + 1];
        const prevChar = result[result.length - 1] || '';
        const isBoundary = nextChar === ':' || nextChar === ',' || nextChar === '}' || nextChar === ']' ||
          nextChar === undefined || /[\s]/.test(nextChar || '') ||
          prevChar === ':' || prevChar === ',' || prevChar === '{' || prevChar === '[';
        if (isBoundary) {
          // stringend边界
          inString = false;
          result += '"';
        } else {
          // content里ofquotes，escape
          result += '\\"';
        }
      } else {
        inString = true;
        result += '"';
      }
      continue;
    }

    if (inString) {
      // string值internalof裸控制字符 → escape
      if (ch === '\n') { result += '\\n'; continue; }
      if (ch === '\r') { result += '\\r'; continue; }
      if (ch === '\t') { result += '\\t'; continue; }
    }

    result += ch;
  }

  return result;
}

function tryParseToolCall(content) {
  if (!content || typeof content !== 'string') return null;
  const str = content.trim();

  let parsed = null;

  // 1. 尝试directlyparse JSON（纯 JSON 响should，含容错修复）
  parsed = parseJsonWithRepair(str);

  // 2. extractcode block ```json/tool ... ```
  if (!parsed) {
    const codeBlockMatch = str.match(/```(?:json|tool)?\s*\n?(\{[\s\S]*?\})\s*```/);
    if (codeBlockMatch) {
      const extracted = codeBlockMatch[1].trim();
      parsed = parseJsonWithRepair(extracted);
    }
  }

  // 3. 在textin查找 JSON object（取第一countcompleteof { ... }）
  if (!parsed) {
    const firstBrace = str.indexOf('{');
    if (firstBrace !== -1) {
      const candidate = extractJsonObject(str, firstBrace);
      if (candidate) {
        parsed = parseJsonWithRepair(candidate);
      }
    }
  }

  if (!parsed) {
    return null;
  }

  // support多种字段名：toolName/tool, params/parameters/arguments
  if (!parsed.toolName && !parsed.tool) {
    console.log('[Cuckoo Code] missing toolName/tool 字段, completeobject:', JSON.stringify(parsed));
    return null;
  }

  // normalizeOutput
  const result = {
    toolName: parsed.toolName || parsed.tool,
    params: parsed.params || parsed.parameters || parsed.arguments || {},
    callId: parsed.callId || `call_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  };
  console.log('[Cuckoo Code] ✅ parsesuccess, toolName=' + result.toolName + ', params=' + JSON.stringify(result.params));
  return result;
}


/**
 * fromtextextract fromcompleteof JSON objectstring（from startPos of { start）
 * through括号配对找to对shouldof } end位置
 */
function extractJsonObject(str, startPos) {
  let braceCount = 0;
  let inString = false;
  let escapeNext = false;

  for (let i = startPos; i < str.length; i++) {
    const char = str[i];

    if (escapeNext) {
      escapeNext = false;
      continue;
    }

    if (char === '\\') {
      escapeNext = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (!inString) {
      if (char === '{') braceCount++;
      else if (char === '}') {
        braceCount--;
        if (braceCount === 0) {
          return str.substring(startPos, i + 1);
        }
      }
    }
  }

  // 括号not配对complete（streamingOutputnotend）
  return null;
}

// ========== JS Toolscriptdetect与execute ==========

// 反quotes与围栏（用字符码构造，avoid源码inofescapeproblem）
const BT = String.fromCharCode(96);
const FENCE = BT + BT + BT;
// Toolcall characteristics：必须出现 "await Toolfunction名(" 形式ofcall（prevent fs.readFile 等普通example误判）
const JS_TOOL_CALL_RE = /\bawait\s+(?:readFile|readFileWithLines|writeFile|editFile|glob|grep|bash|deleteFile|mysql|webFetch)\s*\(/;
/**
 * judge一段 JS 代码whethercall了Toolfunction
 */
function looksLikeIncompleteCodeError(error) {
  if (!error || typeof error !== 'string') return false;
  return /SyntaxError|Missing initializer|Unexpected end of input|Unexpected token|Unexpected identifier|Unexpected reserved word|Invalid or unexpected token/i.test(error);
}

function looksLikeToolScript(code) {
  const c = code || '';
  return JS_TOOL_CALL_RE.test(c);
}

/**
 * judge原始text去掉all围栏code block后whether只剩empty白（整itemreplyonly containscode block）
 */
function hasOnlyFences(text) {
  if (!text || typeof text !== 'string') return false;
  const lines = text.split(String.fromCharCode(10));
  const rest = [];
  let inFence = false;
  for (const line of lines) {
    const t = line.trim();
    if (t.startsWith(FENCE)) {
      inFence = !inFence;
      continue;
    }
    if (!inFence) rest.push(t);
  }
  return rest.join(' ').trim() === '';
}

/**
 * from原始text（含 Markdown 围栏）extract from JS Toolcode block
 * rules：
 * - cuckoo code block：一律treat asToolscript
 * - js / javascript code block：仅当整itemreplyonly containscode block、且代码call了Toolfunctionwhen才treat asToolscript
 *   （avoid把正常answer里ofexample代码误当作Toolscriptexecute）
 */
function extractJsToolBlocks(text) {
  const blocks = [];
  if (!text || typeof text !== 'string') return blocks;

  const onlyFences = hasOnlyFences(text);

  const lines = text.split(String.fromCharCode(10));
  let inBlock = false;
  let lang = '';
  let buf = [];

  const flush = () => {
    const code = buf.join(String.fromCharCode(10)).trim();
    const l = (lang || '').toLowerCase();
    if (code) {
      if (l === 'cuckoo') {
        blocks.push(code);
      } else if ((l === 'js' || l === 'javascript') && onlyFences && looksLikeToolScript(code)) {
        blocks.push(code);
      }
    }
    inBlock = false;
    lang = '';
    buf = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!inBlock) {
      if (trimmed.startsWith(FENCE)) {
        lang = (trimmed.slice(3) || '').split(' ')[0];
        inBlock = true;
        buf = [];
      }
      continue;
    }
    if (trimmed.startsWith(FENCE)) {
      flush();
      continue;
    }
    buf.push(line.replace(String.fromCharCode(13), ''));
  }
  if (inBlock) flush();
  return blocks;
}

/**
 * judge容器去掉all pre code block后whether只剩empty白（整itemreplyonly containscode block）
 */
function hasOnlyCodeContent(root) {
  if (!root) return false;
  // call方已定位tospecificcode blockelementwhen，treat as"只有代码"
  if (root.tagName === 'PRE') return true;
  const clone = root.cloneNode(true);
  // removecode blockthis身、banner（language标签 + copy/下载button）与Tool栏等装饰element
  clone.querySelectorAll('pre, .md-code-block-banner-wrap, .md-code-block-banner, button, [class*="toolbar"], [class*="copy"], [class*="download"], [class*="code-block-header"], [class*="lang"], [class*="header"]').forEach((el) => el.remove());
  return !(clone.textContent || '').trim();
}

/**
 * from渲染后of DOM（markdown 容器or单count pre element）extract from JS Toolcode block
 * rules同 extractJsToolBlocks：js/javascript 块要求整itemreplyonly containscode block
 */
function getJsCodeBlocksFromMarkdown(root) {
  const blocks = [];
  if (!root) return blocks;

  const onlyCode = hasOnlyCodeContent(root);

  const pres = [];
  if (root.tagName === 'PRE') pres.push(root);
  if (root.querySelectorAll) {
    const nested = root.querySelectorAll('pre');
    for (const p of nested) pres.push(p);
  }

  for (const pre of pres) {
    const lang = getCodeBlockLanguage(pre);
    const codeEl = pre.querySelector('code');
    const code = ((codeEl ? codeEl.textContent : pre.textContent) || '').trim();
    if (!code) continue;
    if (lang === 'cuckoo') {
      blocks.push(code);
      continue;
    }
    if ((lang === 'js' || lang === 'javascript' || lang === '') && onlyCode && looksLikeToolScript(code)) {
      blocks.push(code);
    }
  }
  return blocks;
}

/**
 * blinking status badgeprompt
 */
function flashBadge(text) {
  const badge = document.getElementById('cuckoo-status-badge');
  const dot = document.getElementById('cuckoo-status-dot');
  if (badge) {
    badge.style.background = 'rgba(124,255,178,0.25)';
    badge.style.borderColor = 'rgba(124,255,178,0.6)';
    const label = badge.querySelector('span:last-child');
    if (label) label.textContent = text;
    setTimeout(() => {
      badge.style.background = 'rgba(124,131,255,0.15)';
      badge.style.borderColor = 'rgba(124,131,255,0.3)';
      if (label) label.textContent = 'Cuckoo Code runin';
    }, 3000);
  }
  if (dot) {
    dot.style.background = '#ffc107';
    dot.style.animation = 'none';
    setTimeout(() => {
      dot.style.background = '#7cffb2';
      dot.style.animation = 'cuckoo-pulse 2s infinite';
    }, 3000);
  }
}

/**
 * 通知userdetected JS Toolscript（更新预览 + 闪烁徽章）
 */
function notifyJsScriptDetected(code) {
  showOverlay();
  const preview = document.getElementById('cuckoo-cmd-preview');
  if (preview) {
    preview.textContent = '[JS Toolscript]' + String.fromCharCode(10) + code;
  }
  flashBadge('Cuckoo Code - JS Toolscriptdetected');
}

/**
 * executedetectedof JS Toolscript（带双通道去重）
 */
async function handleJsToolScript(code) {
  showOverlay();
  notifyJsScriptDetected(code);
  setTaskStatus(true);
  showToast('Starting command execution');

  const callId = 'js_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
  console.log('[Cuckoo Code] [Diagnosis] 即willexecuteof代码(JSONescape): ' + JSON.stringify(code));
  try {
    const result = await window.electronAPI.executeJs(code, callId);

    const resultSection = document.getElementById('cuckoo-result-section');
    const resultStatus = document.getElementById('cuckoo-result-status');
    const resultOutput = document.getElementById('cuckoo-result-output');
    if (resultSection) resultSection.classList.remove('cuckoo-hidden');

    if (result.success) {
      if (resultStatus) {
        resultStatus.textContent = '✅ JS Script executed successfully';
        resultStatus.className = 'cuckoo-result-status success';
      }
      if (resultOutput) {
        resultOutput.textContent = result.output || '(Script execution completed, no output)';
      }
    } else {
      if (resultStatus) {
        resultStatus.textContent = '❌ JS Script execution failed';
        resultStatus.className = 'cuckoo-result-status error';
      }
      if (resultOutput) {
        resultOutput.textContent = result.error || 'Unknown error';
      }
    }

    addHistory({
      id: callId,
      command: '[JS] ' + truncate((code.split(String.fromCharCode(10))[0] || code), 60),
      success: result.success,
      output: result.success ? (result.output || '') : (result.error || 'Unknown error'),
      timestamp: Date.now(),
    });

    // returnexecuteresult，由call方统一合andreturn
    return { code, result };
  } catch (err) {
    console.error('[Cuckoo Code] JS Tool script execution exception:', err);
    const resultSection = document.getElementById('cuckoo-result-section');
    const resultStatus = document.getElementById('cuckoo-result-status');
    const resultOutput = document.getElementById('cuckoo-result-output');
    if (resultSection) resultSection.classList.remove('cuckoo-hidden');
    if (resultStatus) {
      resultStatus.textContent = '❌ System error';
      resultStatus.className = 'cuckoo-result-status error';
    }
    if (resultOutput) {
      resultOutput.textContent = err.message || String(err);
    }
    return { code, result: { success: false, error: 'System exception: ' + (err.message || String(err)) } };
  } finally {
    setTaskStatus(false);
  }
}

/**
 * Execute tool call
 */
async function handleToolCall(toolCall) {
  const { toolName, params, callId } = toolCall;
  console.log(`[Cuckoo Code] Execute tool: ${toolName}`, params);

  // ensureoverlay可见，让user看to正在处理
  showOverlay();
  setTaskStatus(true);
  showToast('Starting command execution');

  try {
    const result = await window.electronAPI.executeTool(toolName, params, callId);

    // showexecuteresult
    const resultSection = document.getElementById('cuckoo-result-section');
    const resultStatus = document.getElementById('cuckoo-result-status');
    const resultOutput = document.getElementById('cuckoo-result-output');

    if (resultSection) resultSection.classList.remove('cuckoo-hidden');

    if (result.success) {
      if (resultStatus) {
        resultStatus.textContent = '✅ Tool ' + toolName + ' executed successfully';
        resultStatus.className = 'cuckoo-result-status success';
      }
      if (resultOutput) {
        resultOutput.textContent = JSON.stringify(result.data, null, 2);
      }
    } else {
      if (resultStatus) {
        resultStatus.textContent = '❌ Tool ' + toolName + ' execution failed';
        resultStatus.className = 'cuckoo-result-status error';
      }
      if (resultOutput) {
        resultOutput.textContent = result.error || 'Unknown error';
      }
    }

    // 添加to历史
    addHistory({
      id: callId,
      command: `[Tool] ${toolName}`,
      success: result.success,
      output: result.success ? JSON.stringify(result.data, null, 2) : (result.error || 'Unknown error'),
      timestamp: Date.now(),
    });

    // willexecuteresultsend回聊天，让 AI see results and continue working
    sendToolResultToChat(toolCall, result);
  } catch (err) {
    console.error('[Cuckoo Code] Toolexecution exception:', err);
    const resultSection = document.getElementById('cuckoo-result-section');
    const resultStatus = document.getElementById('cuckoo-result-status');
    const resultOutput = document.getElementById('cuckoo-result-output');
    if (resultSection) resultSection.classList.remove('cuckoo-hidden');
    if (resultStatus) {
      resultStatus.textContent = '❌ System error';
      resultStatus.className = 'cuckoo-result-status error';
    }
    if (resultOutput) resultOutput.textContent = err.message || String(err);
    // systemexception也要return AI，让它知道发生了什么
    sendToolResultToChat(toolCall, { success: false, error: 'System exception: ' + (err.message || String(err)) });
  } finally {
    setTaskStatus(false);
  }
}

/**
 * willtext填入input box（React compatible：use原生 value setter）
 * @param {Element} input - input boxelement
 * @param {string} msg - 要填入oftext
 * @returns {boolean} whethersuccess填入
 */
function setInputContent(input, msg) {
  try {
    if (input.tagName === 'TEXTAREA' || input.tagName === 'INPUT') {
      input.focus();
      const nativeSetter = Object.getOwnPropertyDescriptor(
        input.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype,
        'value'
      ).set;
      nativeSetter.call(input, msg);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    }
    if (input.isContentEditable || input.getAttribute('contenteditable') === 'true') {
      input.focus();
      document.execCommand('selectAll', false, null);
      document.execCommand('insertText', false, msg);
      return true;
    }
    return false;
  } catch (err) {
    console.error('[Cuckoo Code] setinput boxcontentFailed:', err.message);
    return false;
  }
}

/**
 * willmessage填入current可见input boxand按指定延迟triggersend
 * @param {string} msg - 要sendofmessage
 * @param {string} [tag] - logmark
 * @param {number} [fixedDelay] - 固定延迟毫秒数；缺省whenuse randomDelay()
 * @param {Function} [afterSent] - send后回调
 * @returns {boolean} whethersuccess
 */
function sendToChat(msg, tag, fixedDelay, afterSent) {
  const input = findInputArea();
  if (!input) {
    console.log('[Cuckoo Code] input box not found，None法sendmessage');
    return false;
  }
  if (!setInputContent(input, msg)) {
    return false;
  }
  const sendDelay = fixedDelay !== undefined ? fixedDelay : randomDelay();
  console.log('[Cuckoo Code] message已填入input box，等待 ' + sendDelay + 'ms send after...');
  setTimeout(function() {
    console.log('[Cuckoo Code] 等待end，starttriggersend');
    triggerSend(input);
    console.log('[Cuckoo Code] 已triggersend, ' + (tag || '') + ', length=' + msg.length);
    if (typeof afterSent === 'function') afterSent();
  }, sendDelay);
  return true;
}

/**
 * willmessage填入 DeepSeek 聊天input boxandtriggersend（Toolresultreturnof公Total实现）
 */
function sendMessageToChat(msg, tag) {
  return sendToChat(msg, tag);
}

/**
 * will JSON Toolexecuteresultsend回 DeepSeek 聊天，让 AI see results and continue working
 */
function sendToolResultToChat(toolCall, result) {
  // 构造returnmessage（明确ofsuccess/Failed信息，AI 可据this修正and继续）
  let msg;
  if (result.success) {
    const data = result.data || {};
    // 大content截断保护（20KB），avoid超长message
    if (typeof data.content === 'string' && data.content.length > 20000) {
      data.content = data.content.substring(0, 20000) + String.fromCharCode(10) + '...[content过长已截断]...';
    }
    msg = '【Toolexecuteresult】' + toolCall.toolName + ' Execution successful (callId: ' + (toolCall.callId || '') + ')' + String.fromCharCode(10) +
      JSON.stringify(data, null, 2);
  } else {
    msg = '【Toolexecuteresult】' + toolCall.toolName + ' Execution failed (callId: ' + (toolCall.callId || '') + ')' + String.fromCharCode(10) +
      'Errorreason: ' + (result.error || 'not知Error') + String.fromCharCode(10) +
      'pleaseaccording toErrorreason修正Parameter后重新callTool。';
  }

  console.log('[Cuckoo Code] returnToolresult, messagelength=' + msg.length);
  sendMessageToChat(msg, 'Tool=' + toolCall.toolName);
}

/**
 * will JS Toolscriptexecuteresultsend回 DeepSeek 聊天，让 AI see results and continue working
 */
function sendCombinedJsResultsToChat(results) {
  if (!Array.isArray(results) || results.length === 0) return;

  const MAX_OUTPUT = 15000;
  const sep = String.fromCharCode(10);

  let msg = '[JS Execution Results Summary] (Total: ' + results.length + ' scripts)' + sep + sep;

  for (let i = 0; i < results.length; i++) {
    const item = results[i];
    msg += '— Script ' + (i + 1) + ' —' + sep;
    if (item && item.result && item.result.success) {
      let out = (item.result.output || '').trim();
      if (out.length > MAX_OUTPUT) {
        out = out.slice(0, MAX_OUTPUT) + sep + '...[Output too long, truncated]...';
      }
      msg += '✅ Success' + sep + (out || '(Script execution completed, no output)');
    } else {
      msg += '❌ Failed' + sep + 'Error reason: ' + ((item && item.result && item.result.error) || 'Unknown error') + sep;
      msg += 'Actually executed code (first 300 chars):' + sep + String((item && item.code) || '').slice(0, 300) + sep;
      msg += 'Please correct the JavaScript code and re-output the complete ' + BT + BT + BT + 'cuckoo code block.';
    }
    msg += sep + sep;
  }

  console.log('[Cuckoo Code] Sending back JS summary execution results, message length=' + msg.length);
  sendMessageToChat(msg, 'JS Summary');
}

// listenmain processsendof systemPrompt
ipcRenderer.on('system-prompt', (_event, content) => {
  systemPromptContent = content || '';
  pendingSystemPrompt = true;
  // ifcurrent已有新ofemptysessioninput box，立即send
  if (pendingSystemPrompt && systemPromptContent) {
    try {
      const input = findInputArea();
      if (input) {
        sendSystemPromptToInput();
      } else {
        // 等待input box出现
        waitForInputAndSend();
      }
    } catch (e) {
    }
  }
});

// listenmain processsendofinitialprompt（directory tree+systemPrompt）
ipcRenderer.on('initial-prompt', (_event, content) => {
  initialPromptContent = content || '';
  pendingInitialPrompt = true;
  // ifcurrent已有新ofemptysessioninput box，立即send
  if (pendingInitialPrompt && initialPromptContent) {
    try {
      const input = findInputArea();
      if (input) {
        sendInitialPromptToInput();
      } else {
        // 等待input box出现
        waitForInitialPromptAndSend();
      }
    } catch (e) {
    }
  }
});

/**
 * 查找 DeepSeek ofinput boxelement
 */
function findInputArea() {
  // 尝试多种常见of textarea select器
  const selectors = [
    'textarea[placeholder*="message"]',
    'textarea[placeholder*="Message"]',
    'textarea[placeholder*="输入"]',
    'textarea[placeholder*="输入message"]',
    'textarea[placeholder*="ask"]',
    'textarea[placeholder*="Ask"]',
    'textarea[placeholder*="提问"]',
    'textarea[placeholder*="send"]',
    'textarea[placeholder*="send"]',
    'textarea[placeholder*="deepseek"]',
    'textarea[placeholder*="DeepSeek"]',
    'textarea.chat-input',
    'textarea',
    'div[contenteditable="true"]',
    '[role="textbox"]',
  ];

  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el && isInputVisible(el)) {
      return el;
    }
  }

  // 额外搜索：查找contain特定textofinput box
  const allTextareas = document.querySelectorAll('textarea');
  for (const ta of allTextareas) {
    const placeholder = (ta.placeholder || '').toLowerCase();
    if (placeholder && (placeholder.includes('deepseek') || placeholder.includes('message') || placeholder.includes('ask') || placeholder.includes('send'))) {
      return ta;
    }
  }

  return null;
}

/**
 * checkelementwhether可见
 */
function isInputVisible(el) {
  if (!el) return false;
  const style = window.getComputedStyle(el);
  return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
}

/**
 * send system prompt toinput box
 */
function sendSystemPromptToInput() {
  if (!systemPromptContent) {
    pendingSystemPrompt = false;
    return false;
  }

  const input = findInputArea();
  if (!input) {
    return false;
  }

  if (!setInputContent(input, systemPromptContent)) {
    return false;
  }

  const sendDelay = randomDelay();
  console.log('[Cuckoo Code] system prompt 已填入，random wait ' + sendDelay + 'ms send after...');
  setTimeout(function() {
    console.log('[Cuckoo Code] 等待end，startsend system prompt');
    triggerSend(input);
    pendingSystemPrompt = false;
  }, sendDelay);

  return true;
}

/**
 * sendinitialprompt（directory tree+systemPrompt）toinput box
 */
function sendInitialPromptToInput() {
  if (!initialPromptContent) {
    pendingInitialPrompt = false;
    return false;
  }

  const input = findInputArea();
  if (!input) {
    return false;
  }

  if (!setInputContent(input, initialPromptContent)) {
    return false;
  }

  const sendDelay = randomDelay();
  console.log('[Cuckoo Code] initialprompt已填入，random wait ' + sendDelay + 'ms send after...');
  setTimeout(function() {
    console.log('[Cuckoo Code] 等待end，startsendinitialprompt');
    triggerSend(input);
    pendingInitialPrompt = false;
  }, sendDelay);

  return true;
}

/**
 * 等待input box出现后再send system prompt
 */
function waitForInputAndSend() {
  let attempts = 0;
  const maxAttempts = 30;

  const checkInterval = setInterval(() => {
    attempts++;
    if (attempts > maxAttempts) {
      clearInterval(checkInterval);
      pendingSystemPrompt = false;
      return;
    }

    if (findInputArea()) {
      clearInterval(checkInterval);
      sendSystemPromptToInput();
    }
  }, 500);
}

/**
 * 等待input box出现后再sendinitialprompt
 */
function waitForInitialPromptAndSend() {
  let attempts = 0;
  const maxAttempts = 30;

  const checkInterval = setInterval(() => {
    attempts++;
    if (attempts > maxAttempts) {
      clearInterval(checkInterval);
      pendingInitialPrompt = false;
      return;
    }

    if (findInputArea()) {
      clearInterval(checkInterval);
      sendInitialPromptToInput();
    }
  }, 500);
}

/**
 * triggersendmessage
 */
function triggerSend(input) {
  // method 1: 查找sendbutton（button仅在input box有contentwhen才可用）
  const sendSelectors = [
    'button[type="submit"]',
    'button[aria-label*="send"]',
    'button[aria-label*="send"]',
    'button[title*="send"]',
    'button[title*="send"]',
    'button[data-action="send"]',
    'button[data-type="send"]',
    '.send-btn',
    '.submit-btn',
    'button svg[data-icon="send"]',
    '[data-testid="send"]',
    '[data-testid="send-button"]',
    'button:has(svg[data-icon="arrow"])',
    'button:has(> svg)',
    'button:has(svg[data-icon="send"])',
  ];

  for (const sel of sendSelectors) {
    const btn = document.querySelector(sel);
    if (btn && isInputVisible(btn) && !btn.disabled) {
      btn.click();
      console.log('[Cuckoo Code] 已点击sendbutton: ' + sel);
      return;
    }
  }

  // method 2: 在input box上simulatecomplete Enter 按键序列（keydown + keypress + keyup）
  if (input) {
    const opts = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true, isComposing: false };
    input.dispatchEvent(new KeyboardEvent('keydown', opts));
    input.dispatchEvent(new KeyboardEvent('keypress', opts));
    input.dispatchEvent(new KeyboardEvent('keyup', opts));
    console.log('[Cuckoo Code] 已through Enter 键triggersend (not foundsendbutton)');
  }
}

/**
 * 查找newsessionbuttonandlisten点击
 */
function findNewSessionButton() {
  const selectors = [
    'button[title*="new"]',
    'button[title*="New"]',
    'button[aria-label*="new"]',
    'button[aria-label*="New"]',
    'button[data-action*="new"]',
    'button[data-action*="chat"]',
    '.new-chat-btn',
    '.new-session-btn',
    '.sidebar-new-btn',
    '[data-testid="new-chat"]',
    'button:has(svg[data-icon="plus"])',
    'button:has(svg[data-icon="add"])',
    'button:has(svg[data-icon="new"])',
    '.nav-new-chat',
    'div:has(> span[data-icon="plus"])',
  ];

  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el && isInputVisible(el)) {
      return el;
    }
  }

  // 搜索contain"new"textofelement
  const allButtons = document.querySelectorAll('button, [role="button"]');
  for (const btn of allButtons) {
    const text = (btn.textContent || '').trim();
    const title = (btn.getAttribute('title') || '').trim();
    const aria = (btn.getAttribute('aria-label') || '').trim();
    if ((text.includes('new') || title.includes('new') || aria.includes('new')) && isInputVisible(btn)) {
      return btn;
    }
  }

  return null;
}

/**
 * listennewsessionbutton点击
 */
function setupNewSessionListener() {
  const btn = findNewSessionButton();
  if (!btn) {
    setTimeout(setupNewSessionListener, 5000);
    return;
  }


  // listen点击事件
  const clickHandler = () => {

    // 重置状态
    pendingSystemPrompt = true;

    // 等待新sessionofinput box出现，然send after system prompt
    setTimeout(() => {
      waitForInputAndSend();
    }, 1500);
  };

  // use event capture ensure在pagescript之前捕获点击
  btn.addEventListener('click', clickHandler, true);

  // use MutationObserver 重新绑定（buttonpossiblebe替换）
  const observer = new MutationObserver(() => {
    btn.removeEventListener('click', clickHandler, true);
    setTimeout(() => setupNewSessionListener(), 1000);
  });
  observer.observe(btn.parentElement || document.body, { childList: true, subtree: true });
}

// 启动newsessionlisten
setTimeout(setupNewSessionListener, 3000);


// ========== initialize ==========

/**
 * initialize Cuckoo Code 扩展
 * inject styles、overlay HTML，绑定事件，启动 MutationObserver anddirectorylisten
 */
function init() {
  try {
    injectCSS();
    injectOverlay();
    initProjectDirSection();
    bindEvents();
    updateHomeMode();

    // listen URL 变化（SPA 路由）
    window.addEventListener('popstate', updateHomeMode);
    window.addEventListener('hashchange', updateHomeMode);
    setInterval(updateHomeMode, 1500);
    // 首次延迟execute，ensure overlay 已注入
    setTimeout(updateHomeMode, 500);

    // defaultshowoverlay - fallback强制show
    forceShowOverlay();

    // 延迟启动观察器，等待page框架渲染
    setTimeout(startObserver, 2000);
  } catch (err) {
    console.error('[Cuckoo Code] init() 出错:', err);
    // fallback：即使出错也强制show面板
    forceShowOverlay();
  }

  // regularly巡检：prevent面板be意外hide
  startOverlayWatcher();
}

// ========== projectdirectoryshow与修改功能 ==========

/**
 * according tocurrent URL 切换overlay首页pattern
 * 首页 https://chat.deepseek.com/ when，只保留「Initialize Project」button，hideother content
 */
function updateHomeMode() {
  const url = window.location.href;
  const isHome = /^https:\/\/chat\.deepseek\.com\/?(\?.*)?$/.test(url);
  const overlay = document.getElementById('cuckoo-overlay');
  if (overlay) {
    if (isHome) {
      overlay.classList.add('cuckoo-home-mode');
    } else {
      overlay.classList.remove('cuckoo-home-mode');
    }
  }
}

/**
 * Initialize Projectdirectory区域：defaulthide、listendirectory更新、绑定修改button
 */
function initProjectDirSection() {
  // initializehide（ifnodirectory）
  updateProjectDirDisplay(null);

  // listenmain processofdirectory更新事件
  ipcRenderer.on('project-dir-updated', (_event, dirPath) => {
    updateProjectDirDisplay(dirPath);
    // directory更新后刷新sessionlist
    renderSessions();
  });

  // 绑定修改button事件 - directly绑定，阻止冒泡anddefaultbehavior
  setTimeout(() => {
    const changeBtn = document.getElementById('cuckoo-btn-change-dir');
    if (changeBtn) {
      changeBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        // use updateProjectDir 只更新directory映射，not重新sendinitialprompt
        const result = await window.electronAPI.updateProjectDir();
        if (result && result.success) {
          // main process会send project-dir-updated 事件更新show
          console.log('[Cuckoo Code] directory已更新');
        } else {
          console.error('修改directoryFailed:', result?.message);
        }
      });
    }
  }, 100);
}

/**
 * 更新projectdirectoryshow
 * @param {string} dirPath - directorypath
 */
function updateProjectDirDisplay(dirPath) {
  const display = document.getElementById('cuckoo-project-dir-display');
  if (display) {
    const span = display.querySelector('.cuckoo-dir-path');
    if (span) {
      span.textContent = dirPath || 'Not selected';
    }
  }
  // 控制整countsectionofshowhide
  const section = document.querySelector('.cuckoo-project-dir-section');
  if (section) {
    if (dirPath && dirPath.trim() !== '') {
      section.style.display = '';
    } else {
      section.style.display = 'none';
    }
  }
}

/**
 * 强制showoverlay（移除allhide状态）
 * forfallback恢复因exceptionbehideof面板
 */
function forceShowOverlay() {
  const overlay = document.getElementById('cuckoo-overlay');
  if (overlay) {
    overlay.classList.remove('cuckoo-hidden');
    overlay.style.transform = 'translateX(0)';
    overlay.style.opacity = '1';
    overlay.style.pointerEvents = 'auto';
  }
}

/**
 * 启动regularly巡检，prevent面板be意外hide（最小化、ESC、scriptError等）
 * 每 5 秒check一次，ifbehidethen自动恢复
 */
function startOverlayWatcher() {
  setInterval(() => {
    const overlay = document.getElementById('cuckoo-overlay');
    if (overlay && overlay.classList.contains('cuckoo-hidden')) {
      forceShowOverlay();
    }
  }, 5000);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}


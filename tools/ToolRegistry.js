/**
 * Tool注册表 - 管理allAvailable Tools
 */

class Tool {
  constructor(name, description, parameters, jsApi) {
    this.name = name;
    this.description = description;
    this.parameters = parameters; // JSON Schema format
    this.jsApi = jsApi || null; // JS call签名，如 'editFile(file_path, old_string, new_string)'
  }

  async execute(params) {
    throw new Error('execute() 必须由子类实现');
  }

  /**
   * getTool描述，forsend给 AI
   */
  getDescription() {
    return {
      name: this.name,
      description: this.description,
      parameters: this.parameters,
      jsApi: this.jsApi
    };
  }
}

class ToolRegistry {
  constructor() {
    this.tools = new Map();
  }

  /**
   * 注册Tool
   * @param {Tool} tool - Tool实例
   */
  register(tool) {
    if (!tool || !tool.name) {
      throw new Error('Tool必须有 name attribute');
    }
    if (this.tools.has(tool.name)) {
      console.warn(`[ToolRegistry] Tool ${tool.name} 已exists，willbe覆盖`);
    }
    this.tools.set(tool.name, tool);
    console.log(`[ToolRegistry] 注册Tool: ${tool.name}`);
  }

  /**
   * getTool
   * @param {string} name - Tool name
   * @returns {Tool|undefined}
   */
  get(name) {
    return this.tools.get(name);
  }

  /**
   * Execute tool
   * @param {string} name - Tool name
   * @param {Object} params - Parameter
   * @returns {Promise<ToolResult>}
   */
  async execute(name, params) {
    const tool = this.tools.get(name);
    if (!tool) {
      return ToolResult.error(`not foundTool: ${name}`);
    }
    try {
      // ValidateParameter（可选，这里简化处理）
      return await tool.execute(params);
    } catch (err) {
      return ToolResult.error(`ToolExecution failed: ${err.message}`);
    }
  }

  /**
   * getallTool描述
   * @returns {Array}
   */
  getDescriptions() {
    return Array.from(this.tools.values()).map(t => t.getDescription());
  }

  /**
   * getformat化ofToollist，for Prompt
   * @returns {string}
   */
  getFormattedToolsForPrompt() {
    const descriptions = this.getDescriptions();
    if (descriptions.length === 0) return '暂NoneAvailable Tools';

    return descriptions.map((t, i) => {
      const params = t.parameters.properties ? Object.keys(t.parameters.properties).join(', ') : 'None';
      return `${i + 1}. **${t.name}** - ${t.description}\n   Parameter: ${params}`;
    }).join('\n\n');
  }

  /**
   * getTool数量
   * @returns {number}
   */
  size() {
    return this.tools.size;
  }

  /**
   * listallTool name
   * @returns {string[]}
   */
  listNames() {
    return Array.from(this.tools.keys());
  }

  /**
   * getformat化of JS API list，for Prompt（AI generate JS 代码call这些function）
   * @returns {string}
   */
  getFormattedJsApiForPrompt() {
    const descriptions = this.getDescriptions();
    if (descriptions.length === 0) return '暂NoneAvailable Tools';

    return descriptions.map((t, i) => {
      const sig = t.jsApi ? '\`' + t.jsApi + '\`' : '\`' + t.name + '(...)\`';
      return (i + 1) + '. ' + sig + ' — ' + t.description;
    }).join('\n');
  }
}

/**
 * 统一ofToolexecuteresult
 */
class ToolResult {
  constructor(success, data, error) {
    this.success = success;
    this.data = data;
    this.error = error;
  }

  static success(data) {
    return new ToolResult(true, data, null);
  }

  static error(error) {
    return new ToolResult(false, null, error);
  }

  toString() {
    if (this.success) {
      return `✅ Success: ${JSON.stringify(this.data)}`;
    } else {
      return `❌ Failed: ${this.error}`;
    }
  }
}

module.exports = { Tool, ToolRegistry, ToolResult };
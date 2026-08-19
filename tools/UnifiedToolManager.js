/**
 * 统一Toolsystem - 核心模块
 * 基于 FileWriteTool.js 规范，support动态注册、Validate、Execute tool
 */

const { ToolRegistry, Tool, ToolResult } = require('./ToolRegistry');
const { FileWriteTool } = require('./FileWriteTool');

/**
 * Unified Tool Manager
 * 负责Tool注册、Call Formatnormalize、ParameterValidate、execute分发
 */
class UnifiedToolManager {
  constructor() {
    this.registry = new ToolRegistry();
    this.registerBuiltinTools();
  }

  /**
   * 注册internal置Tool
   */
  registerBuiltinTools() {
    this.register(new FileWriteTool());
  }

  /**
   * 注册Tool
   * @param {Tool} tool - Tool实例
   */
  register(tool) {
    this.registry.register(tool);
  }

  /**
   * getToollist（forsend给 AI of Prompt）
   * @returns {string} format化ofToollist
   */
  getToolsDescription() {
    return this.registry.getFormattedToolsForPrompt();
  }

  /**
   * getToolof JSON Schema（forValidate）
   * @returns {Object} allToolof Schema 映射
   */
  getToolsSchema() {
    const schemas = {};
    for (const [name, tool] of this.registry.tools) {
      schemas[name] = tool.parameters;
    }
    return schemas;
  }

  /**
   * normalizeToolCall Format
   * support多种输入format，统一转换asstandard format
   *
   * standard format：
   * {
   *   "toolName": "file_write",
   *   "params": { "file_path": "...", "content": "..." },
   *   "callId": "call_xxx"
   * }
   *
   * @param {string|Object} input - 原始输入
   * @returns {Object|null} normalize后ofToolcall，Failedreturn null
   */
  parseToolCall(input) {
    if (!input) return null;

    let parsed = null;

    // 1. if已经是object，尝试directlyuse
    if (typeof input === 'object' && input !== null) {
      parsed = input;
    }
    // 2. if是string，尝试parse JSON
    else if (typeof input === 'string') {
      const str = input.trim();

      // 尝试extract ```tool or ```json code blockinofcontent
      const codeBlockMatch = str.match(/^```(?:tool|json)?\s*\n?(\{[\s\S]*\})\s*```?$/);
      if (codeBlockMatch) {
        try {
          parsed = JSON.parse(codeBlockMatch[1]);
        } catch (e) {
          return null;
        }
      } else {
        // directly尝试parse整countstring
        try {
          parsed = JSON.parse(str);
        } catch (e) {
          return null;
        }
      }
    }

    if (!parsed) return null;

    // Validate必要字段
    if (!parsed.toolName || typeof parsed.toolName !== 'string') {
      return null;
    }

    // normalizeOutput
    return {
      toolName: parsed.toolName,
      params: parsed.params || parsed.parameters || parsed.arguments || {},
      callId: parsed.callId || `call_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    };
  }

  /**
   * ValidateToolcallParameter
   * @param {string} toolName - Tool name
   * @param {Object} params - Parameterobject
   * @returns {Object} { valid: boolean, errors: string[] }
   */
  validateParams(toolName, params) {
    const tool = this.registry.get(toolName);
    if (!tool) {
      return { valid: false, errors: [`Unknown tool: ${toolName}`] };
    }

    const schema = tool.parameters;
    if (!schema || !schema.properties) {
      return { valid: true, errors: [] };
    }

    const errors = [];
    const required = schema.required || [];

    // checkrequired字段
    for (const field of required) {
      if (params[field] === undefined || params[field] === null) {
        errors.push(`Missing required parameter: ${field}`);
      }
    }

    // check字段Type
    for (const [key, value] of Object.entries(params)) {
      const propSchema = schema.properties[key];
      if (!propSchema) continue; // 允许额外字段

      if (propSchema.type === 'string' && typeof value !== 'string') {
        errors.push(`Parameter ${key} must be a string`);
      } else if (propSchema.type === 'number' && typeof value !== 'number') {
        errors.push(`Parameter ${key} 必须是数字`);
      } else if (propSchema.type === 'boolean' && typeof value !== 'boolean') {
        errors.push(`Parameter ${key} 必须是布尔值`);
      } else if (propSchema.type === 'object' && typeof value !== 'object') {
        errors.push(`Parameter ${key} 必须是object`);
      }
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Execute tool call
   * @param {Object} toolCall - normalizeofTool call object
   * @returns {Promise<ToolResult>}
   */
  async execute(toolCall) {
    const { toolName, params, callId } = toolCall;

    // ValidateParameter
    const validation = this.validateParams(toolName, params);
    if (!validation.valid) {
      return ToolResult.error(`Parameter validation failed: ${validation.errors.join(', ')}`);
    }

    // Execute tool
    return this.registry.execute(toolName, params);
  }

  /**
   * getTool定义（forgeneratesystem prompt）
   * @returns {Array} Tool定义array
   */
  getToolDefinitions() {
    return Array.from(this.registry.tools.values()).map(tool => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters
    }));
  }

  /**
   * generate给 AI ofcompleteTooluse说明
   * @returns {string}
   */
  generateSystemPrompt() {
    const tools = this.getToolDefinitions();
    let prompt = '# Available Tools\n\n';

    for (const tool of tools) {
      prompt += `## ${tool.name}\n`;
      prompt += `${tool.description}\n\n`;

      if (tool.parameters && tool.parameters.properties) {
        prompt += '**Parameters:**\n';
        for (const [key, schema] of Object.entries(tool.parameters.properties)) {
          const required = tool.parameters.required?.includes(key) ? ' (required)' : ' (optional)';
          prompt += `- \`${key}\`${required}: ${schema.description} (Type: ${schema.type})\n`;
        }
        prompt += '\n';
      }

      prompt += '---\n\n';
    }

    prompt += `## Call Format\n\npleaseusefollowingformatcallTool（仅Output JSON，do not include other text）：\n\n`;
    prompt += `\`\`\`json\n{\n  "toolName": "Tool name",\n  "params": {\n    "Parameter名": "Parameter值"\n  },\n  "callId": "call_${Date.now()}_${Math.random().toString(36).substr(2, 9)}"\n}\n\`\`\`\n`;

    return prompt;
  }
}

module.exports = { UnifiedToolManager };

// Create全局实例
const toolManager = new UnifiedToolManager();
module.exports.toolManager = toolManager;
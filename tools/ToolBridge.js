/**
 * Tool桥接器 - 在 preload inuse
 * 连接 WebContentCapturer、UnifiedToolManager and Electron IPC
 */

const { toolManager } = require('./UnifiedToolManager');
const { WebContentCapturer } = require('./WebContentCapturer');

class ToolBridge {
  constructor() {
    this.capturer = null;
    this.isInitialized = false;
  }

  /**
   * initialize桥接器
   * @param {Object} electronAPI - electronAPI object
   */
  init(electronAPI) {
    if (this.isInitialized) return;

    this.electronAPI = electronAPI;
    this.capturer = new WebContentCapturer(toolManager);

    // setToolcallHandlers
    this.capturer.setToolCallHandler(async (toolCall) => {
      console.log('[ToolBridge] Execute tool call:', toolCall);
      const result = await toolManager.execute(toolCall);

      // through IPC sendresulttomain process（可选，forlog/历史record）
      if (this.electronAPI && this.electronAPI.executeTool) {
        await this.electronAPI.executeTool({
          toolName: toolCall.toolName,
          params: toolCall.params,
          callId: toolCall.callId
        });
      }

      return result;
    });

    // setmessageHandlers
    this.capturer.setMessageHandler((content, role) => {
      console.log('[ToolBridge] 新message:', role, content.substring(0, 100));
    });

    this.isInitialized = true;
    console.log('[ToolBridge] initializecomplete');
  }

  /**
   * 启动content捕获
   */
  startCapturing() {
    if (this.capturer) {
      this.capturer.start();
    }
  }

  /**
   * stopcontent捕获
   */
  stopCapturing() {
    if (this.capturer) {
      this.capturer.stop();
    }
  }

  /**
   * 手动triggerToolcallparse（for测试）
   * @param {string} content
   */
  async testParseToolCall(content) {
    if (!this.capturer) return null;
    return this.capturer.parseToolCall(content);
  }

  /**
   * getToolsystem prompt
   * @returns {string}
   */
  getSystemPrompt() {
    return toolManager.generateSystemPrompt();
  }

  /**
   * getToollist描述
   * @returns {string}
   */
  getToolsDescription() {
    return toolManager.getToolsDescription();
  }
}

// Create全局实例
const toolBridge = new ToolBridge();

// 导出
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ToolBridge, toolBridge };
} else {
  window.ToolBridge = ToolBridge;
  window.toolBridge = toolBridge;
}
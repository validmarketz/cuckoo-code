/**
 * 网页content捕获器
 * 负责listen DeepSeek 聊天page，捕获 AI replyandParse tool call
 */

class WebContentCapturer {
  constructor(toolManager, options = {}) {
    this.toolManager = toolManager;
    this.options = {
      messageSelector: options.messageSelector || '.ds-markdown, .markdown-body, [data-testid="message"], .message-content',
      assistantSelector: options.assistantSelector || '[data-role="assistant"], .assistant-message, .bot-message',
      pollInterval: options.pollInterval || 2000,
      ...options
    };

    this.lastProcessedMessage = '';
    this.isRunning = false;
    this.pollTimer = null;
    this.onToolCall = null; // 回调function
    this.onMessage = null;  // 新message回调
  }

  /**
   * setToolcall回调
   * @param {Function} callback - (toolCall) => Promise<void>
   */
  setToolCallHandler(callback) {
    this.onToolCall = callback;
  }

  /**
   * set新message回调
   * @param {Function} callback - (message, role) => void
   */
  setMessageHandler(callback) {
    this.onMessage = callback;
  }

  /**
   * 启动listen
   */
  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    console.log('[WebCapturer] startlisten网页content...');
    this.poll();
  }

  /**
   * stoplisten
   */
  stop() {
    this.isRunning = false;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    console.log('[WebCapturer] stoplisten');
  }

  /**
   * 轮询check新message
   */
  async poll() {
    if (!this.isRunning) return;

    try {
      await this.checkNewMessages();
    } catch (e) {
      console.error('[WebCapturer] 轮询出错:', e);
    }

    this.pollTimer = setTimeout(() => this.poll(), this.options.pollInterval);
  }

  /**
   * check新message
   */
  async checkNewMessages() {
    const messages = this.extractMessages();
    if (!messages.length) return;

    // get最新of助手message
    const lastAssistantMsg = this.getLastAssistantMessage(messages);
    if (!lastAssistantMsg) return;

    // 去重：只处理新message
    const contentHash = this.hashContent(lastAssistantMsg.content);
    if (contentHash === this.lastProcessedMessage) return;
    this.lastProcessedMessage = contentHash;

    console.log('[WebCapturer] find新助手message:', lastAssistantMsg.content.substring(0, 100));

    // triggermessage回调
    if (this.onMessage) {
      this.onMessage(lastAssistantMsg.content, 'assistant');
    }

    // 尝试Parse tool call
    const toolCall = this.parseToolCall(lastAssistantMsg.content);
    if (toolCall) {
      console.log('[WebCapturer] detectedToolcall:', toolCall);
      if (this.onToolCall) {
        await this.onToolCall(toolCall);
      }
    }
  }

  /**
   * extractpageallmessage
   * @returns {Array<{role: string, content: string, element: Element}>}
   */
  extractMessages() {
    const messages = [];

    // 尝试多种select器策略
    const selectors = [
      // DeepSeek possibleofselect器
      '.ds-markdown',
      '.markdown-body',
      '[data-testid="message"]',
      '.message-content',
      '.chat-message',
      '[data-role]',
      '.assistant-message',
      '.bot-message'
    ];

    for (const selector of selectors) {
      const elements = document.querySelectorAll(selector);
      if (elements.length > 0) {
        elements.forEach(el => {
          const role = this.detectRole(el);
          const content = el.textContent || el.innerText || '';
          if (content.trim()) {
            messages.push({ role, content: content.trim(), element: el });
          }
        });
        if (messages.length > 0) break; // 找to一种匹配就stop
      }
    }

    return messages;
  }

  /**
   * detectmessage角色
   * @param {Element} el
   * @returns {'user'|'assistant'|'unknown'}
   */
  detectRole(el) {
    // check data-role attribute
    const role = el.getAttribute('data-role');
    if (role === 'assistant' || role === 'bot') return 'assistant';
    if (role === 'user' || role === 'human') return 'user';

    // check class
    const className = el.className || '';
    if (className.includes('assistant') || className.includes('bot')) return 'assistant';
    if (className.includes('user') || className.includes('human')) return 'user';

    // check父element
    const parent = el.closest('[data-role], .message, .chat-message');
    if (parent) {
      const pRole = parent.getAttribute('data-role');
      if (pRole) return pRole;
      const pClass = parent.className || '';
      if (pClass.includes('assistant') || pClass.includes('bot')) return 'assistant';
      if (pClass.includes('user') || pClass.includes('human')) return 'user';
    }

    return 'unknown';
  }

  /**
   * get最新of助手message
   * @param {Array} messages
   * @returns {Object|null}
   */
  getLastAssistantMessage(messages) {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'assistant') {
        return messages[i];
      }
    }
    return null;
  }

  /**
   * Parse tool call
   * support多种format：
   * 1. standard format: {"toolName": "...", "params": {...}, "callId": "..."}
   * 2. code blockformat: ```json {...} ```
   * 3. tool code block: ```tool {...} ```
   * @param {string} content
   * @returns {Object|null}
   */
  parseToolCall(content) {
    if (!content || typeof content !== 'string') return null;

    const str = content.trim();

    // 1. 尝试directlyparse JSON
    let parsed = null;
    try {
      parsed = JSON.parse(str);
    } catch (e) {
      // not是directlyof JSON，尝试extractcode block
    }

    // 2. extractcode block
    if (!parsed) {
      // ```json ... ``` or ```tool ... ``` or ``` ... ```
      const codeBlockMatch = str.match(/^```(?:json|tool)?\s*\n?(\{[\s\S]*\})\s*```?$/);
      if (codeBlockMatch) {
        try {
          parsed = JSON.parse(codeBlockMatch[1]);
        } catch (e) {
          console.log('[WebCapturer] code block JSON parseFailed:', e.message);
        }
      }
    }

    // 3. 尝试在textin查找 JSON object
    if (!parsed) {
      const jsonMatch = str.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          parsed = JSON.parse(jsonMatch[0]);
        } catch (e) {
          // ignore
        }
      }
    }

    if (!parsed) return null;

    // Validate必要字段 - support多种字段名
    if (!parsed.toolName && !parsed.tool) return null;

    // normalizeOutput
    return {
      toolName: parsed.toolName || parsed.tool,
      params: parsed.params || parsed.parameters || parsed.arguments || {},
      callId: parsed.callId || `call_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    };
  }

  /**
   * 简单哈希for去重
   */
  hashContent(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return hash.toString(36);
  }
}

// 导出
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { WebContentCapturer };
} else {
  window.WebContentCapturer = WebContentCapturer;
}
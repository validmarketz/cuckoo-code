const { Tool, ToolResult } = require('./ToolRegistry');

/**
 * 网页访问Tool
 * for访问 http/https 网页，get响shouldcontent。
 * 第一版仅实现 fetch pattern（Node internal置 fetch），适合 API and静态网页。
 */
class WebFetchTool extends Tool {
  constructor() {
    super(
      'web_fetch',
      '访问网页or API。use Node internal置 fetch get http/https URL of响shouldcontent。适合get网页text、JSON 数据、API 响should等。Note：notexecute JavaScript，if网页content由 JS 动态渲染，pleaseuseotherbrowserTool。',
      {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: '要访问of网址，support http/https'
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
            description: '响should体最大bytes数，default 512000（500KB），超出截断',
            default: 512000
          },
          responseType: {
            type: 'string',
            description: 'returnformat: auto (according to content-type 自动)、json、text',
            default: 'auto',
            enum: ['auto', 'json', 'text']
          }
        },
        required: ['url'],
        additionalProperties: false
      },
      'webFetch(url, options?)'
    );
  }

  /**
   * execute网页访问
   * @param {Object} params - { url, method?, headers?, body?, timeout?, maxSize?, responseType? }
   * @returns {Promise<ToolResult>}
   */
  async execute(params) {
    const {
      url,
      method = 'GET',
      headers = {},
      body,
      timeout = 15000,
      maxSize = 512000,
      responseType = 'auto'
    } = params;

    if (!url || typeof url !== 'string') {
      return ToolResult.error('url not能empty');
    }

    // 安全限制：只允许 http/https
    let parsedUrl;
    try {
      parsedUrl = new URL(url);
    } catch (err) {
      return ToolResult.error('None效of URL: ' + url);
    }
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      return ToolResult.error('仅support http/https 协议');
    }

    // 校验超whenand maxSize
    const safeTimeout = typeof timeout === 'number' && timeout > 0 ? Math.min(timeout, 15000) : 15000;
    const safeMaxSize = typeof maxSize === 'number' && maxSize > 0 ? Math.min(maxSize, 512000) : 512000;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), safeTimeout);

    const startTime = Date.now();
    try {
      const requestOptions = {
        method: method.toUpperCase(),
        headers: headers || {},
        signal: controller.signal
      };

      if (body !== undefined && body !== null && body !== '') {
        requestOptions.body = String(body);
      }

      const response = await fetch(url, requestOptions);

      // streamingReading响should体，限制大小；整体超when由 AbortController 控制
      const reader = response.body ? response.body.getReader() : null;
      let receivedBytes = 0;
      let chunks = [];
      let truncated = false;

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          receivedBytes += value.byteLength;
          if (receivedBytes > safeMaxSize) {
            const remaining = safeMaxSize - (receivedBytes - value.byteLength);
            if (remaining > 0) {
              chunks.push(value.slice(0, remaining));
            }
            truncated = true;
            try { await reader.cancel(); } catch (_) { /* ignorecancelError */ }
            break;
          }
          chunks.push(value);
        }
      }

      clearTimeout(timeoutId);

      const buffer = Buffer.concat(chunks.map(c => Buffer.from(c)));
      const rawText = buffer.toString('utf8');

      // according to responseType 处理响shouldcontent
      let bodyResult;
      if (responseType === 'json') {
        try {
          bodyResult = JSON.parse(rawText);
        } catch (err) {
          return ToolResult.error('响shouldnot是合法 JSON: ' + err.message);
        }
      } else if (responseType === 'text') {
        bodyResult = rawText;
      } else {
        // auto
        const contentType = response.headers.get('content-type') || '';
        if (contentType.includes('application/json') || rawText.trim().startsWith('{') || rawText.trim().startsWith('[')) {
          try {
            bodyResult = JSON.parse(rawText);
          } catch (err) {
            bodyResult = rawText; // parseFailed，return原始text
          }
        } else {
          bodyResult = rawText;
        }
      }

      // extract响should头
      const responseHeaders = {};
      if (response.headers && response.headers.forEach) {
        response.headers.forEach((value, key) => {
          responseHeaders[key] = value;
        });
      }

      const elapsedMs = Date.now() - startTime;

      return ToolResult.success({
        url: response.url || url,
        status: response.status,
        statusText: response.statusText || '',
        headers: responseHeaders,
        body: bodyResult,
        finalUrl: response.url || url,
        truncated,
        elapsedMs
      });
    } catch (err) {
      clearTimeout(timeoutId);
      if (err.name === 'AbortError') {
        return ToolResult.error('please求超when (超过 ' + safeTimeout + 'ms)');
      }
      return ToolResult.error('please求Failed: ' + err.message);
    }
  }
}

module.exports = { WebFetchTool };

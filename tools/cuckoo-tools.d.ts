/**
 * Cuckoo Code Tool API（TypeScript 声明）
 *
 * thisfile描述 ```cuckoo code blockincancallof全部全局function与数据Type。
 * runwhen由 tools/JsRunner.js 在受限沙箱in注入这些function；this声明forhelp
 * AI 理解call方式，与runwhenbehaviorkeep一致。
 * thisfilecontent与 systemPrompt.md 末尾of「Tool API Type定义」章节keep同步。
 *
 * usage rules速览：
 * - allToolfunction都是异步of，callwhen必须写 await
 * - relativepath基于全局变量 projectDir（currentproject根directory）parse
 * - 多行textuse反quotes（`）模板string，no needanyescape
 * - Tool出错when抛出exception（Error.message asError描述），可用 try/catch 处理；
 *   唯一例外是 bash()：not抛exception，throughreturn值of exitCode/error 报告Failed
 * - 用 log() Outputin间过程；script最后可用 return returnresult值
 */

/** currentproject根directory（Initialize Project后由system注入）。notinitializewhenas null。 */
declare const projectDir: string | null;

/**
 * Outputin间resulttoexecutelog（notin断script）。
 * logcontent随executeresult一起return给 AI。
 */
declare function log(...args: unknown[]): void;

// ================= file读写 =================

/**
 * Readingfilecontent，returnstring。
 * 超过 1MB offile只return前 1MB。
 * @param filePath relative（基于project根directory）or绝对path
 * @param encoding 编码，default 'utf-8'
 * @throws filenotexists、not是fileorReadingFailedwhen抛出exception
 */
declare function readFile(filePath: string, encoding?: string): Promise<string>;

/**
 * Readingfilecontent，return带行号ofstring（每行prefixas `行号: content`，方便 AI 阅读讨论）。
 * 超过 1MB offile只return前 1MB。
 * @param filePath relative（基于project根directory）or绝对path
 * @param encoding 编码，default 'utf-8'
 * @throws filenotexists、not是fileorReadingFailedwhen抛出exception
 */
declare function readFileWithLines(filePath: string, encoding?: string): Promise<string>;

/** writeFile ofreturn值 */
interface FileWriteResult {
  /** success描述，如：file已写入: C:\project\src\index.js */
  message: string;
  /** 写入fileof绝对path */
  path: string;
  /** 写入ofbytes数 */
  bytes: number;
}

/**
 * Create新fileor覆盖已有file（父directorynotexistswhen自动Create）。
 * @param filePath relative（基于project根directory）or绝对path
 * @param content filecontent；多行contentpleaseuse模板string
 * @param encoding 编码，default 'utf-8'
 */
declare function writeFile(filePath: string, content: string, encoding?: string): Promise<FileWriteResult>;

/** editFile ofreturn值 */
interface FileEditResult {
  message: string;
  /** 编辑后fileof绝对path */
  path: string;
  /** actual替换of处数 */
  replacedCount: number;
  /** 新filebytes数 */
  bytes: number;
}

/**
 * 在filein精确查找 oldString and替换as newString（类似 Claude Code of Edit）。
 * Note：
 * - oldString 必须与filecontent精确匹配（包括empty格与newline），suggest先用 readFile confirm
 * - oldString 出现多处且not传 replaceAll when会报错，please截取更长of唯一片段
 * - need插入contentwhen，可把 oldString 设as锚点，newString 设as“锚点 + 新content”
 * @throws filenotexists、oldString not found、匹配多处（not replaceAll）when抛出exception
 */
declare function editFile(filePath: string, oldString: string, newString: string, replaceAll?: boolean): Promise<FileEditResult>;

// ================= 搜索 =================

/**
 * 按 glob pattern递归搜索projectfile，returnrelativepatharray（以 / 分隔，如 "src/utils/a.js"）。
 * 自动skip node_modules、.git、dist、build 等directory。
 * glob 语法：* 匹配单层internal任意字符，** 匹配任意层级directory，? 匹配单count字符。
 */
declare function glob(pattern: string, searchPath?: string): Promise<string[]>;

/** grep of选项 */
interface GrepOptions {
  /** 搜索起始directory（relativepath），defaultproject根directory */
  path?: string;
  /** file名过滤（glob pattern，语法同 glob functionof pattern），如 "*.js" */
  glob?: string;
  /** ignore大小写，default false */
  ignoreCase?: boolean;
  /** "content"（default，return匹配行）or "count"（只统计每countfileof匹配数） */
  outputMode?: 'content' | 'count';
  /** 匹配行前后各Outputofcontext行数，default 0 */
  context?: number;
}

/** 单countfileinof匹配result */
interface GrepFileMatches {
  /** 匹配fileofrelativepath */
  file: string;
  /** 匹配行list */
  matches: { line: number; content: string; context?: boolean }[];
}

/** grep ofreturn值（outputMode='content'，default） */
interface GrepContentResult {
  message: string;
  pattern: string;
  baseDir: string;
  matches: GrepFileMatches[];
  /** result数达to上限 200 be截断whenas true */
  truncated: boolean;
}

/** grep ofreturn值（outputMode='count'） */
interface GrepCountResult {
  message: string;
  pattern: string;
  baseDir: string;
  /** filerelativepath -> 匹配行数 */
  counts: Record<string, number>;
  /** 匹配总行数 */
  totalMatches: number;
}

/**
 * 在projectfilein按正then表达式ortext搜索，return匹配offile、行号与行content。
 * 自动skip二进制file、超过 1MB offile与 node_modules 等directory。
 * @param pattern 正then表达式or纯text（搜索纯textwhenpleaseescape正then特殊字符）
 * @throws pattern illegal正thenwhen抛出exception
 */
declare function grep(pattern: string, options?: GrepOptions): Promise<GrepContentResult | GrepCountResult>;

// ================= commandexecute =================

/** bash of选项 */
interface BashOptions {
  /** workdirectory（relativepath基于project根directory），defaultproject根directory */
  cwd?: string;
  /** 超when毫秒数，default 30000 */
  timeout?: number;
}

/** bash ofreturn值。Note：bash not抛exception，Failed信息through exitCode/error 字段报告。 */
interface BashResult {
  command: string;
  cwd: string;
  stdout: string;
  stderr: string;
  /** 0 表示success；非 0 ascommand退出码 */
  exitCode: number;
  /** Failedreason（非零退出、超when等），successwhenas null */
  error: string | null;
}

/**
 * execute shell command（Windows use cmd.exe），return stdout/stderr/exitCode。
 * 可for查看directory、run构建、安装依赖（npm install）、git 操作等。
 * Output自动按 UTF-8/GBK smartdecode，not会出现garbled text；Readingfilecontentplease优先用 readFile，
 * if用 PowerShell 读file必须加 -Encoding UTF8。
 * 危险command（format、shutdown、taskkill、diskpart、reg delete、cipher /w 等）会be
 * 安全策略拒绝and抛出exception。
 * command非零退出not会抛exception—pleasecheckreturn值of exitCode 与 error。
 */
declare function bash(command: string, options?: BashOptions): Promise<BashResult>;

// ================= 删除 =================

/** deleteFile ofreturn值 */
interface FileDeleteResult {
  message: string;
  /** be删除fileof绝对path */
  path: string;
}

/**
 * 删除指定file（not可恢复，pleasecarefullyuse；只能删除file，not能删除directory）。
 * @throws filenotexistsorpathnot是filewhen抛出exception
 */
declare function deleteFile(filePath: string): Promise<FileDeleteResult>;

// ================= MySQL =================

/** mysql of连接与查询Parameter */
interface MysqlOptions {
  host: string;
  /** 端口，default 3306 */
  port?: number;
  user: string;
  password: string;
  database: string;
  /** 要executeof SQL（support ? Parameter化） */
  query: string;
  /** Parameter化查询ofParameterarray */
  params?: unknown[];
}

/** mysql ofreturn值 */
interface MysqlResult {
  /** result行数 */
  rowCount: number;
  /** 列名 */
  fields: string[];
  /** 查询result（最多return 1000 行） */
  rows: Record<string, unknown>[];
}

/**
 * 连接 MySQL 数据库andexecute SQL 查询。
 * missing连接Parameter（host/user/password/database）whenshould先向user询问。
 * @throws 连接Failedor SQL Errorwhen抛出exception
 */
declare function mysql(options: MysqlOptions): Promise<MysqlResult>;

// ================= WebFetch =================

/** webFetch of选项 */
interface WebFetchOptions {
  /** HTTP method, default GET */
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD' | 'OPTIONS';
  /** Request headers, e.g., { "Authorization": "Bearer xxx" } */
  headers?: Record<string, string>;
  /** Request body (used for POST/PUT etc.), string */
  body?: string;
  /** Timeout in milliseconds, default 15000 */
  timeout?: number;
  /** 响should体最大bytes数，default 512000（500KB） */
  maxSize?: number;
  /** returnformat：auto / json / text */
  responseType?: 'auto' | 'json' | 'text';
}

/** webFetch ofreturn值 */
interface WebFetchResult {
  url: string;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: unknown;
  finalUrl: string;
  truncated: boolean;
  elapsedMs: number;
}

/**
 * 访问 http/https 网页or API，return结构化result。
 * Note：仅support http/https，not会execute网页inof JavaScript。
 * @param url 目标 URL
 * @param options please求选项
 * @throws URL illegal、超whenorplease求Failed
 */
declare function webFetch(url: string, options?: WebFetchOptions): Promise<WebFetchResult>;

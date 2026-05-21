const LOG_LEVELS = {
  DEBUG: 0,
  INFO: 1,
  WARNING: 2,
  ERROR: 3,
} as const;

type LogLevel = keyof typeof LOG_LEVELS;

// Map our internal level names to the MCP `notifications/message` level enum
// (RFC 5424).
const MCP_LEVEL: Record<LogLevel, string> = {
  DEBUG: 'debug',
  INFO: 'info',
  WARNING: 'warning',
  ERROR: 'error',
};

let currentLevel: number = LOG_LEVELS.INFO;

export function configureLogging(level: string): void {
  const upper = level.toUpperCase() as LogLevel;
  currentLevel = LOG_LEVELS[upper] ?? LOG_LEVELS.INFO;
}

interface LogExtra {
  request_id?: string;
  method?: string;
  path?: string;
  status?: number;
  duration_ms?: number;
  [key: string]: unknown;
}

// MCP sink (set once at server startup) -- when present, logs are also
// forwarded to the client via `notifications/message`. Errors from the sink
// are swallowed so logging stays best-effort.
type McpSink = (
  level: string,
  payload: { logger: string; msg: string; extra?: LogExtra },
) => void;

let mcpSink: McpSink | undefined;

export function setMcpLoggingSink(sink: McpSink | undefined): void {
  mcpSink = sink;
}

function emit(
  level: LogLevel,
  logger: string,
  msg: string,
  extra?: LogExtra,
): void {
  if (LOG_LEVELS[level] < currentLevel) return;

  const entry: Record<string, unknown> = {
    ts: new Date().toISOString(),
    level,
    logger,
    msg,
  };

  if (extra) {
    for (const [key, val] of Object.entries(extra)) {
      if (val !== undefined) {
        entry[key] = val;
      }
    }
  }

  process.stderr.write(JSON.stringify(entry) + '\n');

  if (mcpSink) {
    try {
      mcpSink(MCP_LEVEL[level], { logger, msg, extra });
    } catch {
      // best-effort -- swallow sink errors
    }
  }
}

export interface Logger {
  debug(msg: string, extra?: LogExtra): void;
  info(msg: string, extra?: LogExtra): void;
  warning(msg: string, extra?: LogExtra): void;
  error(msg: string, extra?: LogExtra): void;
}

export function getLogger(name: string): Logger {
  return {
    debug: (msg, extra) => emit('DEBUG', name, msg, extra),
    info: (msg, extra) => emit('INFO', name, msg, extra),
    warning: (msg, extra) => emit('WARNING', name, msg, extra),
    error: (msg, extra) => emit('ERROR', name, msg, extra),
  };
}

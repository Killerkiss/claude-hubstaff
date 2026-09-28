// stdout carries the MCP protocol, so every log line goes to stderr.
type Level = 'debug' | 'info' | 'warn' | 'error';

const order: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = order[(process.env.HUBSTAFF_LOG_LEVEL as Level) ?? 'info'] ?? order.info;

function write(level: Level, message: string, meta?: Record<string, unknown>): void {
  if (order[level] < threshold) return;
  const line: Record<string, unknown> = { ts: new Date().toISOString(), level, message };
  if (meta) {
    for (const [key, value] of Object.entries(meta)) {
      line[key] = value instanceof Error ? value.message : value;
    }
  }
  process.stderr.write(`${JSON.stringify(line)}\n`);
}

export const logger = {
  debug: (message: string, meta?: Record<string, unknown>) => write('debug', message, meta),
  info: (message: string, meta?: Record<string, unknown>) => write('info', message, meta),
  warn: (message: string, meta?: Record<string, unknown>) => write('warn', message, meta),
  error: (message: string, meta?: Record<string, unknown>) => write('error', message, meta),
};

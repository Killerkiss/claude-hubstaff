import { logger } from './logger.js';
import { main } from './server.js';

main().catch((error) => {
  logger.error('hubstaff MCP server failed to start', { error });
  process.exit(1);
});

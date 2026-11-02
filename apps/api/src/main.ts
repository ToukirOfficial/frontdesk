import { createApp } from './bootstrap.js';
import { loadConfig } from './config.js';

const config = loadConfig();
const app = await createApp(config);
// In Docker the API listens on all interfaces inside its container; locally only on loopback.
await app.listen(config.API_PORT, process.env.API_HOST ?? '127.0.0.1');

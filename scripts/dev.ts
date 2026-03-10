import { startServer } from '../server/index.js';
import { createServer } from 'vite';

let viteServer;

async function startDev() {
  await startServer(3001);

  viteServer = await createServer({
    configFile: './vite.config.js',
  });

  await viteServer.listen();
}

if (
  process.env.npm_lifecycle_event &&
  process.env.npm_lifecycle_event.includes('watch')
) {
  let isRestarting = false;

  process.once('SIGUSR2', async () => {
    if (isRestarting) return;
    isRestarting = true;

    if (viteServer) {
      try {
        await viteServer.close();
      } catch {}
    }

    process.kill(process.pid, 'SIGUSR2');
  });
}

startDev();

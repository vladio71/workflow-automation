/**
 * Telegram card bot: a separate process next to the app, same DB and same schedule.
 * Run: npm run bot. tsx with the react-server condition, because app modules import 'server-only'.
 * Time (TELEGRAM_SEND_AT and "today") is local, as in the app; on a server set TZ=Europe/Kyiv.
 */
import 'dotenv/config';
import { db } from '@/lib/db';
import { CardBot } from './bot';
import { loadConfig } from './config';
import { TelegramClient, TelegramError, sleep } from './telegram';

const POLL_TIMEOUT_SECONDS = 25;
const MAX_BACKOFF_MS = 30_000;

async function main(): Promise<void> {
  const config = loadConfig(process.env);
  const tg = new TelegramClient(config.token, config.apiUrl);
  const me = await tg.getMe(); // a bad token fails here, right away
  await tg.deleteWebhook();
  await tg.setMyCommands([{ command: 'today', description: 'Картки на сьогодні' }]);

  const bot = new CardBot(tg, config);
  const stop = new AbortController();
  // on, not once: Ctrl+C can arrive twice (from the terminal and from tsx), the second must not kill the process mid-write
  process.on('SIGINT', () => stop.abort());
  process.on('SIGTERM', () => stop.abort());

  console.log(
    config.chatId
      ? `@${me.username}: chat ${config.chatId}, cards every day at ${config.sendAt} local time`
      : `@${me.username}: setup mode, send /start to the bot to get your chat id`,
  );

  let offset: number | undefined;
  let failures = 0;
  while (!stop.signal.aborted) {
    try {
      await bot.tick(new Date()).catch((error: unknown) => console.error('daily push failed:', error));
      const updates = await tg.getUpdates(offset, POLL_TIMEOUT_SECONDS, stop.signal);
      for (const update of updates) {
        // the offset advances even if handling failed: one broken update must not block the rest
        offset = update.update_id + 1;
        await bot.handleUpdate(update, new Date()).catch((error: unknown) => console.error('update failed:', error));
      }
      failures = 0;
    } catch (error) {
      if (stop.signal.aborted) break;
      if (error instanceof TelegramError && error.code === 401) throw error; // token revoked
      failures += 1;
      const delay = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** failures);
      console.error(`polling failed, retry in ${delay / 1000}s:`, error);
      await sleep(delay, stop.signal);
    }
  }
  await db.$disconnect();
  console.log('bot stopped');
}

main().catch(async (error: unknown) => {
  console.error(error);
  await db.$disconnect();
  process.exit(1);
});

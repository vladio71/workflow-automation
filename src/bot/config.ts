export interface BotConfig {
  token: string;
  /** null: режим налаштування, бот тільки відповідає на /start твоїм chat id */
  chatId: string | null;
  /** HH:MM за локальним часом процесу, як у .env */
  sendAt: string;
  /** те саме в хвилинах від півночі */
  sendAtMinutes: number;
  /** https://api.telegram.org, або фейковий сервер у тестах */
  apiUrl: string;
}

const DEFAULT_API_URL = 'https://api.telegram.org';
const DEFAULT_SEND_AT = '09:00';
const TIME_PATTERN = /^(\d{1,2}):(\d{2})$/;

export function loadConfig(env: NodeJS.ProcessEnv): BotConfig {
  const token = env.TELEGRAM_BOT_TOKEN?.trim() ?? '';
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN is empty: create a bot with @BotFather and put its token into .env');

  const sendAt = env.TELEGRAM_SEND_AT?.trim() || DEFAULT_SEND_AT;
  const match = TIME_PATTERN.exec(sendAt);
  const hours = Number(match?.[1]);
  const minutes = Number(match?.[2]);
  if (!match || hours > 23 || minutes > 59) throw new Error(`TELEGRAM_SEND_AT must look like 09:00, got "${sendAt}"`);

  return {
    token,
    chatId: env.TELEGRAM_CHAT_ID?.trim() || null,
    sendAt,
    sendAtMinutes: hours * 60 + minutes,
    apiUrl: env.TELEGRAM_API_URL?.trim() || DEFAULT_API_URL,
  };
}

/**
 * Minimal Telegram Bot API client: only the methods the card bot needs.
 * The base URL can be overridden (TELEGRAM_API_URL) to run the bot against a fake server.
 */

export interface TgUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  username?: string;
}

export interface TgChat {
  id: number;
  type: string;
}

export interface TgMessage {
  message_id: number;
  date: number;
  chat: TgChat;
  from?: TgUser;
  text?: string;
}

export interface TgCallbackQuery {
  id: string;
  from: TgUser;
  message?: TgMessage;
  data?: string;
}

export interface TgUpdate {
  update_id: number;
  message?: TgMessage;
  callback_query?: TgCallbackQuery;
}

export interface InlineButton {
  text: string;
  callback_data: string;
}

export interface InlineKeyboard {
  inline_keyboard: InlineButton[][];
}

export interface SendMessageInput {
  chatId: string;
  /** Telegram HTML */
  text: string;
  keyboard?: InlineKeyboard;
}

export interface EditMessageInput {
  chatId: string;
  messageId: number;
  /** Telegram HTML */
  text: string;
  /** without a keyboard the message loses its buttons */
  keyboard?: InlineKeyboard;
}

export interface BotCommand {
  command: string;
  description: string;
}

interface ApiResponse<T> {
  ok: boolean;
  result?: T;
  error_code?: number;
  description?: string;
  parameters?: { retry_after?: number };
}

/** Telegram answered with an error, so the request was definitely not executed. A network failure is not this: there it is unknown whether it arrived. */
export class TelegramError extends Error {
  readonly method: string;
  readonly code: number;

  constructor(method: string, code: number, description: string) {
    super(`Telegram ${method}: ${code} ${description}`);
    this.name = 'TelegramError';
    this.method = method;
    this.code = code;
  }
}

const MAX_RATE_LIMIT_RETRIES = 3;

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}

export class TelegramClient {
  private readonly baseUrl: string;

  constructor(token: string, apiUrl: string) {
    this.baseUrl = `${apiUrl.replace(/\/+$/, '')}/bot${token}`;
  }

  async call<T>(method: string, params: object, signal?: AbortSignal): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const response = await fetch(`${this.baseUrl}/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(params),
        signal,
      });
      const body = (await response.json()) as ApiResponse<T>;
      if (body.ok && body.result !== undefined) return body.result;
      const retryAfter = body.parameters?.retry_after;
      // 429: Telegram itself says how many seconds to wait
      if (body.error_code === 429 && retryAfter !== undefined && attempt < MAX_RATE_LIMIT_RETRIES) {
        await sleep(retryAfter * 1000, signal);
        continue;
      }
      throw new TelegramError(method, body.error_code ?? response.status, body.description ?? response.statusText);
    }
  }

  getMe(): Promise<TgUser> {
    return this.call<TgUser>('getMe', {});
  }

  /** getUpdates does not work while the bot has a webhook */
  deleteWebhook(): Promise<boolean> {
    return this.call<boolean>('deleteWebhook', {});
  }

  setMyCommands(commands: BotCommand[]): Promise<boolean> {
    return this.call<boolean>('setMyCommands', { commands });
  }

  /** Long polling: Telegram holds the request up to timeoutSeconds until an update appears. */
  getUpdates(offset: number | undefined, timeoutSeconds: number, signal: AbortSignal): Promise<TgUpdate[]> {
    return this.call<TgUpdate[]>(
      'getUpdates',
      { offset, timeout: timeoutSeconds, allowed_updates: ['message', 'callback_query'] },
      signal,
    );
  }

  sendMessage(input: SendMessageInput): Promise<TgMessage> {
    return this.call<TgMessage>('sendMessage', {
      chat_id: input.chatId,
      text: input.text,
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
      reply_markup: input.keyboard,
    });
  }

  async editMessage(input: EditMessageInput): Promise<void> {
    try {
      await this.call<TgMessage | boolean>('editMessageText', {
        chat_id: input.chatId,
        message_id: input.messageId,
        text: input.text,
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
        reply_markup: input.keyboard ?? { inline_keyboard: [] },
      });
    } catch (error) {
      // the same button pressed again: the text is already like that, not an error
      if (error instanceof TelegramError && error.message.includes('message is not modified')) return;
      throw error;
    }
  }

  /** Clears the spinner on the button; text is shown as a short toast. */
  async answerCallback(callbackQueryId: string, text?: string): Promise<void> {
    try {
      await this.call<boolean>('answerCallbackQuery', { callback_query_id: callbackQueryId, text });
    } catch (error) {
      // a press older than ~15 min can no longer be answered, but the action itself was done
      if (error instanceof TelegramError && error.code === 400) return;
      throw error;
    }
  }
}

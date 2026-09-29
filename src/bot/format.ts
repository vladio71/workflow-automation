import type { CardView } from '@/lib/cards';
import type { InlineKeyboard } from './telegram';

/**
 * Тексти і кнопки бота. Розмітка: Telegram HTML (https://core.telegram.org/bots/api#html-style).
 * Обмеження Telegram: <b> не може містити <code> чи <pre>, повідомлення до 4096 символів.
 */

export type BotGrade = 'FORGOT' | 'HARD' | 'GOOD';

export const GRADE_LABELS: Record<BotGrade, string> = { FORGOT: 'Забув', HARD: 'Важко', GOOD: 'Згадав' };
const GRADE_MARKS: Record<BotGrade, string> = { FORGOT: '🔴', HARD: '🟠', GOOD: '🟢' };
const GRADE_ORDER: BotGrade[] = ['FORGOT', 'HARD', 'GOOD'];
const GRADE_CODES: Record<BotGrade, string> = { FORGOT: 'f', HARD: 'h', GOOD: 'g' };
const GRADE_BY_CODE: Record<string, BotGrade> = { f: 'FORGOT', h: 'HARD', g: 'GOOD' };

/** запас до ліміту 4096: рахуємо разом з тегами, тож із запасом */
const MESSAGE_ROOM = 3800;
const QUESTION_ROOM = 1200;

// ---------- кнопки ----------

export interface RevealAction {
  kind: 'reveal';
  deliveryId: number;
}

export interface GradeAction {
  kind: 'grade';
  deliveryId: number;
  grade: BotGrade;
}

export type CallbackAction = RevealAction | GradeAction;

export function revealKeyboard(deliveryId: number): InlineKeyboard {
  return { inline_keyboard: [[{ text: 'Показати відповідь', callback_data: `r:${deliveryId}` }]] };
}

export function gradeKeyboard(deliveryId: number): InlineKeyboard {
  const row = GRADE_ORDER.map((grade) => ({ text: GRADE_LABELS[grade], callback_data: `g:${deliveryId}:${GRADE_CODES[grade]}` }));
  return { inline_keyboard: [row] };
}

export function parseCallback(data: string): CallbackAction | null {
  const reveal = /^r:(\d+)$/.exec(data);
  if (reveal) return { kind: 'reveal', deliveryId: Number(reveal[1]) };
  const graded = /^g:(\d+):([fhg])$/.exec(data);
  const grade = graded ? GRADE_BY_CODE[graded[2] ?? ''] : undefined;
  if (graded && grade) return { kind: 'grade', deliveryId: Number(graded[1]), grade };
  return null;
}

/** "/today@MyBot arg" -> "/today"; не команда -> null */
export function parseCommand(text: string | undefined): string | null {
  const first = text?.trim().split(/\s+/)[0] ?? '';
  if (!first.startsWith('/')) return null;
  return (first.split('@')[0] ?? '').toLowerCase();
}

// ---------- markdown карток -> Telegram HTML ----------

export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const FENCE = /```([\w+#-]*)[^\n]*\n([\s\S]*?)```/g;
const CODE_SPAN = /`([^`\n]+)`/g;
const SLOT = /\u0000(\d+)\u0000/g;

/** `код`, **жирний** і [посилання](https://...) в одному рядку. Жирний і посилання не можуть містити код. */
function inlineHtml(text: string): string {
  const codes: string[] = [];
  const slotted = text.replace(CODE_SPAN, (_match: string, code: string) => {
    codes.push(code);
    return `\u0000${codes.length - 1}\u0000`;
  });
  const html = escapeHtml(slotted)
    .replace(/\*\*([^*\n\u0000]+?)\*\*/g, '<b>$1</b>')
    .replace(/\[([^\]\n\u0000]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2">$1</a>');
  return html.replace(SLOT, (_match: string, index: string) => `<code>${escapeHtml(codes[Number(index)] ?? '')}</code>`);
}

function textBlockHtml(text: string): string {
  return text
    .split('\n')
    .map((line) => {
      const heading = /^#{1,6}\s+(.*)$/.exec(line);
      if (heading) {
        const inner = inlineHtml(heading[1] ?? '');
        return inner.includes('<code>') ? inner : `<b>${inner}</b>`;
      }
      const item = /^(\s*)[-*+]\s+(.*)$/.exec(line);
      if (item) return `${item[1] ?? ''}• ${inlineHtml(item[2] ?? '')}`;
      return inlineHtml(line);
    })
    .join('\n');
}

/** Блоки коду, `код`, **жирний**, посилання, заголовки і списки. Решта лишається звичайним текстом. */
export function markdownToHtml(markdown: string): string {
  const parts: string[] = [];
  let last = 0;
  for (const match of markdown.matchAll(FENCE)) {
    parts.push(textBlockHtml(markdown.slice(last, match.index)));
    const language = match[1] ?? '';
    const code = escapeHtml((match[2] ?? '').replace(/\n$/, ''));
    parts.push(language ? `<pre><code class="language-${language}">${code}</code></pre>` : `<pre>${code}</pre>`);
    last = match.index + match[0].length;
  }
  parts.push(textBlockHtml(markdown.slice(last)));
  return parts.join('').replace(/\n{3,}/g, '\n\n').trim();
}

/** Завелике -> обрізаний простий текст (без розмітки, щоб не розірвати тег чи блок коду). */
function fitHtml(markdown: string, room: number): string {
  const html = markdownToHtml(markdown);
  if (html.length <= room) return html;
  const note = '\n<i>(повністю в апці)</i>';
  let slice = markdown.slice(0, Math.max(0, room - note.length - 1));
  while (slice.length > 0 && escapeHtml(slice).length + 1 + note.length > room) {
    slice = slice.slice(0, Math.floor(slice.length * 0.9));
  }
  return `${escapeHtml(slice.trimEnd())}…${note}`;
}

// ---------- повідомлення ----------

function header(card: CardView): string {
  return `<i>${escapeHtml(card.topicName)}</i>`;
}

export function questionText(card: CardView): string {
  return `${header(card)}\n\n${fitHtml(card.question, QUESTION_ROOM)}`;
}

/** Питання + відповідь; footer: результат оцінки. */
export function answerText(card: CardView, footer = ''): string {
  const head = `${questionText(card)}\n\n<b>Відповідь</b>\n`;
  const tail = footer ? `\n\n${footer}` : '';
  const answer = card.answer.trim()
    ? fitHtml(card.answer, MESSAGE_ROOM - head.length - tail.length)
    : '<i>Відповіді ще нема, допиши її в апці.</i>';
  return head + answer + tail;
}

const DAY_FORMAT = new Intl.DateTimeFormat('uk-UA', { day: 'numeric', month: 'long' });

export function formatDay(date: Date): string {
  return DAY_FORMAT.format(date);
}

function plural(count: number, one: string, few: string, many: string): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

export function daysWord(count: number): string {
  return `${count} ${plural(count, 'день', 'дні', 'днів')}`;
}

export function cardsWord(count: number): string {
  return `${count} ${plural(count, 'картка', 'картки', 'карток')}`;
}

/** Після оцінки: card уже з новим розкладом. */
export function gradedFooter(grade: BotGrade, card: CardView): string {
  const next = card.dueAt ? `, наступний раз ${formatDay(card.dueAt)} (через ${daysWord(card.interval)})` : '';
  return `${GRADE_MARKS[grade]} <b>${GRADE_LABELS[grade]}</b>${next}`;
}

export const STALE_FOOTER = '⏭ Цю картку вже повторив в апці, оцінку звідси не записую.';

export function doneText(gradedToday: number): string {
  return gradedToday > 0 ? `✅ На сьогодні все: ${cardsWord(gradedToday)}.` : 'На сьогодні карток нема.';
}

export function helpText(sendAt: string): string {
  return [
    'Картки з апки на повторення.',
    `Щодня о ${sendAt} надсилаю першу картку, наступна приходить після оцінки. Оцінки йдуть у той самий розклад, що й в апці.`,
    '',
    '/today: почати зараз або повернути поточну картку',
  ].join('\n');
}

export function setupText(chatId: string): string {
  return `Chat id: <code>${escapeHtml(chatId)}</code>\nДодай у .env <code>TELEGRAM_CHAT_ID=${escapeHtml(chatId)}</code> і перезапусти бота.`;
}

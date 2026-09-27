Репо з дрілами: [vladio71/graphql-base](https://github.com/vladio71/graphql-base) · теорія: `docs/00-theory.md`

## Як виконується запит

`parse` (рядок → AST) → `validate` (AST проти схеми, ліміти depth/alias/cost, **0 SQL**) → `execute` (резолвери зверху вниз).
Резолвер = `(parent, args, context, info)`. Нема резолвера для поля, тоді default resolver повертає `parent[fieldName]`.

## N+1 і DataLoader

- Резолвер поля викликається окремо на кожного батька: 1 запит за списком + N за вкладеним полем. На реальному стеку вийшло **251 vs 102 (Prisma findUnique) vs 3 (DataLoader)** SQL.
- DataLoader збирає всі `load(key)` за поточний тік і викликає batch-функцію **один раз**, плюс кешує по ключу.
- Батч запускається **в кінці поточного тіку**: після синхронного коду і вже поставлених мікротасків, до таймерів та I/O.
- Один SQL **на кожен loader на кожному рівні дерева**, а не один на весь запит.
- Loader створюється **на кожен запит** у context. Глобальний означає витік даних між юзерами, застарілий кеш і ріст пам'яті.
- Після мутації: `loader.clear(id)` або `clear(id).prime(id, updated)`.

**Контракт batch-функції:** `result.length === keys.length` і `result[i]` відповідає `keys[i]`. БД повертає рядки в іншому порядку і без "дірок", тому мапимо через `Map` назад по keys. Якщо повернути "як віддала БД", помилки не буде, дані тихо переплутаються.

## Мій DataLoader

```ts
type BatchFn<K, V> = (keys: readonly K[]) => Promise<ReadonlyArray<V | Error>>;

interface PendingLoad<K, V> {
  key: K;
  resolve: (value: V) => void;
  reject: (error: unknown) => void;
}

/** Запустити fn після поточного синхронного коду і вже поставлених мікротасків, але до таймерів та I/O. */
function afterCurrentTick(fn: () => void): void {
  Promise.resolve().then(() => process.nextTick(fn));
}

class MyLoader<K, V> {
  private queue: PendingLoad<K, V>[] = [];
  private cache = new Map<K, Promise<V>>();
  private isBatchScheduled = false;

  constructor(private readonly batchFn: BatchFn<K, V>) {}

  load(key: K): Promise<V> {
    const cached = this.cache.get(key);
    if (cached) return cached;

    const promise = new Promise<V>((resolve, reject) => {
      this.queue.push({ key, resolve, reject });
    });
    this.cache.set(key, promise);

    if (!this.isBatchScheduled) {
      this.isBatchScheduled = true;
      afterCurrentTick(() => this.dispatchBatch());
    }
    return promise;
  }

  private async dispatchBatch(): Promise<void> {
    const batch = this.queue;
    this.queue = [];
    this.isBatchScheduled = false;

    try {
      const results = await this.batchFn(batch.map((pending) => pending.key));
      if (results.length !== batch.length) {
        throw new Error(`batchFn returned ${results.length} results for ${batch.length} keys`);
      }
      batch.forEach((pending, index) => {
        const result = results[index];
        if (result instanceof Error) {
          this.cache.delete(pending.key); // помилку не кешуємо
          pending.reject(result);
          return;
        }
        pending.resolve(result as V);
      });
    } catch (error) {
      // впав увесь батч: та сама помилка кожному ключу
      for (const pending of batch) {
        this.cache.delete(pending.key);
        pending.reject(error);
      }
    }
  }
}
```

**Що було не так у першій версії:**
1. `if (this.isBatchScheduled!)`: `!` після змінної це non-null assertion, а не заперечення. Батч ніколи не запускався, проміси висіли вічно. Правильно `if (!this.isBatchScheduled)`.
2. Порожній `catch {}` ковтав помилку батчу, і проміси знову висіли вічно. Треба `reject` кожному і прибрати ключі з кешу.
3. Відхилені проміси лишались у кеші, тож повторний `load` одразу отримував стару помилку.

## Помилки

- Помилка в резолвері не валить весь запит: `errors[]` з `path` плюс часткова `data`, HTTP зазвичай 200.
- **Null bubbling:** впало non-null поле, null піднімається до найближчого nullable батька. Всі батьки non-null, тоді `data: null`.
- "Виправ поле" (валідація, дублікат) повертається даними в `payload.userErrors` з `code`. "Не можна / не існує / зламалось" іде в `errors[]` з `extensions.code`.
- Дефолт `= false` є тільки в input і аргументах. Явний `null` дефолт не замінює; `Boolean! = false` забороняє null.

## Пагінація

- Offset: дублі або пропуски при вставках, повільний на великому OFFSET (читає і викидає рядки).
- Cursor: `WHERE (created_at, id) < ($1, $2) ORDER BY created_at DESC, id DESC LIMIT first + 1`, індекс `(created_at DESC, id DESC)`. `id` потрібен як tie-breaker.
- Пастка: Postgres зберігає мікросекунди, JS `Date` мілісекунди. Курсор через `Date` тихо губить рядки.

## Codegen

- Бекенд: typed resolvers + `mappers` (parent = рядок БД). Клієнт: `TypedDocumentNode` або SDK з `.graphql` операцій.
- Ловить **ламаючі** зміни (rename, видалення, зміна типу). "Додав опційне поле і забув використати" ловить тільки тест.

## Транзакції

GraphQL їх не дає, їх дає БД всередині одного резолвера чи сервісу. Поля mutation виконуються послідовно, але **не атомарно разом**.

## Безпека

Depth limit, alias limit, cost limit на етапі validate, плюс обов'язковий ліміт `first` у сервісі (статичні правила не бачать значень змінних). У проді persisted queries.

## Дріли

| # | Що | Файл |
|---|---|---|
| 01-04 | резолвери, ланцюжок, null bubbling, userErrors | [drills/01-easy](https://github.com/vladio71/graphql-base/tree/main/drills/01-easy) |
| 05-06 | DataLoader покроково і руками | [drills/02-medium](https://github.com/vladio71/graphql-base/tree/main/drills/02-medium) |
| 07-10 | N+1 на Prisma, пагінація, auth, codegen | [drills/02-medium](https://github.com/vladio71/graphql-base/tree/main/drills/02-medium) |
| 11-17 | транзакції, ліміти, кеш, subscriptions, top-N, composite cursor, info/AST | [drills/03-hard](https://github.com/vladio71/graphql-base/tree/main/drills/03-hard) |

## Якщо спитають

- **Чому не JOIN?** Форму відповіді обирає клієнт; JOIN "на всі випадки" тягне зайве. DataLoader вирішує N+1 для будь-якої форми.
- **Чому loader на запит?** Кеш на один запит; глобальний дає витік, застарілі дані й пам'ять без меж.
- **Захист від важких запитів?** Depth/alias/cost на validate плюс ліміт у сервісі, у проді persisted queries.
- **Offset чи cursor?** Cursor для стрічок: стабільний і однаково швидкий на будь-якій глибині.
- **Як отримати запитані поля?** `info` через graphql-parse-resolve-info; id і FK вибирати завжди.

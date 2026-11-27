---
sidebar_position: 2
title: Anthropic Messages
description: Client::anthropic() и чем он отличается от Chat Completions - max_tokens, глубина как адаптивные рассуждения и подписанные рассуждения, отправленные обратно.
---

# Anthropic Messages

`Client::anthropic()` работает с Anthropic Messages API за теми же `Request`,
`Event` и `Completion`, что и Chat Completions. Программа, написанная под один
протокол, работает с другим, если сменить конструктор и указать `max_tokens` в
каждом запросе.

```rust
use svir::prelude::*;

async fn ask() -> Result<(), Error> {
    let client = Client::anthropic().api_key_env("ANTHROPIC_API_KEY").build()?;
    let request = Request::new("claude-opus-5-5")
        .max_tokens(16_000)
        .reasoning(Effort::High)
        .user("Why do rivers meander?");

    let mut stream = client.stream(&request).await?;
    while let Some(event) = stream.next().await {
        match event? {
            Event::Reasoning(piece) => eprint!("{}", piece.text),
            Event::Text(piece) => print!("{piece}"),
            Event::Completed(done) => println!("\n{:?}", done.usage),
            _ => {}
        }
    }

    Ok(())
}
```

Хостинговый API работает по HTTPS: сборке нужна фича TLS, `tls-ring` или
`tls-aws-lc`; см. [Фичи и TLS](./features).

## Клиент {/* #the-client */}

| | |
|---|---|
| Сервер | `https://api.anthropic.com`. `.base_url(url)` направляет клиент на другой сервер с эндпоинтом Messages |
| Версия API | `anthropic-version: 2026-10-21`, его пишет svir; через `.header(..)` его не задать |
| Ключ | `api_key`, `api_key_env` или `api_key_file`, отправляется как `Authorization: Bearer`. Шлюз, который читает `x-api-key`, получит его через `.header("x-api-key", key)`, скрытый, как любой заголовок |
| Обработка совместимости | Нет: каждый запрос отправляется один раз |
| Список моделей | Все страницы `GET /v1/models`; `display_name` модели становится её `name` |

Всё остальное из [Настройки](./configuration) — таймауты, слои, лимиты и
строгость — остаётся как есть.

```rust
use svir::prelude::*;

fn local() -> Result<Client, Error> {
    // LM Studio serves the Messages API next to Chat Completions.
    Client::anthropic().base_url("http://127.0.0.1:1234").build()
}
```

## Что говорит запрос {/* #what-a-request-says */}

| | Messages API |
|---|---|
| `max_tokens` | Обязателен: запрос без него — `Unsupported` ещё до отправки |
| `system(..)` | Поле `system` верхнего уровня |
| Части | Каждая — отдельный блок, в заданном порядке: текст, изображение в base64, текстовый файл как текст, обёрнутый его именем |
| Результаты инструментов | Сообщение пользователя из блоков `tool_result`, с `is_error` у неудачного |
| `reasoning(effort)` | Адаптивные рассуждения с этой глубиной, показанные в виде сводки; `Off` выключает рассуждения, `Minimal` — `Unsupported`. См. [глубину рассуждений](../basics/requests#reasoning-effort) |
| `tool_choice(..)` | `none`, `any` для `Required` или один инструмент по имени. См. [Инструменты](../basics/tools#requiring-or-forbidding-a-call) |
| `response_format(..)` | Только схема, в `output_config.format`. См. [Структурированный вывод](../basics/structured-output) |
| `temperature(..)` | Отправляется как задано. Версия API `2026-10-21` отвергает её у хостинговых моделей; совместимый сервер может принять |

Подряд идущие сообщения одной роли объединяются в одно, как сообщение
инструмента и следующее за ним сообщение пользователя.

## Рассуждения {/* #thinking */}

Блок рассуждений приходит в потоке как `Event::Reasoning` с источником
`ReasoningSource::Thinking` и сохраняется в итоговом ответе со своей подписью
(`signature`). Скрытый блок тоже сохраняется: без текста, с зашифрованными
данными в качестве подписи, и ничего не показывает. Если задан уровень
`Effort`, svir просит сводку рассуждений, чтобы было что показать; без него
некоторые модели присылают блоки рассуждений с пустым текстом.

Оба вида уходят серверу обратно такими, какими пришли, на своём месте среди
текста и вызовов: `Completion::parts` хранит порядок, а
`request.assistant(done)` им пользуется. Это всё, что нужно циклу с рассуждениями:

```rust
use svir::prelude::*;

async fn answer(client: &Client, tools: &Tools, mut request: Request) -> Result<Completion, Error> {
    for _ in 0..8 {
        let done = client.complete(&request).await?;
        if done.calls.is_empty() {
            return Ok(done);
        }

        let results = tools.call_all(&done.calls).await;
        // The text, the thinking blocks with their signatures, and the calls, as they came.
        request = request.assistant(done).tool_results(results);
    }

    Err(Error::new(ErrorKind::Unsupported).with_detail("the model kept calling tools"))
}
```

- Блоки рассуждений уходят обратно всегда, что бы ни говорил `send_reasoning`.
  API их просит и отбрасывает без оплаты то, что текущая модель прочесть не может.
- **Не собирайте ход модели вручную.** Новейшие модели отвергают диалог, в
  котором блоки рассуждений переставлены, изменены или выброшены или в котором
  более ранние сообщения изменились после того, как были написаны.
- Рассуждения из Chat Completions или отделённые из тегов `<think>` никогда не
  отправляются в Messages API.

## Ответ {/* #the-answer */}

| Причина остановки | `FinishReason` |
|---|---|
| `end_turn`, `stop_sequence` | `Stop` |
| `tool_use` | `ToolCalls` |
| `max_tokens`, `model_context_window_exceeded` | `Length` |
| `refusal` | `Refusal`, текст, пришедший до него, сохраняется |
| `pause_turn` или незнакомая svir | `Unsupported` |

`Usage::input` считает весь промпт, включая токены, прочитанные из кэша и
записанные в него; `output` — нарастающий итог API, а `reasoning` — токены
рассуждений, если API их сообщает. Остальное из [Чтения ответа](../basics/answers)
остаётся как есть.

## Ошибки {/* #errors */}

| API говорит | `ErrorKind` |
|---|---|
| `529`, `overloaded_error` | `Transport`, можно повторить |
| `400`, «prompt is too long» | `ContextOverflow` |
| `400` из-за поля, которое модель не принимает: `temperature`, выключенные рассуждения, принудительный инструмент у новейших моделей | `Unsupported`, со словами API в `server_message()` |
| Событие `error` после начала потока | `Server` или `ContextOverflow`, если оно так говорит |

Остальные сопоставляются как для любого сервера; см. [Ошибки](../errors).

## Совместимые серверы {/* #compatible-servers */}

Сервер с эндпоинтом Messages работает с тем же клиентом через `base_url`. Что
там делает LM Studio, по наблюдениям:

- С моделью, формат которой он разбирает, например Qwen3.8, он отдаёт
  рассуждения, текст и вызовы инструментов блоками и принимает блок
  рассуждений обратно без подписи, так что цикл с инструментами завершается.
- Выбор инструмента по имени и формат ответа он там игнорирует: модель
  отвечает как хочет.
- С моделью, формат которой он не разбирает, рассуждения, служебные маркеры
  модели и её вызовы инструментов приходят простым текстом, как и в Chat
  Completions.

Факты, на которых построена эта страница, из справочника API и живых прогонов,
собраны в репозитории svir в
[заметках о протоколе](https://github.com/RomanEmreis/svir/blob/main/docs/wire-protocol-anthropic.md).

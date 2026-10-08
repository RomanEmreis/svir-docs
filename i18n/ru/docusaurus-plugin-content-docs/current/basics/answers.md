---
sidebar_position: 3
title: Чтение ответа
description: Ответ целиком или потоком, события, итоговый ответ, рассуждения, расход токенов и отмена.
---

# Чтение ответа

Любой ответ идёт по сети потоком. Выбор за вами: читать его по мере прихода
или дождаться конца.

| Вызов | Возвращает | Когда использовать |
|---|---|---|
| `client.complete(&request).await?` | `Completion` | Важен только готовый ответ |
| `client.stream(&request).await?` | `EventStream` | Текст показывается по мере прихода |
| `stream.completion().await?` | `Completion` | Поток уже открыт, а остаток показывать не нужно |

`complete` — это `stream`, за которым следует `completion`. `stream`
завершается, когда ответ **начался**, а у локальной модели это может быть
сильно позже вызова: сначала модель читает весь промпт.

`complete` и `stream` принимают запрос по ссылке или по значению.

## События {/* #events */}

`EventStream::next()` возвращает `Option<Result<Event, Error>>`. Это метод
самого потока, поэтому импорт `StreamExt` не нужен.

| Событие | Несёт | Значение |
|---|---|---|
| `Event::Text(String)` | Кусок ответа | Показать |
| `Event::Reasoning(Reasoning)` | `source`, `text` | Кусок рассуждений модели; показывать отдельно от ответа |
| `Event::ToolCallDelta(ToolCallDelta)` | `index`, `id`, `name`, `arguments` | Кусок вызова инструмента, только для отображения |
| `Event::Completed(Completion)` | Весь ответ | Всегда последний элемент |

После `Completed` или после `Err` метод `next()` возвращает `None`. `Event`
помечен `#[non_exhaustive]`: заканчивайте каждый `match` веткой `_ => {}`.

## Показывайте дельты, храните итоговый ответ {/* #show-the-deltas-keep-the-completion */}

Итоговый ответ уже содержит всё — с вызовами инструментов и расходом токенов.
Дельты — для отображения, а хранить нужно то, что несёт `Completed`; никогда
не собирайте ответ из кусков.

```rust
use std::io::Write;

use svir::prelude::*;

async fn show(client: &Client, request: &Request) -> Result<Completion, Error> {
    let mut stream = client.stream(request).await?;

    while let Some(event) = stream.next().await {
        match event? {
            Event::Text(piece) => {
                print!("{piece}");
                let _ = std::io::stdout().flush();
            }
            Event::Reasoning(piece) => eprint!("{}", piece.text),
            Event::Completed(done) => return Ok(done),
            _ => {}
        }
    }

    // Unreachable in practice: a stream ends with `Completed` or with an error.
    Err(Error::new(ErrorKind::TruncatedStream))
}
```

`EventStream` — это `Send + Unpin + 'static`, и он владеет всем, что ему
нужно, поэтому его можно передать в задачу или хранить в структуре. Он также
реализует `futures_core::Stream` — для кода, которому нужны комбинаторы.

## Итоговый ответ {/* #the-completion */}

| Поле | Тип | Что хранит |
|---|---|---|
| `finish` | `FinishReason` | `Stop`, `ToolCalls`, `Length`, `ContentFilter` или `Refusal` |
| `text` | `String` | Ответ — ровно в том виде, в каком пришёл |
| `reasoning` | `Vec<Reasoning>` | Рассуждения, по записи на каждый источник |
| `calls` | `Vec<ToolCall>` | Полные вызовы инструментов, по порядку |
| `usage` | `Option<Usage>` | Расход токенов, если сервер его сообщил |
| `timing` | `Option<Timing>` | Когда пришли первый и последний видимые токены |

Действуйте по `finish`:

```rust
use svir::prelude::*;

fn describe(done: &Completion) -> &'static str {
    match done.finish {
        FinishReason::Stop => "the answer is complete",
        // Run the tools in `done.calls` and ask again; see Tools.
        FinishReason::ToolCalls => "the model is waiting for tool results",
        // The output limit cut it off. With a reasoning model the text can be
        // empty: the reasoning used the budget. Raise `max_tokens`.
        FinishReason::Length => "the answer was cut off",
        // The server's content filter stopped it, or flagged it after it was
        // streamed. `done.text` holds what was sent, which may be what was
        // flagged: withdraw what the user was shown.
        FinishReason::ContentFilter => "the answer was filtered",
        // The model would not answer, and `done.text` says why: show it as
        // the answer. It does not have a format the request asked for.
        FinishReason::Refusal => "the model refused",
        _ => "a finish reason this code does not know yet",
    }
}
```

Завершение `ContentFilter` может прийти уже после всего ответа. Асинхронный
контент-фильтр Azure OpenAI отдаёт ответ до проверки и сообщает о блокировке
позже, даже после `stop` самой модели; svir делает это причиной завершения.
Текст перед блокировкой может содержать заблокированное и в обычном режиме
Azure. Поэтому код, который показывает дельты по мере прихода, при такой
причине завершения убирает текст, а не оставляет его с пометкой.

Завершение `Refusal` значит, что модель отказалась отвечать, а текст — это её
отказ. Chat Completions присылает отказ в отдельном поле вместо ответа; svir
передаёт его потоком как `Event::Text`, как любой ответ, поэтому чат
показывает его без отдельного кода. Модели OpenAI отказываются прежде всего
тогда, когда их просят ответить в формате, в котором они отвечать не станут;
см. [Структурированный вывод](./structured-output#refusals). Отказ,
остановленный контент-фильтром, — это `ContentFilter`.

Ответ, запрошенный в JSON, читается в тип через `done.parse::<T>()`, который
разбирает только ответ, завершившийся с `Stop`; см.
[Структурированный вывод](./structured-output#reading-the-answer).

Текст — ровно то, что прислал сервер. Сервер, который отделяет рассуждения,
часто начинает ответ с пустых строк: обрезайте их при показе, а храните как
есть.

## Рассуждения {/* #reasoning */}

Серверы передают рассуждения тремя способами, и svir читает все три в
`Reasoning { source, text }`:

| `ReasoningSource` | Где было |
|---|---|
| `ReasoningContent` | Поле `reasoning_content` |
| `Reasoning` | Поле `reasoning` |
| `Think` | `<think>...</think>` внутри текста ответа |

Inline-теги `<think>` по умолчанию вырезаются из текста, поэтому рассуждения
не показываются как ответ, даже если у сервера нет парсера рассуждений. Тег,
разрезанный границей чанка, придерживается, пока следующий чанк не решит,
что это. `.think(Think::Keep)` на билдере клиента оставляет теги в тексте.

В `Completion::reasoning` по одной записи на источник — в порядке первого
появления, с соединёнными кусками. Рассуждения показываются пользователю как
рассуждения и никогда — как ответ.

## Расход токенов и скорость {/* #usage-and-speed */}

```rust
use svir::prelude::*;

fn report(done: &Completion) {
    if let Some(usage) = done.usage {
        println!("{} tokens in, {} out", usage.input, usage.output);

        if let Some(reasoning) = usage.reasoning {
            println!("{reasoning} of them reasoning");
        }
    }
    if let Some(rate) = done.tokens_per_second() {
        println!("{rate:.1} tokens per second");
    }
}
```

- Расход токенов запрашивается по умолчанию. Если сервер его не сообщает,
  `usage` остаётся `None`, а ответ всё равно полный. Никогда не делайте
  `unwrap`.
- `usage.total` и `usage.reasoning` есть, только если их прислал сервер. svir
  сообщает то, что сказал сервер; оценки — ваша забота.
- `tokens_per_second()` считается от первого видимого токена до последнего,
  поэтому ожидание первого токена не занижает скорость. Для одного токена или
  окна короче 50 мс он равен `None`: честной скорости тогда нет.
- `timing.first_token` отсчитывается от начала ответа, а не от вызова. Время до
  первого токена, каким его ощущает пользователь, замеряйте сами.

## Отмена и дедлайны {/* #cancelling-and-deadlines */}

Drop потока отменяет запрос и закрывает соединение. Вызывать ничего не нужно.
Токен отмены, отключившийся клиент, `select!`, ушедший дальше, — все они
отменяют через drop.

```rust
use std::time::Duration;

use svir::prelude::*;

async fn bounded(client: &Client, request: &Request) -> Result<Completion, Error> {
    let answer = tokio::time::timeout(Duration::from_secs(60), client.complete(request));

    match answer.await {
        Ok(result) => result,
        // The future was dropped, and the request with it.
        Err(_) => Err(Error::new(ErrorKind::Timeout).with_detail("no answer in 60 seconds")),
    }
}
```

И наоборот: поток, отпущенный раньше времени, сгенерировал токены, которые
никто не прочитал.

Для дедлайнов на каждый вызов клиента (время до первого токена, тишина, весь
ответ) используйте [слой `Timeout`](../client/layers). Один дедлайн у клиента
встроен: сервер, который ничего не присылает 5 минут, проваливает вызов.

## Когда поток падает {/* #when-the-stream-fails */}

Ошибка — последний элемент потока. Всё, что пришло до неё, — частичный ответ:
показать его было можно, считать полным — нельзя, а его вызовы инструментов
выполнять нельзя. Оборванный поток вообще не даёт итогового ответа.

| Вид | Что случилось |
|---|---|
| `TruncatedStream` | Соединение закрылось до конца ответа |
| `Timeout` | Сервер замолчал, или прошёл дедлайн |
| `Server` | Сервер сообщил о сбое внутри потока |
| `ContextOverflow` | Сервер сказал внутри потока, что запрос не помещается |
| `Protocol`, `Unsupported` | Поток некорректен или использует то, чего svir не читает |
| `ResponseLimit` | Достигнут [лимит](../advanced/strictness#limits) |

svir ничего из этого не повторяет, и слой `Retry` не трогает начавшийся
ответ: пользователь уже увидел его часть. Отправить запрос снова — решение
приложения. См. [Ошибки](../errors).

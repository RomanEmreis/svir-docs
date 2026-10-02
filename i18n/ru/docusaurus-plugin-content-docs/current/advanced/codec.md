---
sidebar_position: 3
title: Кодек сам по себе
description: Encoder и Decoder без клиента svir — для собственного транспорта.
---

# Кодек сам по себе

`Encoder` и `Decoder` — то, из чего собран клиент, и они публичные. С
`default-features = false` svir — это только типы и кодек: ни клиента, ни
hyper, ни Tokio.

```toml title="Cargo.toml"
[dependencies]
svir = { version = "0.1.3", default-features = false }
```

Если единственная причина — другой HTTP-клиент, то
[собственный бэкенд](../client/custom-backend) проще: он сохраняет разбор
статусов, таймауты, обработку совместимости и слои.

## Декодер {/* #the-decoder */}

`Decoder` работает по push-модели и не делает I/O: байты на входе, события на
выходе. Он читает и поток, которым владеет, и поток, который параллельно
передаётся дальше.

```rust
use svir::openai::chat::Decoder;
use svir::prelude::*;

const RESPONSE: &str = concat!(
    "data: {\"choices\":[{\"index\":0,\"delta\":{\"content\":\"Hello\"},\"finish_reason\":null}]}\n\n",
    "data: {\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":\"stop\"}]}\n\n",
    "data: [DONE]\n\n",
);

fn decode() -> Result<Option<Completion>, Error> {
    let mut decoder = Decoder::strict();
    let mut answer = None;

    // The pieces can be cut anywhere: inside a line, a string, a character.
    for piece in RESPONSE.as_bytes().chunks(7) {
        for event in decoder.push(piece) {
            if let Event::Completed(done) = event? {
                answer = Some(done);
            }
        }
    }
    decoder.finish()?;

    Ok(answer)
}
```

| Вызов | Что делает |
|---|---|
| `Decoder::strict()` / `Decoder::lenient()` / `Decoder::new(mode)` | Декодер для одного ответа |
| `.limits(limits)` / `.think(think)` | Задаются до первого `push` |
| `push(&bytes)` | Возвращает то, что эти байты завершили, как `Vec<Result<Event, Error>>` в порядке провода |
| `is_done()` | Завершился ли поток — успешно или с ошибкой |
| `finish()` | Завершает ввод; поток, который так и не завершился, — `TruncatedStream` |

Правила, которые держит декодер и на которые может полагаться код вокруг:

- Не больше одного элемента `push` — ошибка, и это последний элемент. После
  `Event::Completed` или ошибки `push` ничего не возвращает.
- **Результат не зависит от того, как нарезаны байты.** Один и тот же ответ,
  прочитанный побайтно или целиком, даёт одни и те же события.
- Один декодер читает один ответ. Для следующего создайте новый.
- `finish` сообщает об обрыве один раз; после ошибки, уже возвращённой из
  `push`, он возвращает `Ok`.
- `Completion::timing` отсчитывается от создания декодера, поэтому создавайте
  его, когда ответ начался.

## Кодировщик {/* #the-encoder */}

`Encoder` превращает `Request` в `Body`, точная длина которого известна до
первого байта.

```rust
use svir::openai::chat::Encoder;
use svir::prelude::*;

fn encode(request: &Request) -> Result<(u64, bytes::Bytes), Error> {
    let body = Encoder::new().include_usage(true).encode(request)?;
    let length = body.len();

    // `into_bytes` works when no attachment is a file path.
    Ok((length, body.into_bytes()?))
}
```

| Вызов | Что делает |
|---|---|
| `Encoder::new()` | Отправляет то, что задано в запросе, и ничего больше |
| `.include_usage(bool)` | Запрашивает расход токенов, если запрос не говорит иного. Здесь выключено; клиент его включает |
| `.lean(bool)` | Опускает `reasoning_effort` и `stream_options` — для сервера, который, как известно, их отвергает |
| `.context_tokens(n)` | Падает с `ContextOverflow`, если длина тела плюс `max_tokens` не помещается |
| `encode(&request)` | Без I/O. Вложение, заданное путём к файлу, — `ErrorKind::Attachment` |
| `encode_files(&request).await` | Фича `client`. Сначала измеряет файлы-вложения, чтобы длина была точной |
| `body.len()` | `Content-Length` для отправки |
| `body.into_bytes()` | Всё тело целиком, когда все вложения в памяти |
| `body.into_stream()` | Фича `client`. Тело блоками; файлы читаются по мере опроса |

Тело всегда говорит `"stream": true`: у svir нет декодера для ответа, который
не является потоком.

## Собственный транспорт {/* #a-transport-of-your-own */}

Без клиента транспорт должен делать то, что делает клиент:

1. `POST {base}/v1/chat/completions` с `content-type: application/json`,
   `accept: text/event-stream`, заголовком `Authorization`, если есть ключ, и
   `Content-Length` из `body.len()`.
2. Считать любой неуспешный статус ошибкой ещё до разбора. Соответствие
   статусов и `ErrorKind` живёт в клиенте и не входит в кодек; с собственным
   транспортом это соответствие — ваше.
3. Требовать `content-type: text/event-stream` при успехе. Всё остальное — не
   поток ответа.
4. Передавать тело в `Decoder` по мере прихода и вызвать `finish` в конце.
5. Прекратить чтение, когда пришёл `Event::Completed`.

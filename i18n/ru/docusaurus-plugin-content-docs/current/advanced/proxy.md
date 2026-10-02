---
sidebar_position: 2
title: Ретрансляция через прокси
description: Передать поток событий сервера модели дальше без изменений и прочитать его по пути.
---

# Ретрансляция через прокси

Чат-бэкенд часто стоит между браузером и сервером модели. Браузер должен
получить поток событий сервера без изменений, а бэкенду нужен готовый ответ,
чтобы его сохранить. `client.send` даёт байты, а `Decoder` читает их по пути.

| Задача | Что использовать |
|---|---|
| Вызвать модель и прочитать ответ | `Client::stream` или `complete`. Не эта страница |
| Передать байты сервера кому-то ещё и при этом знать, что было сказано | `Client::send` и `Decoder` |
| Другой HTTP-клиент, но с таймаутами, разбором статусов и слоями svir | [Собственный бэкенд](../client/custom-backend) |
| Вообще без транспорта svir | [Кодек сам по себе](./codec) |

## Ретрансляция {/* #the-relay */}

```rust
use bytes::Bytes;
use svir::openai::chat::Decoder;
use svir::prelude::*;

/// Relays the answer through `forward`, and returns it once it is complete.
async fn relay(
    client: &Client,
    request: &Request,
    mut forward: impl FnMut(Bytes),
) -> Result<Completion, Error> {
    // `send` has done the authentication, the status mapping, and the
    // compatibility handling. What is left is bytes.
    let mut raw = client.send(request).await?;
    let mut decoder = Decoder::lenient();
    let mut answer = None;

    while let Some(bytes) = raw.next().await {
        let bytes = bytes?;
        forward(bytes.clone());

        for event in decoder.push(&bytes) {
            if let Event::Completed(done) = event? {
                answer = Some(done);
            }
        }
    }

    // A stream that ended without its end marker is an error, not a short
    // answer.
    decoder.finish()?;

    answer.ok_or_else(|| Error::new(ErrorKind::TruncatedStream))
}
```

`forward` здесь — соединение ниже по цепочке: канал в SSE-ответ, WebSocket,
что угодно, что принимает байты.

## Что важно знать {/* #what-to-know */}

- **`send` возвращает поток только для успешного статуса с event stream.**
  `401` или `429` от сервера модели — это уже `Err` со своим видом, а сам
  статус лежит в `error.status()`. Не ретранслируйте его как поток.
- **Различайте два `401`.** `401` сверху означает, что сервер модели отверг
  ключ прокси. Это не то же самое, что неаутентифицированный клиент самого
  прокси; отвечайте на него как на сбой прокси (`502`), а не клиента.
- **Решите, что делать, если разбор упал после того, как байты ушли.** Нижняя
  сторона уже их получила; прокси может только остановиться и пометить
  сохранённый ответ как неудачный.
- **Прокси подходит мягкий декодер.** Судить о незнакомых svir полях должен
  клиент ниже по цепочке, а не прокси.
- `RawStream` падает с `ErrorKind::Timeout`, когда сервер замолкает, а его
  drop отменяет запрос — ровно как у `EventStream`. Когда нижняя сторона
  отключается, отпустите поток.
- `send` не проходит через [слои](../client/layers): они работают с событиями.

## Ответ со статусом сервера сверху {/* #answering-with-the-upstreams-status */}

Прокси, который отвечает статусом сервера модели, читает `error.status()`.
Для таймаута или сбоя внутри потока он равен `None`, и тогда прокси
выбирает статус сам.

```rust
use svir::prelude::*;

/// The status a proxy answers with when the upstream call failed.
fn status_for(error: &Error) -> u16 {
    match (error.status(), error.kind()) {
        // The model server refused the proxy's own key: not the caller's fault.
        (Some(401 | 403), _) => 502,
        (Some(status), _) => status,
        (None, ErrorKind::Timeout) => 504,
        (None, _) => 502,
    }
}
```

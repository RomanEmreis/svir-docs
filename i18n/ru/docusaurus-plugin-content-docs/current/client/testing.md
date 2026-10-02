---
sidebar_position: 5
title: Тесты без сервера
description: Скриптованный HTTP-бэкенд отвечает из памяти, и код, который вызывает модель, тестируется без неё.
---

# Тесты без сервера

Тесты не должны зависеть от живой модели. Скриптованный
[бэкенд](./custom-backend) отвечает из памяти, и код, который вызывает модель,
проверяется без сервера, сети и учётных данных.

```rust
use bytes::Bytes;
use svir::http::{Backend, BoxBody, HttpRequest, HttpResponse};
use svir::prelude::*;

const ANSWER: &str = concat!(
    "data: {\"choices\":[{\"index\":0,\"delta\":{\"content\":\"pong\"},\"finish_reason\":null}]}\n\n",
    "data: {\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":\"stop\"}]}\n\n",
    "data: [DONE]\n\n",
);

/// Answers every request with the same stream.
struct Canned;

impl Backend for Canned {
    type Body = BoxBody;

    async fn send(&self, _request: HttpRequest) -> Result<HttpResponse<BoxBody>, Error> {
        let body = futures_util::stream::iter([Ok(Bytes::from_static(ANSWER.as_bytes()))]);
        let headers = vec![("content-type".to_owned(), "text/event-stream".to_owned())];

        Ok(HttpResponse::new(200, headers, Box::pin(body)))
    }
}

#[tokio::test]
async fn pong() -> Result<(), Error> {
    let client = Client::openai("http://127.0.0.1:1").http(Canned).build()?;

    let answer = client.complete(Request::new("m").user("ping")).await?;
    assert_eq!(answer.text, "pong");

    Ok(())
}
```

Для этого нужны `bytes` и `futures-util` в dev-зависимостях:

```toml title="Cargo.toml"
[dev-dependencies]
bytes = "1"
futures-util = "0.3"
tokio = { version = "1", features = ["macros", "rt-multi-thread"] }
```

## Как писать скриптованные ответы {/* #writing-scripted-answers */}

- Ответ должен говорить `content-type: text/event-stream`, иначе клиент его
  отвергнет.
- Строгому клиенту нужен корректный поток: дельта, чанк с причиной
  завершения, затем `[DONE]`.
- Вызов инструмента — это дельта с `tool_calls` и причина завершения
  `tool_calls`.
- Чтобы заскриптовать несколько ответов, держите в бэкенде очередь и снимайте
  по одному на запрос. Чтобы проверить, что было отправлено, прочитайте
  `request.body` до конца и разберите как JSON.
- Сбой скриптуется статусом: ответ `429` проверяет обработку rate limit, поток
  без `[DONE]` — обрыв.

## Против настоящего сервера {/* #against-a-real-server */}

`cargo check` ловит ошибки в API, но не может сказать, примет ли сервер
запрос. Две ошибки компилируются чисто и проявляются только на сервере: ID
модели, которой на сервере нет, и круг вызова инструмента без реплики
ассистента или без результата. Вызов инструментов и изображения к тому же
зависят от самой модели.

Держите живые тесты опциональными — например, за `#[ignore]` — и направляйте
их на любой OpenAI-совместимый сервер. LM Studio по умолчанию слушает
`http://127.0.0.1:1234`.

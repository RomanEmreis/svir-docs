---
sidebar_position: 4
title: Собственный HTTP-бэкенд
description: Замена встроенного транспорта на hyper — для прокси, клиентских сертификатов или других корней.
---

# Собственный HTTP-бэкенд

Встроенный бэкенд — hyper с rustls: без редиректов, без прокси, с корнями по
умолчанию. Для HTTP-прокси, клиентских сертификатов или других корней
реализуйте `svir::http::Backend` поверх HTTP-клиента, который всё это умеет.

Всё, что выше этой границы, работает и с вашим бэкендом: таймаут простоя,
разбор статусов, обработка совместимости, декодирование и слои.

```rust
use svir::http::{Backend, BoxBody, HttpRequest, HttpResponse};
use svir::prelude::*;

struct Mine;

impl Backend for Mine {
    type Body = BoxBody;

    async fn send(&self, request: HttpRequest) -> Result<HttpResponse<BoxBody>, Error> {
        // Send `request.method`, `request.url`, `request.headers`, and
        // `request.body` with your HTTP client, and return the response
        // once its headers have arrived.
        let _ = request;

        Err(Error::new(ErrorKind::Transport).with_detail("not connected"))
    }
}

fn client() -> Result<Client<Mine>, Error> {
    // `http` comes before any layer.
    Client::openai("https://models.example.com").http(Mine).build()
}
```

## Контракт `send` {/* #the-contract-of-send */}

- **Отправьте запрос как есть и верните ответ как получен.** Без редиректов,
  без повторов, без изменений тела.
- В `request.headers` есть `authorization`, если задан ключ, и заголовки,
  добавленные через [`.header(..)`](./configuration#extra-headers). **Любое
  значение, кроме `content-type` и `accept`, может быть учётными данными**:
  не пишите его в логи и отправляйте с пометкой sensitive, где ваш
  HTTP-клиент это умеет. `Debug` у `HttpRequest` их скрывает.
- `request.body` — это `Some(HttpBody { length, stream })`. Отправляйте его с
  `Content-Length: length`, а не chunked: не каждый сервер модели принимает
  chunked-запрос. `stream` отдаёт `Result<Bytes, Error>`.
- Тело ответа — любой `Stream<Item = Result<Bytes, Error>>`, который
  `Send + Unpin + 'static`. `BoxBody` — его упакованная форма; бэкенд, который
  может назвать тип своего потока, обходится без упаковки.
- Ошибку подключения или чтения сообщайте как `ErrorKind::Transport`, таймаут —
  как `ErrorKind::Timeout`. Запрос, который так и не ушёл, помечайте
  `.with_unsent()`: именно это ищет `Retry::connect`.
- **Статусы разбирает svir.** Возвращайте `4xx` или `5xx` как ответ, а не как
  ошибку.
- **Drop тела ответа должен закрывать обмен.** Так отменённый вызов
  останавливает генерацию.

## Тип несёт бэкенд {/* #the-type-carries-the-backend */}

Клиент обобщён по своему бэкенду: `Client<Mine>`. `Client` без параметра —
это встроенный. Код, принимающий любой, может быть обобщён по
`B: svir::http::Backend`.

Слой привязан к бэкенду, для которого его добавили, поэтому `.http(..)` после
`.layer(..)` или `.wrap(..)` — ошибка `Config` в `build()`. Вызывайте `http`
первым.

Скриптованный бэкенд — заодно и способ тестировать код, который вызывает
модель, без модели; см. [Тесты без сервера](./testing).

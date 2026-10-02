---
sidebar_position: 2
title: Слои
description: Middleware вокруг каждого вызова. Retry, Timeout и Trace, замыкания и собственные слои.
---

# Слои

Слой оборачивает сам вызов, `Request -> Result<EventStream, Error>`, — для
каждого запроса, который отправляет клиент. Слои добавляются на билдере, и
**первый добавленный слой — самый внешний**: он первым видит запрос и
последним — ответ.

```rust
use std::time::Duration;

use svir::layer::{Retry, Timeout, Trace};
use svir::prelude::*;

fn client() -> Result<Client, Error> {
    Client::openai("https://models.example.com/v1")
        .api_key_env("MODELS_API_KEY")
        // Outermost: each retry gets the deadline and the trace below it.
        .layer(Retry::transient(3))
        .layer(Timeout::first_token(Duration::from_secs(60)))
        .layer(Trace)
        .build()
}
```

Клиент без слоёв ничего за них не платит. Со слоями клиент хранит их как
trait-объекты, поэтому его тип остаётся `Client`, какими бы они ни были.

## Встроенные {/* #built-in */}

| Слой | Поведение |
|---|---|
| `Retry::connect(n)` | Повторяет вызов, чей запрос так и не дошёл до сервера: соединение отвергнуто или не установилось вовремя. Всегда безопасно |
| `Retry::transient(n)` | Повторяет также таймауты, rate limit и ошибки сервера, случившиеся до начала ответа |
| `.backoff(d)` у любого из них | Пауза перед первым повтором, 500 мс, если не задана. Удваивается каждый раз, до 30 с. `Retry-After` от сервера важнее |
| `Timeout::first_token(d)` | Ни куска ответа (текста, рассуждений, части вызова инструмента) за `d` от вызова |
| `Timeout::idle(d)` | Сервер молчит `d` |
| `Timeout::total(d)` | Ответ не завершился за `d` от вызова |
| `Trace` (фича `tracing`) | Сообщает о каждом вызове через `tracing` |

`Retry` и `Timeout` лежат в `svir::layer`, а не в прелюдии.

### Retry {/* #retry */}

- **Повторяется только вызов, упавший до начала ответа.** Как только ответ
  пошёл, ничего не повторяется: вызывающий код уже видел его часть.
- `Retry::transient` может повторить запрос, который сервер получил. Для
  вызова модели это нормально — на сервере он ничего не меняет, — но стоит
  токенов.
- Ставьте `Retry` снаружи `Timeout` (добавляйте первым), чтобы у каждой
  попытки был свой дедлайн.

### Timeout {/* #timeout */}

Все три проваливают вызов с `ErrorKind::Timeout`. Для локальной модели
дедлайн до первого токена должен покрывать чтение всего промпта, а для
длинного диалога это могут быть минуты.

### Trace {/* #trace */}

С фичей `tracing` слой `Trace` сообщает о каждом вызове через крейт
[`tracing`](https://docs.rs/tracing):

| Уровень | Событие | Поля |
|---|---|---|
| `debug` | `request` | `model`, `messages` |
| `debug` | `response started` | `model`, `elapsed_ms` |
| `info` | `answer complete` | `model`, `finish`, `input_tokens`, `output_tokens`, `elapsed_ms` |
| `warn` | `request failed`, `answer failed` | `model`, `kind`, `elapsed_ms` |

Он никогда не записывает текст, рассуждения, аргументы инструментов или
сообщения сервера, поэтому его безопасно держать включённым в production.

## Замыкание как слой {/* #a-closure-as-a-layer */}

`wrap` превращает замыкание в слой. Оно получает запрос и `next` — остаток
стека.

```rust
use std::time::Instant;

use svir::prelude::*;

fn client() -> Result<Client, Error> {
    Client::openai("http://127.0.0.1:1234")
        .wrap(|request, next| async move {
            let model = request.model.clone();
            let started = Instant::now();
            let answer = next.run(request).await;

            match &answer {
                Ok(_) => eprintln!("{model}: response after {:?}", started.elapsed()),
                Err(error) => eprintln!("{model}: {error}"),
            }
            answer
        })
        .build()
}
```

:::info[`next.run` завершается, когда ответ начался]
Он возвращает поток, как только пришли заголовки, а не когда ответ готов.
Чтобы увидеть весь ответ, наблюдайте за возвращённым потоком — как ниже.
:::

## Собственный слой {/* #a-layer-of-your-own */}

Реализуйте `Layer` для типа, который хранит состояние. Слой не может поменять
тип потока, поэтому формирует поток через собственные методы `EventStream`.

```rust
use std::sync::{
    Arc,
    atomic::{AtomicU64, Ordering},
};

use svir::layer::{Layer, Next};
use svir::prelude::*;

/// Counts the tokens every answer of a client took to generate.
struct Meter {
    generated: Arc<AtomicU64>,
}

impl Layer for Meter {
    async fn call(&self, request: Request, next: Next) -> Result<EventStream, Error> {
        let generated = self.generated.clone();
        let stream = next.run(request).await?;

        Ok(stream.inspect(move |item| {
            if let Ok(Event::Completed(done)) = item {
                let tokens = done.usage.map_or(0, |usage| usage.output);
                generated.fetch_add(tokens, Ordering::Relaxed);
            }
        }))
    }
}
```

| Метод `EventStream` | Для слоя, который |
|---|---|
| `inspect(closure)` | Наблюдает за каждым элементом, включая последний: метрики, логирование, учёт |
| `first_token_by(instant)` | Проваливает поток, если к этому моменту не пришло ни куска ответа |
| `complete_by(instant)` | Проваливает поток, если к этому моменту ответ не готов |
| `idle_timeout(d)` | Проваливает поток, если сервер молчит `d` |

Слой может изменить запрос перед передачей дальше (системный промпт по
умолчанию, псевдоним модели), вызвать `next.run` больше одного раза,
склонировав `next` (так делает `Retry`), или не вызывать его вовсе и вернуть
ошибку. Переписывать события он не может.

## Чего слои не видят {/* #what-layers-do-not-see */}

Слои работают с событиями. `client.send()`, который возвращает сырые байты
сервера для [прокси](../advanced/proxy), и `client.list_models()` через них
не проходят.

Слой привязан к HTTP-бэкенду, для которого его добавили, поэтому
`.http(backend)` должен стоять раньше любого `.layer(..)` или `.wrap(..)`; см.
[Собственный HTTP-бэкенд](./custom-backend).

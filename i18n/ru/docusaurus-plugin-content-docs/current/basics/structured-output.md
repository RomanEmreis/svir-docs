---
sidebar_position: 6
title: Структурированный вывод
description: Ответ в JSON или в JSON по схеме, прочитанный обратно в тип.
---

# Структурированный вывод

Запрос может попросить ответ не прозой, а в JSON: JSON-объект любой формы или
JSON по схеме. Ответ приходит текстом, как любой другой, а `Completion::parse`
читает его в тип.

```toml title="Cargo.toml"
[dependencies]
svir = { version = "0.1.6", features = ["schemars"] }
schemars = "1"
serde = { version = "1", features = ["derive"] }
```

```rust features="schemars"
use schemars::JsonSchema;
use serde::Deserialize;
use svir::prelude::*;

/// A river, as an atlas lists it.
#[derive(Deserialize, JsonSchema)]
struct River {
    /// The river's name in English.
    name: String,
    /// Its length in kilometres.
    length_km: u32,
    /// The lake or sea it flows into.
    mouth: String,
}

async fn river(client: &Client) -> Result<River, Box<dyn std::error::Error>> {
    let request = Request::new("qwen3-27b")
        .response_format(Schema::of::<River>())
        .user("Describe the river that joins Lake Onega to Lake Ladoga.");

    let answer = client.complete(&request).await?;

    Ok(answer.parse()?)
}
```

Схема берётся из типа вместе с doc-комментариями, а разбор ответа обратно в
тип и есть проверка. Больше ответ ничто не проверяет.

## Форматы {/* #the-formats */}

| `response_format(..)` | Отправляется как | Ответ |
|---|---|---|
| `ResponseFormat::Text` | Ничего | Текст любой формы. По умолчанию |
| `ResponseFormat::Json` | `{"type": "json_object"}` | JSON-объект любой формы |
| `Schema::new(name, schema)`, `Schema::of::<T>()` | `{"type": "json_schema", ...}` | JSON, соответствующий схеме |

`response_format` принимает `Schema` как есть; `ResponseFormat::Schema(schema)`
— то же самое. Формат `Text` не отправляется: это умолчание любого сервера.

## Схема {/* #a-schema */}

`Schema` — это имя и JSON Schema. `Schema::new` принимает схему, написанную
вручную:

```rust
use serde_json::json;
use svir::prelude::*;

fn weather(city: &str) -> Request {
    let schema = json!({
        "type": "object",
        "properties": {"city": {"type": "string"}, "celsius": {"type": "number"}},
        "required": ["city", "celsius"],
        "additionalProperties": false
    });

    Request::new("qwen3-27b")
        .response_format(Schema::new("weather", schema).strict(true))
        .user(format!("The weather in {city}, please."))
}
```

- **Имя** Chat Completions требует обязательно: ASCII-буквы, цифры, `_` и `-`,
  не длиннее 64 символов. `Schema::of` называет схему по имени типа.
- **`Schema::of::<T>()`** нужна фича svir `schemars` и `schemars = "1"` в
  вашем крейте — как и [`Tools::add`](./tools#schemas-from-types). Схема — это
  схема типа, с его doc-комментариями в роли описаний.
- Держите схему и тип, в который разбирается ответ, согласованными или
  выводите одно из другого.

### Строгие схемы {/* #strict-schemas */}

`.strict(true)` просит сервер держаться схемы в точности. По умолчанию
выключено и отправляется, только когда включено.

- **OpenAI и Azure OpenAI** гарантируют соответствующий схеме ответ только со
  строгой схемой. Без неё схема направляет модель, но ни к чему не обязывает.
- На этих серверах строгая схема требует большего от самой схемы: каждый
  объект перечисляет все свои свойства в `required` и задаёт
  `additionalProperties: false`. Схема, выведенная из типа, подходит, когда у
  каждой структуры в ней есть `#[serde(deny_unknown_fields)]` и нет полей
  `Option`: schemars не включает `Option` в `required`.
- **Локальные серверы** (LM Studio, llama.cpp, vLLM, mlx-vlm) ограничивают
  сэмплирование схемой — строгой или нет. mlx-lm формат ответа не читает
  вовсе: он отвечает свободным текстом, и `parse` падает.

svir не переписывает выведенную схему под эти требования: переписанная, она
перестала бы говорить то, что говорит тип.

## Любой JSON-объект {/* #any-json-object */}

`ResponseFormat::Json` просит JSON-объект любой формы. Два сервера, о которых
стоит знать:

- OpenAI отвергает его, если в сообщениях нет слова «JSON». Попросите JSON в
  промпте.
- LM Studio отвергает его с `400`: он принимает только схему или текст. Дайте
  ему схему.

## Чтение ответа {/* #reading-the-answer */}

`done.parse::<T>()` читает текст ответа в `T` через serde — так же, как
[`ToolCall::parse`](./tools#without-a-registry) читает аргументы вызова.

- **Разбирается только целый ответ** — тот, что завершился с
  `FinishReason::Stop`. Любая другая причина завершения — ошибка ещё до
  чтения текста: «the answer is not whole: it finished with Length».
  Валидного JSON недостаточно: ответ, обрезанный лимитом вывода, может
  остаться валидным — `12` от того, что было бы `123`.
- **Проверка — это тип.** svir не валидирует ответ по схеме; ответ, который не
  подходит под `T`, — ошибка serde. Правило, которое тип не выражает
  (диапазон, шаблон), проверяется после разбора.
- Ошибка — `serde_json::Error`, а не `svir::Error`. Пустые строки перед JSON,
  которые часто присылают серверы, отделяющие рассуждения, разбору не мешают.
- Чтобы всё-таки прочитать текст, завершившийся не на `Stop`, вызовите
  `serde_json::from_str(&done.text)` сами.

В потоке JSON приходит кусками `Event::Text`, как любой другой текст, и не
валиден, пока не станет целым. Разбирайте итоговый ответ, а не дельты.

```rust
use serde::Deserialize;
use svir::prelude::*;

#[derive(Deserialize)]
struct Weather {
    city: String,
    celsius: f64,
}

fn read(done: &Completion) -> Result<Weather, String> {
    match done.finish {
        FinishReason::Stop => done.parse().map_err(|error| format!("not the weather: {error}")),
        // The model would not answer in the format, and says why.
        FinishReason::Refusal => Err(format!("refused: {}", done.text.trim())),
        FinishReason::Length => Err("cut off: raise max_tokens".to_owned()),
        _ => Err(format!("no answer: {:?}", done.finish)),
    }
}
```

## Отказы {/* #refusals */}

Модель может отказаться отвечать. Модели OpenAI делают это прежде всего тогда,
когда не станут давать ответ в запрошенном формате. Причина завершения тогда —
`FinishReason::Refusal`, а текст — это отказ, переданный потоком как
`Event::Text`: чат показывает его без отдельного кода. `parse` на нём падает:
у отказа нет запрошенного формата. Отказ может прийти на любой запрос; см.
[Чтение ответа](./answers#the-completion).

## Модели с рассуждениями {/* #reasoning-models */}

`parse` читает только текст и никогда — рассуждения. LM Studio подчиняет схеме
и рассуждения модели: с включёнными рассуждениями (глубина не задана, `Low`
или `Medium`) весь JSON приходит как рассуждения, текст остаётся пустым, и
`parse` падает. Просите у такого сервера ответ без рассуждений вместе с
форматом:

```rust
use svir::prelude::*;

fn for_lm_studio(schema: Schema, question: &str) -> Request {
    Request::new("qwen3-27b")
        // With reasoning on, LM Studio sends the JSON as reasoning and no text.
        .reasoning(Effort::Off)
        .response_format(schema)
        .user(question)
}
```

## Когда сервер его не принимает {/* #when-the-server-does-not-take-it */}

**Формат ответа никогда не отбрасывается.** Без него ответ — не то, о чём
просили, а код, который просил, обращается с ним так, будто это оно. Поэтому
[обработка совместимости](../client/configuration#compatibility-handling),
которая повторяет отвергнутый запрос без `reasoning_effort` и
`stream_options`, формат сохраняет.

Сервер, который формат не принимает, проваливает запрос с
`ErrorKind::Unsupported`, статусом и собственными словами в
`error.server_message()`. Просите формат, который сервер принимает: например,
схему вместо `Json` на LM Studio.

То же верно и для [выбора инструмента](./tools#requiring-or-forbidding-a-call).

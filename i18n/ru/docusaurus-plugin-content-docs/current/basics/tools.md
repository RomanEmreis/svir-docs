---
sidebar_position: 5
title: Инструменты
description: Описание инструментов для модели, ответы на её вызовы и цикл, который возвращает результаты.
---

# Инструменты

Модель может попросить вызвать инструменты, которые вы ей описали. svir даёт
детали: описания, вызовы, сделанные моделью, результаты и реестр, который
запускает ваши обработчики. **Цикл, возвращающий результаты модели, — ваш**:
несколько строк, с ограничением, которое выбираете вы.

## Детали {/* #the-pieces */}

| Тип | Что это |
|---|---|
| `Tool` | Описание для модели: `name`, `description`, `input_schema` (JSON Schema) |
| `ToolCall` | Вызов, сделанный моделью: `id`, `name` и `arguments` — сырая JSON-строка, которую она написала |
| `ToolResult` | Ответ на один вызов: `call_id`, `content` (строка) и `is_error` для неудачного вызова |
| `Toolbox` | Трейт: всё, что перечисляет инструменты и отвечает на вызовы |
| `Tools` | `Toolbox` в виде простого реестра обработчиков |

Запрос принимает описания (`Request::tool`, `Request::tools`), а отвечать на
вызовы остаётся набору инструментов. Само по себе ничего не запускается: svir
выполняет только зарегистрированные вами обработчики и только когда об этом
просит ваш цикл.

## Реестр `Tools` {/* #the-tools-registry */}

```rust
use serde::Deserialize;
use serde_json::json;
use svir::prelude::*;

#[derive(Deserialize)]
struct Lookup {
    id: u64,
}

fn tools() -> Tools {
    let lookup = Tool::new("lookup", "Find an order by its number.").schema(json!({
        "type": "object",
        "properties": {"id": {"type": "integer", "description": "The order number"}},
        "required": ["id"]
    }));
    // A tool that takes no arguments needs no schema.
    let now = Tool::new("now", "The current time, UTC.");

    Tools::new()
        .add_tool(lookup, |args: Lookup| async move { format!("order {} is shipped", args.id) })
        .add_tool(now, |_: serde_json::Value| async { "2026-01-01T00:00:00Z" })
}
```

- `add_tool(tool, handler)` принимает `self` и возвращает его; регистрация —
  это цепочка. Инструмент, добавленный под уже занятым именем, заменяет
  прежний.
- Обработчик — асинхронная функция или замыкание с **одним** аргументом: типом,
  который десериализуется из JSON-объекта, написанного моделью. Несколько
  параметров собираются в одну структуру.
- **Десериализация и есть валидация.** Аргументы, не подходящие под тип, до
  обработчика не доходят: модель получает неудачный результат,
  `invalid arguments: ...`, и может попробовать снова. Отдельного валидатора JSON Schema нет, поэтому
  правило, которое тип не выражает (диапазон, шаблон), проверяется в
  обработчике.
- Схема — для модели, тип — для обработчика. Держите их согласованными или
  выводите одно из другого.
- Состояние кладётся в замыкание: клонируйте в него `Arc`, и ещё раз — в блок
  `async move`.

## Схемы из типов {/* #schemas-from-types */}

С фичей `schemars` метод `Tools::add` выводит схему из типа аргумента, включая
doc-комментарии.

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

#[derive(Deserialize, JsonSchema)]
struct Convert {
    /// The amount to convert.
    amount: f64,
    /// The currency to convert from, as a three-letter code.
    from: String,
    /// The currency to convert to, as a three-letter code.
    to: String,
}

async fn convert(args: Convert) -> String {
    format!("{} {} is about {} {}", args.amount, args.from, args.amount, args.to)
}

fn tools() -> Tools {
    Tools::new().add("convert", "Convert an amount between currencies.", convert)
}
```

Вашему крейту для derive нужен `schemars` версии 1: `JsonSchema` другой
мажорной версии — это другой трейт. `add` и `add_tool` можно смешивать в
одном реестре.

## Что возвращает обработчик {/* #what-a-handler-returns */}

| Тип результата | Что получает модель |
|---|---|
| `String`, `&str` | Текст |
| `serde_json::Value` | Значение, записанное как JSON |
| `Result<T, E>` с `E: Display` | `T`, как выше, или неудачный результат с `E` в содержимом |

Ошибка — тоже результат: `ToolResult::error(call_id, message)`, с флагом
`is_error` и сообщением в содержимом, без добавок. То же относится к
неизвестному имени инструмента и некорректным аргументам. Поэтому возвращайте
`Err` с сообщением, которое стоит прочитать, а не паникуйте: модель прочитает
его и сможет исправиться.

В Chat Completions нет поля, которое помечает неудачный вызов, поэтому
кодировщик отправляет `error: ` перед содержимым: модель читает
`error: no weather station in Atlantis`. Не пишите префикс сами: неудачный
результат, где он уже есть, скажет его дважды.

Всё остальное обработчик превращает в одно из этого сам: сериализуйте
структуру через `serde_json::to_value` или отформатируйте её.

## Цикл {/* #the-loop */}

```rust
use svir::prelude::*;

/// A model that keeps calling tools is stopped after this many answers.
const TURNS: usize = 8;

async fn run(client: &Client, tools: &Tools, mut request: Request) -> Result<Completion, Error> {
    for _ in 0..TURNS {
        let done = client.complete(&request).await?;
        if done.calls.is_empty() {
            return Ok(done);
        }

        let results = tools.call_all(&done.calls).await;
        request = request.assistant(done).tool_results(results);
    }

    Err(Error::new(ErrorKind::Unsupported).with_detail("the model kept calling tools"))
}
```

Переданный запрос уже несёт инструменты (`Request::tools(&tools)`) и
сообщение пользователя. Корректность цикла держится на четырёх вещах:

- **Сначала возвращается реплика ассистента, потом результаты.**
  `request.assistant(done)` несёт вызовы и их ID; каждый результат отвечает на
  один ID. Пропустите что-то одно — и модель увидит результаты вызовов,
  которых не делала; большинство серверов такой запрос отвергнут.
- **Каждый вызов получает результат.** Модель может попросить несколько
  инструментов сразу; `call_all` отвечает на все, по порядку.
- **Проверяйте `calls`, а не `finish`.** Ответ, обрезанный лимитом вывода, —
  это `FinishReason::Length` без вызовов, и он завершает цикл как ответ.
- **Ограничение — ваше.** Модель может вызывать инструменты бесконечно. И что
  делать, упёршись в ограничение, тоже решаете вы.

`call_all` запускает обработчики один за другим. Для медленных и независимых
обработчиков вызовите `tools.call(&call)` для каждого и объедините futures;
сохраняйте результаты в порядке вызовов.

## Цикл с потоком {/* #the-loop-streamed */}

Показывайте текст и вызовы по мере прихода, а выполняйте вызовы только из
итогового ответа.

```rust
use svir::prelude::*;

async fn turn(client: &Client, request: &Request) -> Result<Completion, Error> {
    let mut stream = client.stream(request).await?;

    while let Some(event) = stream.next().await {
        match event? {
            Event::Text(piece) => print!("{piece}"),
            // A piece of a call: a name once, then fragments of the arguments.
            Event::ToolCallDelta(piece) => {
                if let Some(name) = piece.name {
                    eprint!("\ncalling {name} ");
                }
                eprint!("{}", piece.arguments);
            }
            Event::Completed(done) => return Ok(done),
            _ => {}
        }
    }

    Err(Error::new(ErrorKind::TruncatedStream))
}
```

`ToolCallDelta::index` различает куски разных вызовов: они могут
перемежаться. Фрагменты `arguments` — не валидный JSON, пока их не соединят, а
соединять их — работа декодера. **Выполнять вызов инструмента можно только из
`Completion::calls`**: вызовы выдаются после причины завершения и конца
потока и никогда — из оборванного потока.

## Требовать или запрещать вызов {/* #requiring-or-forbidding-a-call */}

По умолчанию модель сама решает, вызывать ли инструмент. `Request::tool_choice`
решает за неё:

| `ToolChoice` | Модель | Отправляется как |
|---|---|---|
| `Auto` | Решает сама. По умолчанию | Ничего |
| `None` | Не может вызвать инструмент | `"none"`; ничего, если запрос не предлагает инструментов |
| `Required` | Должна вызвать хотя бы один из предложенных инструментов | `"required"` |
| `ToolChoice::tool(name)` | Должна вызвать этот инструмент, который запрос предлагает | `{"type": "function", "function": {"name": ...}}` |

```rust
use serde_json::json;
use svir::prelude::*;

fn classify(ticket: &str) -> Request {
    let label = Tool::new("label", "Label a support ticket by its topic.").schema(json!({
        "type": "object",
        "properties": {"topic": {"type": "string", "enum": ["billing", "bug", "other"]}},
        "required": ["topic"]
    }));

    Request::new("qwen3-27b")
        .tool(label)
        // The answer is a call of `label`, not prose.
        .tool_choice(ToolChoice::tool("label"))
        .user(ticket)
}
```

- **Вызов, который сделать нельзя, падает до отправки.** `Required` в
  запросе без инструментов или `ToolChoice::tool(name)` для инструмента,
  которого в запросе нет, — это `ErrorKind::Unsupported`, ещё до чтения
  вложений.
- **Выбор инструмента никогда не отбрасывается.**
  [Обработка совместимости](../client/configuration#compatibility-handling)
  его сохраняет, а сервер, который его не принимает, проваливает запрос с
  `Unsupported` и собственными словами. LM Studio отвергает инструмент,
  названный в выборе; если предложен только этот инструмент, `Required`
  просит того же. vLLM принимает выбор, только если запущен с парсером
  вызовов инструментов (`--enable-auto-tool-choice --tool-call-parser ...`);
  без него запрос с инструментами падает с `400`, если только выбор не
  `None`.
- **Вызов именованного инструмента завершается с `ToolCalls`.** vLLM
  завершает его со `stop`, и, по сообщениям, так же делает OpenAI; svir
  читает вызовы и делает причиной завершения `ToolCalls`, как для `Auto` и
  `Required`.
- **Ответ с выбором не сверяется.** Сервер может принять выбор и не
  выполнить его: LM Studio принимает `Required` и может ответить текстом без
  вызова, llama.cpp не соблюдает именованный инструмент, а mlx-lm выбор
  инструмента не читает вовсе. Что модель вызвала, говорит `done.calls`.
- **В цикле выбор остаётся в запросе.** Модель, обязанная вызывать
  инструмент на каждом ходу, так и не ответит. Когда вызов сделан, верните
  выбор вместе с результатами:
  `request.assistant(done).tool_results(results).tool_choice(ToolChoice::Auto)`.
- `None` оставляет инструменты в запросе и просит ответ без вызова: так
  можно завершить цикл на его пределе.

## Свой набор инструментов {/* #a-toolbox-of-your-own */}

Инструменты с общим состоянием или пришедшие откуда-то ещё (другой процесс,
система плагинов, MCP-сервер) реализуют `Toolbox` напрямую.

```rust
use std::sync::Mutex;

use serde::Deserialize;
use serde_json::json;
use svir::prelude::*;

#[derive(Default)]
struct Notes {
    kept: Mutex<Vec<String>>,
}

#[derive(Deserialize)]
struct Note {
    text: String,
}

impl Toolbox for Notes {
    fn tools(&self) -> Vec<Tool> {
        let note = Tool::new("note", "Keep a note for later.").schema(json!({
            "type": "object",
            "properties": {"text": {"type": "string"}},
            "required": ["text"]
        }));
        let notes = Tool::new("notes", "Read back every note kept so far.");

        vec![note, notes]
    }

    async fn call(&self, call: &ToolCall) -> ToolResult {
        let mut kept = self.kept.lock().unwrap_or_else(|poisoned| poisoned.into_inner());

        let answer = match call.name.as_str() {
            "note" => match call.parse::<Note>() {
                Ok(note) => {
                    kept.push(note.text);
                    Ok("kept".to_owned())
                }
                Err(error) => Err(format!("invalid arguments: {error}")),
            },
            "notes" => Ok(kept.join("\n")),
            other => Err(format!("no tool named {other}")),
        };

        // A failure is a result too: the model reads it and can try again.
        match answer {
            Ok(content) => ToolResult::new(&call.id, content),
            Err(message) => ToolResult::error(&call.id, message),
        }
    }
}
```

- `call` возвращает `ToolResult`, а не ошибку: что пошло не так — это
  `ToolResult::error` для модели.
- Future, который возвращает `call`, должен быть `Send`. `std::sync::MutexGuard`,
  удерживаемый через `.await`, это ломает; берите блокировку после всех
  `.await` или используйте асинхронную блокировку.
- `call_all` идёт вместе с трейтом, а `Request::tools(&notes)` работает для
  любого `Toolbox`.

## Без реестра {/* #without-a-registry */}

`ToolCall::parse::<T>()` десериализует аргументы для кода, который
диспетчеризует вручную:

```rust
use serde::Deserialize;
use svir::prelude::*;

#[derive(Deserialize)]
struct Lookup {
    id: u64,
}

fn answer(call: &ToolCall) -> ToolResult {
    match call.parse::<Lookup>() {
        Ok(args) => ToolResult::new(&call.id, format!("order {} is shipped", args.id)),
        Err(error) => ToolResult::error(&call.id, format!("invalid arguments: {error}")),
    }
}
```

Модель, вызывающая инструмент без аргументов, может прислать пустую строку, а
это не JSON. `Tools` читает её как `{}`; ручная диспетчеризация должна это
учитывать.

## Чего svir не делает {/* #what-svir-does-not-do */}

- **Нет макроса `#[tool]`.** Инструмент — это `Tool` и обработчик.
- **Нет MCP.** В svir нет MCP-клиента. Мост от MCP-инструментов к `Toolbox`
  живёт на стороне MCP, в [neva](https://romanemreis.github.io/neva-docs/);
  любой другой MCP-клиент подключается так же — через
  [свой набор инструментов](#a-toolbox-of-your-own).
- **Ни один инструмент не запускается сам.** Аргументы приходят от модели и
  являются данными. Допустим ли вызов (путь, команда, сумма), проверяет
  обработчик.

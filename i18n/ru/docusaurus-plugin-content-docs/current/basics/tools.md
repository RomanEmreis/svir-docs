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
| `ToolResult` | Ответ на один вызов: `call_id` и `content`, строка |
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
  обработчика не доходят: модель получает `error: invalid arguments: ...` и
  может попробовать снова. Отдельного валидатора JSON Schema нет, поэтому
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
svir = { version = "0.1.2", features = ["schemars"] }
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
| `Result<T, E>` с `E: Display` | `T`, как выше, или `error: <E>` |

Ошибка — тоже результат. Модель читает `error: no weather station in
Atlantis` и может исправиться, поэтому возвращайте `Err` с сообщением, которое
стоит прочитать, а не паникуйте. То же относится к неизвестному имени
инструмента и некорректным аргументам.

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

        let content = match call.name.as_str() {
            "note" => match call.parse::<Note>() {
                Ok(note) => {
                    kept.push(note.text);
                    "kept".to_owned()
                }
                Err(error) => format!("error: invalid arguments: {error}"),
            },
            "notes" => kept.join("\n"),
            other => format!("error: no tool named {other}"),
        };

        ToolResult::new(&call.id, content)
    }
}
```

- `call` возвращает `ToolResult`, а не ошибку: что пошло не так — это
  содержимое для модели.
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
    let content = match call.parse::<Lookup>() {
        Ok(args) => format!("order {} is shipped", args.id),
        Err(error) => format!("error: invalid arguments: {error}"),
    };

    ToolResult::new(&call.id, content)
}
```

Модель, вызывающая инструмент без аргументов, может прислать пустую строку, а
это не JSON. `Tools` читает её как `{}`; ручная диспетчеризация должна это
учитывать.

## Чего svir не делает {/* #what-svir-does-not-do */}

- **Нет макроса `#[tool]`.** Инструмент — это `Tool` и обработчик.
- **Нет `tool_choice`.** svir 0.1 не может заставить модель вызвать
  инструмент или запретить это; решает модель. Если это важно, скажите об этом
  в системном промпте.
- **Нет MCP.** В svir нет MCP-клиента. Мост от MCP-инструментов к `Toolbox`
  живёт на стороне MCP, в [neva](https://romanemreis.github.io/neva-docs/);
  любой другой MCP-клиент подключается так же — через
  [свой набор инструментов](#a-toolbox-of-your-own).
- **Ни один инструмент не запускается сам.** Аргументы приходят от модели и
  являются данными. Допустим ли вызов (путь, команда, сумма), проверяет
  обработчик.

# Tools

Describing tools to a model, answering its calls, and the loop that feeds
the answers back.

## Contents

- [The pieces](#the-pieces)
- [The `Tools` registry](#the-tools-registry)
- [Schemas from types](#schemas-from-types)
- [What a handler returns](#what-a-handler-returns)
- [The loop](#the-loop)
- [The loop, streamed](#the-loop-streamed)
- [A toolbox of one's own](#a-toolbox-of-ones-own)
- [Without a registry](#without-a-registry)
- [What svir does not do](#what-svir-does-not-do)

## The pieces

| Type | Is |
|---|---|
| `Tool` | A description for the model: `name`, `description`, `input_schema` (JSON Schema) |
| `ToolCall` | A call the model made: `id`, `name`, and `arguments` as the raw JSON string it wrote |
| `ToolResult` | The answer to one call: `call_id` and `content`, a string |
| `Toolbox` | A trait: anything that lists tools and answers calls |
| `Tools` | A `Toolbox` that is a plain registry of handlers |

A request takes descriptions (`Request::tool`, `Request::tools`). Answering
calls stays with the toolbox. Nothing runs on its own: svir executes only
handlers the caller registered, and only when the caller's loop asks.

## The `Tools` registry

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

* `add_tool(tool, handler)` takes `self` and returns it; registration is a
  chain.
* A handler is an async closure or function of **one** argument: a type that
  deserializes from the JSON object the model wrote. Several parameters go
  into one struct.
* **Deserializing is the validation.** Arguments that do not fit the type
  never reach the handler: the model is told `error: invalid arguments: ...`
  and can try again. There is no separate JSON Schema validator, so a rule
  the type does not express (a range, a pattern) is checked in the handler.
* The schema is for the model and the type is for the handler. Keep them in
  agreement, or derive one from the other (below).
* A tool added under a name already registered replaces the earlier one.
* State goes into the closure: clone an `Arc` into it and again into the
  `async move` block.

## Schemas from types

With svir's `schemars` feature, `Tools::add` derives the schema from the
argument type, doc comments included.

<!-- snippet: features="schemars" -->
```rust
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

The caller's crate needs `schemars = "1"` for the derive. `add` and
`add_tool` can be mixed in one registry.

## What a handler returns

| Return type | The model receives |
|---|---|
| `String`, `&str` | The text |
| `serde_json::Value` | The value written as JSON |
| `Result<T, E>` with `E: Display` | `T` as above, or `error: <E>` |

A failure is a result too. The model reads `error: no weather station in
Atlantis` and can correct itself, so return `Err` with a message worth
reading, not a panic. The same goes for an unknown tool name and for invalid
arguments.

Anything else is turned into one of these by the handler: serialize a struct
with `serde_json::to_value`, or format it.

## The loop

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

The request passed in already carries the tools (`Request::tools(&tools)`)
and the user's message. Four things keep the loop correct:

* **The assistant turn goes back first, then the results.**
  `request.assistant(done)` carries the calls and their IDs; each result
  answers one ID. Leave either out and the model sees results for calls it
  never made.
* **Every call gets a result.** A model can ask for several tools at once;
  `call_all` answers them all, in order.
* **Test `calls`, not `finish`.** An answer cut off by the output limit is
  `FinishReason::Length` with no calls, and ends the loop as an answer.
* **The bound is yours.** So is what happens at the bound.

`call_all` runs the handlers one after another. For handlers that are slow
and independent, call `tools.call(call)` for each and join the futures; keep
the results in the order of the calls.

## The loop, streamed

Show text and calls as they arrive; run the calls only from the completion.

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

`ToolCallDelta::index` tells pieces of different calls apart; they can
interleave. The fragments of `arguments` are not valid JSON until joined, and
joining them is the decoder's work: use `Completion::calls`.

## A toolbox of one's own

Tools that share state, or that come from somewhere else (another process, a
plugin system), implement `Toolbox` directly.

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

* `call` returns a `ToolResult`, never an error: what went wrong is content
  for the model.
* The future `call` returns must be `Send`. A `std::sync::MutexGuard` held
  across an `.await` breaks that; take the lock after the awaits, or use an
  async lock.
* `call_all` comes with the trait, and `Request::tools(&notes)` works for any
  `Toolbox`.

## Without a registry

`ToolCall::parse::<T>()` deserializes the arguments for code that dispatches
by hand:

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

A model that calls a tool with no arguments may send an empty string, which
is not JSON. `Tools` reads it as `{}`; hand-written dispatch has to allow
for it.

## What svir does not do

* **No `#[tool]` macro.** A tool is a `Tool` and a handler.
* **No `tool_choice`.** svir 0.1 cannot force or forbid a tool call; the
  model decides. Say so in the system prompt if it matters.
* **No MCP.** svir has no MCP client. Tools of an MCP server reach a model
  through a bridge that implements `Toolbox` on the MCP side.
* **No tool runs by itself.** Arguments come from a model and are data.
  Whether a call is allowed (a path, a command, an amount) is for the handler
  to check.

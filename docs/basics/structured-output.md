---
sidebar_position: 6
title: Structured output
description: An answer as JSON, or as JSON that matches a schema, read back into a type.
---

# Structured output

A request can ask for the answer as JSON rather than prose: a JSON object of
any shape, or JSON that matches a schema. The answer arrives as text like any
other, and `Completion::parse` reads it into a type.

```toml title="Cargo.toml"
[dependencies]
svir = { version = "0.1.5", features = ["schemars"] }
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

The schema comes from the type, doc comments included, and parsing the answer
back into the type is the check. Nothing else checks it.

## The formats

| `response_format(..)` | Sent as | The answer |
|---|---|---|
| `ResponseFormat::Text` | Nothing | Text of any shape. The default |
| `ResponseFormat::Json` | `{"type": "json_object"}` | A JSON object of any shape |
| `Schema::new(name, schema)`, `Schema::of::<T>()` | `{"type": "json_schema", ...}` | JSON that matches the schema |

`response_format` takes a `Schema` as it is; `ResponseFormat::Schema(schema)`
is the same thing. A `Text` format is not sent: it is every server's default.

## A schema

`Schema` is a name and a JSON Schema. `Schema::new` takes one written by hand:

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

- **The name** is required by Chat Completions: ASCII letters, digits, `_`,
  and `-`, at most 64 characters. `Schema::of` names the schema after the
  type.
- **`Schema::of::<T>()`** needs svir's `schemars` feature and `schemars = "1"`
  in your crate, as [`Tools::add`](./tools#schemas-from-types) does. The
  schema is the type's, with its doc comments as descriptions.
- Keep the schema and the type that parses the answer in agreement, or derive
  one from the other.

### Strict schemas

`.strict(true)` asks the server to keep to the schema exactly. It is off by
default and sent only when on.

- **OpenAI and Azure OpenAI** guarantee an answer that matches only with a
  strict schema. Without it the schema guides the model and binds nothing.
- A strict schema asks more of the schema on those servers: every object lists
  all of its properties under `required` and sets `additionalProperties:
  false`. A schema derived from a type fits when every struct in it has
  `#[serde(deny_unknown_fields)]` and no `Option` fields; schemars leaves an
  `Option` out of `required`.
- **Local servers** (LM Studio, llama.cpp) constrain sampling to the schema,
  strict or not.

svir does not rewrite a derived schema to fit: rewritten, it would no longer
say what the type says.

## Any JSON object

`ResponseFormat::Json` asks for a JSON object of any shape. Two servers to
know about:

- OpenAI rejects it unless the word "JSON" appears in the messages. Ask for
  JSON in the prompt.
- LM Studio rejects it with a `400`: it takes a schema or text only. Give it a
  schema.

## Reading the answer

`done.parse::<T>()` reads the answer's text into `T` with serde, as
[`ToolCall::parse`](./tools#without-a-registry) reads a call's arguments.

- **Only a whole answer parses**: one that finished with `FinishReason::Stop`.
  Any other finish is an error before the text is read: "the answer is not
  whole: it finished with Length". Valid JSON is not enough: an answer the
  output limit cut off can still be valid, `12` of what would have been
  `123`.
- **The type is the check.** svir does not validate the answer against the
  schema; an answer that does not fit `T` is serde's error. A rule the type
  does not express (a range, a pattern) is checked after parsing.
- The error is a `serde_json::Error`, not an `svir::Error`. Blank lines before
  the JSON, which servers that separate reasoning often send, parse fine.
- To read text that did not finish with `Stop` anyway, call
  `serde_json::from_str(&done.text)` yourself.

Streamed, the JSON arrives as `Event::Text` pieces like any other text, and is
not valid until it is whole. Parse the completion, not the deltas.

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

## Refusals

A model may refuse to answer. OpenAI's models do, above all, when they will not
give an answer in the format asked for. The finish is then `FinishReason::Refusal`,
and the text is the refusal, streamed as `Event::Text`: a chat shows it with no
code of its own. `parse` fails on it, since a refusal does not have the format.
A refusal can come for any request; see
[Reading an answer](./answers#the-completion).

## Reasoning models

`parse` reads the text alone, never the reasoning. LM Studio holds a reasoning
model's reasoning to the schema too: with reasoning on (the effort unset,
`Low`, or `Medium`), the whole JSON arrives as reasoning, the text stays empty,
and `parse` fails. Ask such a server for no reasoning with the format:

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

## When the server does not take it

**A response format is never dropped.** Without it the answer is not what was
asked for, and the code that asked acts on it as if it were. So the
[compatibility handling](../client/configuration#compatibility-handling), which
sends a rejected request again without `reasoning_effort` and
`stream_options`, keeps the format.

A server that does not take a format fails the request with
`ErrorKind::Unsupported`, the status, and its own words in
`error.server_message()`. Ask for a format it takes: a schema in place of
`Json` on LM Studio, for one.

The same holds for a [tool choice](./tools#requiring-or-forbidding-a-call).

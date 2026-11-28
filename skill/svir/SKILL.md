---
name: svir
description: Talk to LLMs from Rust with the svir crate -- whole and streamed answers from OpenAI-compatible servers (LM Studio, llama.cpp, vLLM, mlx-lm, mlx-vlm, hosted endpoints) and from the Anthropic Messages API (Claude, with signed thinking sent back), tool calling and the loop that feeds results back, a tool call required or forbidden, structured output (JSON to a schema, parsed into a type), image and file attachments, reasoning, typed errors, retries and timeouts as layers, relaying a model's event stream through a proxy, and the Chat Completions and Messages codecs on their own. Use whenever Rust code depends on `svir`, whenever the task is to call a model, stream its answer, give it tools, get JSON out of it or relay its stream from Rust through an OpenAI-compatible endpoint or the Anthropic API, when upgrading svir, and when reviewing or debugging such code.
license: MIT OR Apache-2.0
metadata:
  svir-version: "0.2.1"
  msrv: "1.85"
  edition: "2024"
  wire-api: "OpenAI-compatible Chat Completions and Anthropic Messages, streaming"
  api-reference: "https://docs.rs/svir"
  repository: "https://github.com/RomanEmreis/svir"
---

# svir -- talking to LLMs from Rust

`svir` is the wire protocol between an application and a model server: types,
an encoder, a decoder, a transport, and the compatibility handling real
servers need. Layers (middleware) and tool sets sit on top, opt-in. It is
**not** an agent framework: there is no agent loop, no session history, no
storage, and no MCP. Those are a few lines of the caller's code, and this
skill shows them.

**This skill describes svir 0.2, which speaks two wire APIs behind the same
types: OpenAI-compatible Chat Completions and the Anthropic Messages API,
always streamed.** For a project on 0.1, read `references/migration.md`
first. Its shape is unlike the LLM SDKs most
code was written against. The conversation is the request, the system prompt
is a field, the answer is one stream whose last item is the whole answer, and
an error is a kind to match on. Code written from habit -- a `system` role
message, `choices[0].delta.content`, a client that remembers the chat -- does
not compile here, or compiles and loses tool calls. The
[Non-negotiables](#non-negotiables) are the places where that happens. Read
them before writing code.

## Step 1 -- establish the version and the features

```bash
cargo add svir --features tls-ring
cargo add tokio --features macros,rt-multi-thread
```

Without a TLS feature the client speaks plain HTTP only, which is enough for
a server on loopback. A hosted API needs `tls-ring` (or `tls-aws-lc`).

In an existing project, read `Cargo.toml` first:

| What you find | What it means |
|---|---|
| `svir = "0.2"` and no `features` key | The client over plain HTTP: everything here except HTTPS, `Tools::add`, `Schema::of`, and the `Trace` layer |
| `features = ["tls-ring"]` or `["tls-aws-lc"]` | HTTP and HTTPS, with that rustls crypto provider |
| `svir = "0.1"`, `features = ["tls"]`, or a lock file on 0.1.x | An older API: TLS on by default as `tls`, no Messages API, no `parts` or `signature`. Read `references/migration.md` before writing code |
| `features = ["schemars"]` | `Tools::add`, which derives a tool's input schema from its argument type, and `Schema::of`, which derives an answer's schema from a type |
| `features = ["tracing"]` | The `Trace` layer |
| `default-features = false` | Types and the codecs only: no `Client`, no `EventStream`, no layers, no attachments read from disk. Read `references/codec.md` |

What else the caller's crate needs, and when:

| For | Add |
|---|---|
| Any use of `Client` | `tokio` with a runtime; svir's client runs on Tokio |
| Typed tool arguments, `Completion::parse` | `serde` with `derive` |
| A tool schema written by hand | `serde_json` |
| `Tools::add`, `Schema::of` | `schemars = "1"` next to svir's `schemars` feature; another major version's `JsonSchema` is a different trait |
| A custom HTTP backend | `bytes` and `futures-core` |

One more check when the build already has rustls through another crate, such
as reqwest: if that crate uses the aws-lc-rs provider, take svir with
`features = ["tls-aws-lc"]`. With both providers compiled in, rustls has no
default one, and code elsewhere that calls `ClientConfig::builder()` panics
with "no process-level CryptoProvider available". svir itself always passes
its provider explicitly.

## Step 2 -- route to the reference you need

Each file is self-contained; load only what the task calls for.

| The task | Read |
|---|---|
| Building a request: the system prompt, messages, images and text files, reasoning effort, sampling, an answer as JSON to a schema, keeping a conversation | `references/requests.md` |
| Reading an answer: events, the completion and its finish reasons (a refusal among them), reasoning, usage and speed, cancelling, strict and lenient decoding, limits | `references/streaming.md` |
| Tools: describing them, the `Tools` registry, typed arguments, the loop, requiring or forbidding a call, a `Toolbox` of one's own | `references/tools.md` |
| The client: base URL, API keys, a gateway's extra headers, timeouts, retries and other layers, TLS, a custom HTTP backend, listing models, tests without a server | `references/client.md` |
| The Anthropic Messages API: `Client::anthropic()`, `max_tokens`, effort as adaptive thinking, thinking sent back, stop reasons, its errors | `references/anthropic.md` |
| A proxy that relays the stream; svir under another HTTP stack; `Encoder` and `Decoder` alone | `references/codec.md` |
| An error kind, a failure to explain, a compile error on code that "should work" | `references/errors.md` |
| A project on an older svir, or an upgrade | `references/migration.md` |

## A call that works

```rust
use svir::prelude::*;

#[tokio::main]
async fn main() -> Result<(), Error> {
    let client = Client::openai("http://127.0.0.1:1234").build()?;
    let request = Request::new("qwen3-27b")
        .system("Be precise.")
        .user("Why do rivers meander?");

    // The whole answer.
    let answer = client.complete(&request).await?;
    println!("{}", answer.text.trim());

    // The same answer as it arrives.
    let mut stream = client.stream(&request).await?;
    while let Some(event) = stream.next().await {
        match event? {
            Event::Text(piece) => print!("{piece}"),
            Event::Completed(done) => println!("\n{:?}", done.usage),
            _ => {}
        }
    }

    Ok(())
}
```

What this shows and every svir program repeats:

* `Client::openai(url)` returns a builder; `build()` validates the URL and the
  key and returns the client. The URL is the server's base, with or without
  `/v1`.
* The model is the ID the server lists (`client.list_models()`), not a family
  name.
* `complete` and `stream` take the request by reference or by value. The
  client keeps no conversation: the request is the conversation.
* `stream.next()` is a method of `EventStream`; no `StreamExt` import is
  needed.
* The same code talks to the Anthropic Messages API with
  `Client::anthropic()` (and `.base_url(..)` for another server), once every
  request sets `max_tokens`. See `references/anthropic.md`.

## A tool loop that works

```rust
use serde::Deserialize;
use serde_json::json;
use svir::prelude::*;

#[derive(Deserialize)]
struct City {
    city: String,
}

async fn weather(args: City) -> Result<String, String> {
    match args.city.to_lowercase().as_str() {
        "oslo" => Ok("4 C, light snow".to_owned()),
        _ => Err(format!("no weather station in {}", args.city)),
    }
}

async fn answer(client: &Client, question: &str) -> Result<String, Error> {
    let describe = Tool::new("weather", "The weather in a city right now.").schema(json!({
        "type": "object",
        "properties": {"city": {"type": "string"}},
        "required": ["city"]
    }));
    let tools = Tools::new().add_tool(describe, weather);

    let mut request = Request::new("qwen3-27b").tools(&tools).user(question);

    // The loop is the caller's, and so is its bound.
    for _ in 0..8 {
        let done = client.complete(&request).await?;
        if done.calls.is_empty() {
            return Ok(done.text);
        }

        let results = tools.call_all(&done.calls).await;
        request = request.assistant(done).tool_results(results);
    }

    Err(Error::new(ErrorKind::Unsupported).with_detail("the model kept calling tools"))
}
```

`request.assistant(done)` puts the model's answer into the history with its
tool calls, their IDs, and its reasoning; `tool_results` answers each call by
ID. Both are needed, in that order: without them the model sees results for
calls it never made, and most servers reject the request.

A handler's `Err` reaches the model as a failed result,
`ToolResult::error(call_id, message)`: `is_error` is set, Chat Completions
sends it as `error: <message>`, and the Messages API with its own
`is_error`. A `Toolbox` of one's own returns
`ToolResult::error` for a failure too; writing `error: ` into the content by
hand sends the prefix twice, or leaves `is_error` unset.

## Non-negotiables

Each one is a place where habit from another SDK produces code that does not
compile, or compiles and misbehaves.

1. **The system prompt is `Request::system(..)`, not a message.** `Role` is
   `User`, `Assistant`, or `Tool`. There is no system role, because each wire
   API puts the prompt somewhere else.

2. **`Event::Completed` is the last item and carries the whole answer.** Text,
   reasoning, tool calls, usage, and timing are all in its `Completion`. Do
   not assemble the answer from deltas; deltas are for display.

3. **A tool call is executable only from `Completion::calls`.**
   `Event::ToolCallDelta` is a piece of a call for display. Its arguments are
   incomplete JSON until the stream ends, and a stream cut short never
   produces a completion at all. With a `Length` finish `calls` is empty:
   the output limit may have cut any call short, so the calls it began are
   in `Completion::cut_calls`, for display and records, never to run.

4. **The builder consumes the request.** `request.user(..)`, `.assistant(..)`,
   and `.tool_results(..)` take `self` and return it, so a conversation is
   `request = request.user(line);`. Calling them and dropping the result
   changes nothing.

5. **Put the `Completion` itself back into the history**, with
   `request.assistant(done)` or `Message::from(done)`. Rebuilding the
   assistant turn from `done.text` loses the tool calls and their IDs, and,
   from the Messages API, its signed thinking blocks and their order, which
   the API checks: it rejects the conversation.

6. **There is no agent loop.** Feeding tool results back is the caller's
   loop, as above. Bound it: a model can call tools forever. A
   `tool_choice` that requires a call stays on the request every turn, so
   set it back to `ToolChoice::Auto` with the results, or the model never
   gets to answer.

7. **Dropping the stream cancels the request** and closes the connection.
   There is nothing to call. Conversely, a stream dropped early generated
   tokens nobody read.

8. **Errors are kinds, not strings.** Match on `error.kind()`, with a wildcard
   arm (`ErrorKind` is `#[non_exhaustive]`). The server's own words are in
   `error.server_message()`, deliberately absent from `Display` and `Debug`:
   show them to a person, do not log them. See `references/errors.md`.

9. **Nothing is retried unless asked.** Retries are the opt-in `Retry` layer,
   and nothing is ever retried once the answer has started. Do not wrap
   `stream` in a retry loop that re-reads a half-delivered answer.

10. **svir reads no environment variables on its own.** A key comes from
    `.api_key(..)`, `.api_key_env("NAME")`, or `.api_key_file(path)`, all
    explicit. Plain HTTP is accepted for loopback only; any other host needs
    `https://` or `.allow_http()`. A header a gateway asks for is
    `.header(name, value)`, never the Bearer key: `authorization` there is a
    `Config` error. `https://` needs a TLS feature (`tls-ring`), off by
    default.

11. **Decoding is strict by default.** A field svir does not know is an
    error, not a guess. `.lenient()` on the builder skips unknown input; use
    it for a server with extensions, not to hide a failure you have not read.

12. **Public data types are `#[non_exhaustive]`.** Build them with their
    constructors (`Request::new`, `Tool::new`, `ToolResult::new`,
    `ToolResult::error`), not struct literals, and match enums with a
    wildcard arm.

13. **The text is what the server sent.** A server that separates reasoning
    often starts the answer with blank lines. Trim for display; store as is.
    A server without a reasoning parser can leave the reasoning in the text,
    ending in a lone `</think>` svir does not split: turn the parser on.

14. **Read a structured answer with `done.parse::<T>()`**, not
    `serde_json::from_str(&done.text)`. `parse` refuses an answer that did
    not finish with `Stop` -- cut off, refused, filtered -- which can still
    be valid JSON. Nothing validates the answer against the schema: the type
    is the check. A refusal is `FinishReason::Refusal`, with the refusal as
    the text.

15. **A Messages request needs `max_tokens`.** Without it the request is
    `Unsupported` before anything is sent. `Effort::Minimal` and
    `ResponseFormat::Json` have no Messages layout and are `Unsupported`
    too; hosted Claude models reject `temperature`.

## Verify before you claim it works

```bash
cargo check
```

`cargo check` catches the API mistakes. It cannot tell whether the server
accepts the request, so run the code against one. Any OpenAI-compatible
server will do; LM Studio listens on `http://127.0.0.1:1234` by default:

```rust
use svir::prelude::*;

#[tokio::main]
async fn main() -> Result<(), Error> {
    let client = Client::openai("http://127.0.0.1:1234").build()?;

    for model in client.list_models().await? {
        println!("{}", model.id);
    }

    Ok(())
}
```

Two mistakes compile cleanly and fail only against a server: a model ID the
server does not have, and a tool round trip that leaves out the assistant
turn or a result. Tool calling and images also depend on the model itself;
a model without them ignores tools or fails.

Tests must not depend on a live model. A scripted `http::Backend` answers
without a server; `references/client.md` has one.

## Conventions worth keeping

* `use svir::prelude::*;` is the intended import. Layers are in
  `svir::layer`, the codecs in `svir::openai::chat` and
  `svir::anthropic::messages`, the HTTP seam in `svir::http`.
* Build one `Client` and clone it; clones share the connection pool and what
  was learned about the server.
* Return `svir::Error` or convert it; keep the kind. `error.is_retryable()`
  says whether the same request can succeed later.
* Reasoning goes to the user as reasoning, never as the answer. It arrives as
  `Event::Reasoning` and stays in `Completion::reasoning`.
* Do not write the JSON body, SSE parsing, or `Authorization` header by hand.
  If svir cannot express something, say so; `Encoder` and `Decoder` are
  public for a transport of one's own.

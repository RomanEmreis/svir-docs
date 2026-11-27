# The Anthropic Messages API

`Client::anthropic()` (svir 0.2) talks to the Anthropic Messages API, behind
the same `Request`, `Event`, and `Completion` as Chat Completions. Code
written for one runs against the other with another constructor and a
`max_tokens` on every request. Everything else in the other references
holds, with the differences below.

## Contents

- [A call](#a-call)
- [The client](#the-client)
- [What a request says](#what-a-request-says)
- [Thinking, and sending it back](#thinking-and-sending-it-back)
- [The answer](#the-answer)
- [Errors](#errors)
- [Compatible servers](#compatible-servers)

## A call

```rust
use svir::prelude::*;

async fn ask() -> Result<(), Error> {
    let client = Client::anthropic().api_key_env("ANTHROPIC_API_KEY").build()?;
    let request = Request::new("claude-opus-5-5")
        .max_tokens(16_000)
        .reasoning(Effort::High)
        .user("Why do rivers meander?");

    let mut stream = client.stream(&request).await?;
    while let Some(event) = stream.next().await {
        match event? {
            Event::Reasoning(piece) => eprint!("{}", piece.text),
            Event::Text(piece) => print!("{piece}"),
            Event::Completed(done) => println!("\n{:?}", done.usage),
            _ => {}
        }
    }

    Ok(())
}
```

The hosted API is HTTPS: the crate needs `features = ["tls-ring"]` or
`["tls-aws-lc"]`, or `build()` fails with `Config`.

## The client

| | |
|---|---|
| Server | `https://api.anthropic.com`; `.base_url(url)` for another server with a Messages endpoint |
| API version | `anthropic-version: 2026-10-21`, written by svir; `.header(..)` cannot set it |
| Key | `api_key`, `api_key_env`, `api_key_file`, sent as `Authorization: Bearer`. A gateway that reads `x-api-key`: `.header("x-api-key", key)` |
| Compatibility handling | None: each request is sent once |
| Model listing | Every page of `GET /v1/models`; `name` is the model's `display_name` |

```rust
use svir::prelude::*;

fn local() -> Result<Client, Error> {
    // LM Studio serves the Messages API next to Chat Completions.
    Client::anthropic().base_url("http://127.0.0.1:1234").build()
}
```

## What a request says

| | Messages API |
|---|---|
| `max_tokens` | **Required.** A request without it is `Unsupported` before anything is sent |
| `system(..)` | The top-level `system` field |
| Parts | Each a block of its own, in the order given: text, an image as base64, a text file as text wrapped with its name |
| Tool results | A user message of `tool_result` blocks, with `is_error` for a failed one; no `error: ` prefix |
| `reasoning(effort)` | `Low` to `Max`: adaptive thinking, shown as a summary, at that `output_config.effort`. `Off`: thinking turned off. `Minimal`: `Unsupported` |
| `tool_choice(..)` | `{type: "none"}`, `{type: "any"}` for `Required`, `{type: "tool", name}`. The newest models reject `any` and a named tool with 400 |
| `response_format(..)` | A schema only, in `output_config.format`; `ResponseFormat::Json` is `Unsupported` |
| `temperature(..)` | Sent as set; hosted models reject it with 400 on API version `2026-10-21` |
| `send_reasoning(..)`, `include_usage(..)` | Not read: thinking always goes back, usage is always reported |

Messages of one role in a row are joined into one, as a tool message and the
user message after it are.

## Thinking, and sending it back

A thinking block streams as `Event::Reasoning` with
`ReasoningSource::Thinking`, and is kept in `Completion::reasoning` with its
`signature`. A redacted block is kept with no text and its data as the
signature, and emits no event. With an `Effort` level set, svir asks for a
summary, so there is text to show.

The answer goes back block for block: `Completion::parts` keeps the order,
and `request.assistant(done)` uses it. A tool loop needs nothing more:

```rust
use svir::prelude::*;

async fn answer(client: &Client, tools: &Tools, mut request: Request) -> Result<Completion, Error> {
    for _ in 0..8 {
        let done = client.complete(&request).await?;
        if done.calls.is_empty() {
            return Ok(done);
        }

        let results = tools.call_all(&done.calls).await;
        // The text, the thinking blocks with their signatures, and the calls, as they came.
        request = request.assistant(done).tool_results(results);
    }

    Err(Error::new(ErrorKind::Unsupported).with_detail("the model kept calling tools"))
}
```

* **Never rebuild a model turn by hand** with `Message::assistant(text)` or by
  copying parts: the newest models reject a conversation whose thinking
  blocks were reordered, edited, or dropped, or whose earlier messages
  changed ("Invalid signature in thinking block"). Keep the history
  append-only.
* Reasoning from Chat Completions or from `<think>` tags is never sent to the
  Messages API; a conversation can move between the two APIs without it.

## The answer

| Stop reason | `FinishReason` |
|---|---|
| `end_turn`, `stop_sequence` | `Stop` |
| `tool_use` | `ToolCalls` |
| `max_tokens`, `model_context_window_exceeded` | `Length` |
| `refusal` | `Refusal`, with the text that streamed before it kept |
| `pause_turn`, or an unknown one | `Unsupported` |

`Usage::input` counts the whole prompt, cache reads and writes included;
`output` is the running total, `reasoning` the thinking tokens when reported.
Unknown event types and added fields are skipped in both modes; an unknown
block or delta type is `Unsupported` in strict mode.

## Errors

| The API says | `ErrorKind` |
|---|---|
| `529`, `overloaded_error` | `Transport`, retryable |
| `400`, "prompt is too long" | `ContextOverflow` |
| `400` for a field the model does not take | `Unsupported`, the API's words in `server_message()` |
| An `error` event after the stream began | `Server`, or `ContextOverflow` when it says so |

## Compatible servers

LM Studio serves `/v1/messages`. With a model whose format it parses
(Qwen3.8), it streams thinking, text, and tool calls as blocks, and takes a
thinking block back without a signature. It ignores a named tool choice and
a response format there. With a model whose format it does not parse, the
reasoning, the model's markers, and its tool calls arrive as plain text.

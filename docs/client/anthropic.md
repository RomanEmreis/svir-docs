---
sidebar_position: 2
title: Anthropic Messages
description: Client::anthropic(), and what differs from Chat Completions - max_tokens, effort as adaptive thinking, and signed thinking sent back.
---

# Anthropic Messages

`Client::anthropic()` talks to the Anthropic Messages API, behind the same
`Request`, `Event`, and `Completion` as Chat Completions. A program written for
one runs against the other with another constructor and a `max_tokens` on every
request.

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

The hosted API is HTTPS: the build needs a TLS feature, `tls-ring` or
`tls-aws-lc`; see [Features and TLS](./features).

## The client

| | |
|---|---|
| Server | `https://api.anthropic.com`. `.base_url(url)` points the client at another server with a Messages endpoint |
| API version | `anthropic-version: 2026-10-21`, which svir writes; `.header(..)` cannot set it |
| Key | `api_key`, `api_key_env`, or `api_key_file`, sent as `Authorization: Bearer`. A gateway that reads `x-api-key` gets it with `.header("x-api-key", key)`, withheld like any header |
| Compatibility handling | None: each request is sent once |
| Model listing | Every page of `GET /v1/models`; a model's `display_name` is its `name` |

Everything else on [Configuration](./configuration), timeouts, layers, limits,
and strictness, holds as it is.

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
| `max_tokens` | Required: a request without it is `Unsupported` before anything is sent |
| `system(..)` | The top-level `system` field |
| Parts | Each a block of its own, in the order given: text, an image as base64, a text file as text wrapped with its name |
| Tool results | A user message of `tool_result` blocks, with `is_error` for a failed one |
| `reasoning(effort)` | Adaptive thinking, shown as a summary, at that effort; `Off` turns thinking off, `Minimal` is `Unsupported`. See [reasoning effort](../basics/requests#reasoning-effort) |
| `tool_choice(..)` | `none`, `any` for `Required`, or one tool by name. See [Tools](../basics/tools#requiring-or-forbidding-a-call) |
| `response_format(..)` | A schema only, in `output_config.format`. See [Structured output](../basics/structured-output) |
| `temperature(..)` | Sent as set. API version `2026-10-21` rejects it on hosted models; a compatible server may take it |

Messages of one role in a row are joined into one, as a tool message and the
user message after it are.

## Thinking

A thinking block streams as `Event::Reasoning` with the source
`ReasoningSource::Thinking`, and is kept in the completion with its
`signature`. A redacted block is kept too, with no text and its encrypted data
as the signature, and shows nothing. With an `Effort` level set, svir asks for
a summary of the thinking, so there is text to show; with none, some models
send thinking blocks with empty text.

Both go back to the server as they came, in their place among the text and the
calls: `Completion::parts` keeps the order, and `request.assistant(done)` uses
it. That is all a tool loop with thinking needs:

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

- Thinking blocks always go back, whatever `send_reasoning` says. The API asks
  for them, and drops without billing what the current model cannot read.
- **Do not rebuild a model turn by hand.** The newest models reject a
  conversation whose thinking blocks were reordered, edited, or dropped, or
  whose earlier messages changed after they were written.
- Reasoning from Chat Completions, or split out of `<think>` tags, is never
  sent to the Messages API.

## The answer

| Stop reason | `FinishReason` |
|---|---|
| `end_turn`, `stop_sequence` | `Stop` |
| `tool_use` | `ToolCalls` |
| `max_tokens`, `model_context_window_exceeded` | `Length` |
| `refusal` | `Refusal`, with the text that streamed before it kept |
| `pause_turn`, or one svir does not know | `Unsupported` |

`Usage::input` counts the whole prompt, the tokens the cache read and wrote
included; `output` is the API's running total, and `reasoning` its thinking
tokens when it reports them. The rest of [Reading an answer](../basics/answers)
holds as it is.

## Errors

| The API says | `ErrorKind` |
|---|---|
| `529`, `overloaded_error` | `Transport`, retryable |
| `400`, "prompt is too long" | `ContextOverflow` |
| `400` for a field the model does not take: `temperature`, thinking turned off, a forced tool on the newest models | `Unsupported`, with the API's words in `server_message()` |
| An `error` event after the stream began | `Server`, or `ContextOverflow` when it says so |

The others map as for any server; see [Errors](../errors).

## Compatible servers

A server with a Messages endpoint takes the same client with `base_url`. What
LM Studio does there, as observed:

- With a model whose format it parses, such as Qwen3.8, it streams thinking,
  text, and tool calls as blocks, and takes a thinking block back without a
  signature, so a tool loop completes.
- It ignores a named tool choice and a response format there: the model
  answers as it likes.
- With a model whose format it does not parse, the reasoning, the model's
  markers, and its tool calls arrive as plain text, on Chat Completions as
  well.

The facts behind this page, from the API's reference and from live runs, are
in the svir repository's
[wire protocol notes](https://github.com/RomanEmreis/svir/blob/main/docs/wire-protocol-anthropic.md).

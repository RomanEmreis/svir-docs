---
sidebar_position: 3
title: Reading an answer
description: Whole or streamed answers, events, the completion, reasoning, usage, and cancelling.
---

# Reading an answer

Every answer is streamed on the wire. You choose whether to read it as it
arrives or wait for the end.

| Call | Returns | Use when |
|---|---|---|
| `client.complete(&request).await?` | `Completion` | Only the finished answer matters |
| `client.stream(&request).await?` | `EventStream` | Text is shown as it arrives |
| `stream.completion().await?` | `Completion` | A stream was opened, and the rest of it is not shown |

`complete` is `stream` followed by `completion`. `stream` resolves when the
response **starts**, which for a local model can be long after the call: the
model reads the whole prompt first.

`complete` and `stream` take the request by reference or by value.

## Events

`EventStream::next()` yields `Option<Result<Event, Error>>`. It is a method of
the stream itself, so no `StreamExt` import is needed.

| Event | Carries | Meaning |
|---|---|---|
| `Event::Text(String)` | A piece of the answer | Show it |
| `Event::Reasoning(Reasoning)` | `source`, `text` | A piece of the model's reasoning; show it apart from the answer |
| `Event::ToolCallDelta(ToolCallDelta)` | `index`, `id`, `name`, `arguments` | A piece of a tool call, for display only |
| `Event::Completed(Completion)` | The whole answer | Always the last item |

After `Completed`, or after an `Err`, `next()` returns `None`. `Event` is
`#[non_exhaustive]`: end every `match` with `_ => {}`.

## Show the deltas, keep the completion

The completion already holds the whole answer, with its tool calls and usage.
Use the deltas for display and keep what `Completed` carries; never rebuild the
answer from the pieces.

```rust
use std::io::Write;

use svir::prelude::*;

async fn show(client: &Client, request: &Request) -> Result<Completion, Error> {
    let mut stream = client.stream(request).await?;

    while let Some(event) = stream.next().await {
        match event? {
            Event::Text(piece) => {
                print!("{piece}");
                let _ = std::io::stdout().flush();
            }
            Event::Reasoning(piece) => eprint!("{}", piece.text),
            Event::Completed(done) => return Ok(done),
            _ => {}
        }
    }

    // Unreachable in practice: a stream ends with `Completed` or with an error.
    Err(Error::new(ErrorKind::TruncatedStream))
}
```

`EventStream` is `Send + Unpin + 'static` and owns everything it needs, so it
can be moved into a task or kept in a struct. It also implements
`futures_core::Stream`, for code that wants combinators.

## The completion

| Field | Type | Holds |
|---|---|---|
| `finish` | `FinishReason` | `Stop`, `ToolCalls`, `Length`, or `ContentFilter` |
| `text` | `String` | The answer, exactly as sent |
| `reasoning` | `Vec<Reasoning>` | Reasoning, one entry per source |
| `calls` | `Vec<ToolCall>` | Complete tool calls, in order |
| `usage` | `Option<Usage>` | Token counts, when the server reported them |
| `timing` | `Option<Timing>` | When the first and last visible tokens arrived |

Act on `finish`:

```rust
use svir::prelude::*;

fn describe(done: &Completion) -> &'static str {
    match done.finish {
        FinishReason::Stop => "the answer is complete",
        // Run the tools in `done.calls` and ask again; see Tools.
        FinishReason::ToolCalls => "the model is waiting for tool results",
        // The output limit cut it off. With a reasoning model the text can be
        // empty: the reasoning used the budget. Raise `max_tokens`.
        FinishReason::Length => "the answer was cut off",
        // The server's content filter stopped it, or flagged it after it was
        // streamed. `done.text` holds what was sent, which may be what was
        // flagged: withdraw what the user was shown.
        FinishReason::ContentFilter => "the answer was filtered",
        _ => "a finish reason this code does not know yet",
    }
}
```

A `ContentFilter` finish can come after the whole answer. Azure OpenAI's
asynchronous content filter streams the answer before vetting it and reports a
block afterwards, even after the model's own `stop`; svir makes that the
finish. Text before a block may hold what was blocked in Azure's default mode
too. So code that shows the deltas as they arrive takes the text down on this
finish, rather than leaving it up with a note.

The text is what the server sent. A server that separates reasoning often
starts the answer with blank lines: trim for display, store as is.

## Reasoning

Servers carry reasoning in three ways, and svir reads all of them into
`Reasoning { source, text }`:

| `ReasoningSource` | Where it was |
|---|---|
| `ReasoningContent` | The `reasoning_content` field |
| `Reasoning` | The `reasoning` field |
| `Think` | `<think>...</think>` inside the answer text |

Inline `<think>` tags are split out of the text by default, so reasoning is not
shown as the answer even when the server has no reasoning parser. A tag cut in
half by a chunk boundary is held back until the next chunk decides it.
`.think(Think::Keep)` on the client builder leaves the tags in the text.

`Completion::reasoning` has one entry per source, in order of first
appearance, with the pieces joined. Reasoning goes to the user as reasoning,
never as the answer.

## Usage and speed

```rust
use svir::prelude::*;

fn report(done: &Completion) {
    if let Some(usage) = done.usage {
        println!("{} tokens in, {} out", usage.input, usage.output);

        if let Some(reasoning) = usage.reasoning {
            println!("{reasoning} of them reasoning");
        }
    }
    if let Some(rate) = done.tokens_per_second() {
        println!("{rate:.1} tokens per second");
    }
}
```

- Usage is asked for by default. A server that does not report it leaves
  `usage` as `None`; the answer is still complete. Never `unwrap` it.
- `usage.total` and `usage.reasoning` are present only when the server sent
  them. svir reports what the server said; estimates are yours.
- `tokens_per_second()` runs from the first visible token to the last, so the
  wait before the first token does not drag it down. It is `None` for a single
  token or a window under 50 ms: there is no honest rate then.
- `timing.first_token` is measured from the start of the response, not from
  the call. Time the call yourself for time to first token as a user feels it.

## Cancelling and deadlines

Dropping the stream cancels the request and closes the connection. There is
nothing to call. A cancellation token, a client that disconnected, a
`select!` that moved on: all of them cancel by dropping.

```rust
use std::time::Duration;

use svir::prelude::*;

async fn bounded(client: &Client, request: &Request) -> Result<Completion, Error> {
    let answer = tokio::time::timeout(Duration::from_secs(60), client.complete(request));

    match answer.await {
        Ok(result) => result,
        // The future was dropped, and the request with it.
        Err(_) => Err(Error::new(ErrorKind::Timeout).with_detail("no answer in 60 seconds")),
    }
}
```

Conversely, a stream dropped early generated tokens nobody read.

For deadlines on every call of a client (time to first token, silence, the
whole answer), use the [`Timeout` layer](../client/layers). The client has one
deadline built in: a server that sends nothing for 5 minutes fails the call.

## When the stream fails

An error is the last item of the stream. What arrived before it is a partial
answer: fine to have shown, wrong to treat as complete, and its tool calls must
not be run. A stream cut short never produces a completion at all.

| Kind | What happened |
|---|---|
| `TruncatedStream` | The connection closed before the answer finished |
| `Timeout` | The server went silent, or a deadline passed |
| `Server` | The server reported a failure inside the stream |
| `ContextOverflow` | The server said, inside the stream, that the request does not fit |
| `Protocol`, `Unsupported` | The stream is malformed, or uses something svir does not read |
| `ResponseLimit` | A [limit](../advanced/strictness#limits) was reached |

svir retries none of this, and the `Retry` layer leaves a started answer
alone: the user has already seen part of it. Sending the request again is the
application's call. See [Errors](../errors).

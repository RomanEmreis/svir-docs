---
sidebar_position: 5
title: Errors
description: One error type, a kind to act on, and the server's own message kept out of logs.
---

# Errors

Every fallible call returns `svir::Error`: one type, with a **kind** to act on.
Match on the kind, never on the text.

| Accessor | Gives |
|---|---|
| `kind()` | An `ErrorKind`: what went wrong, in terms code can act on |
| `is_retryable()` | Whether the same request can succeed later |
| `retry_after()` | How long the server asked to wait, if it said (capped at 30 s) |
| `is_unsent()` | The request never reached the server: the connection could not be made |
| `status()` | The HTTP status of a response that was not a success; `None` for any other failure |
| `detail()` | A short description written by svir |
| `server_message()` | The server's own words, if it sent any |
| `source()` | The underlying error, through `std::error::Error` |

`Display` is the kind's description and the detail. It never contains the API
key, the request URL, headers, or the server's message, so it is safe to log.

## Kinds

| Kind | Retryable | Raised for | What to do |
|---|---|---|---|
| `Transport` | yes | The server could not be reached; HTTP 500, 502, 503 | Check that the server runs; retry with backoff |
| `Timeout` | yes | A connect, idle, or layer deadline passed; HTTP 408, 504 | Retry, or raise the deadline for a slow local model |
| `RateLimited` | yes | HTTP 429 | Wait `retry_after()` if present, then retry |
| `TruncatedStream` | yes | The stream ended before the answer was complete | Send the request again if the partial answer can be discarded |
| `Authentication` | no | HTTP 401, 403 | Fix the key |
| `ContextOverflow` | no | The request does not fit in the model's context | Shorten the conversation, or drop attachments |
| `ContentFilter` | no | The server's content filter blocked the prompt | Change the prompt: the same one is blocked again, and billed again |
| `Server` | no | The server reported a failure inside the stream | Read `server_message()`; the server's logs say more |
| `Protocol` | no | A malformed or inconsistent response | Report it, with the raw stream |
| `Unsupported` | no | Something svir cannot represent; an unexpected status; a response that is not an event stream | See [Troubleshooting](./troubleshooting) |
| `ResponseLimit` | no | The response passed a configured [limit](./advanced/strictness#limits) | Raise `Limits` on purpose |
| `Attachment` | no | A file could not be read, is not what it claims, or changed | Fix the file or its media type |
| `Config` | no | The URL, the key source, or a header is not acceptable | Fix the builder call |

`ErrorKind` is `#[non_exhaustive]`: a `match` needs a wildcard arm. A context
overflow is recognized by the error's code, type, or message, whether the
server says it in an error response or inside a `200` stream. A blocked
prompt is recognized by the error's code alone, `content_filter`, as Azure
OpenAI sends it with a `400`. An answer the filter stops is not an error but
[`FinishReason::ContentFilter`](./basics/answers#the-completion).

## Handling them

```rust
use std::time::Duration;

use svir::prelude::*;

enum Next {
    Answer(Completion),
    RetryAfter(Duration),
    Shorten,
    GiveUp(String),
}

async fn ask(client: &Client, request: &Request) -> Next {
    let error = match client.complete(request).await {
        Ok(done) => return Next::Answer(done),
        Err(error) => error,
    };

    match error.kind() {
        ErrorKind::ContextOverflow => Next::Shorten,
        ErrorKind::RateLimited => {
            Next::RetryAfter(error.retry_after().unwrap_or(Duration::from_secs(5)))
        }
        _ if error.is_retryable() => Next::RetryAfter(Duration::from_secs(1)),
        // `Display` is safe to log and to show.
        _ => Next::GiveUp(error.to_string()),
    }
}
```

- Match on the kind, never on the text of `Display` or `detail()`: the text can
  change between releases, the kinds are part of the API.
- `complete` either returns the whole answer or an error, so a retry there is
  clean. With `stream`, a failure after the first event means the user has
  seen part of an answer: retrying is a product decision, not a default.
- For retries before the response starts, prefer the
  [`Retry` layer](./client/layers#retry) to a hand-written loop.
- Return `svir::Error` from your functions, or convert it and keep the kind.

## The server's own message

`error.server_message()` is what the server said: an `error.message` from a
JSON body, a plain-text body, or a message inside the stream, cut to 4 KiB.

It is kept out of `Display` and `Debug` on purpose. A server's message can
quote the prompt, a file name, or an internal address, and those do not belong
in logs. Show it to the person who made the request; log `error.to_string()`.

```rust
use svir::prelude::*;

fn explain(error: &Error) -> String {
    match error.server_message() {
        Some(said) => format!("{error} (the server said: {said})"),
        None => error.to_string(),
    }
}
```

## Errors of your own

Code around svir, such as a tool loop or a layer, can fail with an svir
`Error` of its own, built from a kind and a detail:

```rust
use svir::prelude::*;

fn gave_up() -> Error {
    Error::new(ErrorKind::Unsupported).with_detail("the model kept calling tools")
}
```

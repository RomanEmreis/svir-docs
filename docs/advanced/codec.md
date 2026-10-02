---
sidebar_position: 3
title: The codec alone
description: Encoder and Decoder without the svir client, for a transport of your own.
---

# The codec alone

`Encoder` and `Decoder` are what the client is built from, and they are
public. With `default-features = false`, svir is only the types and the codec:
no client, no hyper, no Tokio.

```toml title="Cargo.toml"
[dependencies]
svir = { version = "0.1.2", default-features = false }
```

If the only reason is a different HTTP client, a
[custom backend](../client/custom-backend) is less work: it keeps the status
mapping, the timeouts, the compatibility handling, and layers.

## The decoder

`Decoder` is push-based and does no I/O: bytes in, events out. It reads a
stream it owns as well as one being forwarded elsewhere.

```rust
use svir::openai::chat::Decoder;
use svir::prelude::*;

const RESPONSE: &str = concat!(
    "data: {\"choices\":[{\"index\":0,\"delta\":{\"content\":\"Hello\"},\"finish_reason\":null}]}\n\n",
    "data: {\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":\"stop\"}]}\n\n",
    "data: [DONE]\n\n",
);

fn decode() -> Result<Option<Completion>, Error> {
    let mut decoder = Decoder::strict();
    let mut answer = None;

    // The pieces can be cut anywhere: inside a line, a string, a character.
    for piece in RESPONSE.as_bytes().chunks(7) {
        for event in decoder.push(piece) {
            if let Event::Completed(done) = event? {
                answer = Some(done);
            }
        }
    }
    decoder.finish()?;

    Ok(answer)
}
```

| Call | Does |
|---|---|
| `Decoder::strict()` / `Decoder::lenient()` / `Decoder::new(mode)` | A decoder for one response |
| `.limits(limits)` / `.think(think)` | Set before the first `push` |
| `push(&bytes)` | Returns what these bytes complete, as `Vec<Result<Event, Error>>` in wire order |
| `is_done()` | Whether the stream completed or failed |
| `finish()` | Ends the input; a stream that never completed is `TruncatedStream` |

Rules the decoder keeps, and code around it can rely on:

- At most one item of a `push` is an error, and it is the last. After
  `Event::Completed` or an error, `push` returns nothing.
- **The outcome does not depend on how the bytes were cut.** The same response
  read byte by byte or in one piece gives the same events.
- One decoder reads one response. Make a new one for the next.
- `finish` reports truncation once; after an error already returned by `push`
  it is `Ok`.
- `Completion::timing` counts from the moment the decoder was created, so
  create it when the response starts.

## The encoder

`Encoder` turns a `Request` into a `Body` whose exact length is known before
its first byte.

```rust
use svir::openai::chat::Encoder;
use svir::prelude::*;

fn encode(request: &Request) -> Result<(u64, bytes::Bytes), Error> {
    let body = Encoder::new().include_usage(true).encode(request)?;
    let length = body.len();

    // `into_bytes` works when no attachment is a file path.
    Ok((length, body.into_bytes()?))
}
```

| Call | Does |
|---|---|
| `Encoder::new()` | Sends what the request sets and nothing else |
| `.include_usage(bool)` | Asks for token counts when the request does not say. Off here; the client turns it on |
| `.lean(bool)` | Leaves out `reasoning_effort` and `stream_options`, for a server known to reject them |
| `.context_tokens(n)` | Fails with `ContextOverflow` when the body length plus `max_tokens` does not fit |
| `encode(&request)` | No I/O. An attachment held as a file path is `ErrorKind::Attachment` |
| `encode_files(&request).await` | Feature `client`. Measures file attachments first, so that the length is exact |
| `body.len()` | The `Content-Length` to send |
| `body.into_bytes()` | The whole body, when every attachment is in memory |
| `body.into_stream()` | Feature `client`. The body in blocks; files are read as it is polled |

The body always says `"stream": true`: svir has no decoder for a response that
is not a stream.

## A transport of your own

Without the client, the transport has to do what the client does:

1. `POST {base}/v1/chat/completions` with `content-type: application/json`,
   `accept: text/event-stream`, the `Authorization` header if there is a key,
   and `Content-Length` from `body.len()`.
2. Treat any status other than success as an error before decoding. svir's
   mapping of statuses to `ErrorKind` lives in the client and is not part of
   the codec; with a transport of your own, the mapping is yours.
3. Require `content-type: text/event-stream` on a success. Anything else is not
   an answer stream.
4. Feed the body to a `Decoder` as it arrives, and call `finish` at the end.
5. Stop reading once `Event::Completed` arrives.

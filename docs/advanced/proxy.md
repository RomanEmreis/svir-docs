---
sidebar_position: 2
title: Relaying through a proxy
description: Pass a model server's event stream on unchanged, and read it on the way past.
---

# Relaying through a proxy

A chat backend often sits between a browser and a model server. The browser
should get the server's event stream unchanged, and the backend wants the
finished answer to store. `client.send` gives the bytes; a `Decoder` reads
them on the way past.

| The job | Use |
|---|---|
| Call a model and read the answer | `Client::stream` or `complete`. Not this page |
| Relay the server's bytes to someone else, and also know what was said | `Client::send` and a `Decoder` |
| Another HTTP client, with svir's timeouts, status mapping, and layers | A [custom backend](../client/custom-backend) |
| No svir transport at all | [The codec alone](./codec) |

## The relay

```rust
use bytes::Bytes;
use svir::openai::chat::Decoder;
use svir::prelude::*;

/// Relays the answer through `forward`, and returns it once it is complete.
async fn relay(
    client: &Client,
    request: &Request,
    mut forward: impl FnMut(Bytes),
) -> Result<Completion, Error> {
    // `send` has done the authentication, the status mapping, and the
    // compatibility handling. What is left is bytes.
    let mut raw = client.send(request).await?;
    let mut decoder = Decoder::lenient();
    let mut answer = None;

    while let Some(bytes) = raw.next().await {
        let bytes = bytes?;
        forward(bytes.clone());

        for event in decoder.push(&bytes) {
            if let Event::Completed(done) = event? {
                answer = Some(done);
            }
        }
    }

    // A stream that ended without its end marker is an error, not a short
    // answer.
    decoder.finish()?;

    answer.ok_or_else(|| Error::new(ErrorKind::TruncatedStream))
}
```

`forward` stands for the downstream connection: a channel to an SSE response,
a WebSocket, anything that takes bytes.

## What to know

- **`send` returns only for a success status with an event stream.** A `401`
  or a `429` from the model server is already an `Err` with its kind, and
  `error.status()` has the status itself. Do not relay it as a stream.
- **Keep the two `401`s apart.** An upstream `401` means the model server
  refused the proxy's key. It is not the proxy's own client being
  unauthenticated; answer it as the proxy's failure (a `502`), not as the
  client's.
- **Decide what happens when decoding fails after bytes were forwarded.** The
  downstream already has them; the proxy can only stop and mark the stored
  answer as failed.
- **A lenient decoder suits a proxy.** The downstream client, not the proxy, is
  the judge of fields svir does not know.
- `RawStream` fails with `ErrorKind::Timeout` when the server goes silent, and
  dropping it cancels the request, exactly as `EventStream` does. When the
  downstream disconnects, drop the stream.
- `send` does not pass through [layers](../client/layers): they work on events.

## Answering with the upstream's status

A proxy that answers with the model server's status reads `error.status()`.
It is `None` for a timeout or a failure inside a stream, where the proxy has to
pick a status of its own.

```rust
use svir::prelude::*;

/// The status a proxy answers with when the upstream call failed.
fn status_for(error: &Error) -> u16 {
    match (error.status(), error.kind()) {
        // The model server refused the proxy's own key: not the caller's fault.
        (Some(401 | 403), _) => 502,
        (Some(status), _) => status,
        (None, ErrorKind::Timeout) => 504,
        (None, _) => 502,
    }
}
```

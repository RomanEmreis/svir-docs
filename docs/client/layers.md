---
sidebar_position: 2
title: Layers
description: Middleware around every call. Retry, Timeout and Trace, closures, and layers of your own.
---

# Layers

A layer wraps the call itself, `Request -> Result<EventStream, Error>`, for
every request a client sends. Layers are added on the builder, and **the first
layer added is the outermost**: it sees the request first and the answer last.

```rust
use std::time::Duration;

use svir::layer::{Retry, Timeout, Trace};
use svir::prelude::*;

fn client() -> Result<Client, Error> {
    Client::openai("https://models.example.com/v1")
        .api_key_env("MODELS_API_KEY")
        // Outermost: each retry gets the deadline and the trace below it.
        .layer(Retry::transient(3))
        .layer(Timeout::first_token(Duration::from_secs(60)))
        .layer(Trace)
        .build()
}
```

A client without layers pays nothing for them. With layers, the client keeps
them as trait objects, so its type stays `Client` whatever they are.

## Built in

| Layer | Behavior |
|---|---|
| `Retry::connect(n)` | Retries a call whose request never reached the server: a refused or timed-out connection. Always safe |
| `Retry::transient(n)` | Also retries timeouts, rate limits, and server errors that came before the answer started |
| `.backoff(d)` on either | The wait before the first retry, 500 ms unless set. It doubles each time, up to 30 s. A `Retry-After` from the server wins |
| `Timeout::first_token(d)` | Nothing of the answer (text, reasoning, a piece of a tool call) within `d` of the call |
| `Timeout::idle(d)` | The server silent for `d` |
| `Timeout::total(d)` | The answer not complete within `d` of the call |
| `Trace` (feature `tracing`) | Reports each call through `tracing` |

`Retry` and `Timeout` are in `svir::layer`, not in the prelude.

### Retry

- **Only a call that failed before the response started is retried.** Once the
  answer streams, nothing is: the caller has already seen part of it.
- `Retry::transient` can repeat a request the server did receive. That is fine
  for a model call, which changes nothing on the server, but it costs tokens.
- Put `Retry` outside `Timeout` (add it first) so that each attempt gets its
  own deadline.

### Timeout

All three fail the call with `ErrorKind::Timeout`. On a local model, a
first-token deadline has to cover reading the whole prompt, which for a long
conversation can take minutes.

### Trace

With the `tracing` feature, `Trace` reports each call through the
[`tracing`](https://docs.rs/tracing) crate:

| Level | Event | Fields |
|---|---|---|
| `debug` | `request` | `model`, `messages` |
| `debug` | `response started` | `model`, `elapsed_ms` |
| `info` | `answer complete` | `model`, `finish`, `input_tokens`, `output_tokens`, `elapsed_ms` |
| `warn` | `request failed`, `answer failed` | `model`, `kind`, `elapsed_ms` |

It never records text, reasoning, tool arguments, or the server's messages, so
it is safe to leave on in production.

## A closure as a layer

`wrap` turns a closure into a layer. It receives the request and `next`, the
rest of the stack.

```rust
use std::time::Instant;

use svir::prelude::*;

fn client() -> Result<Client, Error> {
    Client::openai("http://127.0.0.1:1234")
        .wrap(|request, next| async move {
            let model = request.model.clone();
            let started = Instant::now();
            let answer = next.run(request).await;

            match &answer {
                Ok(_) => eprintln!("{model}: response after {:?}", started.elapsed()),
                Err(error) => eprintln!("{model}: {error}"),
            }
            answer
        })
        .build()
}
```

:::info[`next.run` resolves when the response starts]
It returns the stream once the headers arrive, not when the answer is
complete. To see the whole answer, watch the stream it returns, as below.
:::

## A layer of your own

Implement `Layer` for a type that holds state. A layer cannot change the type
of the stream, so it shapes the stream through `EventStream`'s own methods.

```rust
use std::sync::{
    Arc,
    atomic::{AtomicU64, Ordering},
};

use svir::layer::{Layer, Next};
use svir::prelude::*;

/// Counts the tokens every answer of a client took to generate.
struct Meter {
    generated: Arc<AtomicU64>,
}

impl Layer for Meter {
    async fn call(&self, request: Request, next: Next) -> Result<EventStream, Error> {
        let generated = self.generated.clone();
        let stream = next.run(request).await?;

        Ok(stream.inspect(move |item| {
            if let Ok(Event::Completed(done)) = item {
                let tokens = done.usage.map_or(0, |usage| usage.output);
                generated.fetch_add(tokens, Ordering::Relaxed);
            }
        }))
    }
}
```

| `EventStream` method | For a layer that |
|---|---|
| `inspect(closure)` | Watches every item, the last one included: metrics, logging, accounting |
| `first_token_by(instant)` | Fails the stream if nothing of the answer arrived by then |
| `complete_by(instant)` | Fails the stream if the answer is not complete by then |
| `idle_timeout(d)` | Fails the stream when the server is silent for `d` |

A layer may change the request before passing it on (a default system prompt,
a model alias), call `next.run` more than once after cloning `next` (that is
what `Retry` does), or not call it at all and return an error. It cannot
rewrite events.

## What layers do not see

Layers work on events. `client.send()`, which returns the server's raw bytes
for a [proxy](../advanced/proxy), and `client.list_models()` do not pass
through them.

A layer is tied to the HTTP backend it was added for, so `.http(backend)` has
to come before any `.layer(..)` or `.wrap(..)`; see
[Custom HTTP backend](./custom-backend).

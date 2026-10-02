---
sidebar_position: 5
title: Testing without a server
description: A scripted HTTP backend answers from memory, so code that calls a model is tested without one.
---

# Testing without a server

Tests should not depend on a live model. A scripted
[backend](./custom-backend) answers from memory, which tests the code that
calls a model with no server, no network, and no credentials.

```rust
use bytes::Bytes;
use svir::http::{Backend, BoxBody, HttpRequest, HttpResponse};
use svir::prelude::*;

const ANSWER: &str = concat!(
    "data: {\"choices\":[{\"index\":0,\"delta\":{\"content\":\"pong\"},\"finish_reason\":null}]}\n\n",
    "data: {\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":\"stop\"}]}\n\n",
    "data: [DONE]\n\n",
);

/// Answers every request with the same stream.
struct Canned;

impl Backend for Canned {
    type Body = BoxBody;

    async fn send(&self, _request: HttpRequest) -> Result<HttpResponse<BoxBody>, Error> {
        let body = futures_util::stream::iter([Ok(Bytes::from_static(ANSWER.as_bytes()))]);
        let headers = vec![("content-type".to_owned(), "text/event-stream".to_owned())];

        Ok(HttpResponse::new(200, headers, Box::pin(body)))
    }
}

#[tokio::test]
async fn pong() -> Result<(), Error> {
    let client = Client::openai("http://127.0.0.1:1").http(Canned).build()?;

    let answer = client.complete(Request::new("m").user("ping")).await?;
    assert_eq!(answer.text, "pong");

    Ok(())
}
```

This needs `bytes` and `futures-util` as dev-dependencies:

```toml title="Cargo.toml"
[dev-dependencies]
bytes = "1"
futures-util = "0.3"
tokio = { version = "1", features = ["macros", "rt-multi-thread"] }
```

## Writing scripted answers

- The response must say `content-type: text/event-stream`, or the client
  refuses it.
- A strict client needs a well-formed stream: a delta, a chunk with the finish
  reason, then `[DONE]`.
- A tool call is a delta with `tool_calls` and the finish reason `tool_calls`.
- To script several answers, keep a queue in the backend and pop one per
  request. To assert on what was sent, read `request.body` to its end and parse
  it as JSON.
- A failure is scripted by status: a `429` response tests rate-limit handling,
  a stream without `[DONE]` tests truncation.

## Against a real server

`cargo check` catches API mistakes; it cannot tell whether a server accepts the
request. Two mistakes compile cleanly and fail only against a server: a model
ID the server does not have, and a tool round trip that leaves out the
assistant turn or a result. Tool calling and images also depend on the model
itself.

Keep live tests opt-in, for example behind `#[ignore]`, and point them at any
OpenAI-compatible server. LM Studio listens on `http://127.0.0.1:1234` by
default.

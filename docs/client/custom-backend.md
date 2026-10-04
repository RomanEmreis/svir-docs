---
sidebar_position: 4
title: Custom HTTP backend
description: Replacing the built-in hyper transport, for proxies, client certificates, or other roots.
---

# Custom HTTP backend

The built-in backend is hyper with rustls: no redirects, no proxies, the
default roots. For an HTTP proxy, client certificates, or other roots,
implement `svir::http::Backend` over an HTTP client that has them.

Everything above the seam still holds for your backend: the idle timeout,
status mapping, compatibility handling, decoding, and layers.

```rust
use svir::http::{Backend, BoxBody, HttpRequest, HttpResponse};
use svir::prelude::*;

struct Mine;

impl Backend for Mine {
    type Body = BoxBody;

    async fn send(&self, request: HttpRequest) -> Result<HttpResponse<BoxBody>, Error> {
        // Send `request.method`, `request.url`, `request.headers`, and
        // `request.body` with your HTTP client, and return the response
        // once its headers have arrived.
        let _ = request;

        Err(Error::new(ErrorKind::Transport).with_detail("not connected"))
    }
}

fn client() -> Result<Client<Mine>, Error> {
    // `http` comes before any layer.
    Client::openai("https://models.example.com").http(Mine).build()
}
```

## The contract of `send`

- **Send the request as given and return the response as received.** No
  redirects, no retries, no changes to the body.
- `request.headers` holds `authorization` when there is a key, and the
  headers added with [`.header(..)`](./configuration#extra-headers). **Every
  value but those of `content-type` and `accept` may be a credential**: keep
  it out of logs, and send it marked sensitive where your HTTP client can.
  `HttpRequest`'s `Debug` withholds them.
- `request.body` is `Some(HttpBody { length, stream })`. Send it with
  `Content-Length: length`, not chunked: not every model server accepts a
  chunked request. `stream` yields `Result<Bytes, Error>`.
- The response body is any `Stream<Item = Result<Bytes, Error>>` that is
  `Send + Unpin + 'static`. `BoxBody` is the boxed form; a backend that can
  name its stream type avoids the box.
- Report a failure to connect or to read as `ErrorKind::Transport`, and a
  timeout as `ErrorKind::Timeout`. Mark a request that never left with
  `.with_unsent()`: that is what `Retry::connect` looks for.
- **Status codes are svir's to map.** Return a `4xx` or `5xx` as a response,
  not as an error.
- **Dropping the response body must close the exchange.** That is how a
  cancelled call stops the generation.

## The type carries the backend

The client is generic over its backend: `Client<Mine>`. `Client` alone means
the built-in one. Code that takes either can be generic over
`B: svir::http::Backend`.

A layer is tied to the backend it was added for, so `.http(..)` after a
`.layer(..)` or `.wrap(..)` is a `Config` error at `build()`. Call `http`
first.

A scripted backend is also the way to test code that calls a model without a
model; see [Testing without a server](./testing).

---
sidebar_position: 1
title: Configuration
description: The client builder, base URLs, API keys, extra headers, timeouts, listing models, and compatibility handling.
---

# Configuration

`Client::openai(url)` returns a `ClientBuilder`. Every method takes `self` and
returns it, and `build()` returns `Result<Client, Error>`: the URL, the key
source, and the headers are checked there, not on the first request.

```rust
use std::time::Duration;

use svir::layer::{Retry, Timeout};
use svir::prelude::*;

fn client() -> Result<Client, Error> {
    Client::openai("https://models.example.com/v1")
        .api_key_env("MODELS_API_KEY")
        .connect_timeout(Duration::from_secs(5))
        .layer(Retry::connect(3))
        .layer(Timeout::first_token(Duration::from_secs(120)))
        .build()
}
```

| Method | Effect | Default |
|---|---|---|
| `api_key(key)` / `api_key_env(name)` / `api_key_file(path)` | Bearer authentication | None |
| `header(name, value)` | A header sent with every request, for a gateway or a hosted endpoint | None |
| `allow_http()` | Plain HTTP to a host that is not loopback | Refused |
| `connect_timeout(d)` | How long connecting may take | 10 s |
| `idle_timeout(d)` / `no_idle_timeout()` | How long the server may send nothing | 5 min |
| `include_usage(bool)` | Ask for token counts when a request does not say | On |
| `lenient()` / `mode(Mode)` | How strictly responses are read | Strict |
| `limits(Limits)` | Bounds on one response | 64 MiB, 256 KiB per event, 64 tool calls |
| `think(Think)` | What to do with inline `<think>` tags | Split into reasoning |
| `context_tokens(n)` | Refuse a request that cannot fit, before sending it | Off |
| `http(backend)` | Another HTTP backend | hyper |
| `layer(l)` / `wrap(closure)` | Middleware around every call | None |

**Build one `Client` per server and clone it.** Clones are cheap and share the
connection pool and what was learned about the server. A client's `Debug` shows
the URL and never the key or a header's value.

Strictness and limits have a page of their own:
[Strict decoding and limits](../advanced/strictness).

## The base URL

Pass the server's base, with or without `/v1` and a trailing slash; svir
appends `/v1/chat/completions` and `/v1/models`. A path in front is kept:
`http://host/openai/v1` calls `http://host/openai/v1/chat/completions`.

`build()` fails with `ErrorKind::Config` for:

| The URL | Why |
|---|---|
| `http://` to a host that is not loopback | Keys and prompts would cross the network in the clear. Use `https://`, or `.allow_http()` for a trusted network |
| `https://` without the `tls` or the `tls-aws-lc` feature | Neither is on; see [Features and TLS](./features) |
| Credentials, a query, or a fragment in the URL | A key belongs in `api_key`, not in the URL |
| No scheme (`127.0.0.1:1234`) | Write `http://127.0.0.1:1234` |

Loopback is `localhost`, `127.0.0.1`, and `[::1]`.

## API keys

| Source | Read |
|---|---|
| `.api_key("...")` | The value given |
| `.api_key_env("NAME")` | The variable, when the client is built; unset is a `Config` error |
| `.api_key_file(path)` | The file, when the client is built; surrounding whitespace is dropped |

**svir reads no environment variable and no `.env` file unless told to.** The
key is sent as `Authorization: Bearer ...` and never appears in `Debug`,
`Display`, errors, or events. A local server without authentication needs no
key at all.

## Extra headers

A gateway or a hosted endpoint may ask for a header of its own: attribution,
an organization or a project, or a key under a name other than
`Authorization`. `header(name, value)` adds one to every request the client
sends, the model listing included.

```rust
use svir::prelude::*;

fn client() -> Result<Client, Error> {
    Client::openai("https://gateway.example.com/v1")
        .api_key_env("GATEWAY_KEY")
        .header("x-title", "My App")
        .build()
}
```

- Names are not case-sensitive and are sent lowercase. Setting a name again
  replaces the earlier value.
- **Every value is treated as a credential**: it never appears in `Debug`, in
  errors, or in events, and the built-in backend sends it marked sensitive.
  An error names the header, never its value.
- svir reads no environment variable for a header. For a value that lives
  there, read it with `std::env::var(..)` and pass it.

`build()` fails with `ErrorKind::Config` for:

| The header | Why |
|---|---|
| A name that is not a header name (`"x title"`, `""`) | It cannot be sent |
| A value with a line break, another control character, or text that is not ASCII | A line break would end the header and start another |
| `authorization`, `content-type`, `content-length`, `accept`, `host`, `transfer-encoding`, `connection` | svir writes these itself, or they frame the request. The Bearer key goes through `api_key` |

The headers are the client's, the same on every request. There are no headers
per request: a [layer](./layers) works above HTTP and cannot add one.

## Timeouts

| What | How | Default |
|---|---|---|
| Connecting | `connect_timeout(d)` | 10 s |
| Silence from the server, before the response and during it | `idle_timeout(d)` | 5 min |
| Time to the first piece of the answer | `Timeout::first_token(d)` [layer](./layers) | None |
| The whole answer | `Timeout::total(d)` [layer](./layers) | None |

There is no total timeout by default, on purpose: a long generation is not a
failure. The idle timeout is long because a local model reads the whole prompt
before its first token. Shorten it for a hosted server, not for a local one.

All of them fail with `ErrorKind::Timeout`.

## Listing models

```rust
use svir::prelude::*;

async fn models(client: &Client) -> Result<Vec<String>, Error> {
    let listed = client.list_models().await?;

    Ok(listed.into_iter().map(|model| model.id).collect())
}
```

The listing is what the server reports, unfiltered: embedding and speech models
are in it next to chat models. `Model` has `id`, the ID to put in a request,
and an optional display `name`.

:::tip
Some local servers answer with whatever model is loaded when they do not know
the ID in the request. If every model gives the same answer, list the models
and check the ID.
:::

## Compatibility handling

Some servers reject optional fields, `reasoning_effort` and `stream_options`,
with a `400` or `422`. The client then sends the request once more without
them, and remembers: later requests of this client and its clones leave them
out from the start. Nothing was generated by the rejected request, so this is
not a retry in the sense of the `Retry` layer, and it needs no configuration.

What to know about it:

- On such a server `Completion::usage` is `None` (usage is asked for through
  `stream_options`), and the reasoning effort is not applied.
- Only a rejection whose body does not explain it gets the second attempt. A
  context overflow or a prompt the content filter blocked is reported as it
  is: sent again, a blocked prompt would be billed again.
- If the second attempt fails too, the original error is reported.

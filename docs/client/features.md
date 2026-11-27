---
sidebar_position: 4
title: Features and TLS
description: Cargo features, what each one turns on, and choosing a rustls crypto provider.
---

# Features and TLS

svir is one crate with no procedural macros. Its features decide how much of
it you build.

| Feature | Turns on | Default |
|---|---|---|
| `client` | `Client`, `EventStream`, the hyper transport, attachments read from disk | Yes |
| `tls-ring` | HTTPS through rustls with the ring provider and the webpki roots | No |
| `tls-aws-lc` | HTTPS through rustls with the aws-lc-rs provider and the webpki roots | No |
| `schemars` | `Tools::add` and `Schema::of`, which derive a tool's input schema and an answer's schema from a type | No |
| `tracing` | The [`Trace` layer](./layers#trace) | No |

Both wire APIs, Chat Completions and the Anthropic Messages API, are always in
the crate: a wire API that needs nothing svir does not have already is not a
feature.

Reading a project's `Cargo.toml` tells you what it can use:

| What you find | What it means |
|---|---|
| `svir = "0.2"` and no `features` key | The client over plain HTTP: everything except HTTPS, `Tools::add`, `Schema::of`, and `Trace` |
| `features = ["tls-ring"]` or `["tls-aws-lc"]` | The client over HTTP and HTTPS |
| `features = ["schemars"]` | `Tools::add` and `Schema::of`; the crate also needs `schemars = "1"` for the derive |
| `features = ["tracing"]` | The `Trace` layer |
| `default-features = false` | Types and the codecs only: no `Client`, no `EventStream`, no layers, no attachments read from disk. See [The codec alone](../advanced/codec) |

What else your crate needs, and when:

| For | Add |
|---|---|
| Any use of `Client` | `tokio` with a runtime; the client runs on Tokio |
| Typed tool arguments, `Completion::parse` | `serde` with `derive` |
| A tool schema written by hand | `serde_json` |
| `Tools::add`, `Schema::of` | `schemars = "1"` next to svir's `schemars` feature |
| A custom HTTP backend | `bytes` and `futures-core` |

## TLS and the crypto provider

Plain HTTP is all a model server on loopback needs, so the default build has no
TLS. HTTPS is rustls with the webpki roots and HTTP/2 by ALPN, with the crypto
provider your build chooses:

| Feature | Provider |
|---|---|
| `tls-ring` | ring. Builds without a C toolchain everywhere |
| `tls-aws-lc` | aws-lc-rs. With both features on, this one is used |

```toml title="Cargo.toml"
[dependencies]
svir = { version = "0.2", features = ["tls-ring"] }
```

Without either, an `https://` URL is a `Config` error at `build()`, and the
error names both features. The built-in transport follows no redirects, uses no
proxy, and trusts the default roots; for anything else, see
[Custom HTTP backend](./custom-backend).

svir always passes its provider to rustls explicitly, so it works with either.
The choice still matters to the rest of your build: rustls picks a
process-wide default provider only when exactly one is compiled in. If another
dependency brings aws-lc-rs, as reqwest can, take `tls-aws-lc` so that the
build has one provider; with ring added, code elsewhere that relies on the
default (`ClientConfig::builder()`) panics with "no process-level
CryptoProvider available". The other fix is in that code: pass a provider there
too, or install one at startup with `CryptoProvider::install_default`.

## Versions

This site describes svir **0.2**. What changes when you upgrade from an earlier
release is on [Migration](../reference/migration), and every change is in the
[changelog](https://github.com/RomanEmreis/svir/blob/main/CHANGELOG.md).

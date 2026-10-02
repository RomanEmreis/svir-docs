---
sidebar_position: 2
title: Attachments
description: Images and text files, from disk or from memory, streamed into the request body.
---

# Attachments

A user message can carry images and text files next to its text. Attachments
given as paths are not read when the message is built: they are read while the
request is sent, a block at a time, so a large image is never in memory whole.

```rust
use svir::prelude::*;

fn attachments(photo: Vec<u8>) -> Message {
    Message::user("Describe what you see.")
        // A file: nothing is read until the request is sent.
        .with(Image::path("chart.png"))
        // An extension svir does not know needs its media type.
        .with(Image::path("scan.tif").media_type("image/tiff"))
        // Bytes already in memory always name theirs.
        .with(Image::bytes(photo, "image/jpeg"))
        // A text file, by path or from memory.
        .with(TextFile::path("notes.md"))
        .with(TextFile::text("query.sql", "select 1;"))
}
```

## Images

Images travel as base64 data URLs.

- The media type comes from the extension for `png`, `jpg`, `jpeg`, `gif`, and
  `webp`. Anything else needs `.media_type(..)`, or sending fails with
  `ErrorKind::Attachment`.
- `Image::bytes(data, media_type)` takes bytes already in memory, and always
  their media type.
- The model has to be able to see. A text-only model rejects the request or
  ignores the image; svir cannot tell which models can.

## Text files

Text files travel as text inside the message, wrapped with their name.

- They must be UTF-8. `TextFile` is for text: send an image as `Image`, and
  convert anything else first.
- The model is told the file name. `.name(..)` changes it, for example to hide
  a local path.
- `TextFile::text(name, text)` sends text from memory as if it were a file.

## When files are read

The encoder measures every file when the request is sent, so the body's exact
`Content-Length` is known before its first byte, and then streams the files
into the body.

- A file that is missing, unreadable, or changed since it was measured fails
  the **call** with `ErrorKind::Attachment`, not the construction of the
  message.
- Paths are relative to the process's working directory.
- A file written to between measuring and sending fails rather than sending a
  body that disagrees with its length.

:::tip
`ClientBuilder::context_tokens(n)` refuses a request that cannot fit before
sending it, by counting the body's bytes as tokens. That never underestimates
text, but it overestimates images by far: with image attachments, leave it off.
:::

## Stored attachments

A request can be serialized; see
[Conversations](./conversations#storing-and-restoring). An attachment given as
a path is stored as the path, and one given as bytes is stored as base64. A
stored path has to exist again when the request is sent.

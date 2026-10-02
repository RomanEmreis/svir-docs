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
    decoder.finish()?;

    answer.ok_or_else(|| Error::new(ErrorKind::TruncatedStream))
}
```

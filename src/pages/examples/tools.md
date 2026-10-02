```rust features="schemars"
use schemars::JsonSchema;
use serde::Deserialize;
use svir::prelude::*;

#[derive(Deserialize, JsonSchema)]
struct City {
    /// The city to look up.
    city: String,
}

async fn weather(args: City) -> Result<String, String> {
    match args.city.to_lowercase().as_str() {
        "oslo" => Ok("4 C, light snow".to_owned()),
        _ => Err(format!("no weather station in {}", args.city)),
    }
}

async fn ask(client: &Client, question: &str) -> Result<String, Error> {
    let tools = Tools::new().add("weather", "The weather in a city right now.", weather);
    let mut request = Request::new("qwen3-27b").tools(&tools).user(question);

    for _ in 0..8 {
        let done = client.complete(&request).await?;
        if done.calls.is_empty() {
            return Ok(done.text);
        }

        let results = tools.call_all(&done.calls).await;
        request = request.assistant(done).tool_results(results);
    }

    Err(Error::new(ErrorKind::Unsupported).with_detail("the model kept calling tools"))
}
```

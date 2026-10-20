# Recorded fixtures

Real Amazon Bedrock outputs for the four scenarios, keyed by scenario and step. They are written only by `npm run demo:record` (live Bedrock, `MODEL_PROVIDER=bedrock`), never by hand. In `DEMO_MODE` the server replays them so the video never depends on a live model call.

None are recorded yet. Until they are, `DEMO_MODE` falls back to the offline stand-in, which is labelled "not a model" in the app.

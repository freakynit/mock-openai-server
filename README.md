### Mock OpenAI Server 
1. Nodejs express server app to faithfully mock all important OpenAI endpoints (chat, embeddings, image, audio and models).
2. All existing SDK's and apps should work as-is by changing just the endpoint and optionally api key (check `apiKeys` in config.yaml).
3. Helpful to save on your LLM API call costs while developing/testing agents or developing other apps. Also, helpful to return reproducible and configurable outputs while developing/testing.  
4. All models, their configurations, sample responses and server settings are configurable through `config.yaml`.

### Implemented
1. `/chat/completions`
2. `/embeddings`
3. `/images/generations`
4. `/images/variations`
5. `/images/edits`
6. `/audio/speech`
7. `/audio/transcriptions`
8. `/audio/translations`
9. `/models`
10. `/models/{model}`

### Not Implemented
> You most probably are not using these
1. Logits, modalities, prediction, and response_format->json_schema in `/chat/completions`.
2. Only `aac` output format is NOT supported in `/audio/speech` endpoint. Rest all ARE supported. `ffmpeg` related, nothing related to code.

### Installation
1. Clone the repo (`git clone https://github.com/freakynit/mock-openai-server.git`), `cd` into it, and do `npm i`
2. Install ffmpeg binary separately if audio endpoints are not working (should not be needed though).
3. Start server: `node src/server.js` or `npm run server`
4. Set api base (and optionally api key) in your client apps or openai SDK's to: `http://localhost:8080/v1`
5. Checkout `src/examples.js` for example usages of all supported endpoints (start looking from bottom of the file).

### Understanding config.yaml
This configuration file defines server settings, model configurations, and supported functionalities for text, image, audio, and embeddings.
1. **General Settings**:
    - `publicFilesDirectory`: Directory for storing public/generated files (`public`).
    - `server`: Host and port configuration (`localhost:8080`).
    - `organizationName`: Name of the organization (`my sample org`).
    - `apiKeys`: List of API keys used for authorization. Leave it empty to allow anonymous access.

2. **Response Delay**:
    - Option to enable/disable simulated response delays.
    - Configurable delay range in milliseconds.

3. **Model Configurations**:
    - **Chat Models**: Multiple text-based models (e.g., `chatgpt-4o-latest`, `model-2`). Add more if needed.
        - Maximum token limits and sample responses are defined.
    - **Visual Language Models (VLM)**:
        - Image generation models (e.g., `dall-e-2`, `dall-e-3`) with configurations for resolution, quality, and styles.
        - Support for generating and editing images with sample responses provided.
    - **Audio Models**:
        - Text-to-speech (TTS) models with voice options, supported formats, and duration limits.
        - Audio transcription and translation with sample responses and supported formats (e.g., `json`, `text`).
    - **Embeddings**:
        - Text embedding models with maximum token and dimension limits, supporting different encoding formats.

4. **Functionalities**:
    - Text-based tools (e.g., summation, weather fetching, string reversal) using regex-based triggers.
    - Extensive support for generating sample responses in text, JSON, and media (images/audio).

### Understanding tool use
1. Unlike other sample responses, the tool use requires one small extra step.
2. You just need to declare the regex that will be used to match the prompt when tool use is requested.
3. See `modelConfigs -> chat -> tools` in `config.yaml` for examples (they are simple enough). Sample:
```yaml
    tools:
       functions:
          - functionName: "calculate_sum"
            arguments: { "a": 10, "b": 20 }
            regexToMatchAgainstPrompt: |
               .*sum.*
          - functionName: "fetch_weather"
            arguments: { "location": "Boston, MA", "unit": "imperial" }
            regexToMatchAgainstPrompt: |
               .*weather.* 
```

### Understanding Sample Responses
1. Except for `/embeddings` endpoint, all other endpoints allow specifying sample responses in config.yaml.
2. For `/embeddings`, responses are always generated on the fly. But, the server makes sure to generate same tokens for the same given input.
3. Media endpoints: `/audio/speec` and `/images/{generations,variations,edits}` also support generating media dynamically. Use `generationFrom: generated` for these if needed.
4. `/models` endpoint simply traverses all models listed in config.yaml across different modalities and returns them.
5. For adding new response strategies, look into relevant source files under `src/generators` path. You just need to implement one simple method for all except `/chat`, which needs two methods.

### Other Important Points
1. When using dynamically generated media, these files are generated in `src/public` (more precisely: `src/${publicFilesDirectory}`) by default and are NOT cleaned.
2. Do not forget to put `/v1` in your client SDK's or apps when configuring mock server endpoint.
3. Code requires some good refactoring... inputs and contributions are welcome.

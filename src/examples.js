import { OpenAI } from "openai";
import fs from 'fs';
import {base64ToFloatsArray} from './utils.js';

const openaiLLMConfig = {
    apiBase: 'https://api.openai.com/v1',
    apiKey: '<ADD your real key if testing against real endpoint>',
    model: 'chatgpt-4o-latest'
};
const mockServerLLMConfig = {
    apiBase: 'http://localhost:8080/v1',
    apiKey: 'key-1'
};

const llmConfig = mockServerLLMConfig;

const openai = new OpenAI({
    apiKey: llmConfig.apiKey,
    baseURL: llmConfig.apiBase
});

/************ Chat ************/

async function chatCompletions() {
    const stream = true;
    const numGenerations = stream ? 1 : 1;

    try {
        const result = await openai.chat.completions.create({
            model: 'chatgpt-4o-latest',
            messages: [{ role: "user", content: "how are you doing?" }],
            max_tokens: 2048,
            temperature: 0.7,
            n: numGenerations,
            stream,
            stream_options: stream ? {include_usage: true} : null,
            // response_format: { type: 'json_object' }
        });

        if(stream) {
            for await (const chunk of result) {
                //console.log(JSON.stringify(chunk, null, 2));
                if(chunk.choices && chunk.choices.length > 0) {
                    process.stdout.write(chunk.choices[0]?.delta?.content || '');
                } else {
                    console.log(`\n=== usage ===\n`, chunk.usage);
                }
            }
        } else {
            console.log(JSON.stringify(result, null, 2));
            // result?.choices?.forEach(choice => console.log(choice?.message?.content));
        }
    } catch (error) {
        console.error("Error testing the mock server:", error.response?.data || error.message);
    }
}

async function functionCallingToolUse() {
    const stream = true;

    const strict = true;
    const additionalProperties = strict ? false : true; // this can be false for both cases

    // Important:
    // Make sure to also update `modelConfigs -> chat -> tools` in config.yaml if making changes in these samples.
    const tools = [
        {"type":"function","function":{"name":"calculate_sum","description":"Calculates the sum of two numbers.","strict":strict,"parameters":{"type":"object","properties":{"a":{"type":"number","description":"The first number."},"b":{"type":"number","description":"The second number."}},"required":["a","b"],"additionalProperties":additionalProperties}}},
        {"type":"function","function":{"name":"fetch_weather","description":"Fetches the weather for a specified location.","strict":strict,"parameters":{"type":"object","properties":{"location":{"type":"string","description":"The city and state, e.g. San Francisco, CA"},"unit":{"type":["string","null"],"enum":["metric","imperial"],"description":"The unit system for temperature (metric or imperial)."}},"required":["location","unit"],"additionalProperties":additionalProperties}}},
        {"type":"function","function":{"name":"reverse_string","description":"Reverses the given string.","strict":strict,"parameters":{"type":"object","properties":{"input_string":{"type":"string","description":"The string to reverse."}},"required":["input_string"],"additionalProperties":additionalProperties}}}
    ];

    try {
        const result = await openai.chat.completions.create({
            model: 'gpt-4o',
            messages: [{ role: "user", content: "What's the weather like in Boston today in metric units?" }],
            max_tokens: 2048,
            temperature: 0.7,
            stream,
            stream_options: stream ? {include_usage: true} : null,
            tools,
            tool_choice: "auto"
            // tool_choice: {"type": "function", "function": {"name": "calculate_sum"}}
        });

        if(stream) {
            let idx = 0;
            for await (const chunk of result) {
                // console.log(JSON.stringify(chunk, null, 2));
                if(chunk.choices && chunk.choices.length > 0) {
                    if(idx++ == 0) {
                        process.stdout.write(`function: ${chunk.choices[0]?.delta?.tool_calls?.[0]?.function?.name}\n`);
                        process.stdout.write('arguments: ');
                    }
                    process.stdout.write(chunk.choices[0]?.delta?.tool_calls?.[0]?.function?.arguments || '');
                } else {
                    console.log(`\n=== usage ===\n`, chunk.usage);
                }
            }
        } else {
            console.log(JSON.stringify(result, null, 2));
            // result?.choices?.forEach(choice => console.log(choice?.message?.content));
        }
    } catch (error) {
        console.error("Error testing the mock server:", error.response?.data || error.message);
    }
}

/************ Embeddings ************/

async function createEmbedding() {
    const encoding = 'float';

    try {
        const result = await openai.embeddings.create({
            model: 'text-embedding-ada-002',
            input: "The quick brown fox jumped over the lazy dog",
            // input: ["The quick brown fox jumped over the lazy dog", "How are you doing today?"],
            // input: Array.from({ length: 100 }, (_, i) => i + 1),
            // input: Array.from({ length: 2 }, (_, i) => Array.from({ length: 100 }, (_, i) => i + 1)),
            encoding_format: encoding,
            // dimensions: 248
        });

        console.log(JSON.stringify(result, null, 2));
        // result.data.forEach(embeddingContainer => console.log(encoding === 'base64'
        //     ? base64ToFloatsArray(embeddingContainer.embedding)
        //     : embeddingContainer.embedding));
    } catch (error) {
        console.error("Error testing the mock server:", error.response?.data || error.message);
    }
}

/************ Images ************/

async function imageGenerations() {
    const responseFormat = 'url';  // or b64_json

    try {
        const response = await openai.images.generate({
            prompt: 'A serene waterfall in a lush jungle, with golden sunlight filtering through the trees.',
            model: 'dall-e-2',
            quality: 'standard',
            n: 2,
            size: '1024x1024',
            response_format: responseFormat
        });

        let idx = 1;
        response.data.forEach(item => {
            if(responseFormat === 'url') {
                console.log(`url: ${item.url}`);
            } else {
                const imageData = Buffer.from(item.b64_json, 'base64');
                const savePath = `generated_image-${idx++}.bmp`;
                fs.writeFileSync(savePath, imageData);
                console.log(`Saved to: ${savePath}`);
            }
        });
    } catch (error) {
        console.error('Error', error.response ? error.response.data : error.message);
    }
}

async function imageVariations() {
    const responseFormat = 'url';  // or b64_json

    try {
        const imageFilePath = './sample_media/images/image-0.png';

        const response = await openai.images.createVariation({
            image: fs.createReadStream(imageFilePath),
            model: 'dall-e-2',
            n: 2,
            size: '1024x1024',
            response_format: responseFormat
        });

        let idx = 1;
        response.data.forEach(item => {
            if(responseFormat === 'url') {
                console.log(`url: ${item.url}`);
            } else {
                const imageData = Buffer.from(item.b64_json, 'base64');
                const savePath = `generated_image_variation-${idx++}.bmp`;
                fs.writeFileSync(savePath, imageData);
                console.log(`Saved to: ${savePath}`);
            }
        });
    } catch (error) {
        console.error('Error', error.response ? error.response.data : error.message);
    }
}

async function imageEdits() {
    const responseFormat = 'url';  // or b64_json

    try {
        const imageFilePath = './sample_media/images/image-0.png';
        const maskFilePath = './sample_media/images/sample-mask.png';

        const response = await openai.images.edit({
            prompt: 'make some random update',
            image: fs.createReadStream(imageFilePath),
            mask: fs.createReadStream(maskFilePath),
            model: 'dall-e-2',
            n: 2,
            size: '1024x1024',
            response_format: responseFormat
        });

        let idx = 1;
        response.data.forEach(item => {
            if(responseFormat === 'url') {
                console.log(`url: ${item.url}`);
            } else {
                const imageData = Buffer.from(item.b64_json, 'base64');
                const savePath = `generated_image_edit-${idx++}.bmp`;
                fs.writeFileSync(savePath, imageData);
                console.log(`Saved to: ${savePath}`);
            }
        });
    } catch (error) {
        console.error('Error', error.response ? error.response.data : error.message);
    }
}

/************ Audio ************/

async function audioSpeech() {
    try {
        const responseFormat = 'mp3';

        const response = await openai.audio.speech.create({
            input: 'We stand here today, not as individuals, but as a collective voice for progress and equality. The challenges we face are great, but so too is our resolve to overcome them. Together, we can build a future that reflects the best of our shared humanity.',
            model: 'tts-1',
            voice: 'nova',
            response_format: responseFormat
        });

        const outputPath = `./generated_speech.${responseFormat}`;

        const buffer = Buffer.from(await response.arrayBuffer());
        await fs.promises.writeFile(outputPath, buffer);

        console.log(`Written to file: ${outputPath}`);
    } catch (error) {
        console.error('Error', error.response ? error.response.data : error.message);
    }
}

async function audioTranscriptions() {
    try {
        const audioFilePath = './sample_media/audio/audio-0.mp3';

        const response = await openai.audio.transcriptions.create({
            file: fs.createReadStream(audioFilePath),
            model: 'whisper-1',
            prompt: '',
            temperature: 0.0,
            language: 'en',
            response_format: 'verbose_json',
            timestamp_granularities: ['word', 'segment']
        });

        console.log(response);
    } catch (error) {
        console.error('Error', error.response ? error.response.data : error.message);
    }
}

async function audioTranslations() {
    try {
        const audioFilePath = './sample_media/audio/audio-0.mp3';

        const response = await openai.audio.translations.create({
            file: fs.createReadStream(audioFilePath),
            model: 'whisper-1',
            prompt: '',
            temperature: 0.0,
            response_format: 'verbose_json'
        });

        console.log(response);
    } catch (error) {
        console.error('Error', error.response ? error.response.data : error.message);
    }
}

/************ Models ************/

async function getModels() {
    try {
        const response = await openai.models.list();

        console.log(response);
    } catch (error) {
        console.error('Error', error.response ? error.response.data : error.message);
    }
}

async function getModel() {
    try {
        const response = await openai.models.retrieve('whisper-1');

        console.log(response);
    } catch (error) {
        console.error('Error', error.response ? error.response.data : error.message);
    }
}

async function main() {
    // Chat
    await chatCompletions();
    // await functionCallingToolUse();

    // Embeddings
    // await createEmbedding();

    // Images
    // await imageGenerations();
    // await imageVariations();
    // await imageEdits();

    // Audio
    // await audioSpeech();
    // await audioTranscriptions();
    // await audioTranslations();

    // Models
    // await getModels();
    // await getModel();
}

main().catch(console.error);

import express from 'express';
import {getId, clipText, getTimestampSeconds, isIso6391_1, getRandomDivisibleBy} from "./utils.js";
import {oneShotResponse, streamResponse} from './impls/chat.js';
import {textToImage, getImageFileName, parseDimensions} from './impls/image.js';
import {generateRandomAudio, getAudioFileName, mimeTypeMap, transcribeAudio, translateAudio} from './impls/audio.js';
import {generateEmbedding} from './impls/embedding.js';
import {init as initChat} from './generators/chat.js';
import {init as initImage} from './generators/image.js';
import {init as initAudio} from './generators/audio.js';
import {init as initEmbedding} from './generators/embedding.js';
import fs from "fs";
import path from "path";
import multer from 'multer';
import {fileURLToPath} from "url";
import yaml from "yaml";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const contents = fs.readFileSync('./config.yaml', 'utf-8');
const config = yaml.parse(contents);

(async () => {
    initChat(config);
    initImage(config);
    await initAudio(config);
    initEmbedding(config);
})();

const PUBLIC_FILES_DIRECTORY = path.join(__dirname, config.publicFilesDirectory);  // use full path else res.sendFile throws error since it needs full path
if (!fs.existsSync(PUBLIC_FILES_DIRECTORY)) {
    fs.mkdirSync(PUBLIC_FILES_DIRECTORY);
}

const chatModelConfigs = config.modelConfigs.chat;
const vlmModelConfigs = config.modelConfigs.vlm;

const imageGenerationModelConfigs = config.modelConfigs.imageGeneration;
const imageVariationsModelConfigs = config.modelConfigs.imageVariations;
const imageEditsModelConfigs = config.modelConfigs.imageEdits;

const audioGenerationModelConfigs = config.modelConfigs.audioGeneration;
const audioTranscriptionModelConfigs = config.modelConfigs.audioTranscription;
const audioTranslationModelConfigs = config.modelConfigs.audioTranslation;

const embeddingModelConfigs = config.modelConfigs.embeddings;

const upload = multer({ dest: PUBLIC_FILES_DIRECTORY });

function delayMiddleware(delayMs) {
    return function(req, res, next) {
        setTimeout(next, delayMs);
    };
}

const app = express();
app.use(express.json());

if(config.responseDelay.enable) {
    const chosenDelay = getRandomDivisibleBy(config.responseDelay.minDelayMs, config.responseDelay.maxDelayMs, 1);
    console.log(`Delaying all responses by ${chosenDelay} milliseconds`);
    app.use(delayMiddleware(chosenDelay));
}

function checkAuth(req, validKeys = []) {
    if (!validKeys || validKeys.length === 0) {
        return true;
    }

    const authHeader = req.headers['authorization'];

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return false;
    }

    const token = authHeader.split(' ')[1];

    if (validKeys.includes(token)) {
        return true;
    }

    return false;
}

app.post('/v1/chat/completions', (req, res) => {
    if(!checkAuth(req, config.apiKeys)) {
        res.sendStatus(401);
    }

    let { model, messages, tools, tool_choice: toolChoice, stream, stream_options: streamOptions, max_tokens: maxTokensOld, max_completion_tokens: maxTokensNew, temperature, stop: stopSequences, top_p: topP, n: numGenerations, user, frequency_penalty: frequencyPenalty, presence_penalty: presencePenalty, response_format: responseFormat } = req.body;

    const maxTokens = maxTokensNew || maxTokensOld;
    const {
        authorization,
        "openai-organization": organization,
        "openai-project": project,
        "openai-version": apiVersion,
        ...headers
    } = req.headers;

    if(temperature) {
        if(temperature < 0 || temperature > 1) {
            return res.status(400).send(`'temperature' can only be between 0 and 1. Given: ${temperature}`);
        }
    } else {
        temperature = 0;
    }

    if(topP) {
        if(topP < 0 || topP > 1) {
            return res.status(400).send(`'top_p' can only be between 0 and 1. Given: ${topP}`);
        }
    } else {
        topP = 1;
    }

    if(frequencyPenalty) {
        if(frequencyPenalty < -2 || frequencyPenalty > 2) {
            return res.status(400).send(`'frequency_penalty' can only be between -2 and 2. Given: ${frequencyPenalty}`);
        }
    } else {
        frequencyPenalty = 0;
    }

    if(presencePenalty) {
        if(presencePenalty < -2 || presencePenalty > 2) {
            return res.status(400).send(`'presence_penalty' can only be between -2 and 2. Given: ${presencePenalty}`);
        }
    } else {
        presencePenalty = 0;
    }

    if(stopSequences) {
        if(Array.isArray(stopSequences) && stopSequences.length > 4) {
            return res.status(400).send(`Only 4 stop sequences are allowed. Given: ${stopSequences.length}.`);
        }
        if(!Array.isArray(stopSequences)) {
            stopSequences = [stopSequences];
        }
    } else {
        stopSequences = [];
    }

    const availableModels = Object.keys(chatModelConfigs.models)
    if(!availableModels.includes(model)) {
        return res.status(400).send(`Model: ${model} is not available. Available models: ${JSON.stringify(availableModels)}`);
    }

    const modelConfig = chatModelConfigs.models[model];
    if(maxTokens > modelConfig.maxTokens) {
        return res.status(400).send(`Model: ${model} only supports ${modelConfig.maxTokens} tokens. Requested: ${maxTokens}`);
    }

    let addExtraUsageOnlyChunk = false;
    if(streamOptions) {
        if(!stream) {
            return res.status(400).send(`'stream_options' can only be specified if 'stream' is true.`);
        }
        if(streamOptions['include_usage']) {
            addExtraUsageOnlyChunk = true;
        }
    }

    if(numGenerations) {
        if(numGenerations < 1) {
            return res.status(400).send(`'n' should be greater than 0. Given: ${numGenerations}`);
        }

        if(numGenerations > 1 && stream) {
            return res.status(400).send(`For streaming, 'n' should not be greater than 1. Given: ${numGenerations}.`);
        }
    } else {
        numGenerations = 1;
    }

    let isJsonOutput = false;
    let givenJsonSchema = null;

    if(responseFormat && 'type' in responseFormat) {
        if(responseFormat.type === 'json_object') {
            isJsonOutput = true;
        } else if(responseFormat.type === 'json_schema') {
            isJsonOutput = true;
            if(!'json_schema' in responseFormat) {
                return res.status(400).send(`Please specify json schema in response_format.json_schema field`);
            } else {
                givenJsonSchema = responseFormat['json_schema'] === 'string' ? JSON.parse(responseFormat['json_schema']) : responseFormat['json_schema'];
            }
        }
    }

    if(typeof toolChoice === 'string') {
        if(!['none', 'auto', 'required'].includes(toolChoice)) {
            return res.status(400).send(`Invalid 'tool_choice' specified: ${JSON.stringify(toolChoice)}.`);
        }
        if(toolChoice !== 'none' && (!tools || tools.length == 0)) {
            return res.status(400).send(`Please provide tool definitions since 'tool_choice' is specified.`);
        }
    } else {
        if(toolChoice) {
            if (!('type' in toolChoice)
                || !toolChoice['type'] === 'function'
                || !('function' in toolChoice)
                || !('name' in toolChoice['function'])) {
                return res.status(400).send(`Invalid 'tool_choice' definition: ${JSON.stringify(toolChoice)}.`);
            } else if (!toolChoice['function']['name']) {
                return res.status(400).send(`No function name specified in 'tool_choice': ${JSON.stringify(toolChoice)}.`);
            } else if (tools.map(t => t?.function?.name ?? '').filter(f => f === toolChoice['function']['name']).length == 0) {
                return res.status(400).send(`Required tool/function not found in provided tools.\nGiven 'tool_choice': ${JSON.stringify(toolChoice)}, \nand given 'tools': ${JSON.stringify(tools)}.`);
            }
        }
    }

    if(stream) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('x-request-id', getId());
        //res.flushHeaders();

        streamResponse({
            model, messages, tools, toolChoice, maxTokens, temperature, stopSequences, frequencyPenalty, presencePenalty, addExtraUsageOnlyChunk, isJsonOutput, givenJsonSchema,
            onChunk: (chunk) => {
                res.write(`data: ${JSON.stringify(chunk)}\n\n`);
            },
            onCompletion: () => {
                res.write(`data: [DONE]\n\n`);
                res.end();
            },
            onError: ((statusCode, errorMessage) => {
                res.status(statusCode).send(errorMessage);
            })
        });
    } else {
        oneShotResponse({
            model, messages, tools, toolChoice, maxTokens, numGenerations, temperature, stopSequences, frequencyPenalty, presencePenalty, isJsonOutput, givenJsonSchema,
            onData: (data) => {
                res.header('x-request-id', getId()).json(data);
            },
            onError: ((statusCode, errorMessage) => {
                res.status(statusCode).send(errorMessage);
            })
        });
    }
});

app.post('/v1/images/generations', async (req, res) => {
    if(!checkAuth(req, config.apiKeys)) {
        res.sendStatus(401);
    }

    let { model, prompt, n: numImagesToGenerate, quality: qualityString, size, style, response_format: responseFormat, user } = req.body;

    if(!prompt) {
        return res.status(400).send(`Prompt is mandatory.`);
    }

    const availableModels = Object.keys(imageGenerationModelConfigs.models)
    if(!availableModels.includes(model)) {
        return res.status(400).send(`Model: ${model} is not available. Available models: ${JSON.stringify(availableModels)}.`);
    }

    if(!imageGenerationModelConfigs.availableResponseFormats.includes(responseFormat)) {
        return res.status(400).send(`Allowed values for response_format are: ${imageGenerationModelConfigs.availableResponseFormats} only.`);
    }

    const modelConfig = imageGenerationModelConfigs.models[model];

    if(numImagesToGenerate && numImagesToGenerate > 1) {
        if(numImagesToGenerate > modelConfig.maxImages) {
            return res.status(400).send(`Model ${model} only allows generating ${modelConfig.maxImages} images at a time.`);
        }
    } else {
        numImagesToGenerate = 1;
    }

    if(qualityString) {
        if(!modelConfig.availableQualities.includes(qualityString)) {
            return res.status(400).send(`Model ${model} only supports following quality strings: ${JSON.stringify(modelConfig.availableQualities)}. Given: ${qualityString}.`);
        }
    } else {
        qualityString = 'standard';
    }

    if(size) {
        if(!modelConfig.availableSizes.includes(size)) {
            return res.status(400).send(`Model ${model} only supports following sizes: ${JSON.stringify(modelConfig.availableSizes)}. Given: ${size}.`);
        }
    } else {
        size = `${modelConfig.defaultWidth}x${modelConfig.defaultHeight}`;
    }

    if(style) {
        if(modelConfig.availableStyles && !modelConfig.availableStyles.includes(style)) {
            return res.status(400).send(`Model ${model} only supports following styles: ${JSON.stringify(modelConfig.availableStyles)}. Given: ${style}.`);
        }
    }

    const { width, height } = parseDimensions(size);
    const quality = qualityString && qualityString === "hd" ? 100 : 80;
    const returnUrls = responseFormat && responseFormat === "url" ? true : false;

    const promises = [];
    const serverPublicPaths = [];
    for(let i = 0; i < numImagesToGenerate; i++) {
        const fileName = getImageFileName(prompt, width, height, quality);
        promises.push(textToImage('imageGeneration', prompt, path.join(PUBLIC_FILES_DIRECTORY, fileName), width, height, quality));
        serverPublicPaths.push(`${config.publicFilesDirectory}/${fileName}`);
    }
    const paths = await Promise.all(promises);

    let data = returnUrls
        ? serverPublicPaths.map(serverPublicPath => ({ url: `http://${config.server.host}:${config.server.port}/${serverPublicPath}` }))
        : paths.map(imagePath => ({ b64_json: fs.readFileSync(imagePath).toString('base64') }));

    res.json({
        created: getTimestampSeconds(),
        data
    });
});

app.post('/v1/images/variations', upload.single('image'), async (req, res) => {
    if(!checkAuth(req, config.apiKeys)) {
        res.sendStatus(401);
    }

    let { model, n: numImagesToGenerate, size, response_format: responseFormat, user } = req.body;

    if(!req.file) {
        return res.status(400).send(`Image file is needed`);
    }

    const availableModels = Object.keys(imageVariationsModelConfigs.models)
    if(!availableModels.includes(model)) {
        return res.status(400).send(`Model: ${model} is not available. Available models: ${JSON.stringify(availableModels)}.`);
    }

    if(!imageVariationsModelConfigs.availableResponseFormats.includes(responseFormat)) {
        return res.status(400).send(`Allowed values for response_format are: ${imageVariationsModelConfigs.availableResponseFormats} only.`);
    }

    const modelConfig = imageVariationsModelConfigs.models[model];

    if(numImagesToGenerate && numImagesToGenerate > 1) {
        if(numImagesToGenerate > modelConfig.maxImages) {
            return res.status(400).send(`Model ${model} only allows generating ${modelConfig.maxImages} images at a time.`);
        }
    } else {
        numImagesToGenerate = 1;
    }

    if(size) {
        if(!modelConfig.availableSizes.includes(size)) {
            return res.status(400).send(`Model ${model} only supports following sizes: ${JSON.stringify(modelConfig.availableSizes)}. Given: ${size}.`);
        }
    } else {
        size = `${modelConfig.defaultWidth}x${modelConfig.defaultHeight}`;
    }

    const { width, height } = parseDimensions(size);
    const quality = 80;
    const returnUrls = responseFormat && responseFormat === "url" ? true : false;
    const prompt = `some dummy prompt`;

    const promises = [];
    const serverPublicPaths = [];
    for(let i = 0; i < numImagesToGenerate; i++) {
        const fileName = getImageFileName(prompt, width, height, quality);
        promises.push(textToImage('imageVariations', prompt, path.join(PUBLIC_FILES_DIRECTORY, fileName), width, height, quality));
        serverPublicPaths.push(`${config.publicFilesDirectory}/${fileName}`);
    }
    const paths = await Promise.all(promises);

    let data = returnUrls
        ? serverPublicPaths.map(serverPublicPath => ({ url: `http://${config.server.host}:${config.server.port}/${serverPublicPath}` }))
        : paths.map(imagePath => ({ b64_json: fs.readFileSync(imagePath).toString('base64') }));

    res.json({
        created: getTimestampSeconds(),
        data
    });
});

app.post('/v1/images/edits', upload.fields([
    { name: 'image', maxCount: 1 },
    { name: 'mask', maxCount: 1 },
]), async (req, res) => {
    if(!checkAuth(req, config.apiKeys)) {
        res.sendStatus(401);
    }

    let { prompt, model, n: numImagesToGenerate, size, response_format: responseFormat, user } = req.body;

    const imageFile = req.files['image'] ? req.files['image'][0] : null;
    const maskFile = req.files['mask'] ? req.files['mask'][0] : null;

    if(!imageFile) {
        return res.status(400).send(`Image file is mandatory.`);
    }

    if(!prompt) {
        return res.status(400).send(`Prompt is mandatory.`);
    }

    const availableModels = Object.keys(imageEditsModelConfigs.models)
    if(!availableModels.includes(model)) {
        return res.status(400).send(`Model: ${model} is not available. Available models: ${JSON.stringify(availableModels)}.`);
    }

    if(!imageEditsModelConfigs.availableResponseFormats.includes(responseFormat)) {
        return res.status(400).send(`Allowed values for response_format are: ${imageEditsModelConfigs.availableResponseFormats} only.`);
    }

    const modelConfig = imageEditsModelConfigs.models[model];

    if(numImagesToGenerate && numImagesToGenerate > 1) {
        if(numImagesToGenerate > modelConfig.maxImages) {
            return res.status(400).send(`Model ${model} only allows generating ${modelConfig.maxImages} images at a time.`);
        }
    } else {
        numImagesToGenerate = 1;
    }

    if(size) {
        if(!modelConfig.availableSizes.includes(size)) {
            return res.status(400).send(`Model ${model} only supports following sizes: ${JSON.stringify(modelConfig.availableSizes)}. Given: ${size}.`);
        }
    } else {
        size = `${modelConfig.defaultWidth}x${modelConfig.defaultHeight}`;
    }

    const { width, height } = parseDimensions(size);
    const quality = 80;
    const returnUrls = responseFormat && responseFormat === "url" ? true : false;

    const promises = [];
    const serverPublicPaths = [];
    for(let i = 0; i < numImagesToGenerate; i++) {
        const fileName = getImageFileName(prompt, width, height, quality);
        promises.push(textToImage('imageEdits', prompt, path.join(PUBLIC_FILES_DIRECTORY, fileName), width, height, quality));
        serverPublicPaths.push(`${config.publicFilesDirectory}/${fileName}`);
    }
    const paths = await Promise.all(promises);

    let data = returnUrls
        ? serverPublicPaths.map(serverPublicPath => ({ url: `http://${config.server.host}:${config.server.port}/${serverPublicPath}` }))
        : paths.map(imagePath => ({ b64_json: fs.readFileSync(imagePath).toString('base64') }));

    res.json({
        created: getTimestampSeconds(),
        data
    });
});

app.post('/v1/audio/speech', async (req, res) => {
    if(!checkAuth(req, config.apiKeys)) {
        res.sendStatus(401);
    }

    let { model, input, voice, response_format: responseFormat, speed } = req.body;

    if(!input) {
        return res.status(400).send(`Input is mandatory.`);
    }

    const availableModels = Object.keys(audioGenerationModelConfigs.models)
    if(!availableModels.includes(model)) {
        return res.status(400).send(`Model: ${model} is not available. Available models: ${JSON.stringify(availableModels)}.`);
    }

    const modelConfig = audioGenerationModelConfigs.models[model];

    if(!modelConfig.voices.includes(voice)) {
        return res.status(400).send(`Allowed values for voice are: ${JSON.stringify(modelConfig.voices)} only. Given: ${voice}.`);
    }

    if(responseFormat) {
        if(!audioGenerationModelConfigs.availableResponseFormats.includes(responseFormat)) {
            return res.status(400).send(`Allowed response formats: ${JSON.stringify(audioGenerationModelConfigs.availableResponseFormats)}. Given: ${responseFormat}.`);
        }
    } else {
        responseFormat = 'wav';
    }

    if(speed) {
        if(speed < audioGenerationModelConfigs.allowedSpeedRange[0] || speed > audioGenerationModelConfigs.allowedSpeedRange[1]) {
            return res.status(400).send(`Allowed speed range: ${JSON.stringify(audioGenerationModelConfigs.allowedSpeedRange)}. Given: ${speed}.`);
        }
    } else {
        speed = 1.0;
    }

    const durationSeconds = Math.min(modelConfig.maxDurationSeconds, input.length);

    const audioFileName = getAudioFileName(input, responseFormat, durationSeconds);
    const audioPath = path.join(PUBLIC_FILES_DIRECTORY, audioFileName);
    await generateRandomAudio(audioPath, input, responseFormat, durationSeconds);

    const mimeType = mimeTypeMap[responseFormat] || 'application/octet-stream';

    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Disposition', `attachment; filename=${audioFileName}`);  // Optionally setting content-disposition for download

    res.sendFile(audioPath, (err) => {
        if (err) {
            console.error(`Error sending file: ${audioPath}`, err);
            res.status(500).send(`Error sending file: ${audioPath}`);
        }
    });
});

app.post('/v1/audio/transcriptions', upload.single('file'), async (req, res) => {
    if(!checkAuth(req, config.apiKeys)) {
        res.sendStatus(401);
    }

    let { model, prompt, temperature, language,  response_format: responseFormat, timestamp_granularities: timestampGranularitiesReceived} = req.body;

    const audioFile = req.file;
    const audioFilePath = audioFile.path;
    const sizeInBytes = audioFile.size;

    if(!audioFile) {
        return res.status(400).send(`Audio file is mandatory`);
    }

    if(temperature) {
        if(temperature < 0 || temperature > 1) {
            return res.status(400).send(`'temperature' can only be between 0 and 1. Given: ${temperature}`);
        }
    } else {
        temperature = 0;
    }

    if(language) {
        if(!isIso6391_1(language)) {
            return res.status(400).send(`'language' should be in iso-639-1 format. Given: ${language}`);
        }
    } else {
        language = 'en';
    }

    const availableModels = Object.keys(audioTranscriptionModelConfigs.models)
    if(!availableModels.includes(model)) {
        return res.status(400).send(`Model: ${model} is not available. Available models: ${JSON.stringify(availableModels)}.`);
    }

    const modelConfig = audioTranscriptionModelConfigs.models[model];

    if(responseFormat) {
        if(!audioTranscriptionModelConfigs.availableResponseFormats.includes(responseFormat)) {
            return res.status(400).send(`Allowed response formats: ${JSON.stringify(audioTranscriptionModelConfigs.availableResponseFormats)}. Given: ${responseFormat}.`);
        }
    } else {
        responseFormat = 'wav';
    }

    let timestampGranularities = typeof timestampGranularitiesReceived === 'string' ? JSON.parse(timestampGranularitiesReceived) : timestampGranularitiesReceived;

    if(responseFormat === 'verbose_json') {
        if(!timestampGranularities || timestampGranularities.length == 0) {
            timestampGranularities = ['segment'];
        }

        if(!(timestampGranularities.length > 0 && timestampGranularities.every(v => audioTranscriptionModelConfigs.allowedTimestampGranularities.includes(v)))) {
            res.status(400).send(`timestamp_granularities can only be one of ${audioTranscriptionModelConfigs.allowedTimestampGranularities}. Given: ${timestampGranularities}.`);
            return ;
        }
    }

    res.json(await transcribeAudio(audioFilePath, sizeInBytes, prompt, model, temperature, language, responseFormat, timestampGranularities));
});

app.post('/v1/audio/translations', upload.single('file'), async (req, res) => {
    if(!checkAuth(req, config.apiKeys)) {
        res.sendStatus(401);
    }

    let { model, prompt, temperature, response_format: responseFormat} = req.body;

    const audioFile = req.file;
    const audioFilePath = audioFile.path;
    const sizeInBytes = audioFile.size;

    if(!audioFile) {
        return res.status(400).send(`Audio file is mandatory`);
    }

    if(temperature) {
        if(temperature < 0 || temperature > 1) {
            return res.status(400).send(`'temperature' can only be between 0 and 1. Given: ${temperature}`);
        }
    } else {
        temperature = 0;
    }

    const availableModels = Object.keys(audioTranslationModelConfigs.models)
    if(!availableModels.includes(model)) {
        return res.status(400).send(`Model: ${model} is not available. Available models: ${JSON.stringify(availableModels)}.`);
    }

    const modelConfig = audioTranslationModelConfigs.models[model];

    if(responseFormat) {
        if(!audioTranslationModelConfigs.availableResponseFormats.includes(responseFormat)) {
            return res.status(400).send(`Allowed response formats: ${JSON.stringify(audioTranslationModelConfigs.availableResponseFormats)}. Given: ${responseFormat}.`);
        }
    } else {
        responseFormat = 'wav';
    }

    let response = await translateAudio(audioFilePath, sizeInBytes, prompt, model, temperature, responseFormat);

    if(typeof response === 'string') {
        res.send(response);
    } else {
        res.json(response);
    }
});

app.post('/v1/embeddings', async (req, res) => {
    if(!checkAuth(req, config.apiKeys)) {
        res.sendStatus(401);
    }

    let { model, input, encoding_format: encodingFormat, dimensions, user } = req.body;

    if(!input) {
        return res.status(400).send(`Input is mandatory.`);
    }

    if(dimensions) {
        if(dimensions < 1) {
            return res.status(400).send(`'dimensions' should be greater than 0. Given: ${dimensions}.`);
        }
    } else {
        dimensions = 1536;
    }

    const availableModels = Object.keys(embeddingModelConfigs.models)
    if(!availableModels.includes(model)) {
        return res.status(400).send(`Model: ${model} is not available. Available models: ${JSON.stringify(availableModels)}.`);
    }

    const modelConfig = embeddingModelConfigs.models[model];

    let isInputValid = false;

    if (typeof input === 'string') {
        const numInputTokens = input.trim().split(/\s+/).length;
        if(numInputTokens > modelConfig.maxInputTokens) {
            return res.status(400).send(`Max allowed input tokens are: ${modelConfig.maxInputTokens}. Given: ${numInputTokens}.`);
        }
        input = [input];    // NOTE: we are updating input here
        isInputValid = true;
    } else if (Array.isArray(input)) {
        if (input.every(item => typeof item === 'string')) {
            input.forEach((inputString, idx) => {
                const numInputTokens = inputString.trim().split(/\s+/).length;
                if(numInputTokens > modelConfig.maxInputTokens) {
                    return res.status(400).send(`Max allowed input tokens are: ${modelConfig.maxInputTokens}. Given: ${numInputTokens} for input at index: ${idx}.`);
                }
            });
            isInputValid = true;
        } else if (input.every(item => Number.isInteger(item))) {
            if(input.length > embeddingModelConfigs.maxDimensions) {
                return res.status(400).send(`Max allowed input dimensions are: ${embeddingModelConfigs.maxDimensions}. Given: ${input.length}.`);
            }
            input = [input];    // NOTE: we are updating input here
            isInputValid = true;
        } else if (input.every(item => Array.isArray(item) && item.every(innerItem => Number.isInteger(innerItem)))) {
            input.forEach((inputIntegerArray, idx) => {
                if(inputIntegerArray.length > embeddingModelConfigs.maxDimensions) {
                    return res.status(400).send(`Max allowed input dimensions are: ${embeddingModelConfigs.maxDimensions}. Given: ${inputIntegerArray.length} for input at index: ${idx}.`);
                }
            });
            isInputValid = true;
        }
    }

    if(!isInputValid) {
        return res.status(400).send(`Input is invalid. Allowed: string, array of strings, array of integers, or an array of array of integers.`);
    }

    if(encodingFormat) {
        if (!embeddingModelConfigs.availableEncodingFormats.includes(encodingFormat)) {
            return res.status(400).send(`Allowed values for encoding_format are: ${JSON.stringify(embeddingModelConfigs.availableEncodingFormats)} only. Given: ${encodingFormat}.`);
        }
    } else {
        encodingFormat = 'float';
    }

    res.json(generateEmbedding(input, model, encodingFormat, dimensions));
});

app.get('/v1/models', async (req, res) => {
    if(!checkAuth(req, config.apiKeys)) {
        res.sendStatus(401);
    }

    const modelObjects = Array.from(
        new Set(
            Object.values(config.modelConfigs)
                .flatMap((category) => Object.keys(category.models))
        )
    ).map((modelName) => ({
        id: modelName,
        object: "model",
        created: getTimestampSeconds(),
        owned_by: config.organizationName
    }));


    res.json({
        object: 'list',
        data: modelObjects
    });
});

app.get('/v1/models/:model', async (req, res) => {
    if(!checkAuth(req, config.apiKeys)) {
        res.sendStatus(401);
    }

    const { model } = req.params;

    if(!model) {
        return res.status(400).send(`Model name is mandatory`);
    }

    if(!Object.values(config.modelConfigs).some((category) => model in category.models)) {
        return res.status(404).send(`Model: ${model} not available`);
    }

    res.json({
        "id": model,
        "object": "model",
        "created": getTimestampSeconds(),
        "owned_by": config.organizationName
    });
});

app.use('/public', express.static(path.join(__dirname, config.publicFilesDirectory)));

app.listen(config.server.port, config.server.host, () => {
    console.log(`Mock OpenAI API server is running at http://${config.server.host}:${config.server.port}`);
});

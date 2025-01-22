import path from "path";
import fs from "fs";
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import ffmpeg from "fluent-ffmpeg";
ffmpeg.setFfmpegPath(ffmpegInstaller.path);
import seedrandom from 'seedrandom';
import {fileURLToPath} from "url";
import crypto from "crypto";
import {repeatText, generateTokens} from '../utils.js';
import {getResponseForAudioGeneration, getTranscription, getTranslation} from '../generators/audio.js';

const TOKENS_PER_SEGMENT = 14;

const mimeTypeMap = {
    mp3: 'audio/mpeg',
    opus: 'audio/opus',
    aac: 'audio/aac',
    flac: 'audio/flac',
    wav: 'audio/wav',
    pcm: 'audio/L16', // For raw PCM data
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const timestampGranularitiesFunctionMap = {
    word: textToWordTimeStamps,
    segment: textToSegmentTimeStamps
};

async function generateRandomAudio(outputFilePath, seed = null, outputFormat = 'mp3', durationSeconds = 5) {
    const supportedFormats = ["mp3", "opus", "aac", "flac", "wav", "pcm"];

    if (!supportedFormats.includes(outputFormat)) {
        throw new Error(`Unsupported output format: ${outputFormat}. Please use one of: ${supportedFormats.join(', ')}`);
    }

    return await getResponseForAudioGeneration(seed, durationSeconds, outputFormat, outputFilePath);
}

async function transcribeAudio(filePath, sizeInBytes, prompt, model, temperature, language, responseFormat, timestampGranularities) {
    const transcription = getTranscription(sizeInBytes, prompt, model, temperature, language);
    const audioDurationSeconds = await getAudioDurationSeconds(filePath);

    return await formatAudioTextResponse("transcribe", responseFormat, timestampGranularities, language, audioDurationSeconds, transcription);
}

async function translateAudio(filePath, sizeInBytes, prompt, model, temperature, responseFormat) {
    const transcription = getTranslation(sizeInBytes, prompt, model, temperature);
    const audioDurationSeconds = await getAudioDurationSeconds(filePath);

    const timestampGranularities = responseFormat === 'verbose_json' ? ['word', 'segment'] : null;

    return await formatAudioTextResponse("translate", responseFormat, timestampGranularities, 'english', audioDurationSeconds, transcription);
}

async function formatAudioTextResponse(task, responseFormat, timestampGranularities, language, audioDurationSeconds, text) {
    if(responseFormat === 'text') {
        return text;
    } else if(responseFormat === 'json') {
        return { text };
    } else if(responseFormat === 'verbose_json') {
        let response = {
            task: task,
            language: language,
            duration: audioDurationSeconds,
            text: text
        };

        const entries = timestampGranularities.map(tg => [`${tg}s`, timestampGranularitiesFunctionMap[tg](text, language, audioDurationSeconds)]);
        const timestampsArrayMaps = Object.fromEntries(entries);

        return Object.assign(response, timestampsArrayMaps);
    } else if(responseFormat === 'srt') {
        return textToSrt(text, audioDurationSeconds);
    } else if(responseFormat === 'vtt') {
        return textToVtt(text, audioDurationSeconds);
    }
}

function textToWordTimeStamps(text, language = "english", totalDuration = 10) {
    const words = text.split(/\s+/);
    const totalChars = text.replace(/\s+/g, '').length; // Exclude spaces
    const durationPerChar = totalDuration / totalChars;

    let currentTime = 0;

    return words.map(word => {
        const wordDuration = word.length * durationPerChar;
        const wordStart = currentTime;
        const wordEnd = wordStart + wordDuration;

        currentTime = wordEnd;

        return {
            word: word,
            start: wordStart,
            end: wordEnd,
        };
    });
}

function textToSegmentTimeStamps(text, language = "english", totalDuration = 10) {
    const segments = text.match(/[^.!?]+[.!?]/g) || [text];
    const durationPerSegment = totalDuration / segments.length;

    let currentTime = 0;

    return segments.map((segment, index) => {
        const segmentStart = currentTime;
        const segmentEnd = segmentStart + durationPerSegment;

        currentTime = segmentEnd;

        const tokens = generateTokens(segment, TOKENS_PER_SEGMENT);

        return {
            id: index,
            seek: Math.floor(segmentStart * 100), // Example: seek in milliseconds
            start: segmentStart,
            end: segmentEnd,
            text: segment.trim(),
            tokens: tokens,
            temperature: 0.0, // Mocked value
            avg_logprob: -0.28 + Math.random() * 0.02, // Mocked value
            compression_ratio: 1.23 + Math.random() * 0.02, // Mocked value
            no_speech_prob: Math.random() * 0.01, // Mocked value
        };
    });
}

function textToSrt(text, totalDuration) {
    const sentences = text.match(/[^.!?]+[.!?]/g) || [text];
    const durationPerSentence = totalDuration / sentences.length;

    let currentTime = 0;

    const srt = sentences.map((sentence, index) => {
        const start = currentTime;
        const end = start + durationPerSentence;

        const formattedStart = formatTimestampForSrt(start);
        const formattedEnd = formatTimestampForSrt(end);

        currentTime = end;

        return `${index + 1}\n${formattedStart} --> ${formattedEnd}\n${sentence.trim()}\n`;
    });

    return srt.join('\n');
}

function textToVtt(text, totalDuration) {
    const sentences = text.match(/[^.!?]+[.!?]/g) || [text];
    const durationPerSentence = totalDuration / sentences.length;

    let currentTime = 0;

    const vtt = sentences.map((sentence) => {
        const start = currentTime;
        const end = start + durationPerSentence;

        const formattedStart = formatTimestampForVtt(start);
        const formattedEnd = formatTimestampForVtt(end);

        currentTime = end;

        return `${formattedStart} --> ${formattedEnd}\n${sentence.trim()}`;
    });

    return `WEBVTT\n\n${vtt.join('\n\n')}`;
}

function formatTimestampForSrt(seconds) {
    const hours = String(Math.floor(seconds / 3600)).padStart(2, '0');
    const minutes = String(Math.floor((seconds % 3600) / 60)).padStart(2, '0');
    const secs = String(Math.floor(seconds % 60)).padStart(2, '0');
    const millis = String(Math.floor((seconds % 1) * 1000)).padStart(3, '0');
    return `${hours}:${minutes}:${secs},${millis}`;
}

function formatTimestampForVtt(seconds) {
    const hours = String(Math.floor(seconds / 3600)).padStart(2, '0');
    const minutes = String(Math.floor((seconds % 3600) / 60)).padStart(2, '0');
    const secs = String(Math.floor(seconds % 60)).padStart(2, '0');
    const millis = String(Math.floor((seconds % 1) * 1000)).padStart(3, '0');
    return `${hours}:${minutes}:${secs}.${millis}`;
}

function getAudioDurationSeconds(audioPath) {
    return new Promise((resolve, reject) => {
        ffmpeg.ffprobe(audioPath, (err, metadata) => {
            if (err) {
                reject(err);
                return ;
            }
            resolve(metadata.format.duration);
        });
    });
}

function getAudioFileName(prompt, responseFormat, durationSeconds) {
    const hash = crypto.createHash('md5').update(`${prompt}-${responseFormat}-${durationSeconds}`).digest('hex');
    return `${hash}.${responseFormat}`;
}

export {
    generateRandomAudio,
    getAudioFileName,
    mimeTypeMap,
    transcribeAudio,
    translateAudio
}

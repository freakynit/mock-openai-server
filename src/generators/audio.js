import seedrandom from "seedrandom";
import path from "path";
import fs from "fs";
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import ffmpeg from "fluent-ffmpeg";
ffmpeg.setFfmpegPath(ffmpegInstaller.path);
import {repeatText} from "../utils.js";
import {fileURLToPath} from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TRANSCRIPTION_REPETITION_BOUNDARY_BYTES = 1 * 1024 * 1024;    // repeat transcribed text N number of times based on size of uploaded file

let config = null;

let samplesGenerationFrom = 'generated';
let audioGenerationCachedData = null;

async function init(cfg) {
    config = cfg;

    samplesGenerationFrom = config?.modelConfigs?.audioGeneration?.generationFrom ?? 'generated';

    if(samplesGenerationFrom === 'samples') {
        audioGenerationCachedData = await processAudioFiles(config?.modelConfigs?.audioGeneration?.sampleResponseFiles);
    }
}

async function getResponseForAudioGeneration(seed, durationSeconds, outputFormat, outputFilePath) {
    let pcmBuffer = null;
    let sampleRate = null;
    let numChannels = 1;

    if(samplesGenerationFrom === 'samples') {
        let audioData = audioGenerationCachedData[Math.floor(Math.random() * audioGenerationCachedData.length)];
        pcmBuffer = audioData.buffer;
        sampleRate = audioData.sampleRate;
        numChannels = audioData.channels;
    } else {
        sampleRate = 44100; // Common sample rate
        const numSamples = sampleRate * durationSeconds;
        const bitsPerSample = 16;
        const bytesPerSample = bitsPerSample / 8;
        numChannels = 1; // Mono
        const totalBytes = numSamples * bytesPerSample * numChannels;

        pcmBuffer = generateBuffer(seed, totalBytes);
    }

    if (outputFormat === "pcm") {
        fs.writeFileSync(outputFilePath, pcmBuffer);
        return;
    }

    await convertToFormat(pcmBuffer, sampleRate, numChannels, outputFormat, outputFilePath);
}

function getTranscription(audioFileSizeInBytes, prompt, model, temperature, language) {
    const sampleResponses = config.modelConfigs.audioTranscription.sampleResponses;

    const transcription = sampleResponses[Math.floor(Math.random() * sampleResponses.length)];
    const repetition = Math.floor(audioFileSizeInBytes / TRANSCRIPTION_REPETITION_BOUNDARY_BYTES);

    return repeatText(transcription, repetition);
}

function getTranslation(audioFileSizeInBytes, prompt, model, temperature) {
    const sampleResponses = config.modelConfigs.audioTranslation.sampleResponses;

    const transcription = sampleResponses[Math.floor(Math.random() * sampleResponses.length)];
    const repetition = Math.floor(audioFileSizeInBytes / TRANSCRIPTION_REPETITION_BOUNDARY_BYTES);

    return repeatText(transcription, repetition);
}

function convertToPCM(inputFile) {
    return new Promise((resolve, reject) => {
        ffmpeg.ffprobe(inputFile, (err, metadata) => {
            if (err) {
                return reject(`Error retrieving metadata: ${err.message}`);
            }

            const stream = metadata.streams.find((s) => s.codec_type === "audio");
            if (!stream) {
                return reject("No audio stream found in the file.");
            }

            const sampleRate = stream.sample_rate ? parseInt(stream.sample_rate, 10) : null;
            const channels = stream.channels || null;

            if (!sampleRate || !channels) {
                return reject("Unable to retrieve audio sample rate or channels.");
            }

            const outputBuffers = [];
            const command = ffmpeg(inputFile)
                .audioCodec("pcm_s16le") // Set audio codec to PCM 16-bit little-endian
                .format("s16le") // Raw PCM output format
                .on("error", (err) => {
                    reject(`Error processing file ${inputFile}: ${err.message}`);
                })
                .on("end", () => {
                    resolve({ sampleRate, channels, buffer: Buffer.concat(outputBuffers) });
                });

            command.pipe()
                .on("data", (chunk) => {
                    outputBuffers.push(chunk);
                });
        });
    });
}

async function processAudioFiles(files) {
    if(files) {
        const results = [];
        for (const file of files) {
            try {
                //console.log(`Processing file: ${file}`);
                const data = await convertToPCM(file);
                results.push(data);
                //console.log(`Finished processing file: ${file}`);
            } catch (error) {
                console.error(error);
            }
        }
        return results;
    }

    return null;
}

function generateBuffer(seed, totalBytes) {
    const rng = seed ? seedrandom(seed.toString()) : Math.random;
    const buffer = Buffer.alloc(totalBytes);
    for (let i = 0; i < totalBytes; i += 2) {
        const randomSample = Math.round((rng() * 65534) - 32767);
        buffer.writeInt16LE(randomSample, i);
    }
    return buffer;
}

function convertToFormat(buffer, sampleRate, numChannels, format, outputFilePath) {
    return new Promise((resolve, reject) => {
        const tempPcmPath = path.join(__dirname, 'temp.pcm');
        fs.writeFileSync(tempPcmPath, buffer);

        ffmpeg(tempPcmPath)
            .inputFormat('s16le')
            .audioFrequency(sampleRate)
            .audioChannels(numChannels)
            .toFormat(format)
            .on('end', () => {
                fs.unlinkSync(tempPcmPath); // Delete the temporary PCM file
                resolve(outputFilePath);
            })
            .on('error', (err) => {
                fs.unlinkSync(tempPcmPath); // Delete the temporary PCM file in case of error
                reject(new Error(`FFmpeg error: ${err.message}`));
            })
            .save(outputFilePath);
    });
}

export {
    init,
    getResponseForAudioGeneration,
    getTranscription,
    getTranslation
};

import { v4 as uuidv4 } from 'uuid';
import crypto from "crypto";
import ISO6391 from 'iso-639-1';

const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

function getTimestampSeconds() {
    return Math.floor(Date.now() / 1000);
}

function getId() {
    return `gen-${getTimestampSeconds()}-${uuidv4()}`;
}

function getRandomString(numChars) {
    let result = '';
    for (let i = 0; i < numChars; i++) {
        const randomIndex = Math.floor(Math.random() * characters.length);
        result += characters[randomIndex];
    }
    return result;
}

const clipText = (text, len) => text.length > len ? text.slice(0, len) + '...' : text;

function generateTokens(input, tokenCount, asFloats= false) {
    const vocabularySize = 300_000;

    if (tokenCount <= 0) throw new Error("Token count must be greater than 0");

    const seed = parseInt(crypto.createHash("md5").update(typeof input === "string" ? input : Buffer.from(input)).digest("hex").slice(0, 8), 16);

    // Create a deterministic PRNG based on the seed
    function seededRandom(seed) {
        let value = seed % vocabularySize;
        return function () {
            value = (value * 16807) % vocabularySize;
            return asFloats ? value/vocabularySize : value;
        };
    }

    // Generate tokens
    const random = seededRandom(seed);
    const tokens = Array.from({ length: tokenCount }, () => random());

    return tokens;
}

function repeatText(text, n) {
    if (n <= 0) {
        return text;
    }
    return Array(n).fill(text).join(' | ');
}

function isIso6391_1(languageString) {
    return ISO6391.validate(languageString);
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function floatsArrayToBase64(floats) {
    return Buffer.from(new Float32Array(floats).buffer).toString('base64');
}

function base64ToFloatsArray(base64String) {
    const binaryBuffer = Buffer.from(base64String, 'base64');
    return new Float32Array(binaryBuffer.buffer, binaryBuffer.byteOffset, binaryBuffer.length / Float32Array.BYTES_PER_ELEMENT);
}

function getRandomDivisibleBy(min, max, divisor) {
    min = Math.ceil(min / divisor) * divisor;
    max = Math.floor(max / divisor) * divisor;

    return Math.floor(Math.random() * ((max - min) / divisor + 1)) * divisor + min;
}

export {
    getId,
    getRandomString,
    clipText,
    getTimestampSeconds,
    generateTokens,
    repeatText,
    isIso6391_1,
    sleep,
    floatsArrayToBase64,
    base64ToFloatsArray,
    getRandomDivisibleBy
}

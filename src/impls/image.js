import crypto from "crypto";
import fs from "fs";
import sharp from "sharp";
import {getResponseForImageGeneration} from '../generators/image.js';

async function textToImage(task, text, imagePath, width, height, quality = 80) {
    if(text == null || text.length == 0) {
        return null;
    }

    const buffer = await getResponseForImageGeneration(task, text, width, height, quality);

    await sharp(buffer)
        .resize(width, height)
        .jpeg({ quality })
        .toFile(imagePath);

    return imagePath;
}

function parseDimensions(dimensions) {
    if (!dimensions) {
        return null;
    }

    const parts = dimensions.split('x');
    if (parts.length !== 2) {
        return null;
    }

    const width = parseInt(parts[0], 10);
    const height = parseInt(parts[1], 10);

    if (isNaN(width) || isNaN(height)) {
        return null;
    }

    return { width, height };
}

function getImageFileName(prompt, width, height, quality) {
    const hash = crypto.createHash('md5').update(`${prompt}-${width}-${height}-${quality}`).digest('hex');
    return `${hash}.jpeg`;
}

export {
    textToImage,
    getImageFileName,
    parseDimensions
}

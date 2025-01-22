import fs from "fs";

let config = null;

let samplesGenerationSource = {
    'imageGeneration': 'generated',
    'imageVariations': 'generated',
    'imageEdits': 'generated',
};

function init(cfg) {
    config = cfg;

    Object.keys(samplesGenerationSource).forEach(key => {
        samplesGenerationSource[key] = config?.modelConfigs?.[key]?.generationFrom ?? 'generated'
    });
}

async function getResponseForImageGeneration(task, prompt, width, height, quality) {
    if(prompt == null || prompt.length == 0) {
        return null;
    }

    if(samplesGenerationSource[task] === 'samples') {
        const sampleFiles = config?.modelConfigs?.[task]?.sampleResponseFiles ?? [];
        return fs.readFileSync(sampleFiles[Math.floor(Math.random() * sampleFiles.length)]);
    } else {
        const svg = `
        <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
            <rect width="100%" height="100%" fill="#ddd" />
            <text x="50%" y="50%" font-size="20" font-family="Arial, sans-serif" fill="#000" text-anchor="middle" alignment-baseline="middle">
                ${prompt}
            </text>
        </svg>
    `;

        return Buffer.from(svg);
    }
}

export {
    init,
    getResponseForImageGeneration
};

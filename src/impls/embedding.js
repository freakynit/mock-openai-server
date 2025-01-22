import {floatsArrayToBase64} from "../utils.js";
import {getResponseForEmbedding} from '../generators/embedding.js';

// input can be array of strings or an array of array of integers
function generateEmbedding(input, model, encodingFormat, tokenCount) {
    let response = {
        object: 'list',
        data: [],
        model,
        usage: {
            prompt_tokens: 0,
            total_tokens: 0
        }
    };

    input.forEach((item, idx) => {
        response.data.push({
            object: 'embedding',
            index: idx,
            embedding: getResponseForEmbedding(item, tokenCount)
        });
        response.usage.prompt_tokens += item.length;
        response.usage.total_tokens += item.length;
    });

    response.data = encodingFormat === 'base64'
        ? response.data.map(embeddingContainer => ({...embeddingContainer, embedding: floatsArrayToBase64(embeddingContainer.embedding)}))
        : response.data;

    return response;
}

export {
    generateEmbedding
};

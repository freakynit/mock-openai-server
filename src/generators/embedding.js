import {generateTokens} from "../utils.js";

let config = null;

function init(cfg) {
    config = cfg;
}

// input can be a 'string' or 'array of integers(to be treated as one input)'
function getResponseForEmbedding(input, dimensions) {
    return generateTokens(input, dimensions, true)
}

export {
    init,
    getResponseForEmbedding
};

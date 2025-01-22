import {fileURLToPath} from "url";
import path from "path";
import {getId, getRandomString, getTimestampSeconds, sleep} from "../utils.js";
import {getResponseForChatCompletion} from '../generators/chat.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function applyStopSequences(content, stopSequences) {
    return stopSequences == null
        ? content
        : stopSequences
            .filter(stopSequence => content.indexOf(stopSequence) > -1)
            .map(stopSequence => content.substring(0, content.indexOf(stopSequence)))
            .reduce((a, b) => a.length <= b.length ? a : b, content)
}

function applyFrequencyPenalty(input, frequencyPenalty = 0) {
    if (!input || typeof frequencyPenalty !== 'number' || frequencyPenalty < -2 || frequencyPenalty > 2) {
        return input;
    }

    const words = input.split(/\s+/);
    const wordFrequency = {};
    const adjustedWords = [];

    for (const word of words) {
        const lowerWord = word.toLowerCase();
        wordFrequency[lowerWord] = (wordFrequency[lowerWord] || 0) + 1;

        const penalty = frequencyPenalty * (wordFrequency[lowerWord] - 1);
        const keepWord = Math.random() > Math.min(1, Math.max(0, penalty)); // Randomly keep/discard

        if (keepWord || frequencyPenalty <= 0) {
            adjustedWords.push(word);
        }
    }

    return adjustedWords.join(' ');
}

function applyPresencePenalty(input, presencePenalty = 0) {
    if (!input || typeof presencePenalty !== 'number' || presencePenalty < -2 || presencePenalty > 2) {
        return input;
    }

    const words = input.split(/\s+/);
    const wordPresence = {};

    words.forEach(word => {
        wordPresence[word] = (wordPresence[word] || 0) + 1;
    });

    const penalizedContent = words.map(word => {
        const penalty = presencePenalty * (wordPresence[word] > 1 ? 1 : 0);
        if (penalty > 0) {
            return "";
        }
        return word;
    });

    return penalizedContent.filter(word => word !== "").join(" ");
}

function updateContent(content, stopSequences, maxTokens, frequencyPenalty, presencePenalty) {
    let updatedContent = content;

    if(maxTokens) updatedContent = content.slice(0, maxTokens);
    updatedContent = applyStopSequences(updatedContent, stopSequences);
    updatedContent = applyFrequencyPenalty(updatedContent, frequencyPenalty);
    updatedContent = applyPresencePenalty(updatedContent, presencePenalty);

    return updatedContent;
}

function getPromptLength(messages) {
    if(!messages || !Array.isArray(messages)) return 0;

    let totalLength = 0;

    messages.forEach(message => {
        if (Array.isArray(message.content)) {
            message.content.forEach(item => {
                if (item.type === "text" && typeof item.text === "string") {
                    totalLength += item.text.length;
                }
            });
        } else if (typeof message.content === "string") {
            totalLength += message.content.length;
        }
    });

    return totalLength;
}

function processContentOrToolCalls(contentOrToolCalls, stopSequences, maxTokens, frequencyPenalty, presencePenalty) {
    let finishReason = 'stop';
    let completionTokens = 0;
    let errorCode = null;
    let errorMessage = null;

    if(('tool_calls' in contentOrToolCalls) && contentOrToolCalls['tool_calls'] != null && contentOrToolCalls['tool_calls'].length > 0) {
        const allArgs = contentOrToolCalls['tool_calls'].map(tc => tc.arguments);
        if(JSON.stringify(allArgs).length > maxTokens) {
            errorCode = 400;
            errorMessage = 'Could not finish the message because max_tokens was reached. Please try again with higher max_tokens.';
        } else {
            completionTokens += JSON.stringify(allArgs).length;
            finishReason = 'tool_calls';
        }
    } else {
        let contentBefore = contentOrToolCalls['content'];

        contentOrToolCalls['content'] = updateContent(contentOrToolCalls['content'], stopSequences, maxTokens, frequencyPenalty, presencePenalty)
        completionTokens += contentOrToolCalls['content'].length;

        finishReason = contentBefore.length != contentOrToolCalls['content'].length ? 'length' : 'stop';
    }

    return {
        contentOrToolCalls, finishReason, completionTokens, errorCode, errorMessage
    }
}

function oneShotResponse({ model, messages, tools, toolChoice, maxTokens, numGenerations, temperature, stopSequences, frequencyPenalty, presencePenalty, isJsonOutput, givenJsonSchema, onData, onError }) {
    const promptTokens = getPromptLength(messages) + (tools ? JSON.stringify(tools).length : 0);

    let completionTokens = 0;

    let choices = [];
    for(let i = 0; i < numGenerations; i++) {
        let {contentOrToolCalls: contentOrToolCallsOriginal, errorCode, errorMessage} = getResponseForChatCompletion(messages, tools, toolChoice, isJsonOutput);
        if(errorCode) {
            return onError(errorCode, errorMessage);
        }

        let {contentOrToolCalls, finishReason, completionTokens: completionTokensUpdated, errorCode: errorCode2, errorMessage: errorMessage2}
            = processContentOrToolCalls(contentOrToolCallsOriginal, stopSequences, maxTokens, frequencyPenalty, presencePenalty);
        if(errorCode2) {
            return onError(errorCode2, errorMessage2);
        }

        completionTokens = completionTokensUpdated;

        let isToolResponse = ('tool_calls' in contentOrToolCalls) && contentOrToolCalls['tool_calls'] != null && contentOrToolCalls['tool_calls'].length > 0;

        choices.push({
            index: i,
            message: {
                role: 'assistant',
                content: isToolResponse ? null : contentOrToolCalls['content'],
                tool_calls: isToolResponse ? contentOrToolCalls['tool_calls'].map((tc, idx) => ({
                    index: idx,
                    id: `call_${getRandomString(24)}`,
                    type: 'function',
                    'function': {
                        name: tc.name,
                        arguments: JSON.stringify(tc.arguments)
                    }
                })) : null
            },
            finish_reason: finishReason,
        });
    }

    onData({
        id: getId(),
        object: 'chat.completion',
        created: getTimestampSeconds(),
        model,
        choices,
        usage: {
            prompt_tokens: promptTokens,
            completion_tokens: completionTokens,
            total_tokens: promptTokens + completionTokens,
            prompt_tokens_details: { cached_tokens: 0, audio_tokens: 0 },
            completion_tokens_details: {
                reasoning_tokens: 0,
                audio_tokens: 0,
                accepted_prediction_tokens: 0,
                rejected_prediction_tokens: 0
            }
        }
    });
}

function streamResponse({ model, messages, tools, toolChoice, maxTokens, temperature, stopSequences, frequencyPenalty, presencePenalty, addExtraUsageOnlyChunk, isJsonOutput, givenJsonSchema, onChunk, onCompletion, onError }) {
    const promptTokens = getPromptLength(messages) + (tools ? JSON.stringify(tools).length : 0);

    const id = getId();
    let completionTokens = 0;

    let {contentOrToolCalls: contentOrToolCallsOriginal, errorCode, errorMessage} = getResponseForChatCompletion(messages, tools, toolChoice, isJsonOutput);
    if(errorCode) {
        return onError(errorCode, errorMessage);
    }

    let {contentOrToolCalls, finishReason, completionTokens: completionTokensUpdated, errorCode: errorCode2, errorMessage: errorMessage2}
        = processContentOrToolCalls(contentOrToolCallsOriginal, stopSequences, maxTokens, frequencyPenalty, presencePenalty);
    if(errorCode2) {
        return onError(errorCode2, errorMessage2);
    }

    completionTokens = completionTokensUpdated;

    let areTheseToolChunks = false;
    let chunks = [];
    if(('tool_calls' in contentOrToolCalls) && contentOrToolCalls['tool_calls'] != null && contentOrToolCalls['tool_calls'].length > 0) {
        areTheseToolChunks = true;

        const toolCallId =`call_${getRandomString(24)}`;

        for(let idx = 0; idx < contentOrToolCalls['tool_calls'].length; idx++) {
            const tc = contentOrToolCalls['tool_calls'][idx];
            const argumentStringChunks = JSON.stringify(tc.arguments).split(/\s+/);

            argumentStringChunks.forEach(argumentStringChunk => chunks.push({
                index: idx,
                id: toolCallId,
                type: 'function',
                function: {
                    name: tc.name,
                    arguments: argumentStringChunk
                }
            }));
        }
    } else {
        areTheseToolChunks = false;
        chunks = contentOrToolCalls['content'].split(/\s+/);
    }

    let chunkIndex = 0;

    const sendData = () => {
        if (chunkIndex >= chunks.length) {
            onCompletion();
            return;
        }

        onChunk(buildResponsePart(model, id, chunks, chunkIndex, areTheseToolChunks, finishReason, null));

        if(addExtraUsageOnlyChunk && chunkIndex === (chunks.length - 1)) {
            onChunk(buildResponsePart(model, id, chunks, -1, areTheseToolChunks, finishReason, {
                prompt_tokens: promptTokens,
                completion_tokens: completionTokens,
                total_tokens: promptTokens + completionTokens,
                prompt_tokens_details: { cached_tokens: 0, audio_tokens: 0 },
                completion_tokens_details: {
                    reasoning_tokens: 0,
                    audio_tokens: 0,
                    accepted_prediction_tokens: 0,
                    rejected_prediction_tokens: 0
                }
            }));
        }

        chunkIndex++;
        setTimeout(sendData, 100);
    };

    sendData();
}

// index = -1 represents extra usage-only chunk. 'choices' field should be sent empty in this case.
function buildResponsePart(model, id, chunks, chunkIndex, areTheseToolChunks, finishReason, usage) {
    return {
        id: id,
        object: 'chat.completion.chunk',
        created: getTimestampSeconds(),
        model: model,
        choices: chunkIndex === -1 ? [] : [
            {
                index: 0,   // this is message index... same for all chunks corresponding to a single message response stream... increments according to 'n'(`numGenerations`)... not applicable to stream mode though
                delta: {
                    role: "assistant",
                    content: areTheseToolChunks ? null : chunks[chunkIndex] + " ",
                    tool_calls: areTheseToolChunks ? [chunks[chunkIndex]] : null
                },
                finish_reason: chunkIndex === chunks.length - 1 ? finishReason : null
            }
        ],
        usage
    };
}

export {
    oneShotResponse,
    streamResponse
}
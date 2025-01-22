let config = null;
const registeredFunctions = {};

// public methods

function init(cfg) {
    config = cfg;

    initToolsCache();
}

function initToolsCache() {
    const functions = config.modelConfigs.chat.tools.functions;

    functions.forEach((func) => {
        registeredFunctions[func.functionName] = {
            'regex': new RegExp(func.regexToMatchAgainstPrompt.replace(/[\r\n]+$/, '')),
            'arguments': func.arguments
        };
    });
}

function getResponseForChatCompletion(messages, tools, toolChoice, returnJsonFormattedStrings = false) {
    let contentOrToolCalls = null;
    let errorCode = null;
    let errorMessage = null;

    const promptInputs = getPromptInputs(messages);
    const lastInput = promptInputs && promptInputs.length > 0 ? promptInputs[promptInputs.length - 1] : null;

    if (!lastInput) return null;

    if(!tools || tools.length == 0 || (typeof toolChoice === 'string' && toolChoice === 'none')) {
        contentOrToolCalls = {
            'tool_calls': null,
            'content': getNonToolResponse(lastInput, returnJsonFormattedStrings)
        };
    } else {
        const toolResponse = getToolResponse(
            lastInput,
            tools,
            (typeof toolChoice === 'string' && toolChoice === 'auto'),
            (typeof toolChoice === 'string' && toolChoice === 'required'),
            typeof toolChoice !== 'string',
            toolChoice
        );

        if(toolResponse['errorCode']) {
            contentOrToolCalls = null;
            errorCode = toolResponse['errorCode'];
            errorMessage = toolResponse['errorMessage'];
        } else {
            contentOrToolCalls = {
                'tool_calls': toolResponse['toolCalls'],
                'content': toolResponse['toolCalls'] ? null : "Unable to find any matching tool."
            }
        }
    }

    return {contentOrToolCalls, errorCode, errorMessage};
}

function getMatchingFunctionsAndArgs(toolsArrayFromClient, textToMatch) {
    const matches = [];

    for (const obj of toolsArrayFromClient) {
        if (obj.type === "function") {
            const functionName = obj.function.name;

            if (registeredFunctions[functionName]) {
                if (registeredFunctions[functionName]['regex'].test(textToMatch)) {
                    matches.push({
                        name: functionName,
                        arguments: registeredFunctions[functionName].arguments
                    });
                }
            }
        }
    }

    return matches;
}

function getNonToolResponse(lastInput, returnJsonFormattedStrings) {
    let sampleResponses = [];

    if (returnJsonFormattedStrings) {
        sampleResponses = 'imageUrl' in lastInput ? config.modelConfigs.vlm.sampleResponsesForJsonOutput.map(r => JSON.stringify(r)) : config.modelConfigs.chat.sampleResponsesForJsonOutput.map(r => JSON.stringify(r));
    } else {
        sampleResponses = 'imageUrl' in lastInput ? config.modelConfigs.vlm.sampleResponses : config.modelConfigs.chat.sampleResponses;
    }

    return sampleResponses[Math.floor(Math.random() * sampleResponses.length)];
}

function getToolResponse(lastInput, tools, toolChoiceAuto, toolChoiceRequired, toolChoiceSpec, toolChoiceGivenSpec) {
    let toolCalls = null;
    let errorCode = null;
    let errorMessage = null;

    if(toolChoiceSpec) {
        if(registeredFunctions[toolChoiceGivenSpec.function.name]) {
            toolCalls = [{
                name: toolChoiceGivenSpec.function.name,
                arguments: registeredFunctions[toolChoiceGivenSpec.function.name].arguments
            }];
        } else {
            errorCode = 400;
            errorMessage = `Sample response for required function: ${toolChoiceSpec.function.name} not given in mock server config.`;
        }
    } else {
        const matchingFunctionsAndArgs = getMatchingFunctionsAndArgs(tools, lastInput?.user?.text);

        if(!matchingFunctionsAndArgs || matchingFunctionsAndArgs.length == 0) {
            if(toolChoiceRequired) {
                const firstRegisteredFunctionName = Object.keys(registeredFunctions)[0];

                toolCalls = [{
                    name: firstRegisteredFunctionName,
                    arguments: registeredFunctions[firstRegisteredFunctionName].arguments
                }];
            } else {
                toolCalls = null;
            }
        } else {
            toolCalls = matchingFunctionsAndArgs;
        }
    }

    return {toolCalls, errorCode, errorMessage};
}

// Returns array of the form:
// [
//     {user: {text: 'prompt by the user'}},
//     {assistant: {text: 'assistant response'}},
//     {user: {text: 'another prompt by the user', 'imageUrl': 'optional imageUrl field value'}},
//     {...},
//     {...}
// ]
function getPromptInputs(messages) {
    const result = [];

    messages.forEach(message => {
        const key = message.role;
        const entry = { [key]: {} };

        if (typeof message.content === "string") {
            entry[key]['text'] = message.content;
        } else if (Array.isArray(message.content)) {
            message.content.forEach(item => {
                if (item.type === "text" && typeof item.text === "string") {
                    entry[key]['text'] = item.text;
                } else if (item.type === "image_url" && item.image_url && item.image_url.url) {
                    entry[key]['imageUrl'] = item.image_url.url;
                }
            });
        } else if (Array.isArray(message.tool_calls)) {
            message.tool_calls.forEach(item => {
                if (item.type === "function") {
                    entry[key] = {
                        type: 'function',
                        functionName: item.function.name,
                        arguments: item.function.arguments
                    }
                }
            });
        }

        result.push(entry);
    });

    return result;
}

export {
    init,
    getResponseForChatCompletion
};

// processor.js - Azure TTS 语音合成处理器
const axios = require('axios');

/**
 * 将文本合成为语音
 * @param {string} text - 要合成的文本
 * @param {string} voice - 语音名称 (如 en-GB-SoniaNeural)
 * @param {number} rate - 语速 (0.5-2.0)
 * @param {number} pitch - 音调 (-50 到 50)
 * @returns {Promise<Buffer>} 音频数据
 */
async function synthesizeSpeech(text, voice, rate, pitch) {
    const AZURE_KEY = process.env.AZURE_KEY;
    const AZURE_REGION = process.env.AZURE_REGION;
    
    if (!AZURE_KEY || !AZURE_REGION) {
        throw new Error('Azure credentials not configured');
    }

    const endpoint = `https://${AZURE_REGION}.tts.speech.microsoft.com/cognitiveservices/v1`;
    
    const voiceName = voice || 'en-GB-SoniaNeural';
    const speed = rate || 1.0;
    const pitchValue = pitch || 0;

    const ssml = `
        <speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en-GB">
            <voice name="${voiceName}">
                <prosody rate="${speed}" pitch="${pitchValue}%">
                    ${text}
                </prosody>
            </voice>
        </speak>
    `;

    try {
        const response = await axios({
            method: 'post',
            url: endpoint,
            headers: {
                'Ocp-Apim-Subscription-Key': AZURE_KEY,
                'Content-Type': 'application/ssml+xml',
                'X-Microsoft-OutputFormat': 'audio-16khz-128kbitrate-mono-mp3',
                'User-Agent': 'Linguaskill-TTS-Proxy'
            },
            data: ssml,
            responseType: 'arraybuffer'
        });

        return response.data;
    } catch (error) {
        console.error('Azure TTS 合成错误:', error.message);
        throw error;
    }
}

module.exports = { synthesizeSpeech };

// api/tts.js — Azure TTS + OpenAI + STT 代理 (最簡化穩定版)
export default async function handler(req, res) {
    // ============================================================
    // 1. CORS 預檢請求 (OPTIONS)
    // ============================================================
    if (req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-proxy-secret');
        return res.status(200).end();
    }

    // ============================================================
    // 2. 只允許 POST 請求
    // ============================================================
    if (req.method !== 'POST') {
        return res.status(405).json({ error: '只允許 POST 請求' });
    }

    // ============================================================
    // 3. 驗證密鑰
    // ============================================================
    const secret = req.headers['x-proxy-secret'];
    const expectedSecret = process.env.PROXY_SECRET;

    if (!expectedSecret) {
        return res.status(500).json({ error: '伺服器設定錯誤' });
    }
    if (secret !== expectedSecret) {
        return res.status(403).json({ error: '未授權' });
    }

    // ============================================================
    // 4. 解析請求
    // ============================================================
    const { action, text, voice, rate, sttAudio, prompt } = req.body;

    // 環境變數
    const subscriptionKey = process.env.AZURE_KEY;
    const region = process.env.AZURE_REGION || 'southeastasia';
    const openaiKey = process.env.AZURE_OPENAI_KEY;
    const openaiEndpoint = process.env.AZURE_OPENAI_ENDPOINT;
    const openaiDeployment = process.env.AZURE_OPENAI_DEPLOYMENT || 'gpt-5-mini';
    const sttKey = process.env.AZURE_STT_KEY || subscriptionKey;

    function setCorsHeaders() {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-proxy-secret');
    }

    // ============================================================
    // 5. Azure TTS (語音合成)
    // ============================================================
    if (action === 'tts') {
        if (!text) {
            setCorsHeaders();
            return res.status(400).json({ error: '請提供文字 (text)' });
        }
        if (!subscriptionKey) {
            setCorsHeaders();
            return res.status(500).json({ error: '伺服器未設定 Azure 金鑰' });
        }

        try {
            const tokenResponse = await fetch(
                `https://${region}.api.cognitive.microsoft.com/sts/v1.0/issuetoken`,
                {
                    method: 'POST',
                    headers: {
                        'Ocp-Apim-Subscription-Key': subscriptionKey,
                        'Content-Type': 'application/x-www-form-urlencoded',
                        'Content-Length': '0'
                    }
                }
            );

            if (!tokenResponse.ok) {
                const errorText = await tokenResponse.text();
                setCorsHeaders();
                return res.status(tokenResponse.status).json({
                    error: `Token 獲取失敗: ${errorText}`
                });
            }

            const accessToken = await tokenResponse.text();

            const ssml = `
                <speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="pt-PT">
                    <voice name="${voice || 'pt-PT-FernandaNeural'}">
                        <prosody rate="${rate || 1.0}">
                            ${text}
                        </prosody>
                    </voice>
                </speak>
            `;

            const ttsResponse = await fetch(
                `https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`,
                {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${accessToken}`,
                        'Content-Type': 'application/ssml+xml',
                        'X-Microsoft-OutputFormat': 'audio-16khz-128kbitrate-mono-mp3',
                        'User-Agent': 'Vercel-Proxy'
                    },
                    body: ssml
                }
            );

            if (!ttsResponse.ok) {
                const errorText = await ttsResponse.text();
                setCorsHeaders();
                return res.status(ttsResponse.status).json({
                    error: `TTS 調用失敗: ${errorText}`
                });
            }

            const audioBuffer = await ttsResponse.arrayBuffer();
            const base64Audio = Buffer.from(audioBuffer).toString('base64');

            setCorsHeaders();
            return res.status(200).json({
                success: true,
                audio: base64Audio,
                voice: voice || 'pt-PT-FernandaNeural',
                rate: rate || 1.0
            });

        } catch (error) {
            console.error('TTS 錯誤:', error);
            setCorsHeaders();
            return res.status(500).json({ error: `伺服器錯誤: ${error.message}` });
        }
    }

    // ============================================================
    // 6. Azure OpenAI (看圖造句 + 發音評分) — 最簡化版本
    // ============================================================
    if (action === 'openai') {
        if (!openaiKey || !openaiEndpoint) {
            setCorsHeaders();
            return res.status(500).json({ error: '伺服器未設定 Azure OpenAI 金鑰或端點' });
        }

        if (!prompt) {
            setCorsHeaders();
            return res.status(400).json({ error: '請提供提示詞 (prompt)' });
        }

        try {
            // ★★★ 只使用最基本的參數 ★★★
            const requestBody = {
                messages: [
                    { role: 'user', content: prompt }
                ],
                max_completion_tokens: 800
            };

            console.log('OpenAI 請求參數:', JSON.stringify(requestBody, null, 2));

            const gptResponse = await fetch(
                `${openaiEndpoint}openai/deployments/${openaiDeployment}/chat/completions?api-version=2024-02-15-preview`,
                {
                    method: 'POST',
                    headers: {
                        'api-key': openaiKey,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(requestBody)
                }
            );

            if (!gptResponse.ok) {
                const errorText = await gptResponse.text();
                console.error('OpenAI 錯誤回應:', errorText);
                setCorsHeaders();
                return res.status(gptResponse.status).json({
                    error: `OpenAI 請求失敗 (${gptResponse.status}): ${errorText}`
                });
            }

            const gptData = await gptResponse.json();
            const content = gptData.choices[0].message.content;

            setCorsHeaders();
            return res.status(200).json({
                success: true,
                content: content
            });

        } catch (error) {
            console.error('OpenAI 錯誤:', error);
            setCorsHeaders();
            return res.status(500).json({ error: `伺服器錯誤: ${error.message}` });
        }
    }

    // ============================================================
    // 7. Azure Speech-to-Text (語音轉文字)
    // ============================================================
    if (action === 'stt') {
        if (!sttKey) {
            setCorsHeaders();
            return res.status(500).json({ error: '伺服器未設定 STT 金鑰' });
        }

        if (!sttAudio) {
            setCorsHeaders();
            return res.status(400).json({ error: '請提供音頻資料 (sttAudio)' });
        }

        try {
            const audioBuffer = Buffer.from(sttAudio, 'base64');

            const sttResponse = await fetch(
                `https://${region}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=pt-PT&format=simple`,
                {
                    method: 'POST',
                    headers: {
                        'Ocp-Apim-Subscription-Key': sttKey,
                        'Content-Type': 'audio/wav'
                    },
                    body: audioBuffer
                }
            );

            if (!sttResponse.ok) {
                const errorText = await sttResponse.text();
                setCorsHeaders();
                return res.status(sttResponse.status).json({
                    error: `STT 請求失敗 (${sttResponse.status}): ${errorText}`
                });
            }

            const sttData = await sttResponse.json();

            setCorsHeaders();
            return res.status(200).json({
                success: true,
                text: sttData.DisplayText || '',
                recognitionStatus: sttData.RecognitionStatus || 'Success'
            });

        } catch (error) {
            console.error('STT 錯誤:', error);
            setCorsHeaders();
            return res.status(500).json({ error: `伺服器錯誤: ${error.message}` });
        }
    }

    // ============================================================
    // 8. 未知 action
    // ============================================================
    setCorsHeaders();
    return res.status(400).json({ error: '未知的 action: ' + action });
}

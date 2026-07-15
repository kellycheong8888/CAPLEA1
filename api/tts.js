// api/tts.js — Azure TTS Proxy (含 CORS 支援)
export default async function handler(req, res) {
    // 處理 CORS 預檢請求 (OPTIONS)
    if (req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        return res.status(200).end();
    }

    // 只允許 POST 請求
    if (req.method !== 'POST') {
        return res.status(405).json({ error: '只允許 POST 請求' });
    }

    const { text, voice = 'pt-PT-FernandaNeural', rate = 1.0 } = req.body;

    if (!text) {
        return res.status(400).json({ error: '請提供文字 (text)' });
    }

    const subscriptionKey = process.env.AZURE_KEY;
    const region = process.env.AZURE_REGION || 'southeastasia';

    if (!subscriptionKey) {
        return res.status(500).json({ error: '伺服器未設定 Azure 金鑰' });
    }

    try {
        console.log('正在獲取 Token...');
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
            console.error('Token 獲取失敗:', tokenResponse.status, errorText);
            return res.status(tokenResponse.status).json({
                error: `Token 獲取失敗 (${tokenResponse.status}): ${errorText}`
            });
        }

        const accessToken = await tokenResponse.text();
        console.log('Token 獲取成功，長度:', accessToken.length);

        if (!accessToken || accessToken.length < 10) {
            return res.status(500).json({ error: '獲取到的 Token 無效' });
        }

        const ssml = `
            <speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="pt-PT">
                <voice name="${voice}">
                    <prosody rate="${rate}">
                        ${text}
                    </prosody>
                </voice>
            </speak>
        `;

        console.log('正在呼叫 Azure TTS...');
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
            console.error('TTS 調用失敗:', ttsResponse.status, errorText);
            return res.status(ttsResponse.status).json({
                error: `TTS 調用失敗 (${ttsResponse.status}): ${errorText}`
            });
        }

        const audioBuffer = await ttsResponse.arrayBuffer();
        const base64Audio = Buffer.from(audioBuffer).toString('base64');

        console.log('TTS 成功！音頻大小:', audioBuffer.byteLength);

        // ★★★ 加入 CORS 標頭 ★★★
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

        res.status(200).json({
            success: true,
            audio: base64Audio,
            voice: voice,
            rate: rate
        });

    } catch (error) {
        console.error('代理錯誤:', error);
        res.status(500).json({ error: `伺服器錯誤: ${error.message}` });
    }
}

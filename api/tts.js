// api/tts.js — Azure TTS Proxy for Vercel
export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: '只允許 POST 請求' });
    }

    const { text, voice = 'pt-PT-FernandaNeural', rate = 1.0 } = req.body;

    if (!text) {
        return res.status(400).json({ error: '請提供文字 (text)' });
    }

    const subscriptionKey = process.env.AZURE_KEY;
    const region = process.env.AZURE_REGION;

    if (!subscriptionKey || !region) {
        return res.status(500).json({ error: '伺服器未設定 Azure 金鑰或區域' });
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

    try {
        const response = await fetch(
            `https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`,
            {
                method: 'POST',
                headers: {
                    'Ocp-Apim-Subscription-Key': subscriptionKey,
                    'Content-Type': 'application/ssml+xml',
                    'X-Microsoft-OutputFormat': 'audio-16khz-128kbitrate-mono-mp3',
                    'User-Agent': 'Vercel-Proxy'
                },
                body: ssml
            }
        );

        if (!response.ok) {
            const errorText = await response.text();
            return res.status(response.status).json({ error: `Azure 錯誤: ${errorText}` });
        }

        const audioBuffer = await response.arrayBuffer();
        const base64Audio = Buffer.from(audioBuffer).toString('base64');

        res.status(200).json({
            success: true,
            audio: base64Audio,
            voice: voice,  
            rate: rate
        });

    } catch (error) {
        console.error('Azure TTS 錯誤:', error);
        res.status(500).json({ error: '伺服器錯誤，請稍後再試' });
    }
}

// ================================================================
// Azure TTS / STT Proxy Server (Vercel)
// ================================================================

// ============================================
// WebM 轉 WAV（使用 ffmpeg）
// ============================================

async function convertWebMToWav(webmBuffer) {
    const { exec } = require('child_process');
    const fs = require('fs');
    const path = require('path');
    const os = require('os');
    
    return new Promise((resolve, reject) => {
        const tempDir = os.tmpdir();
        const inputFile = path.join(tempDir, `input_${Date.now()}.webm`);
        const outputFile = path.join(tempDir, `output_${Date.now()}.wav`);
        
        try {
            fs.writeFileSync(inputFile, webmBuffer);
        } catch (err) {
            return reject(new Error('寫入輸入文件失敗: ' + err.message));
        }
        
        const command = `ffmpeg -i "${inputFile}" -ar 16000 -ac 1 -f wav "${outputFile}" -y`;
        
        exec(command, (error, stdout, stderr) => {
            try {
                if (fs.existsSync(inputFile)) fs.unlinkSync(inputFile);
            } catch (e) {}
            
            if (error) {
                try {
                    if (fs.existsSync(outputFile)) fs.unlinkSync(outputFile);
                } catch (e) {}
                return reject(new Error('ffmpeg 轉換失敗: ' + error.message));
            }
            
            try {
                if (fs.existsSync(outputFile)) {
                    const wavBuffer = fs.readFileSync(outputFile);
                    fs.unlinkSync(outputFile);
                    resolve(wavBuffer);
                } else {
                    reject(new Error('轉換失敗：未生成輸出文件'));
                }
            } catch (readError) {
                reject(new Error('讀取輸出文件失敗: ' + readError.message));
            }
        });
    });
}

// ================================================================
// 主處理函數
// ================================================================

export default async function handler(req, res) {
    // ============================================
    // CORS 設定（允許所有來源存取）
    // ============================================
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-proxy-secret');

    // 處理 OPTIONS 預檢請求
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    // 只允許 POST 請求
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    // 驗證密鑰
    const secret = req.headers['x-proxy-secret'];
    if (secret !== 'mysecret2026') {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const { action, sttAudio, text, voice, rate } = req.body;

    // 從環境變數獲取 Azure 金鑰
    const AZURE_KEY = process.env.AZURE_SPEECH_KEY;
    const AZURE_REGION = process.env.AZURE_SPEECH_REGION;

    if (!AZURE_KEY || !AZURE_REGION) {
        console.error('❌ Azure 憑證未設定');
        return res.status(500).json({ error: 'Azure credentials not configured' });
    }

    try {
        // ============================================
        // 語音合成 (TTS)
        // ============================================
        if (action === 'tts') {
            const url = `https://${AZURE_REGION}.tts.speech.microsoft.com/cognitiveservices/v1`;
            
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Ocp-Apim-Subscription-Key': AZURE_KEY,
                    'Content-Type': 'application/ssml+xml',
                    'X-Microsoft-OutputFormat': 'audio-16khz-128kbitrate-mono-mp3',
                    'User-Agent': 'YourAppName'
                },
                body: `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="pt-PT">
                    <voice name="${voice || 'pt-PT-FernandaNeural'}">
                        <prosody rate="${rate || 1.0}">${text}</prosody>
                    </voice>
                </speak>`
            });

            if (!response.ok) {
                const error = await response.text();
                return res.status(response.status).json({ error: `TTS failed: ${error}` });
            }

            const audioBuffer = await response.arrayBuffer();
            const base64 = Buffer.from(audioBuffer).toString('base64');
            return res.json({ success: true, audio: base64 });
        }

        // ============================================
        // 語音轉文字 (STT)
        // ============================================
        if (action === 'stt') {
            if (!sttAudio) {
                return res.status(400).json({ error: 'Missing sttAudio' });
            }

            console.log('📥 收到 STT 請求，音訊長度:', sttAudio.length);

            let audioBuffer = Buffer.from(sttAudio, 'base64');

            const header = audioBuffer.toString('hex', 0, 16);
            const isWebM = header.includes('1a45dfa3');
            const isWav = audioBuffer.toString('utf-8', 0, 4) === 'RIFF';
            
            console.log('📋 音訊格式檢測:', { isWav, isWebM });

            if (!isWav && isWebM) {
                console.log('🔄 檢測到 WebM 格式，轉換為 WAV...');
                try {
                    audioBuffer = await convertWebMToWav(audioBuffer);
                    console.log('✅ WebM 轉換成功');
                } catch (convertError) {
                    console.error('❌ WebM 轉換失敗:', convertError.message);
                }
            }

            const isWavAfter = audioBuffer.toString('utf-8', 0, 4) === 'RIFF';

            const url = `https://${AZURE_REGION}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=pt-PT&format=simple`;

            console.log('📤 發送請求到 Azure STT...');

            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Ocp-Apim-Subscription-Key': AZURE_KEY,
                    'Content-Type': isWavAfter ? 'audio/wav' : 'audio/webm',
                    'Accept': 'application/json'
                },
                body: audioBuffer
            });

            console.log('📥 Azure STT 回應狀態:', response.status);

            if (!response.ok) {
                const error = await response.text();
                console.error('❌ Azure STT 錯誤:', error);
                return res.status(response.status).json({ error: `STT failed: ${error}` });
            }

            const data = await response.json();
            console.log('📥 Azure STT 結果:', data);

            const resultText = data.DisplayText || data.text || data.Recognized || '';
            
            return res.json({ success: true, text: resultText });
        }

        // ============================================
        // Ping 測試
        // ============================================
        if (action === 'ping') {
            return res.json({ success: true, message: 'pong', azureConfigured: !!AZURE_KEY });
        }

        return res.status(400).json({ error: 'Unknown action: ' + action });

    } catch (error) {
        console.error('❌ Proxy 錯誤:', error);
        return res.status(500).json({ error: error.message });
    }
}

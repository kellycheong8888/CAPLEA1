// processor.js - AudioWorkletProcessor 定義
class RecorderProcessor extends AudioWorkletProcessor {
    process(inputs, outputs, parameters) {
        const input = inputs[0];
        if (input && input.length > 0) {
            // 將音頻數據發送到主線程
            this.port.postMessage(input[0]);
        }
        return true;
    }
}

registerProcessor('recorder-processor', RecorderProcessor);

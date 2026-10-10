import { parentPort, workerData } from 'node:worker_threads'
import { join } from 'node:path'
import sherpa from 'sherpa-onnx-node'

const recognizer = new sherpa.OfflineRecognizer({ featConfig: { sampleRate: 16000, featureDim: 80 }, modelConfig: { senseVoice: { model: join(workerData.modelDirectory, 'model.int8.onnx'), language: 'zh', useInverseTextNormalization: 1 }, tokens: join(workerData.modelDirectory, 'tokens.txt'), numThreads: 2, provider: 'cpu', debug: 0 } })
parentPort.on('message', ({ id, samples, rate }) => {
  try {
    const stream = recognizer.createStream()
    stream.acceptWaveform({ sampleRate: rate, samples })
    recognizer.decode(stream)
    parentPort.postMessage({ id, text: recognizer.getResult(stream).text.trim() })
  } catch (error) { parentPort.postMessage({ id, error: error.message }) }
})

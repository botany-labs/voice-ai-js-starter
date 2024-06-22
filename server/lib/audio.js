// raw audio mangling

function float32ToPCM16(buffer) {
  const pcm16 = new Int16Array(buffer.length);
  for (let i = 0; i < buffer.length; i++) {
    let s = Math.max(-1, Math.min(1, buffer[i]));
    pcm16[i] = s < 0 ? s * 32768 : s * 32767;
  }
  return pcm16;
}

function pcm16ToFloat32(buffer) {
  const float32 = new Float32Array(buffer.length);
  for (let i = 0; i < buffer.length; i++) {
    float32[i] = buffer[i] / 32767;
  }
  return float32;
}

function createWavHeader(sampleRate, numChannels, bytesPerSample, dataSize) {
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;

  const buffer = new ArrayBuffer(44);
  const view = new DataView(buffer);

  // RIFF identifier
  view.setUint32(0, 1380533830, false); // 'RIFF'

  // file length minus RIFF identifier and file type header
  view.setUint32(4, 36 + dataSize, true);
  // RIFF type
  view.setUint32(8, 1463899717, false); // 'WAVE'

  // format chunk identifier
  view.setUint32(12, 1718449184, false); // 'fmt '

  // format chunk length
  view.setUint32(16, 16, true);
  // sample format (raw)
  view.setUint16(20, 1, true);
  // channel count
  view.setUint16(22, numChannels, true);
  // sample rate
  view.setUint32(24, sampleRate, true);
  // byte rate (sample rate * block align)
  view.setUint32(28, byteRate, true);
  // block align (channel count * bytes per sample)
  view.setUint16(32, blockAlign, true);
  // bits per sample
  view.setUint16(34, bytesPerSample * 8, true);
  // data chunk identifier
  view.setUint32(36, 1684108385, false); // 'data'

  // data chunk length
  view.setUint32(40, dataSize, true);

  return Buffer.from(buffer);
}

function generateBeep(frequency, durationSeconds, sampleRate) {
    const volume = 0.2;
    const numSamples = sampleRate * durationSeconds;
    const buffer = new Float32Array(numSamples);
    for (let i = 0; i < numSamples; i++) {
      buffer[i] = Math.sin(2 * Math.PI * frequency * (i / sampleRate)) * volume;
    }
    return buffer;
}

module.exports = {
  float32ToPCM16,
  pcm16ToFloat32,
  createWavHeader,
  generateBeep,
};

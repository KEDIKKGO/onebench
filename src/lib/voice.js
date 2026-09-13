// 语音适配层：麦克风录制 / 语音识别(STT) / 语音播报(TTS)
// 网页端实现基于 MediaRecorder + SiliconFlow(FunAudioLLM/SenseVoiceSmall)。
// 将来接入手机客户端时，只需按相同签名替换本文件的实现：
//   class VoiceRecorder { start(); stop(): Promise<Blob>; cancel() }
//   transcribeAudio({ url, key, model, blob }): Promise<string>
//   speakText({ engine, ttsUrl, ttsModel, ttsVoice, key, text }): Promise<void>
// 面板组件与业务逻辑无需改动。

export function isVoiceSupported() {
  return typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia) && typeof window.MediaRecorder !== 'undefined'
}

export class VoiceRecorder {
  constructor() {
    this.stream = null
    this.recorder = null
    this.chunks = []
  }

  async start() {
    if (!isVoiceSupported()) throw new Error('当前环境不支持录音（网页需麦克风权限；原生客户端请接入系统录音模块）')
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : ''
    this.recorder = new MediaRecorder(this.stream, mimeType ? { mimeType } : undefined)
    this.chunks = []
    this.recorder.ondataavailable = (event) => { if (event.data && event.data.size) this.chunks.push(event.data) }
    this.recorder.start()
  }

  stop() {
    return new Promise((resolve, reject) => {
      if (!this.recorder) return reject(new Error('尚未开始录音'))
      this.recorder.onstop = () => {
        const blob = new Blob(this.chunks, { type: this.recorder.mimeType || 'audio/webm' })
        this.stream?.getTracks().forEach((track) => track.stop())
        resolve(blob)
      }
      this.recorder.stop()
    })
  }

  cancel() {
    try {
      if (this.recorder && this.recorder.state !== 'inactive') this.recorder.stop()
      this.stream?.getTracks().forEach((track) => track.stop())
    } catch { /* ignore */ }
  }
}

// 语音转文字：兼容 SiliconFlow / OpenAI 的 /v1/audio/transcriptions 接口
export async function transcribeAudio({ url, key, model, blob }) {
  const base = (url || 'https://api.siliconflow.cn/v1').replace(/\/+$/, '')
  if (!key) throw new Error('未填写语音识别 API Key，请先打开齿轮设置')
  const type = blob.type || ''
  const ext = type.includes('wav') ? 'wav' : type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm'
  const form = new FormData()
  form.append('file', blob, `speech.${ext}`)
  form.append('model', model || 'FunAudioLLM/SenseVoiceSmall')
  const response = await fetch(`${base}/audio/transcriptions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}` },
    body: form,
  })
  if (!response.ok) {
    if (response.status === 401) throw new Error('语音识别鉴权失败（401），请检查 API Key')
    const detail = await response.text().catch(() => '')
    throw new Error(`语音识别失败 ${response.status}：${detail.slice(0, 120)}`)
  }
  const data = await response.json()
  const text = String(data.text || data.result || '').trim()
  if (!text) throw new Error('没有识别出内容，请靠近麦克风重说一次')
  return text
}

// 语音播报：system=浏览器本地合成（免费、零配置）；cloud=云端 TTS（音质更自然，需 Key）
export async function speakText({ engine, ttsUrl, ttsModel, ttsVoice, key, text }) {
  if (!text) return
  if (engine !== 'cloud') {
    if (!('speechSynthesis' in window)) throw new Error('当前浏览器不支持系统语音朗读，可在设置里改用云端语音')
    window.speechSynthesis.cancel()
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.lang = 'zh-CN'
    utterance.rate = 1
    window.speechSynthesis.speak(utterance)
    return
  }
  const base = (ttsUrl || 'https://api.siliconflow.cn/v1').replace(/\/+$/, '')
  if (!key) throw new Error('云端语音需要 API Key，请先打开齿轮设置')
  const response = await fetch(`${base}/audio/speech`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: ttsModel || 'FunAudioLLM/CosyVoice2-0.5B',
      input: text,
      voice: ttsVoice || 'FunAudioLLM/CosyVoice2-0.5B:alex',
      response_format: 'mp3',
    }),
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`云端语音失败 ${response.status}：${detail.slice(0, 120)}`)
  }
  const blob = await response.blob()
  const objectUrl = URL.createObjectURL(blob)
  const audio = new Audio(objectUrl)
  await audio.play()
  audio.onended = () => URL.revokeObjectURL(objectUrl)
}

export function stopSpeaking() {
  try { window.speechSynthesis?.cancel() } catch { /* ignore */ }
}

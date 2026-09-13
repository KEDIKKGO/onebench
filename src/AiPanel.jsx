import { useEffect, useRef, useState } from 'react'
import { CheckCircle, GearSix, PaperPlaneRight, Robot, Sparkle, Trash, X } from '@phosphor-icons/react'
import {
  clearAiMessages,
  defaultAiConfig,
  parseAiActions,
  persistAiMessages,
  sendAiChat,
} from './lib/ai-chat'

// 右侧常驻 AI 助理面板：不随左侧应用切换消失
export function AiPanel({ open, onClose, provider, onProviderChange, config, onConfigChange, messages, setMessages, workspace, workspaceData, onAction }) {
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const listRef = useRef(null)

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight
  }, [messages, busy])

  if (!open) return null

  const updateConfig = (field) => (event) => {
    onConfigChange({ ...config, [field]: event.target.value })
  }

  const send = async () => {
    const text = input.trim()
    if (!text || busy) return
    const nextMessages = [...messages, { role: 'user', content: text }]
    setMessages(nextMessages)
    persistAiMessages(nextMessages)
    setInput('')
    setBusy(true)
    try {
      const reply = await sendAiChat({ provider, config, messages: nextMessages, workspace, workspaceData })
      const { clean, actions } = parseAiActions(reply)
      const applied = []
      for (const action of actions) {
        const result = onAction ? onAction(action) : { ok: false, label: '面板未连接工作台数据' }
        applied.push({ action, ...result })
      }
      const done = [...nextMessages, { role: 'assistant', content: clean, actions: applied }]
      setMessages(done)
      persistAiMessages(done)
    } catch (error) {
      const failed = [...nextMessages, { role: 'assistant', content: String(error.message || error), error: true }]
      setMessages(failed)
      persistAiMessages(failed)
    } finally {
      setBusy(false)
    }
  }

  const providerMeta = {
    local: { title: '本机模型', note: 'Ollama 兼容接口，数据不出本机' },
    cloud: { title: '云端模型', note: 'OpenAI 兼容接口，需填 API Key' },
  }

  return (
    <aside className="ai-panel" aria-label="AI 助理">
      <header className="ai-head">
        <span className="ai-badge"><Robot weight="fill" /></span>
        <div>
          <strong>AI 助理</strong>
          <small>{providerMeta[provider].title} · {providerMeta[provider].note}</small>
        </div>
        <div className="ai-head-actions">
          <button type="button" onClick={() => setShowSettings((value) => !value)} aria-label="模型设置"><GearSix weight="duotone" /></button>
          <button type="button" onClick={() => { clearAiMessages(); setMessages([]) }} aria-label="清空对话"><Trash weight="duotone" /></button>
          <button type="button" onClick={onClose} aria-label="收起面板"><X weight="bold" /></button>
        </div>
      </header>

      <div className="ai-provider-switch" role="tablist" aria-label="选择模型来源">
        <button type="button" role="tab" aria-selected={provider === 'local'} className={provider === 'local' ? 'active' : ''} onClick={() => onProviderChange('local')}>本机</button>
        <button type="button" role="tab" aria-selected={provider === 'cloud'} className={provider === 'cloud' ? 'active' : ''} onClick={() => onProviderChange('cloud')}>云端</button>
      </div>

      {showSettings && (
        <section className="ai-settings" aria-label="模型参数">
          {provider === 'local' ? (
            <>
              <label>本机服务地址（Ollama）<input value={config.localUrl} onChange={updateConfig('localUrl')} placeholder="http://localhost:11434" /></label>
              <label>模型名称<input value={config.localModel} onChange={updateConfig('localModel')} placeholder={defaultAiConfig.localModel} /></label>
              <small>提示：本机模型需先安装 Ollama 并 `ollama pull 模型名`；跨网页调用需设置 OLLAMA_ORIGINS 允许本工作台地址。</small>
            </>
          ) : (
            <>
              <label>云端服务地址（OpenAI 兼容）<input value={config.cloudUrl} onChange={updateConfig('cloudUrl')} placeholder="https://api.openai.com" /></label>
              <label>模型名称<input value={config.cloudModel} onChange={updateConfig('cloudModel')} placeholder={defaultAiConfig.cloudModel} /></label>
              <label>API Key<input type="password" value={config.cloudKey} onChange={updateConfig('cloudKey')} placeholder="sk-..." /></label>
              <small>提示：Key 仅保存在本机浏览器 localStorage，不会写入仓库或上传。</small>
            </>
          )}
        </section>
      )}

      <div className="ai-messages" ref={listRef}>
        {messages.length === 0 && (
          <div className="ai-empty">
            <Sparkle weight="duotone" />
            <p>你好，我是工作台里的 AI 助理。</p>
            <small>可以问「我今天有哪些任务」，也可以直接说「帮我加一个明天上午开站会的任务」「把 XX 任务标记完成」。</small>
            <small>先在上方「本机 / 云端」里选好模型，点齿轮填写参数。</small>
          </div>
        )}
        {messages.map((message, index) => (
          <div className={`ai-bubble ${message.role}${message.error ? ' error' : ''}`} key={index}>
            {message.content}
            {message.actions?.length > 0 && (
              <div className="ai-actions">
                {message.actions.map((entry, i) => (
                  <span key={i} className={entry.ok ? 'ok' : 'fail'}>
                    <CheckCircle weight={entry.ok ? 'fill' : 'bold'} /> {entry.label}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
        {busy && <div className="ai-bubble assistant pending">思考中…</div>}
      </div>

      <footer className="ai-input">
        <textarea
          rows={2}
          value={input}
          placeholder={provider === 'local' ? '连接本机模型对话…' : '连接云端模型对话…'}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); send() } }}
        />
        <button type="button" onClick={send} disabled={busy || !input.trim()} aria-label="发送"><PaperPlaneRight weight="bold" /></button>
      </footer>
    </aside>
  )
}

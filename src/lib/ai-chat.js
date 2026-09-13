// AI 助理：本机（Ollama 兼容）与云端（OpenAI 兼容）模型接入
const AI_OPEN_KEY = 'onebench.ai.open'
const AI_PROVIDER_KEY = 'onebench.ai.provider'
const AI_CONFIG_KEY = 'onebench.ai.config'
const AI_MESSAGES_KEY = 'onebench.ai.messages'

export const defaultAiConfig = {
  localUrl: 'http://localhost:11434',
  localModel: 'qwen2.5:7b',
  cloudUrl: 'https://api.openai.com',
  cloudModel: 'gpt-4o-mini',
  cloudKey: '',
}

export function readAiOpen() {
  try { return localStorage.getItem(AI_OPEN_KEY) === '1' } catch { return false }
}

export function persistAiOpen(open) {
  try { open ? localStorage.setItem(AI_OPEN_KEY, '1') : localStorage.removeItem(AI_OPEN_KEY) } catch { /* ignore */ }
}

export function readAiProvider() {
  try { return localStorage.getItem(AI_PROVIDER_KEY) === 'cloud' ? 'cloud' : 'local' } catch { return 'local' }
}

export function persistAiProvider(provider) {
  try { localStorage.setItem(AI_PROVIDER_KEY, provider) } catch { /* ignore */ }
}

export function readAiConfig() {
  try { return { ...defaultAiConfig, ...JSON.parse(localStorage.getItem(AI_CONFIG_KEY) || '{}') } } catch { return { ...defaultAiConfig } }
}

export function persistAiConfig(config) {
  try { localStorage.setItem(AI_CONFIG_KEY, JSON.stringify(config)) } catch { /* ignore */ }
}

export function readAiMessages() {
  try {
    const list = JSON.parse(localStorage.getItem(AI_MESSAGES_KEY) || '[]')
    return Array.isArray(list) ? list.slice(-80) : []
  } catch { return [] }
}

export function persistAiMessages(messages) {
  try { localStorage.setItem(AI_MESSAGES_KEY, JSON.stringify(messages.slice(-80))) } catch { /* ignore */ }
}

export function clearAiMessages() {
  try { localStorage.removeItem(AI_MESSAGES_KEY) } catch { /* ignore */ }
}

function buildSystemPrompt(workspace, workspaceData) {
  const tasks = (workspaceData.tasks || []).filter((item) => !item.done).slice(0, 12)
    .map((item) => `- ${item.text || item.title || ''}`).join('\n')
  const projects = (workspaceData.projects || []).slice(0, 8)
    .map((item) => `- ${item.title || item.name || ''}${item.note ? `（${item.note}）` : ''}`).join('\n')
  return [
    '你是「团队工作台」里内嵌的 AI 助理，帮助用户管理日常工作与项目。',
    `用户：${workspace.profile?.displayName || '朋友'}；工作台：${workspace.name}；定位：${workspace.intent || ''}。`,
    tasks ? `当前未完成任务：\n${tasks}` : '',
    projects ? `当前项目：\n${projects}` : '',
    '回答保持简洁、可执行；涉及用户数据时基于上面列出的内容回答。',
  ].filter(Boolean).join('\n')
}

async function callLocalModel(config, messages) {
  const base = (config.localUrl || '').replace(/\/+$/, '')
  const response = await fetch(`${base}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: config.localModel, messages, stream: false }),
  })
  if (!response.ok) throw new Error(`本机模型返回 ${response.status}，请确认 Ollama 已运行且模型已下载（ollama run ${config.localModel}）`)
  const data = await response.json()
  const content = data?.message?.content || data?.response || ''
  if (!content) throw new Error('本机模型没有返回内容')
  return content
}

async function callCloudModel(config, messages) {
  const base = (config.cloudUrl || '').replace(/\/+$/, '')
  const response = await fetch(`${base}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.cloudKey || ''}`,
    },
    body: JSON.stringify({ model: config.cloudModel, messages, stream: false }),
  })
  if (!response.ok) {
    if (response.status === 401) throw new Error('云端模型认证失败（401），请检查 API Key')
    throw new Error(`云端模型返回 ${response.status}`)
  }
  const data = await response.json()
  const content = data?.choices?.[0]?.message?.content || ''
  if (!content) throw new Error('云端模型没有返回内容')
  return content
}

export async function sendAiChat({ provider, config, messages, workspace, workspaceData }) {
  const system = buildSystemPrompt(workspace, workspaceData)
  const payload = [{ role: 'system', content: system }, ...messages]
  return provider === 'cloud' ? callCloudModel(config, payload) : callLocalModel(config, payload)
}

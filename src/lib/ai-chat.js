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
  const tasks = (workspaceData.tasks || []).slice(0, 12)
    .map((item) => `- ${item.done ? '[已完成] ' : ''}${item.title}`).join('\n')
  const projects = (workspaceData.projects || []).slice(0, 8)
    .map((item) => `- ${item.title}${item.meta ? `（${item.meta}）` : ''}`).join('\n')
  return [
    '你是「团队工作台」里内嵌的 AI 助理，帮助用户管理日常工作与项目。',
    `用户：${workspace.profile?.displayName || '朋友'}；工作台：${workspace.name}；定位：${workspace.intent || ''}。`,
    tasks ? `当前任务列表：\n${tasks}` : '',
    projects ? `当前项目：\n${projects}` : '',
    '回答保持简洁、可执行。',
    '【重要：你可以直接修改工作台数据】当用户要求新增/完成任务、记录想法或添加项目时，不要只口头描述，必须在回复的最后单独成行输出动作指令，格式为：',
    '[ACTION] {"type":"add_task","text":"任务内容"}',
    '支持的动作类型：',
    '- add_task：新增一条任务，字段 text（必填）',
    '- complete_task：把某条任务标记完成，字段 text 填该任务的关键词（必填）',
    '- add_note：把内容写入快速记录，字段 text（必填）',
    '- add_project：新增项目，字段 title（必填）、meta（备注，可选）',
    '规则：动作指令放在回复最末尾，每行一条；只在用户明确表达"帮我加/完成/记录"意图时输出；正常聊天和回答问题时不要输出动作。示例：用户说"帮我加一个明天上午十点开站会的任务"，你在回复末尾输出：[ACTION] {"type":"add_task","text":"明天 10:00 站会"}',
  ].filter(Boolean).join('\n')
}

// 从模型回复中解析动作指令；返回 { clean, actions }
export function parseAiActions(content) {
  const actions = []
  const lines = String(content || '').split('\n')
  const kept = []
  for (const line of lines) {
    const match = line.match(/^\s*\[ACTION\]\s*(\{.*\})\s*$/)
    if (match) {
      try {
        const parsed = JSON.parse(match[1])
        if (parsed && typeof parsed.type === 'string') actions.push(parsed)
        continue
      } catch { /* 非法 JSON，按普通文本保留 */ }
    }
    kept.push(line)
  }
  return { clean: kept.join('\n').trim(), actions }
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

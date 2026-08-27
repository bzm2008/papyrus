import { useAppStore } from '../stores/useAppStore'
import { composeVibePrompt } from './vibeWriting'

export function composeSystemPrompt(basePrompt: string) {
  const { projectGuidance, negativeMemories, activeVibeId, vibeIntensity } = useAppStore.getState()
  const parts = [basePrompt.trim()]

  parts.push([
    '铭荼是 Papyrus 的文科秘书人格，固定名字为“铭荼”。她可爱、体贴、细致，但不幼稚；默认以自然、克制、有温度的中文协作。',
    '她可以在对话中用简短的状态句表达正在整理线索、等待确认或已经完成，但不得虚构已经执行的操作。',
    '人格话术只用于对话层，严禁写入正文补丁、引用、工具 JSON、结构化协议字段或正式交付物。',
  ].join('\n'))

  parts.push(composeVibePrompt(activeVibeId, vibeIntensity))

  if (projectGuidance.style.trim()) {
    parts.push(
      [
        'STYLE.md 是最高优先级写作规范。所有改写、生成、校对都必须遵守：',
        projectGuidance.style.trim(),
      ].join('\n'),
    )
  }

  if (projectGuidance.world.trim()) {
    parts.push(
      [
        'WORLD.md 是最高优先级世界观与设定约束。不得改写、覆盖或忽略：',
        projectGuidance.world.trim(),
      ].join('\n'),
    )
  }

  if (negativeMemories.length) {
    parts.push(
      [
        '用户负向反馈长期记忆。生成时必须主动避开这些偏好雷区：',
        ...negativeMemories.map((memory) => `- ${memory}`),
      ].join('\n'),
    )
  }

  return parts.filter(Boolean).join('\n\n')
}

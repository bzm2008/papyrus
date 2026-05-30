import { useAppStore } from '../stores/useAppStore'
import { composeVibePrompt } from './vibeWriting'

export function composeSystemPrompt(basePrompt: string) {
  const { projectGuidance, negativeMemories, activeVibeId, vibeIntensity } = useAppStore.getState()
  const parts = [basePrompt.trim()]

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

export type VibeId = 'quiet-archive' | 'rain-outline' | 'cinema-draft' | 'deadline-heat'

export type VibePreset = {
  id: VibeId
  label: string
  shortLabel: string
  scene: string
  prompt: string
  rhythm: string
  accent: string
}

export const vibePresets: Record<VibeId, VibePreset> = {
  'quiet-archive': {
    id: 'quiet-archive',
    label: '静档案室',
    shortLabel: '档案',
    scene: '安静、克制、像在旧资料室里整理证据。',
    prompt:
      '当前写作氛围是“静档案室”：输出要克制、准确、耐心，重视材料秩序、事实链和句子里的判断重量。',
    rhythm: '慢速深写',
    accent: '#6f7f68',
  },
  'rain-outline': {
    id: 'rain-outline',
    label: '雨夜大纲',
    shortLabel: '雨夜',
    scene: '低噪声、长呼吸，适合拆结构和续写章节。',
    prompt:
      '当前写作氛围是“雨夜大纲”：输出要有连贯节奏，先找结构线，再落笔，避免突然拔高或跳过情绪过渡。',
    rhythm: '线性推进',
    accent: '#577590',
  },
  'cinema-draft': {
    id: 'cinema-draft',
    label: '镜头草稿',
    shortLabel: '镜头',
    scene: '像在剪辑台旁写场景，重视动作、空间和画面推进。',
    prompt:
      '当前写作氛围是“镜头草稿”：输出要把抽象想法转成可见动作、空间关系和信息释放，不要只写心理说明。',
    rhythm: '场景驱动',
    accent: '#8a6f9e',
  },
  'deadline-heat': {
    id: 'deadline-heat',
    label: '截稿热流',
    shortLabel: '截稿',
    scene: '紧凑、有方向感，适合快速成稿和发表前修订。',
    prompt:
      '当前写作氛围是“截稿热流”：输出要直接、有取舍、可执行，优先生成可用版本，再指出下一轮最关键修订。',
    rhythm: '快速收束',
    accent: '#b66a3c',
  },
}

export const defaultVibeId: VibeId = 'quiet-archive'

export function getVibePreset(id: VibeId) {
  return vibePresets[id] ?? vibePresets[defaultVibeId]
}

export function composeVibePrompt(vibeId: VibeId, intensity: number) {
  const vibe = getVibePreset(vibeId)
  const level =
    intensity >= 80 ? '强' : intensity >= 55 ? '中' : intensity >= 30 ? '轻' : '极轻'

  return [
    vibe.prompt,
    `氛围强度：${level}（${intensity}%）。强度越高，越明显地调整节奏、画面感和句子呼吸；强度越低，只做轻微倾向。`,
  ].join('\n')
}

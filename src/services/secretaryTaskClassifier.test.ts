import { describe, expect, it } from 'vitest'

import { classifySecretaryTask } from './secretaryTaskClassifier'

describe('classifySecretaryTask domain routing', () => {
  it('routes local file and desktop requests to the controlled work assistant', () => {
    expect(classifySecretaryTask('整理下载目录里的 PDF').domain).toBe('work_assistant')
    expect(classifySecretaryTask('打开 VS Code 应用').domain).toBe('work_assistant')
    expect(classifySecretaryTask('查看电脑 CPU 和内存状态').domain).toBe('work_assistant')
  })

  it('routes collection plus writing to the mixed pipeline', () => {
    expect(classifySecretaryTask('扫描项目资料并写一份研究报告').domain).toBe('mixed')
  })

  it('routes browser tab actions to the Browser Bridge domain', () => {
    expect(classifySecretaryTask('打开链接并填写网页表单').domain).toBe('browser')
    expect(classifySecretaryTask('查看浏览器当前标签页').domain).toBe('browser')
  })

  it('preserves ordinary writing classification', () => {
    expect(classifySecretaryTask('续写这个小说章节', { writeIntent: true }).domain).toBe('writing')
  })
})

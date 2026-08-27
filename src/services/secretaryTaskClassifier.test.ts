import { describe, expect, it } from 'vitest'

import { classifySecretaryTask, isCapabilityQuestion, isConversationalShortcut } from './secretaryTaskClassifier'

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

  it('recognizes greetings as conversation-only shortcuts', () => {
    expect(isConversationalShortcut('你好')).toBe(true)
    expect(isConversationalShortcut('谢谢你')).toBe(true)
    expect(isConversationalShortcut('写一段欢迎词')).toBe(false)
    expect(isConversationalShortcut('查看今天的新闻')).toBe(false)
  })

  it('treats computer and browser capability questions as conversation-only', () => {
    expect(isCapabilityQuestion('你能不能操控电脑')).toBe(true)
    expect(isConversationalShortcut('你能不能操控浏览器')).toBe(true)
    expect(isCapabilityQuestion('你可以操控电脑吗')).toBe(true)
    expect(isConversationalShortcut('你可以操控浏览器吗')).toBe(true)
    expect(isCapabilityQuestion('能否使用终端')).toBe(true)
    expect(isConversationalShortcut('你可以帮我打开 Chrome 吗')).toBe(false)
    expect(classifySecretaryTask('帮我控制电脑打开计算器').domain).toBe('work_assistant')
  })

  it('routes browser application launches to the desktop assistant', () => {
    expect(classifySecretaryTask('帮我打开谷歌浏览器这个软件').domain).toBe('work_assistant')
    expect(classifySecretaryTask('打开 Chrome 应用').domain).toBe('work_assistant')
    expect(classifySecretaryTask('帮我打开系统默认浏览器').domain).toBe('work_assistant')
    expect(classifySecretaryTask('查看 Chrome 当前标签页').domain).toBe('browser')
  })

  it('routes explicit Git and terminal requests to the controlled work assistant', () => {
    expect(classifySecretaryTask('帮我运行 git status').domain).toBe('work_assistant')
    expect(classifySecretaryTask('在终端查看当前项目分支').domain).toBe('work_assistant')
    expect(classifySecretaryTask('帮我写一个 git status 命令').domain).toBe('writing')
  })
})

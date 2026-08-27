import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { ProjectNavigator } from './ProjectNavigator'

describe('ProjectNavigator unified workspace navigation', () => {
  it('groups actions, conversations, and project files into one workspace', () => {
    render(<ProjectNavigator />)

    expect(screen.getByText('工作台')).toBeInTheDocument()
    expect(screen.getByText('历史聊天')).toBeInTheDocument()
    expect(screen.getByText('项目资料')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '新建对话' })).toBeInTheDocument()
    expect(screen.getByTitle('新建文章')).toBeInTheDocument()
  })

  it('keeps the primary actions discoverable when collapsed', () => {
    render(<ProjectNavigator collapsed />)

    expect(screen.getByTitle('新建对话')).toBeInTheDocument()
    expect(screen.getByTitle('导入文件')).toBeInTheDocument()
    expect(screen.getByTitle('打开文件夹')).toBeInTheDocument()
  })
})

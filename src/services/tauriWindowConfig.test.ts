import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'


describe('Papyrus desktop window configuration', () => {
  it('fits common 1024x768 X11 workareas while retaining normal window controls', () => {
    const config = JSON.parse(readFileSync(
      path.resolve('src-tauri/tauri.conf.json'), 'utf8',
    ))
    const window = config.app.windows[0]

    expect(window).toMatchObject({
      title: 'Papyrus',
      width: 1024,
      height: 640,
      minWidth: 720,
      minHeight: 460,
      resizable: true,
      fullscreen: false,
    })
  })
})

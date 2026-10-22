import { describe, expect, it } from 'vitest'
import { classifyFile, nextExportName } from './files.ts'
import { pickRecorderMime } from './export.ts'

function file(name: string, type: string): File {
  return new File([new Uint8Array([1, 2, 3])], name, { type })
}

describe('classifyFile', () => {
  it('reconhece jpg png heic', () => {
    expect(classifyFile(file('rua.JPG', 'image/jpeg'))).toBe('foto')
    expect(classifyFile(file('x.png', 'image/png'))).toBe('foto')
    expect(classifyFile(file('retrato.heic', 'image/heic'))).toBe('foto')
    expect(classifyFile(file('retrato.HEIC', ''))).toBe('foto')
  })

  it('reconhece mp4 e mov', () => {
    expect(classifyFile(file('clipe.mp4', 'video/mp4'))).toBe('video')
    expect(classifyFile(file('clipe.MOV', 'video/quicktime'))).toBe('video')
  })

  it('rejeita tipos estranhos', () => {
    expect(classifyFile(file('notas.pdf', 'application/pdf'))).toBe('unknown')
  })
})

describe('export names', () => {
  it('usa o padrão revelar-foto-001', () => {
    expect(nextExportName('foto', 1, 'jpg')).toBe('revelar-foto-001.jpg')
    expect(nextExportName('video', 12, 'mp4')).toBe('revelar-video-012.mp4')
  })
})

describe('pickRecorderMime', () => {
  it('prefere H.264 + AAC em MP4', () => {
    const mime = pickRecorderMime((type) => type.startsWith('video/mp4'))
    expect(mime).toContain('video/mp4')
    expect(mime).toContain('avc1')
  })

  it('devolve vazio se nada for suportado', () => {
    expect(pickRecorderMime(() => false)).toBe('')
  })
})

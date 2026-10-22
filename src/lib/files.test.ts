import { describe, expect, it } from 'vitest'
import { classifyFile, nextExportName } from './files.ts'
import { PHOTO_JPEG_QUALITY, photoExportSpec, pickRecorderMime } from './export.ts'
import { maxPhotoSide } from './decode.ts'

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

describe('photo export', () => {
  it('JPEG de alta qualidade e PNG sem perda', () => {
    expect(PHOTO_JPEG_QUALITY).toBeGreaterThanOrEqual(0.95)
    const jpeg = photoExportSpec(file('rua.jpg', 'image/jpeg'))
    expect(jpeg.ext).toBe('jpg')
    expect(jpeg.quality).toBe(0.95)
    const png = photoExportSpec(file('rua.png', 'image/png'))
    expect(png.ext).toBe('png')
    expect(png.mime).toBe('image/png')
  })
})

describe('resolução nativa', () => {
  it('não limita a foto a 1920', () => {
    expect(maxPhotoSide()).toBeGreaterThan(8000)
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

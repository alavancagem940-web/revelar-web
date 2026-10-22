/** Gera uma foto subexposta de exemplo (sem arquivos externos). */
export function makeSamplePhoto(): File {
  const width = 640
  const height = 420
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas 2D indisponível.')

  const sky = ctx.createLinearGradient(0, 0, 0, height)
  sky.addColorStop(0, '#1a140f')
  sky.addColorStop(1, '#0c0a08')
  ctx.fillStyle = sky
  ctx.fillRect(0, 0, width, height)

  ctx.fillStyle = '#24180f'
  ctx.beginPath()
  ctx.ellipse(320, 470, 380, 140, 0, 0, Math.PI * 2)
  ctx.fill()

  ctx.fillStyle = '#3a220c'
  ctx.beginPath()
  ctx.arc(320, 200, 70, 0, Math.PI * 2)
  ctx.fill()

  ctx.strokeStyle = '#5a3a14'
  ctx.lineWidth = 6
  ctx.beginPath()
  ctx.arc(320, 208, 38, 0.15 * Math.PI, 0.85 * Math.PI)
  ctx.stroke()

  ctx.fillStyle = '#2a1c10'
  ctx.beginPath()
  ctx.arc(298, 188, 7, 0, Math.PI * 2)
  ctx.arc(342, 188, 7, 0, Math.PI * 2)
  ctx.fill()

  ctx.fillStyle = '#6a4a18'
  ctx.font = '28px ui-sans-serif, system-ui, sans-serif'
  ctx.fillText('amostra escura', 214, 330)

  const bytes = canvas.toDataURL('image/jpeg', 0.82)
  const binary = atob(bytes.split(',')[1] ?? '')
  const raw = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) raw[i] = binary.charCodeAt(i)
  return new File([raw], 'foto-teste.jpg', { type: 'image/jpeg' })
}

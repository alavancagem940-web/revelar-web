/** Foto plana/lavada de exemplo — o tratamento deve devolver punch. */

function hashNoise(x: number, y: number): number {
  const n = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453
  return n - Math.floor(n)
}

export function washedBarPixels(width = 960, height = 640): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4)
  const cx = width * 0.47
  const cy = height * 0.44
  const lights: [number, number, number, number][] = [
    [0.2, 0.13, 74, 1],
    [0.5, 0.08, 98, 1.2],
    [0.8, 0.14, 72, 1],
  ]

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const nx = x / width
      const ny = y / height
      let r = 126 + ny * 16
      let g = 122 + ny * 12
      let b = 116 + ny * 8

      const grain = Math.sin(y * 0.09 + Math.sin(x * 0.018) * 1.1) * 1.6
      r += grain
      g += grain * 0.8
      b += grain * 0.5

      const bottle = (x + 30) % 54
      if (y > height * 0.56 && y < height * 0.86 && bottle < 10) {
        const center = 1 - Math.abs(bottle - 4.5) / 5
        const edge = bottle < 1.2 || bottle > 8.8 ? 8 : -14 * center
        r += edge
        g += edge * 0.82
        b += edge * 0.68
      }

      if (y > height * 0.74) {
        r -= 12
        g -= 14
        b -= 16
        r += Math.sin(x * 0.07) * 1.6
      }

      for (const [lx, ly, rad, watt] of lights) {
        const dx = x - lx * width
        const dy = y - ly * height
        const d2 = dx * dx + dy * dy
        const glow = Math.exp(-d2 / (rad * rad)) * watt
        const core = Math.exp(-d2 / (rad * rad * 0.07)) * watt
        r += glow * 24 + core * 28
        g += glow * 15 + core * 16
        b += glow * 6 + core * 6
      }

      const dx = (x - cx) / (width * 0.1)
      const dy = (y - cy) / (height * 0.18)
      const face = dx * dx + dy * dy
      if (face < 1) {
        const t = 1 - face
        r += 11 * t
        g += 7 * t
        b += 4 * t
        if (dy < -0.15) {
          r -= 10 * t
          g -= 12 * t
          b -= 13 * t
        }
      }

      const shoulder = Math.hypot(x - cx, y - (cy + height * 0.2))
      if (shoulder < width * 0.15 && y > cy + 16) {
        r -= 7
        g -= 8
        b -= 9
        r += Math.sin(nx * 22 + ny * 6) * 2.4
      }

      const n = (hashNoise(x, y) - 0.5) * 5.5
      r += n
      g += n * 0.92
      b += n * 0.88

      const fog = 150
      r = fog + (r - fog) * 0.42
      g = fog + (g - fog) * 0.4
      b = fog + (b - fog) * 0.38

      const i = (y * width + x) * 4
      data[i] = r
      data[i + 1] = g
      data[i + 2] = b
      data[i + 3] = 255
    }
  }
  return data
}

export function makeSamplePhoto(): File {
  const width = 960
  const height = 640
  const pixels = washedBarPixels(width, height)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas 2D indisponível.')
  const image = new ImageData(width, height)
  image.data.set(pixels)
  ctx.putImageData(image, 0, 0)
  const bytes = canvas.toDataURL('image/jpeg', 0.88)
  const binary = atob(bytes.split(',')[1] ?? '')
  const raw = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) raw[i] = binary.charCodeAt(i)
  return new File([raw], 'foto-plana.jpg', { type: 'image/jpeg' })
}

/** Vizruna VA mark on a 6 × 12 pixel grid: 1 = ink, 2 = active checkpoint. */
export const PIXEL_VIZRUNA_ROWS = [
  '1........1..',
  '.1......1.1.',
  '..1....1...1',
  '...1..112111',
  '....11.....1',
  '.....1.....1',
] as const

export const PIXEL_VIZRUNA_COLS = PIXEL_VIZRUNA_ROWS[0].length
export const PIXEL_VIZRUNA_ROW_COUNT = PIXEL_VIZRUNA_ROWS.length

export type PixelCell = {
  key: string
  on: boolean
  accent: boolean
  delayMs: number
}

export function buildPixelVizrunaCells(): PixelCell[] {
  const cells: PixelCell[] = []
  let idx = 0
  for (let r = 0; r < PIXEL_VIZRUNA_ROW_COUNT; r++) {
    const row = PIXEL_VIZRUNA_ROWS[r]
    for (let c = 0; c < PIXEL_VIZRUNA_COLS; c++) {
      const on = row[c] !== '.'
      cells.push({
        key: `${r}-${c}`,
        on,
        accent: row[c] === '2',
        delayMs: on ? idx++ * 26 : 0,
      })
    }
  }
  return cells
}

export function pixelVizrunaAssembleMs(cellCountOn: number): number {
  return cellCountOn * 26 + 380
}

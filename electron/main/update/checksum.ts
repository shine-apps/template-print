import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'

/** 流式计算文件 SHA256（小写 hex），避免整包读入内存 */
export function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const input = createReadStream(filePath)
    input.on('error', reject)
    input.on('data', (chunk) => hash.update(chunk))
    input.on('end', () => resolve(hash.digest('hex')))
  })
}

/** 校验文件 sha256 是否等于期望值（大小写不敏感） */
export async function verifySha256(filePath: string, expected: string): Promise<boolean> {
  const actual = await sha256File(filePath)
  return actual === expected.toLowerCase()
}

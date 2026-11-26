/**
 * 归档加密：AES-GCM-256 + PBKDF2-SHA256（210,000 次）。
 * 二进制容器：4 字节魔数 "DSAR" + 1 字节版本 + 16 字节 salt + 12 字节 iv + 密文。
 * 这样加密大 ZIP 时不需要 Base64，避免数倍内存膨胀。
 */
const MAGIC = new Uint8Array([0x44, 0x53, 0x41, 0x52]) // DSAR
const VERSION = 1
const ITERATIONS = 210_000
const SALT_LENGTH = 16
const IV_LENGTH = 12
const HEADER_LENGTH = MAGIC.length + 1 + SALT_LENGTH + IV_LENGTH

const encoder = new TextEncoder()

const source = (bytes: Uint8Array): BufferSource => bytes as unknown as BufferSource

const deriveKey = async (password: string, salt: Uint8Array) => {
  const material = await crypto.subtle.importKey(
    'raw',
    source(encoder.encode(password)),
    'PBKDF2',
    false,
    ['deriveKey']
  )
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: source(salt), iterations: ITERATIONS, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
}

export const isEncryptedArchive = async (file: File): Promise<boolean> => {
  if (file.size < HEADER_LENGTH) {
    return false
  }
  const head = new Uint8Array(await file.slice(0, MAGIC.length).arrayBuffer())
  return MAGIC.every((byte, index) => head[index] === byte)
}

export const encryptArchive = async (blob: Blob, password: string): Promise<Blob> => {
  if (password.length < 6) {
    throw new Error('passwordTooShort')
  }
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH))
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH))
  const key = await deriveKey(password, salt)
  const plain = await blob.arrayBuffer()
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: source(iv) }, key, plain)
  const header = new Uint8Array(HEADER_LENGTH)
  header.set(MAGIC, 0)
  header[MAGIC.length] = VERSION
  header.set(salt, MAGIC.length + 1)
  header.set(iv, MAGIC.length + 1 + SALT_LENGTH)
  return new Blob([header, cipher], { type: 'application/octet-stream' })
}

export const decryptArchive = async (file: File, password: string): Promise<Blob> => {
  if (password.length < 6) {
    throw new Error('passwordTooShort')
  }
  const bytes = new Uint8Array(await file.arrayBuffer())
  if (
    bytes.length <= HEADER_LENGTH ||
    !MAGIC.every((byte, index) => bytes[index] === byte) ||
    bytes[MAGIC.length] !== VERSION
  ) {
    throw new Error('invalidFile')
  }
  const salt = bytes.slice(MAGIC.length + 1, MAGIC.length + 1 + SALT_LENGTH)
  const iv = bytes.slice(MAGIC.length + 1 + SALT_LENGTH, HEADER_LENGTH)
  const cipher = bytes.slice(HEADER_LENGTH)
  try {
    const key = await deriveKey(password, salt)
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: source(iv) },
      key,
      source(cipher)
    )
    return new Blob([plain], { type: 'application/zip' })
  } catch {
    throw new Error('wrongPassword')
  }
}

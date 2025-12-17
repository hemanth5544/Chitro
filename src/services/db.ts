import { Pool } from 'pg'

const connectionString = process.env.DATABASE_URL

if (!connectionString) {
  // We don't throw here to keep local dev without DB working (only cloud uploads will fail)
  // eslint-disable-next-line no-console
  console.warn('[db] DATABASE_URL is not set. Video metadata persistence will be disabled.')
}

export const pool = new Pool(
  connectionString
    ? {
        connectionString,
      }
    : undefined
)

export async function query<T = any>(text: string, params: any[] = []): Promise<{ rows: T[] }> {
  const client = await pool.connect()
  try {
    const res = await client.query<T>(text, params)
    return { rows: res.rows }
  } finally {
    client.release()
  }
}

let initialized = false

export async function ensureVideoTable() {
  if (initialized) return
  initialized = true

  // Create table if it doesn't exist
  await query(
    `
    CREATE TABLE IF NOT EXISTS videos (
      id UUID PRIMARY KEY,
      filename TEXT NOT NULL,
      content_type TEXT NOT NULL,
      size BIGINT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      s3_key TEXT NOT NULL,
      public_url TEXT NOT NULL
    );
  `
  )

  // Add public_url column if it doesn't exist (for existing tables)
  try {
    await query(
      `
      ALTER TABLE videos 
      ADD COLUMN IF NOT EXISTS public_url TEXT;
    `
    )
  } catch (error) {
    // Column might already exist, ignore error
    console.log('[db] public_url column check:', error instanceof Error ? error.message : 'unknown')
  }

  // Update existing rows without public_url to have a default value
  await query(
    `
    UPDATE videos 
    SET public_url = '' 
    WHERE public_url IS NULL;
    `
  )
}



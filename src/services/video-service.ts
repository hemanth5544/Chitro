import { S3Service, VideoMetadata } from './s3-service'
import { ensureVideoTable, query } from './db'

export class VideoService {
  /**
   * Create video metadata record (persisted in Postgres / Neon)
   */
  static async createVideoMetadata(
    videoId: string,
    filename: string,
    contentType: string,
    size: number,
    s3Key: string,
    publicUrl?: string
  ): Promise<VideoMetadata> {
    await ensureVideoTable()

    // If publicUrl is provided, use it; otherwise generate one
    const finalPublicUrl = publicUrl || await S3Service.generatePublicUrl(s3Key)

    await query(
      `
      INSERT INTO videos (id, filename, content_type, size, created_at, s3_key, public_url)
      VALUES ($1, $2, $3, $4, NOW(), $5, $6)
      ON CONFLICT (id) DO UPDATE SET public_url = $6;
    `,
      [videoId, filename, contentType, size, s3Key, finalPublicUrl]
    )

    return {
      id: videoId,
      filename,
      contentType,
      size,
      createdAt: new Date().toISOString(),
      s3Key,
      s3Url: finalPublicUrl,
    }
  }

  /**
   * Get video metadata by ID
   */
  static async getVideoMetadata(videoId: string): Promise<VideoMetadata | null> {
    await ensureVideoTable()

    const { rows } = await query<{
      id: string
      filename: string
      content_type: string
      size: string
      created_at: string
      s3_key: string
      public_url: string
    }>(
      `
      SELECT id, filename, content_type, size, created_at, s3_key, public_url
      FROM videos
      WHERE id = $1;
    `,
      [videoId]
    )

    const row = rows[0]
    if (!row) {
      return null
    }

    const metadata: VideoMetadata = {
      id: row.id,
      filename: row.filename,
      contentType: row.content_type,
      size: Number(row.size),
      createdAt: row.created_at,
      s3Key: row.s3_key,
      s3Url: row.public_url, // Use stored public URL from DB
    }

    return metadata
  }

  /**
   * List all videos
   */
  static async listVideos(limit: number = 50): Promise<VideoMetadata[]> {
    await ensureVideoTable()

    const { rows } = await query<{
      id: string
      filename: string
      content_type: string
      size: string
      created_at: string
      s3_key: string
      public_url: string
    }>(
      `
      SELECT id, filename, content_type, size, created_at, s3_key, public_url
      FROM videos
      ORDER BY created_at DESC
      LIMIT $1;
    `,
      [limit]
    )

    const videos: VideoMetadata[] = rows.map((row) => {
      const video: VideoMetadata = {
        id: row.id,
        filename: row.filename,
        contentType: row.content_type,
        size: Number(row.size),
        createdAt: row.created_at,
        s3Key: row.s3_key,
        s3Url: row.public_url || "", // Use stored public URL from DB
      }
      return video
    })

    return videos
  }

  /**
   * Delete video metadata
   */
  static async deleteVideo(videoId: string): Promise<boolean> {
    await ensureVideoTable()

    const { rows } = await query<{ id: string }>(
      `
      DELETE FROM videos
      WHERE id = $1
      RETURNING id;
    `,
      [videoId]
    )

    return rows.length > 0
  }
}



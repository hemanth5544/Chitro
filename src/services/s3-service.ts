import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { randomUUID } from 'node:crypto'

/**
 * Sevalla Object Storage (S3-compatible, powered by Cloudflare R2)
 *
 * Configuration via environment variables (as per Sevalla official docs):
 *
 *   S3_REGION=your_region_here
 *   S3_ACCESS_KEY_ID=your_access_key_here
 *   S3_SECRET_ACCESS_KEY=your_secret_key_here
 *   S3_BUCKET_NAME=your_bucket_name
 *   S3_ENDPOINT=https://s3.sevalla.storage (optional, defaults to this)
 *   S3_PUBLIC_URL=https://chitro-f1si7.sevalla.storage (Sevalla public domain for your bucket)
 */

const region = process.env.S3_REGION || 'us-east-1'
const accessKeyId = process.env.S3_ACCESS_KEY_ID || ''
const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY || ''
const bucketName = process.env.S3_BUCKET_NAME || ''
const endpoint = process.env.S3_ENDPOINT || 'https://s3.sevalla.storage'
// Sevalla public URL format: https://{bucket-name}.sevalla.storage
const publicUrlBase = process.env.S3_PUBLIC_URL || `https://${bucketName}.sevalla.storage`

if (!accessKeyId || !secretAccessKey || !bucketName) {
  console.warn('[S3Service] Missing Sevalla credentials. Cloud uploads will fail.')
  console.warn('[S3Service] Configure S3_REGION, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, and S3_BUCKET_NAME env vars')
}

// Sevalla S3 Client setup (following official docs)
const s3Client = new S3Client({
  region: region,
  credentials: {
    accessKeyId: accessKeyId,
    secretAccessKey: secretAccessKey,
  },
  endpoint: endpoint, // Optional
  forcePathStyle: endpoint ? true : false,
})

const BUCKET_NAME = bucketName

export interface VideoMetadata {
  id: string
  filename: string
  contentType: string
  size: number
  createdAt: string
  s3Key: string
  s3Url: string // Always included - publicly accessible URL
}

export class S3Service {
  /**
   * Upload a video file directly to Sevalla storage (following official docs pattern)
   * Returns the s3Key and public URL
   */
  static async uploadVideo(
    buffer: Buffer,
    filename: string,
    contentType: string = 'video/webm'
  ): Promise<{ videoId: string; s3Key: string; publicUrl: string }> {
    const videoId = randomUUID()
    const extension = filename.split('.').pop() || 'webm'
    const s3Key = `videos/${videoId}.${extension}`

    console.log('[S3Service] Uploading video to Sevalla', {
      bucket: BUCKET_NAME,
      key: s3Key,
      contentType,
      size: buffer.length,
    })

    // Upload file to Sevalla (exact pattern from working test script)
    const putCommand = new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: s3Key,
      Body: buffer,
      ContentType: contentType,
    })

    await s3Client.send(putCommand)
    console.log(`[S3Service] Uploaded file to S3 with key: ${s3Key}`)

    // Generate a signed URL for downloading the file (optional, for authenticated access)
    const getCommand = new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: s3Key,
    })

    const signedUrl = await getSignedUrl(s3Client, getCommand, {
      expiresIn: 3600, // URL valid for 1 hour
    })

    console.log(`[S3Service] Generated signed URL: ${signedUrl.substring(0, 100)}...`)

    // Public URL (Sevalla public domain format)
    const publicUrl = `${publicUrlBase}/${s3Key}`
    console.log(`[S3Service] Public URL: ${publicUrl}`)

    return {
      videoId,
      s3Key,
      publicUrl, // Return public URL (can also use signedUrl if needed)
    }
  }

  /**
   * Generate a presigned URL for uploading a video to S3 (legacy method)
   * @deprecated Use uploadVideo instead for direct backend uploads
   */
  static async generateUploadUrl(
    filename: string,
    contentType: string = 'video/webm'
  ): Promise<{ uploadUrl: string; videoId: string; s3Key: string }> {
    const videoId = randomUUID()
    const extension = filename.split('.').pop() || 'webm'
    const s3Key = `videos/${videoId}.${extension}`

    console.log('[S3Service] Generating upload URL', {
      bucket: BUCKET_NAME,
      key: s3Key,
      contentType,
      endpoint: s3Client.config.endpoint?.toString(),
      region: s3Client.config.region,
    })

    const command = new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: s3Key,
      ContentType: contentType,
      // Optional: Add metadata
      Metadata: {
        'video-id': videoId,
        'original-filename': filename,
        'uploaded-at': new Date().toISOString(),
      },
    })

    // Generate presigned URL (DO NOT send the command - we're just generating a URL)
    // Note: Presigned URLs for Sevalla/R2 will point to the actual R2 endpoint
    // This is correct - the upload will go to R2, which is Sevalla's backend storage
    const uploadUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 }) // 1 hour expiry

    console.log('[S3Service] Upload URL generated', {
      videoId,
      s3Key,
      bucket: BUCKET_NAME,
      endpoint: s3Client.config.endpoint?.toString(),
      uploadUrl: uploadUrl.substring(0, 120) + '...',
      note: 'Upload URL points to R2 (Sevalla backend) - this is correct',
    })

    return {
      uploadUrl,
      videoId,
      s3Key,
    }
  }

  /**
   * Generate a publicly accessible URL for downloading/viewing a video from Sevalla
   * Uses Sevalla's public domain format: https://{bucket}.sevalla.storage/{key}
   * 
   * Note: If your bucket requires authentication, you may need to use presigned URLs instead.
   * Set S3_USE_PRESIGNED=true to use presigned URLs (valid for 7 days).
   */
  static async generatePublicUrl(s3Key: string): Promise<string> {
    const usePresigned = process.env.S3_USE_PRESIGNED === 'true'
    
    if (usePresigned) {
      // Generate presigned URL valid for 7 days (604800 seconds)
      const command = new GetObjectCommand({
        Bucket: BUCKET_NAME,
        Key: s3Key,
      })
      
      const publicUrl = await getSignedUrl(s3Client, command, { expiresIn: 604800 })
      
      console.log('[S3Service] Generated presigned public URL', {
        s3Key,
        url: publicUrl.substring(0, 100) + '...',
        expiresIn: '7 days',
      })
      
      return publicUrl
    } else {
      // Use Sevalla public domain format
      const publicUrl = `${publicUrlBase}/${s3Key}`
      
      console.log('[S3Service] Generated public URL (Sevalla domain)', {
        s3Key,
        publicUrl,
        base: publicUrlBase,
      })
      
      return publicUrl
    }
  }

  /**
   * Generate a presigned URL for downloading/viewing a video from S3
   * @deprecated Use generatePublicUrl instead
   */
  static async generateDownloadUrl(s3Key: string): Promise<string> {
    return this.generatePublicUrl(s3Key)
  }

  /**
   * Get the S3 bucket name
   */
  static getBucketName(): string {
    return BUCKET_NAME
  }

  /**
   * Verify if an object exists in storage
   */
  static async verifyObjectExists(s3Key: string): Promise<boolean> {
    try {
      const command = new HeadObjectCommand({
        Bucket: BUCKET_NAME,
        Key: s3Key,
      })
      
      await s3Client.send(command)
      console.log('[S3Service] Object verified to exist', { s3Key })
      return true
    } catch (error: any) {
      if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
        console.warn('[S3Service] Object not found', { s3Key })
        return false
      }
      console.error('[S3Service] Error verifying object', { s3Key, error: error.message })
      return false
    }
  }
}


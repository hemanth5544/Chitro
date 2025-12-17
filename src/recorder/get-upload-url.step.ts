import { ApiRouteConfig, Handlers } from 'motia'
import { z } from 'zod'
import { S3Service } from '../services/s3-service'
import { VideoService } from '../services/video-service'

const requestSchema = z.object({
  filename: z.string().min(1, 'Filename is required'),
  contentType: z.string().default('video/webm'),
  size: z.number().positive().optional(),
})

const responseSchema = z.object({
  uploadUrl: z.string().url(),
  videoId: z.string().uuid(),
  s3Key: z.string(),
})

export const config: ApiRouteConfig = {
  type: 'api',
  name: 'GetUploadUrl',
  description: 'Generate presigned S3 URL for video upload',
  flows: ['chitro-recorder'],
  method: 'POST',
  path: '/api/recorder/upload-url',
  emits: [],
  bodySchema: requestSchema,
  responseSchema: {
    200: responseSchema,
    400: z.object({ error: z.string() }),
    500: z.object({ error: z.string() }),
  },
}

export const handler: Handlers['GetUploadUrl'] = async (req, { logger }) => {
  try {
    logger.info('Generating upload URL', { body: req.body })

    const { filename, contentType, size } = req.body

    // Generate presigned upload URL
    const { uploadUrl, videoId, s3Key } = await S3Service.generateUploadUrl(
      filename,
      contentType
    )

    // Create video metadata record (size will be updated after upload)
    await VideoService.createVideoMetadata(
      videoId,
      filename,
      contentType,
      size || 0,
      s3Key
    )

    logger.info('Upload URL generated', { videoId, s3Key })

    return {
      status: 200,
      body: {
        uploadUrl,
        videoId,
        s3Key,
      },
    }
  } catch (error) {
    logger.error('Error generating upload URL', { error })
    return {
      status: 500,
      body: {
        error: error instanceof Error ? error.message : 'Failed to generate upload URL',
      },
    }
  }
}


import { ApiRouteConfig, Handlers } from 'motia'
import { z } from 'zod'
import { S3Service } from '../services/s3-service'
import { VideoService } from '../services/video-service'

const responseSchema = z.object({
  videoId: z.string().uuid(),
  s3Key: z.string(),
  publicUrl: z.string().url(),
  message: z.string(),
})

export const config: ApiRouteConfig = {
  type: 'api',
  name: 'UploadVideo',
  description: 'Upload video file to Sevalla storage',
  flows: ['chitro-recorder'],
  method: 'POST',
  path: '/api/recorder/upload',
  emits: ['video-uploaded'],
  // Note: bodySchema for file uploads is handled as multipart/form-data
  responseSchema: {
    200: responseSchema,
    400: z.object({ error: z.string() }),
    500: z.object({ error: z.string() }),
  },
}

export const handler: Handlers['UploadVideo'] = async (req, { logger, emit, state }) => {
  try {
    logger.info('Uploading video to Sevalla', { 
      contentType: req.headers['content-type'],
      contentLength: req.headers['content-length'],
    })

    // Get video file from request
    // Express.raw() middleware parses binary data as Buffer
    let videoBuffer: Buffer
    let filename: string
    let contentType: string = 'video/webm'

    // Check if body is a Buffer (raw binary upload via express.raw())
    if (req.body instanceof Buffer) {
      logger.info('Body is Buffer (raw binary)', { size: req.body.length })
      videoBuffer = req.body
      filename = req.headers['x-filename'] as string || `chitro-recording-${Date.now()}.webm`
      contentType = (req.headers['content-type'] as string) || 'video/webm'
    }
    // Fallback: Check if multer parsed the file (req.file is set by multer)
    else if ((req as any).file) {
      const file = (req as any).file as { buffer: Buffer; originalname: string; mimetype: string }
      logger.info('File received via multer', { 
        size: file.buffer.length,
        originalname: file.originalname,
        mimetype: file.mimetype,
      })
      
      videoBuffer = file.buffer
      filename = file.originalname || `chitro-recording-${Date.now()}.webm`
      contentType = file.mimetype || 'video/webm'
    } 
    // Fallback: Check if body is JSON with base64 encoded video
    else if (typeof req.body === 'object' && req.body !== null && 'video' in req.body && typeof (req.body as any).video === 'string') {
      logger.info('Body is JSON with base64 video')
      const body = req.body as { video: string; filename?: string; contentType?: string }
      videoBuffer = Buffer.from(body.video, 'base64')
      filename = body.filename || `chitro-recording-${Date.now()}.webm`
      contentType = body.contentType || 'video/webm'
    }
    // Unknown format
    else {
      logger.warn('Unknown body format', { 
        bodyType: typeof req.body,
        hasFile: !!(req as any).file,
        bodyKeys: typeof req.body === 'object' && req.body !== null ? Object.keys(req.body) : [],
      })
      return {
        status: 400,
        body: { 
          error: 'Invalid request body format. Expected FormData with video file, binary data, or JSON with video field.',
          receivedType: typeof req.body,
        },
      }
    }

    if (videoBuffer.length === 0) {
      return {
        status: 400,
        body: { error: 'Video file is empty' },
      }
    }

    // Upload to Sevalla storage
    const { videoId, s3Key, publicUrl } = await S3Service.uploadVideo(
      videoBuffer,
      filename,
      contentType
    )

    // Store metadata in Neon DB with public URL
    await VideoService.createVideoMetadata(
      videoId,
      filename,
      contentType,
      videoBuffer.length,
      s3Key,
      publicUrl // Store the public URL directly
    )

    // Cache the video metadata immediately for fast retrieval
    await state.set('videos', videoId, {
      id: videoId,
      filename,
      contentType,
      size: videoBuffer.length,
      createdAt: new Date().toISOString(),
      s3Key,
      s3Url: publicUrl,
    })

    // Invalidate video list cache to ensure fresh data
    await state.clear('video-lists')

    // Emit event for async processing (verification, additional processing, etc.)
    await emit({
      topic: 'video-uploaded',
      data: {
        videoId,
        s3Key,
        filename,
        contentType,
        size: videoBuffer.length,
        publicUrl,
      },
    })

    logger.info('Video uploaded successfully', { videoId, s3Key, publicUrl })

    return {
      status: 200,
      body: {
        videoId,
        s3Key,
        publicUrl,
        message: 'Video uploaded successfully',
      },
    }
  } catch (error) {
    logger.error('Error uploading video', { error })
    return {
      status: 500,
      body: {
        error: error instanceof Error ? error.message : 'Failed to upload video',
      },
    }
  }
}


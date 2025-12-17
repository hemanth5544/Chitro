import { EventConfig, Handlers } from 'motia'
import { z } from 'zod'
import { S3Service } from '../services/s3-service'
import { VideoService } from '../services/video-service'

export const config: EventConfig = {
  type: 'event',
  name: 'ProcessVideoUpload',
  description: 'Process video upload asynchronously - verify upload, update metadata, invalidate cache',
  flows: ['chitro-recorder'],
  subscribes: ['video-uploaded'],
  emits: [],
  input: z.object({
    videoId: z.string().uuid(),
    s3Key: z.string(),
    filename: z.string(),
    contentType: z.string(),
    size: z.number(),
    publicUrl: z.string().url(),
  }),
}

export const handler: Handlers['ProcessVideoUpload'] = async (input, { logger, state, traceId }) => {
  try {
    logger.info('Processing video upload event', { videoId: input.videoId, traceId })

    // Verify the object exists in S3 storage (with caching for performance)
    // Check cache first to avoid repeated S3 API calls
    const verificationCacheKey = `s3-verify:${input.s3Key}`
    const cachedVerification = await state.get<boolean>('s3-verifications', verificationCacheKey)
    let exists: boolean
    let wasCached = false
    
    if (cachedVerification !== null) {
      // Cache hit - use cached result
      exists = cachedVerification
      wasCached = true
      logger.info('S3 verification retrieved from cache', { videoId: input.videoId, s3Key: input.s3Key, exists })
    } else {
      // Cache miss - verify from S3
      exists = await S3Service.verifyObjectExists(input.s3Key)
      // Cache the result (TTL handled by Motia, but we cache positive results)
      if (exists) {
        await state.set('s3-verifications', verificationCacheKey, true)
      }
    }
    
    if (!exists) {
      logger.warn('Video object not found in S3', { videoId: input.videoId, s3Key: input.s3Key })
      // Don't throw - allow metadata to be stored even if verification fails
      // The object might be still uploading
    } else {
      logger.info('Video object verified in S3', { videoId: input.videoId, s3Key: input.s3Key, wasCached })
    }

    // Ensure metadata is stored in database
    await VideoService.createVideoMetadata(
      input.videoId,
      input.filename,
      input.contentType,
      input.size,
      input.s3Key,
      input.publicUrl
    )

    // Cache the video metadata for fast retrieval (Motia state management)
    await state.set('videos', input.videoId, {
      id: input.videoId,
      filename: input.filename,
      contentType: input.contentType,
      size: input.size,
      createdAt: new Date().toISOString(),
      s3Key: input.s3Key,
      s3Url: input.publicUrl,
    })

    // Invalidate video list cache to ensure fresh data
    // Clear all list caches (different limits)
    const allCachedLists = await state.getGroup<{ videos: any[]; count: number }>('video-lists')
    for (const cached of allCachedLists) {
      // We'll clear the entire group since we don't know which limit keys exist
      // This is fine - the cache will rebuild on next request
    }
    await state.clear('video-lists')

    logger.info('Video upload processed successfully', { 
      videoId: input.videoId,
      traceId,
    })
  } catch (error) {
    logger.error('Error processing video upload', { 
      error,
      videoId: input.videoId,
      traceId,
    })
    // Don't throw - we don't want to retry indefinitely
    // The video is already uploaded, this is just metadata processing
  }
}


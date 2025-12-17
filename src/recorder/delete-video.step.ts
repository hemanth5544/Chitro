import { ApiRouteConfig, Handlers } from 'motia'
import { z } from 'zod'
import { VideoService } from '../services/video-service'
import { S3Service } from '../services/s3-service'

export const config: ApiRouteConfig = {
  type: 'api',
  name: 'DeleteVideo',
  description: 'Delete video metadata and optionally from storage',
  flows: ['chitro-recorder'],
  method: 'DELETE',
  path: '/api/recorder/videos/:videoId',
  emits: ['video-deleted'],
  responseSchema: {
    200: z.object({ 
      message: z.string(),
      videoId: z.string().uuid(),
    }),
    404: z.object({ error: z.string() }),
    500: z.object({ error: z.string() }),
  },
}

export const handler: Handlers['DeleteVideo'] = async (req, { logger, state, emit }) => {
  try {
    const { videoId } = req.pathParams

    logger.info('Deleting video', { videoId })

    // Get video metadata first to get S3 key
    const video = await VideoService.getVideoMetadata(videoId)

    if (!video) {
      return {
        status: 404,
        body: {
          error: 'Video not found',
        },
      }
    }

    // Delete from database
    const deleted = await VideoService.deleteVideo(videoId)

    if (!deleted) {
      return {
        status: 404,
        body: {
          error: 'Video not found',
        },
      }
    }

    // Remove from cache (Motia state management)
    await state.delete('videos', videoId)

    // Invalidate video list cache to ensure fresh data
    await state.clear('video-lists')

    // Emit event for async S3 deletion (if needed in future)
    await emit({
      topic: 'video-deleted',
      data: {
        videoId,
        s3Key: video.s3Key,
        filename: video.filename,
      },
    })

    logger.info('Video deleted successfully', { videoId })

    return {
      status: 200,
      body: {
        message: 'Video deleted successfully',
        videoId,
      },
    }
  } catch (error) {
    logger.error('Error deleting video', { error })
    return {
      status: 500,
      body: {
        error: error instanceof Error ? error.message : 'Failed to delete video',
      },
    }
  }
}


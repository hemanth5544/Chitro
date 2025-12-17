import { ApiRouteConfig, Handlers } from 'motia'
import { z } from 'zod'
import { VideoService } from '../services/video-service'

const responseSchema = z.object({
  id: z.string(),
  filename: z.string(),
  contentType: z.string(),
  size: z.number(),
  createdAt: z.string(),
  s3Key: z.string(),
  s3Url: z.string().url(), // Always included - publicly accessible URL
})

export const config: ApiRouteConfig = {
  type: 'api',
  name: 'GetVideo',
  description: 'Get video metadata by ID',
  flows: ['chitro-recorder'],
  method: 'GET',
  path: '/api/recorder/videos/:videoId',
  emits: [],
  responseSchema: {
    200: responseSchema,
    404: z.object({ error: z.string() }),
    500: z.object({ error: z.string() }),
  },
}

export const handler: Handlers['GetVideo'] = async (req, { logger }) => {
  try {
    const { videoId } = req.pathParams

    logger.info('Getting video', { videoId })

    const video = await VideoService.getVideoMetadata(videoId)

    if (!video) {
      return {
        status: 404,
        body: {
          error: 'Video not found',
        },
      }
    }

    return {
      status: 200,
      body: video,
    }
  } catch (error) {
    logger.error('Error getting video', { error })
    return {
      status: 500,
      body: {
        error: error instanceof Error ? error.message : 'Failed to get video',
      },
    }
  }
}


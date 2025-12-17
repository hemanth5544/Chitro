import { ApiRouteConfig, Handlers } from 'motia'
import { z } from 'zod'
import { VideoService } from '../services/video-service'

const responseSchema = z.object({
  videos: z.array(
    z.object({
      id: z.string(),
      filename: z.string(),
      contentType: z.string(),
      size: z.number(),
      createdAt: z.string(),
      s3Key: z.string(),
      s3Url: z.string().url(), // Always included - publicly accessible URL
    })
  ),
  count: z.number(),
})

type VideoListResponse = z.infer<typeof responseSchema>

export const config: ApiRouteConfig = {
  type: 'api',
  name: 'ListVideos',
  description: 'List all recorded videos',
  flows: ['chitro-recorder'],
  method: 'GET',
  path: '/api/recorder/videos',
  emits: [],
  queryParams: [
    {
      name: 'limit',
      description: 'Maximum number of videos to return (default: 50)',
    },
  ],
  responseSchema: {
    200: responseSchema,
    500: z.object({ error: z.string() }),
  },
}

export const handler: Handlers['ListVideos'] = async (req, { logger, state }) => {
  try {
    const limitParam = req.queryParams.limit
    const limit = limitParam
      ? parseInt(Array.isArray(limitParam) ? limitParam[0] : limitParam, 10)
      : 50

    logger.info('Listing videos', { limit })

    // Check cache first (Motia state management for performance)
    // Cache key includes limit to handle different pagination
    const cacheKey = `list:${limit}`
    const cachedResult = await state.get<VideoListResponse>('video-lists', cacheKey)
    
    if (cachedResult) {
      logger.info('Video list retrieved from cache', { limit, count: cachedResult.count })
      return {
        status: 200,
        body: cachedResult,
      }
    }

    // Cache miss - fetch from database
    const videos = await VideoService.listVideos(limit)

    const result = {
      videos,
      count: videos.length,
    }

    // Cache the result for future requests (improves performance)
    await state.set('video-lists', cacheKey, result)

    return {
      status: 200,
      body: result,
    }
  } catch (error) {
    logger.error('Error listing videos', { error })
    return {
      status: 500,
      body: {
        error: error instanceof Error ? error.message : 'Failed to list videos',
      },
    }
  }
}


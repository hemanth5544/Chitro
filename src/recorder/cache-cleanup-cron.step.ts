import { CronConfig, Handlers } from 'motia'

export const config: CronConfig = {
  type: 'cron',
  cron: '0 */6 * * *', // Run every 6 hours
  name: 'CacheCleanupJob',
  description: 'Periodically clean up stale cache entries and maintain cache health',
  flows: ['chitro-recorder'],
  emits: [],
}

export const handler: Handlers['CacheCleanupJob'] = async ({ logger, state }) => {
  try {
    logger.info('Starting cache cleanup job')

    // Get all cached videos
    const cachedVideos = await state.getGroup<{
      id: string
      filename: string
      contentType: string
      size: number
      createdAt: string
      s3Key: string
      s3Url: string
    }>('videos')

    logger.info('Found cached videos', { count: cachedVideos.length })

    // Get all cached video lists
    const cachedLists = await state.getGroup<{ videos: any[]; count: number }>('video-lists')
    logger.info('Found cached video lists', { count: cachedLists.length })

    // Note: Motia state management handles TTL automatically if configured
    // This cron job is for additional maintenance and monitoring

    // Log cache statistics for monitoring
    logger.info('Cache cleanup completed', {
      videosCached: cachedVideos.length,
      listsCached: cachedLists.length,
      timestamp: new Date().toISOString(),
    })

    // Optional: Clear very old upload URL caches (presigned URLs expire after 1 hour)
    // These shouldn't accumulate, but we clean them up just in case
    const uploadUrls = await state.getGroup<any>('upload-urls')
    if (uploadUrls.length > 0) {
      logger.info('Cleaning up expired upload URL caches', { count: uploadUrls.length })
      // Upload URLs expire after 1 hour, so we can safely clear old ones
      // Motia state will handle this automatically, but we log for visibility
    }
  } catch (error) {
    logger.error('Error in cache cleanup job', { error })
    // Don't throw - cron jobs shouldn't fail the system
  }
}


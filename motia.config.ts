import { defineConfig } from '@motiadev/core'
import endpointPlugin from '@motiadev/plugin-endpoint/plugin'
import logsPlugin from '@motiadev/plugin-logs/plugin'
import observabilityPlugin from '@motiadev/plugin-observability/plugin'
import statesPlugin from '@motiadev/plugin-states/plugin'
import bullmqPlugin from '@motiadev/plugin-bullmq/plugin'
import chitroRecorderPlugin from './plugins/chitro-recorder/index.js'
import cors from 'cors'
import express from 'express'
import { S3Service } from './src/services/s3-service.js'
import { VideoService } from './src/services/video-service.js'

export default defineConfig({
  plugins: [observabilityPlugin, statesPlugin, endpointPlugin, logsPlugin, bullmqPlugin, chitroRecorderPlugin],
  app: (app) => {
    // Enable CORS for frontend
    app.use(cors({
      origin: ['http://localhost:5173', 'http://localhost:3000', 'http://localhost:5174'],
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Filename'],
    }))

    // Handle video uploads directly (bypass Motia to avoid spawn E2BIG error with large files)
    app.post('/api/recorder/upload', express.raw({ 
      type: ['video/webm', 'video/*', 'application/octet-stream'],
      limit: 500 * 1024 * 1024, // 500MB in bytes
    }), async (req, res) => {
      try {
        const videoBuffer = req.body as Buffer
        const filename = (req.headers['x-filename'] as string) || `chitro-recording-${Date.now()}.webm`
        const contentType = (req.headers['content-type'] as string) || 'video/webm'

        if (!videoBuffer || videoBuffer.length === 0) {
          return res.status(400).json({ error: 'Video file is empty' })
        }

        console.log('[Upload] Processing video upload', {
          size: videoBuffer.length,
          filename,
          contentType,
        })

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
          publicUrl
        )

        // Note: State management and event emission would be handled here if we had access to Motia context
        // Since this is a direct Express route, we'll rely on the event step to handle caching
        // The event will be emitted by the Motia system when the upload completes

        console.log('[Upload] Video uploaded successfully', { videoId, s3Key, publicUrl })

        res.status(200).json({
          videoId,
          s3Key,
          publicUrl,
          message: 'Video uploaded successfully',
        })
      } catch (error) {
        console.error('[Upload] Error uploading video', error)
        res.status(500).json({
          error: error instanceof Error ? error.message : 'Failed to upload video',
        })
      }
    })
  },
})

# Chitro

**Screen Recording Sharing for Absolutely Everyone**

Chitro is a sleek, modern screen recording application built with Motia. Record your screen, save locally, or upload to AWS S3 cloud storage.

## Features

- 🎥 **Screen Recording**: Record your screen with audio using modern browser APIs
- 💾 **Save Locally**: Download recordings directly to your device
- ☁️ **Cloud Upload**: Upload recordings to AWS S3 for sharing and storage
- 🎨 **Modern UI**: Beautiful, sleek interface with gradient backgrounds and smooth animations
- ⏱️ **Recording Controls**: Start, pause, resume, and stop recording with real-time duration display

## Architecture

This application is built using **Motia**, a unified backend framework that brings APIs, background jobs, workflows, and more into one system.

### Backend Components

- **API Steps** (`src/recorder/`):
  - `get-upload-url.step.ts` - Generates presigned S3 URLs for video uploads
  - `list-videos.step.ts` - Lists all recorded videos
  - `get-video.step.ts` - Retrieves video metadata by ID

- **Services** (`src/services/`):
  - `s3-service.ts` - Sevalla Object Storage (S3-compatible) integration for upload/download URLs
  - `video-service.ts` - Video metadata management

### Frontend Plugin

- **Workbench Plugin** (`plugins/chitro-recorder/`):
  - React component for screen recording UI
  - Integrated into Motia Workbench for easy access

## Setup

### Prerequisites

- Node.js 18+ 
- npm or yarn
- AWS Account with S3 bucket (optional, for cloud uploads)

### Installation

```bash
# Install dependencies
npm install

# Generate TypeScript types
npm run generate-types
```

### Sevalla Object Storage Configuration (for Cloud Uploads)

1. Create a bucket in your Sevalla account
2. Get your S3-compatible credentials from Sevalla Object Storage service details
3. Create a `.env` file in the project root:

```env
S3_REGION=your_region_here
S3_ACCESS_KEY_ID=your_access_key_here
S3_SECRET_ACCESS_KEY=your_secret_key_here
S3_BUCKET_NAME=your_bucket_name
S3_ENDPOINT=https://s3.sevalla.storage
S3_PUBLIC_URL=https://chitro-f1si7.sevalla.storage
```

**Note**: `S3_PUBLIC_URL` should be your Sevalla bucket's public domain (format: `https://{bucket-name}.sevalla.storage`). If your bucket requires authentication, set `S3_USE_PRESIGNED=true` to use presigned URLs instead.

**Note**: The application will work without Sevalla credentials, but cloud uploads will fail. Local saves will still function.

**Important**: You must configure CORS on your Sevalla bucket to allow browser uploads. Use the AWS CLI:

```bash
AWS_ACCESS_KEY_ID=YOUR_S3_ACCESS_KEY_ID \
AWS_SECRET_ACCESS_KEY=YOUR_S3_SECRET_ACCESS_KEY \
aws s3api put-bucket-cors \
  --bucket YOUR_BUCKET_NAME \
  --endpoint-url https://s3.sevalla.storage \
  --cors-configuration '{
    "CORSRules": [
      {
        "AllowedHeaders": ["*"],
        "AllowedMethods": ["PUT", "POST", "GET", "HEAD"],
        "AllowedOrigins": ["http://localhost:5173", "http://localhost:3000"],
        "MaxAgeSeconds": 3000
      }
    ]
  }'
```

### Running the Application

```bash
# Start development server (with hot reload)
npm run dev

# Start production server
npm run start
```

The Motia Workbench will be available at `http://localhost:3000`

## Usage

1. **Access the Recorder**: Click on the "Chitro Recorder" button in the Workbench top panel
2. **Start Recording**: Click "Start Recording" and grant screen capture permissions
3. **Control Recording**: 
   - Click "Pause" to pause/resume recording
   - Click "Stop" to finish recording
4. **Save Your Recording**:
   - **Save to Device**: Downloads the video file to your computer
   - **Upload to Cloud**: Uploads to AWS S3 (requires AWS configuration)

## Project Structure

```
Chitro/
├── src/
│   ├── recorder/          # API endpoints for video operations
│   │   ├── get-upload-url.step.ts
│   │   ├── list-videos.step.ts
│   │   └── get-video.step.ts
│   └── services/          # Business logic and external integrations
│       ├── s3-service.ts
│       └── video-service.ts
├── plugins/
│   └── chitro-recorder/   # Frontend plugin
│       ├── components/
│       │   └── chitro-recorder.tsx
│       └── index.ts
├── motia.config.ts        # Motia configuration
└── package.json
```

## API Endpoints

- `POST /api/recorder/upload-url` - Generate presigned S3 upload URL
- `GET /api/recorder/videos` - List all videos (optional `?limit=50` query param)
- `GET /api/recorder/videos/:videoId` - Get video metadata

## Development

```bash
# Generate types after modifying step configs
npm run generate-types

# Build for production
npm run build

# Clean build artifacts
npm run clean
```

## Technologies

- **Motia** - Unified backend framework
- **React** - Frontend UI library
- **AWS SDK** - S3-compatible API for Sevalla Object Storage
- **TypeScript** - Type safety
- **Zod** - Schema validation
- **Sevalla** - Object storage backend

## License

MIT

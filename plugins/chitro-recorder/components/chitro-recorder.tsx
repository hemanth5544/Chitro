import React, { useState, useRef, useEffect } from 'react'

interface RecordingState {
  isRecording: boolean
  isPaused: boolean
  recordedChunks: Blob[]
  duration: number
  error: string | null
}

interface VideoMetadata {
  uploadUrl: string
  videoId: string
  s3Key: string
}

export const ChitroRecorder: React.FC = () => {
  const [recordingState, setRecordingState] = useState<RecordingState>({
    isRecording: false,
    isPaused: false,
    recordedChunks: [],
    duration: 0,
    error: null,
  })
  
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [showOptions, setShowOptions] = useState(false)
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null)

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const timerRef = useRef<NodeJS.Timeout | null>(null)
  const videoPreviewRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    if (recordingState.isRecording && !recordingState.isPaused) {
      timerRef.current = setInterval(() => {
        setRecordingState((prev) => ({ ...prev, duration: prev.duration + 1 }))
      }, 1000)
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
    }

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current)
      }
    }
  }, [recordingState.isRecording, recordingState.isPaused])

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
  }

  const startRecording = async () => {
    try {
      setRecordingState((prev) => ({ ...prev, error: null }))
      
      // Request screen capture
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          mediaSource: 'screen' as MediaTrackConstraints['mediaSource'],
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        } as MediaTrackConstraints,
        audio: true,
      })

      streamRef.current = stream
      
      // Set up video preview
      if (videoPreviewRef.current) {
        videoPreviewRef.current.srcObject = stream
      }

      // Handle stream end (user stops sharing)
      stream.getVideoTracks()[0].onended = () => {
        stopRecording()
      }

      // Create MediaRecorder
      const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
        ? 'video/webm;codecs=vp9'
        : MediaRecorder.isTypeSupported('video/webm')
        ? 'video/webm'
        : 'video/mp4'

      const mediaRecorder = new MediaRecorder(stream, {
        mimeType,
        videoBitsPerSecond: 2500000, // 2.5 Mbps
      })

      mediaRecorderRef.current = mediaRecorder

      const chunks: Blob[] = []

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunks.push(event.data)
        }
      }

      mediaRecorder.onstop = () => {
        setRecordingState((prev) => ({
          ...prev,
          recordedChunks: chunks,
          isRecording: false,
        }))
        setShowOptions(true)
      }

      mediaRecorder.start(1000) // Collect data every second
      
      setRecordingState({
        isRecording: true,
        isPaused: false,
        recordedChunks: [],
        duration: 0,
        error: null,
      })
    } catch (error) {
      console.error('Error starting recording:', error)
      setRecordingState((prev) => ({
        ...prev,
        error: error instanceof Error ? error.message : 'Failed to start recording',
        isRecording: false,
      }))
    }
  }

  const pauseRecording = () => {
    if (mediaRecorderRef.current && recordingState.isRecording) {
      if (recordingState.isPaused) {
        mediaRecorderRef.current.resume()
        setRecordingState((prev) => ({ ...prev, isPaused: false }))
      } else {
        mediaRecorderRef.current.pause()
        setRecordingState((prev) => ({ ...prev, isPaused: true }))
      }
    }
  }

  const stopRecording = () => {
    if (mediaRecorderRef.current && recordingState.isRecording) {
      mediaRecorderRef.current.stop()
      mediaRecorderRef.current = null
    }

    // Stop all tracks
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    }

    // Clear video preview
    if (videoPreviewRef.current) {
      videoPreviewRef.current.srcObject = null
    }
  }

  const handleSaveToDevice = () => {
    if (recordingState.recordedChunks.length === 0) {
      setRecordingState((prev) => ({ ...prev, error: 'No recording to save' }))
      return
    }

    const blob = new Blob(recordingState.recordedChunks, { type: 'video/webm' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `chitro-recording-${Date.now()}.webm`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)

    setShowOptions(false)
    setRecordingState({
      isRecording: false,
      isPaused: false,
      recordedChunks: [],
      duration: 0,
      error: null,
    })
  }

  const handleUploadToCloud = async () => {
    if (recordingState.recordedChunks.length === 0) {
      setRecordingState((prev) => ({ ...prev, error: 'No recording to upload' }))
      return
    }

    setUploading(true)
    setUploadProgress(0)

    try {
      const blob = new Blob(recordingState.recordedChunks, { type: 'video/webm' })
      const filename = `chitro-recording-${Date.now()}.webm`

      // Step 1: Get presigned upload URL
      const response = await fetch('/api/recorder/upload-url', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          filename,
          contentType: 'video/webm',
          size: blob.size,
        }),
      })

      if (!response.ok) {
        throw new Error('Failed to get upload URL')
      }

      const { uploadUrl, videoId }: VideoMetadata = await response.json()

      // Step 2: Upload to S3 using presigned URL
      const uploadResponse = await fetch(uploadUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': 'video/webm',
        },
        body: blob,
      })

      if (!uploadResponse.ok) {
        throw new Error('Failed to upload video')
      }

      setUploadProgress(100)
      setDownloadUrl(`/api/recorder/videos/${videoId}`)
      
      // Reset recording state
      setShowOptions(false)
      setRecordingState({
        isRecording: false,
        isPaused: false,
        recordedChunks: [],
        duration: 0,
        error: null,
      })

      // Show success message
      alert('Video uploaded successfully!')
    } catch (error) {
      console.error('Error uploading video:', error)
      setRecordingState((prev) => ({
        ...prev,
        error: error instanceof Error ? error.message : 'Failed to upload video',
      }))
    } finally {
      setUploading(false)
      setUploadProgress(0)
    }
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 p-6">
      <div className="w-full max-w-4xl bg-white/10 backdrop-blur-lg rounded-2xl shadow-2xl p-8 border border-white/20">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-white mb-2">Chitro</h1>
          <p className="text-white/70 text-lg">Screen Recording Sharing for Everyone</p>
        </div>

        {/* Video Preview */}
        {recordingState.isRecording && (
          <div className="mb-6 rounded-lg overflow-hidden bg-black">
            <video
              ref={videoPreviewRef}
              autoPlay
              muted
              className="w-full max-h-96 object-contain"
            />
          </div>
        )}

        {/* Recording Status */}
        {recordingState.isRecording && (
          <div className="flex items-center justify-center mb-6">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2 bg-red-500/20 px-4 py-2 rounded-full border border-red-500/50">
                <div className="w-3 h-3 bg-red-500 rounded-full animate-pulse" />
                <span className="text-white font-semibold text-lg">
                  {formatTime(recordingState.duration)}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Controls */}
        {!showOptions && (
          <div className="flex justify-center gap-4 mb-6">
            {!recordingState.isRecording ? (
              <button
                onClick={startRecording}
                className="px-8 py-4 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white font-semibold rounded-xl shadow-lg transform hover:scale-105 transition-all duration-200 flex items-center gap-2"
              >
                <svg
                  className="w-6 h-6"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
                  />
                </svg>
                Start Recording
              </button>
            ) : (
              <>
                <button
                  onClick={pauseRecording}
                  className="px-6 py-3 bg-yellow-600 hover:bg-yellow-700 text-white font-semibold rounded-xl shadow-lg transform hover:scale-105 transition-all duration-200 flex items-center gap-2"
                >
                  {recordingState.isPaused ? (
                    <>
                      <svg
                        className="w-5 h-5"
                        fill="currentColor"
                        viewBox="0 0 20 20"
                      >
                        <path
                          fillRule="evenodd"
                          d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z"
                          clipRule="evenodd"
                        />
                      </svg>
                      Resume
                    </>
                  ) : (
                    <>
                      <svg
                        className="w-5 h-5"
                        fill="currentColor"
                        viewBox="0 0 20 20"
                      >
                        <path
                          fillRule="evenodd"
                          d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zM7 8a1 1 0 012 0v4a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v4a1 1 0 102 0V8a1 1 0 00-1-1z"
                          clipRule="evenodd"
                        />
                      </svg>
                      Pause
                    </>
                  )}
                </button>
                <button
                  onClick={stopRecording}
                  className="px-6 py-3 bg-red-600 hover:bg-red-700 text-white font-semibold rounded-xl shadow-lg transform hover:scale-105 transition-all duration-200 flex items-center gap-2"
                >
                  <svg
                    className="w-5 h-5"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path
                      fillRule="evenodd"
                      d="M10 18a8 8 0 100-16 8 8 0 000 16zM8 7a1 1 0 012 0v4a1 1 0 11-2 0V7zm5-1a1 1 0 00-1 1v4a1 1 0 102 0V8a1 1 0 00-1-1z"
                      clipRule="evenodd"
                    />
                  </svg>
                  Stop
                </button>
              </>
            )}
          </div>
        )}

        {/* Save/Upload Options */}
        {showOptions && (
          <div className="space-y-4">
            <div className="text-center mb-6">
              <p className="text-white text-lg font-semibold mb-2">
                Recording Complete!
              </p>
              <p className="text-white/70">Choose how you'd like to save your recording</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <button
                onClick={handleSaveToDevice}
                disabled={uploading}
                className="px-6 py-4 bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-700 hover:to-cyan-700 text-white font-semibold rounded-xl shadow-lg transform hover:scale-105 transition-all duration-200 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <svg
                  className="w-6 h-6"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                  />
                </svg>
                Save to Device
              </button>

              <button
                onClick={handleUploadToCloud}
                disabled={uploading}
                className="px-6 py-4 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 text-white font-semibold rounded-xl shadow-lg transform hover:scale-105 transition-all duration-200 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {uploading ? (
                  <>
                    <svg
                      className="animate-spin h-6 w-6"
                      fill="none"
                      viewBox="0 0 24 24"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                      />
                    </svg>
                    Uploading...
                  </>
                ) : (
                  <>
                    <svg
                      className="w-6 h-6"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                      />
                    </svg>
                    Upload to Cloud
                  </>
                )}
              </button>
            </div>

            {uploading && (
              <div className="mt-4">
                <div className="bg-white/10 rounded-full h-2 overflow-hidden">
                  <div
                    className="bg-gradient-to-r from-green-500 to-emerald-500 h-full transition-all duration-300"
                    style={{ width: `${uploadProgress}%` }}
                  />
                </div>
                <p className="text-white/70 text-sm text-center mt-2">
                  {uploadProgress}% uploaded
                </p>
              </div>
            )}

            <button
              onClick={() => {
                setShowOptions(false)
                setRecordingState({
                  isRecording: false,
                  isPaused: false,
                  recordedChunks: [],
                  duration: 0,
                  error: null,
                })
              }}
              className="w-full px-4 py-2 bg-white/10 hover:bg-white/20 text-white rounded-lg transition-all duration-200"
            >
              Record Again
            </button>
          </div>
        )}

        {/* Error Message */}
        {recordingState.error && (
          <div className="mt-4 p-4 bg-red-500/20 border border-red-500/50 rounded-lg">
            <p className="text-red-200 text-sm">{recordingState.error}</p>
          </div>
        )}
      </div>
    </div>
  )
}


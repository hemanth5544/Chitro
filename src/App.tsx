import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ThemeToggle } from '@/components/theme-toggle'
import { Play, Pause, Square, Download, Upload, Trash2, X, Video, Check, Copy, ExternalLink } from 'lucide-react'

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000'

function App() {
  const [isRecording, setIsRecording] = useState(false)
  const [isPaused, setIsPaused] = useState(false)
  const [duration, setDuration] = useState(0)
  const [chunks, setChunks] = useState<Blob[]>([])
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showPreview, setShowPreview] = useState(false)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [showSuccessModal, setShowSuccessModal] = useState(false)
  const [uploadedVideoUrl, setUploadedVideoUrl] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const timerRef = useRef<NodeJS.Timeout | null>(null)
  const videoPreviewRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    if (isRecording && !isPaused) {
      timerRef.current = setInterval(() => setDuration((d) => d + 1), 1000)
    } else if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [isRecording, isPaused])

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60)
    const s = seconds % 60
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
  }

  const startRecording = async () => {
    try {
      setError(null)
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { width: { ideal: 1920 }, height: { ideal: 1080 } } as MediaTrackConstraints,
        audio: true,
      })

      streamRef.current = stream
      if (videoPreviewRef.current) videoPreviewRef.current.srcObject = stream

      stream.getVideoTracks()[0].onended = () => stopRecording()

      const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
        ? 'video/webm;codecs=vp9'
        : MediaRecorder.isTypeSupported('video/webm')
        ? 'video/webm'
        : 'video/mp4'

      const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 2_500_000 })
      const localChunks: Blob[] = []

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) localChunks.push(e.data)
      }
      recorder.onstop = () => {
        setChunks(localChunks)
        setIsRecording(false)
        // Create preview URL for the recorded video
        const blob = new Blob(localChunks, { type: mimeType })
        const url = URL.createObjectURL(blob)
        setPreviewUrl(url)
        setShowPreview(true)
      }

      recorder.start(1000)
      mediaRecorderRef.current = recorder
      setDuration(0)
      setIsRecording(true)
      setIsPaused(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start recording')
    }
  }

  const pauseOrResume = () => {
    const rec = mediaRecorderRef.current
    if (!rec) return
    if (rec.state === 'paused') {
      rec.resume()
      setIsPaused(false)
    } else if (rec.state === 'recording') {
      rec.pause()
      setIsPaused(true)
    }
  }

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop()
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
    if (videoPreviewRef.current) videoPreviewRef.current.srcObject = null
  }

  const saveToDevice = () => {
    if (!chunks.length) return setError('No recording to save')
    const blob = new Blob(chunks, { type: 'video/webm' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `chitro-${Date.now()}.webm`
    a.click()
    URL.revokeObjectURL(url)
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    resetState()
  }

  const deleteRecording = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    resetState()
  }

  const uploadToCloud = async () => {
    console.log('[Upload] Starting upload...', { chunksLength: chunks.length })
    if (!chunks.length) {
      console.error('[Upload] No chunks to upload')
      return setError('No recording to upload')
    }
    
    setUploading(true)
    setError(null)
    
    try {
      const blob = new Blob(chunks, { type: 'video/webm' })
      const filename = `chitro-recording-${Date.now()}.webm`

      console.log('[Upload] Step 1: Preparing binary upload...', { 
        blobSize: blob.size, 
        filename 
      })

      // Send file as raw binary data (simpler, avoids multipart parsing issues)
      console.log('[Upload] Step 2: Sending to backend...', { 
        endpoint: `${API_BASE}/api/recorder/upload`
      })

      const res = await fetch(`${API_BASE}/api/recorder/upload`, {
        method: 'POST',
        headers: {
          'Content-Type': 'video/webm',
          'X-Filename': filename,
        },
        body: blob, // Send blob directly as binary
      })

      console.log('[Upload] Step 3: Response received', { 
        status: res.status, 
        statusText: res.statusText,
        ok: res.ok 
      })

      if (!res.ok) {
        const text = await res.text()
        console.error('[Upload] Upload failed', { 
          status: res.status, 
          statusText: res.statusText,
          error: text 
        })
        throw new Error(`Upload failed: ${res.status} ${res.statusText}`)
      }

      const data = await res.json()
      console.log('[Upload] Step 4: Upload successful!', data)
      
      // Close preview modal and show success modal
      setError(null)
      if (previewUrl) URL.revokeObjectURL(previewUrl)
      setShowPreview(false)
      setUploadedVideoUrl(data.publicUrl)
      setShowSuccessModal(true)
      resetState()
    } catch (err) {
      console.error('[Upload] Error:', err)
      setError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  const resetState = () => {
    setChunks([])
    setDuration(0)
    setIsRecording(false)
    setIsPaused(false)
    setShowPreview(false)
    setPreviewUrl(null)
    setError(null)
  }

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      setError('Failed to copy to clipboard')
    }
  }

  const closeSuccessModal = () => {
    setShowSuccessModal(false)
    setUploadedVideoUrl(null)
    setCopied(false)
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-8 max-w-7xl">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-4xl font-bold bg-gradient-to-r from-primary to-purple-600 bg-clip-text text-transparent">
              Chitro
            </h1>
            <p className="text-muted-foreground mt-1">Screen Recording Sharing for Everyone</p>
          </div>
          <ThemeToggle />
        </div>

        {/* Recording Controls */}
        <Card className="mb-8">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Video className="h-5 w-5" />
              Screen Recorder
            </CardTitle>
            <CardDescription>
              Record your screen with audio and save locally or upload to cloud storage
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Video Preview */}
            {isRecording && (
              <div className="rounded-lg overflow-hidden border bg-black aspect-video">
                <video ref={videoPreviewRef} autoPlay muted className="w-full h-full object-contain" />
              </div>
            )}

            {/* Recording Status */}
            {isRecording && (
              <div className="flex items-center justify-center gap-3">
                <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-destructive/10 border border-destructive/20">
                  <div className="h-3 w-3 rounded-full bg-destructive animate-pulse" />
                  <span className="font-mono text-lg font-semibold">{formatTime(duration)}</span>
                </div>
              </div>
            )}

            {/* Controls */}
            <div className="flex flex-wrap gap-3 justify-center">
              {!isRecording ? (
                <Button onClick={startRecording} size="lg" className="gap-2">
                  <Play className="h-4 w-4" />
                  Start Recording
                </Button>
              ) : (
                <>
                  <Button onClick={pauseOrResume} variant="outline" size="lg" className="gap-2">
                    {isPaused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
                    {isPaused ? 'Resume' : 'Pause'}
                  </Button>
                  <Button onClick={stopRecording} variant="destructive" size="lg" className="gap-2">
                    <Square className="h-4 w-4" />
                    Stop
                  </Button>
                </>
              )}
            </div>

            {/* Error Message */}
            {error && (
              <div className="p-4 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm">
                {error}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Preview Modal */}
        {showPreview && previewUrl && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
            <Card className="w-full max-w-4xl mx-4 max-h-[90vh] flex flex-col">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
                <div>
                  <CardTitle className="text-2xl">Recording Preview</CardTitle>
                  <CardDescription>Review your recording and choose an action</CardDescription>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={deleteRecording}
                  className="h-8 w-8"
                >
                  <X className="h-4 w-4" />
                </Button>
              </CardHeader>
              <CardContent className="flex-1 overflow-hidden flex flex-col gap-6">
                {/* Video Preview */}
                <div className="rounded-lg overflow-hidden border bg-black aspect-video">
                  <video
                    src={previewUrl}
                    controls
                    className="w-full h-full object-contain"
                    autoPlay
                  />
                </div>

                {/* Action Buttons */}
                <div className="flex flex-col sm:flex-row gap-3">
                  <Button
                    onClick={saveToDevice}
                    variant="outline"
                    size="lg"
                    className="flex-1 gap-2"
                  >
                    <Download className="h-5 w-5" />
                    Save to Device
                  </Button>
                  <Button
                    onClick={uploadToCloud}
                    disabled={uploading}
                    size="lg"
                    className="flex-1 gap-2"
                  >
                    {uploading ? (
                      <>
                        <Upload className="h-5 w-5 animate-pulse" />
                        Uploading...
                      </>
                    ) : (
                      <>
                        <Upload className="h-5 w-5" />
                        Upload to Cloud
                      </>
                    )}
                  </Button>
                  <Button
                    onClick={deleteRecording}
                    variant="destructive"
                    size="lg"
                    className="flex-1 gap-2"
                  >
                    <Trash2 className="h-5 w-5" />
                    Delete
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Success Modal */}
        {showSuccessModal && uploadedVideoUrl && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
            <Card className="w-full max-w-2xl mx-4">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
                <div className="flex items-center gap-3">
                  <div className="h-12 w-12 rounded-full bg-green-500/20 flex items-center justify-center">
                    <Check className="h-6 w-6 text-green-500" />
                  </div>
                  <div>
                    <CardTitle className="text-2xl">Upload Successful!</CardTitle>
                    <CardDescription>Your video is now available at the public URL</CardDescription>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={closeSuccessModal}
                  className="h-8 w-8"
                >
                  <X className="h-4 w-4" />
                </Button>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Public URL Display */}
                <div className="space-y-2">
                  <label className="text-sm font-medium text-muted-foreground">Public URL</label>
                  <div className="flex items-center gap-2 p-4 rounded-lg border bg-muted/50">
                    <code className="flex-1 text-sm font-mono break-all text-foreground">
                      {uploadedVideoUrl}
                    </code>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => copyToClipboard(uploadedVideoUrl)}
                      className="gap-2 shrink-0"
                    >
                      {copied ? (
                        <>
                          <Check className="h-4 w-4" />
                          Copied!
                        </>
                      ) : (
                        <>
                          <Copy className="h-4 w-4" />
                          Copy
                        </>
                      )}
                    </Button>
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="flex gap-3 pt-2">
                  <Button
                    asChild
                    size="lg"
                    className="flex-1 gap-2"
                  >
                    <a href={uploadedVideoUrl} target="_blank" rel="noreferrer">
                      <ExternalLink className="h-4 w-4" />
                      Open Video
                    </a>
                  </Button>
                  <Button
                    onClick={closeSuccessModal}
                    variant="outline"
                    size="lg"
                    className="flex-1"
                  >
                    Done
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  )
}

export default App

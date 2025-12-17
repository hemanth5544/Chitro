import { useEffect, useRef, useState } from 'react'
import './App.css'

type VideoMeta = {
  id: string
  filename: string
  contentType: string
  size: number
  createdAt: string
  s3Key: string
  s3Url: string // Always included - publicly accessible URL
}

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000'

function App() {
  const [isRecording, setIsRecording] = useState(false)
  const [isPaused, setIsPaused] = useState(false)
  const [duration, setDuration] = useState(0)
  const [chunks, setChunks] = useState<Blob[]>([])
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [videos, setVideos] = useState<VideoMeta[]>([])
  const [showOptions, setShowOptions] = useState(false)

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const timerRef = useRef<NodeJS.Timeout | null>(null)
  const videoPreviewRef = useRef<HTMLVideoElement>(null)

  // Timer
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
        setShowOptions(true)
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
    resetState()
  }

  const uploadToCloud = async () => {
    if (!chunks.length) return setError('No recording to upload')
    setUploading(true)
    setError(null)
    try {
      const blob = new Blob(chunks, { type: 'video/webm' })
      const filename = `chitro-recording-${Date.now()}.webm`

      console.log('Step 1: Converting blob to base64...', { filename, size: blob.size })
      
      // Convert blob to base64 for JSON upload
      const arrayBuffer = await blob.arrayBuffer()
      const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)))

      console.log('Step 2: Uploading to backend...', { 
        blobSize: blob.size, 
        contentType: blob.type,
        base64Length: base64.length,
      })

      const res = await fetch(`${API_BASE}/api/recorder/upload`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          video: base64,
          filename,
          contentType: 'video/webm',
        }),
      })
      
      console.log('Step 3: Upload response', { 
        status: res.status, 
        statusText: res.statusText,
        ok: res.ok,
      })

      if (!res.ok) {
        const text = await res.text()
        console.error('Upload failed response:', {
          status: res.status,
          statusText: res.statusText,
          body: text.substring(0, 1000),
        })
        throw new Error(`Upload failed: ${res.status} ${res.statusText}\n${text.substring(0, 500)}`)
      }

      const data = await res.json()
      console.log('Step 4: Upload successful!', { 
        videoId: data.videoId,
        publicUrl: data.publicUrl,
        message: data.message,
      })
      
      await loadVideos()
      setShowOptions(false)
      resetState()
      alert(`Uploaded successfully! Video is now in Sevalla storage.\nPublic URL: ${data.publicUrl}`)
    } catch (err) {
      console.error('Upload error:', err)
      setError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  const loadVideos = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/recorder/videos`)
      if (!res.ok) throw new Error('Failed to list videos')
      const data = await res.json()
      setVideos(data.videos || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load videos')
    }
  }

  const resetState = () => {
    setChunks([])
    setDuration(0)
    setIsRecording(false)
    setIsPaused(false)
    setShowOptions(false)
  }

  useEffect(() => {
    loadVideos()
  }, [])

  return (
    <div className="page">
      <header className="hero">
        <div>
          <p className="eyebrow">Chitro · Screen Recorder</p>
          <h1>Record, Save, or Upload</h1>
          <p className="subhead">
            Capture your screen in one click. Save locally or upload to the cloud via the Motia backend.
          </p>
          <div className="actions">
            {!isRecording ? (
              <button className="btn primary" onClick={startRecording}>
                Start Recording
              </button>
            ) : (
              <>
                <button className="btn" onClick={pauseOrResume}>
                  {isPaused ? 'Resume' : 'Pause'}
                </button>
                <button className="btn danger" onClick={stopRecording}>
                  Stop
                </button>
              </>
            )}
            <button className="btn ghost" onClick={loadVideos}>
              Refresh Library
            </button>
          </div>
          {isRecording && (
            <div className="status">
              <span className="dot" /> Recording · {formatTime(duration)}
            </div>
          )}
        </div>
        {isRecording && <div className="preview">
          <video ref={videoPreviewRef} autoPlay muted />
        </div>}
      </header>

      {showOptions && (
        <section className="panel">
          <h3>Recording ready</h3>
          <p>Choose where to save your recording.</p>
          <div className="actions">
            <button className="btn" onClick={saveToDevice}>
              Save to device
            </button>
            <button className="btn primary" onClick={uploadToCloud} disabled={uploading}>
              {uploading ? 'Uploading…' : 'Upload to cloud'}
            </button>
          </div>
        </section>
      )}

      <section className="panel">
        <div className="panel-head">
      <div>
            <h3>Your recordings</h3>
            <p>Latest uploads from the backend.</p>
      </div>
          <button className="btn ghost" onClick={loadVideos}>
            Refresh
        </button>
        </div>
        {videos.length === 0 ? (
          <p className="muted">No videos yet.</p>
        ) : (
          <div className="video-list">
            {videos.map((v) => (
              <div key={v.id} className="video-card">
                <div className="video-meta">
                  <h4>{v.filename}</h4>
                  <p className="muted">
                    {new Date(v.createdAt).toLocaleString()} · {(v.size / 1024 / 1024).toFixed(2)} MB
                  </p>
                  <p className="muted small">ID: {v.id}</p>
                  <div className="video-url">
                    <p className="muted small">Public URL:</p>
                    <a 
                      href={v.s3Url} 
                      target="_blank" 
                      rel="noreferrer"
                      className="url-link"
                      title={v.s3Url}
                    >
                      {v.s3Url.length > 60 ? v.s3Url.substring(0, 60) + '...' : v.s3Url}
                    </a>
                  </div>
                </div>
                <div className="video-actions">
                  <a className="btn small" href={v.s3Url} target="_blank" rel="noreferrer">
                    Watch
                  </a>
                  <button 
                    className="btn small ghost" 
                    onClick={() => {
                      navigator.clipboard.writeText(v.s3Url)
                      alert('URL copied to clipboard!')
                    }}
                  >
                    Copy URL
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {error && <div className="error">{error}</div>}
      </div>
  )
}

export default App

import React, { useEffect, useRef, useState } from 'react'
import { Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Stack, TextField, Typography } from '@mui/material'
import CameraAltOutlined from '@mui/icons-material/CameraAltOutlined'
import UploadFileOutlined from '@mui/icons-material/UploadFileOutlined'
import jsQR from 'jsqr'

/** Camera access starts only after the user opens this dialog; every exit stops tracks. */
export default function QrScanner({ open, onClose, onRead, continuous = false, progress, title = 'Scan a payment code', description }: { open: boolean; onClose: () => void; onRead: (value: string) => void; continuous?: boolean; progress?: string; title?: string; description?: string }) {
  const video = useRef<HTMLVideoElement>(null)
  const reader = useRef(onRead)
  const closer = useRef(onClose)
  const [camera, setCamera] = useState(false)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState('')
  const [text, setText] = useState('')
  useEffect(() => { reader.current = onRead; closer.current = onClose }, [onRead, onClose])
  useEffect(() => {
    if (!open) { setCamera(false); setText(''); setError('') }
  }, [open])
  useEffect(() => {
    if (!open || !camera) return
    let alive = true, stream: MediaStream | undefined, timer: ReturnType<typeof setInterval> | undefined, busy = false
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d', { willReadFrequently: true })
    let previous = '', previousAt = 0
    setStarting(true); setError('')
    if (!navigator.mediaDevices?.getUserMedia) { setError('Camera access is unavailable. Import a QR image or paste the code.'); setCamera(false); setStarting(false); return }
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false }).then(async result => {
      stream = result
      if (!alive || !video.current) { stream.getTracks().forEach(track => track.stop()); return }
      video.current.srcObject = stream
      await video.current.play()
      if (!alive) return
      setStarting(false)
      timer = setInterval(() => {
        const element = video.current
        if (!alive || busy || !context || !element?.videoWidth) return
        busy = true
        try {
          canvas.width = element.videoWidth; canvas.height = element.videoHeight
          context.drawImage(element, 0, 0)
          const pixels = context.getImageData(0, 0, canvas.width, canvas.height)
          const code = jsQR(pixels.data, pixels.width, pixels.height, { inversionAttempts: 'dontInvert' })
          if (code && (code.data !== previous || Date.now() - previousAt > 1500)) {
            previous = code.data; previousAt = Date.now(); reader.current(code.data)
            if (!continuous) { closer.current(); return }
          }
        } finally { busy = false }
      }, 150)
    }).catch(error => { if (alive) { setError(error.name === 'NotAllowedError' ? 'Camera access was denied. Enable it in system settings, import an image, or paste a payment code.' : 'The camera is unavailable. Import a QR image or paste the payment code.'); setStarting(false); setCamera(false) } })
    return () => { alive = false; if (timer) clearInterval(timer); stream?.getTracks().forEach(track => track.stop()); if (video.current) video.current.srcObject = null }
  }, [open, camera, continuous])

  const importImage = async (file?: File) => {
    if (!file) return
    setError('')
    if (file.size > 10 * 1024 * 1024) { setError('Choose a QR image smaller than 10 MB.'); return }
    const url = URL.createObjectURL(file)
    try {
      const image = new Image(); image.src = url; await image.decode()
      const scale = Math.min(1, 1600 / Math.max(image.width, image.height))
      const canvas = document.createElement('canvas'); canvas.width = image.width * scale; canvas.height = image.height * scale
      const ctx = canvas.getContext('2d')!; ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height)
      const code = jsQR(pixels.data, pixels.width, pixels.height)
      if (!code) throw new Error('No QR code was found in this image. Try a clearer image.')
      reader.current(code.data); if (!continuous) onClose()
    } catch (error) { setError((error as Error).message || 'This image could not be read.') } finally { URL.revokeObjectURL(url) }
  }
  return <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
    <DialogTitle>{title}</DialogTitle>
    <DialogContent><Stack spacing={2}>
      <Typography color="text.secondary">{description || (continuous ? 'Point your camera at the animated payment code. Keep scanning until all parts are collected.' : 'Scan a wallet, address, or nearby request.')}</Typography>
      {error && <Alert severity="warning">{error}</Alert>}
      {camera && <Box sx={{ bgcolor: '#0f172a', borderRadius: 2, overflow: 'hidden', minHeight: 180, position: 'relative' }}><video ref={video} muted playsInline style={{ width: '100%', display: 'block' }} />{starting && <CircularProgress size={28} sx={{ position: 'absolute', top: '45%', left: '45%', color: 'white' }} />}</Box>}
      {progress && <Alert severity="info">{progress}</Alert>}
      <Stack direction="row" spacing={1}><Button variant="outlined" startIcon={<CameraAltOutlined />} onClick={() => setCamera(value => !value)}>{camera ? 'Stop camera' : 'Use camera'}</Button><Button component="label" startIcon={<UploadFileOutlined />}>Import QR image<input type="file" hidden accept="image/*" onChange={event => { void importImage(event.target.files?.[0]); event.target.value = '' }} /></Button></Stack>
      <TextField fullWidth multiline minRows={2} label="Or paste a code" value={text} onChange={event => setText(event.target.value)} />
      <Button variant="contained" disabled={!text.trim()} onClick={() => { for (const value of text.trim().split(/\r?\n/).filter(Boolean)) reader.current(value.trim()); setText(''); if (!continuous) onClose() }}>Read code</Button>
    </Stack></DialogContent><DialogActions><Button onClick={onClose}>Close</Button></DialogActions>
  </Dialog>
}

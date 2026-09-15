/**
 * Nagrywanie głosu i przygotowanie pliku WAV dla whisper.cpp.
 *
 * whisper.cpp przyjmuje wyłącznie WAV 16 kHz mono. Zamiast dokładać do aplikacji
 * kilkudziesięciomegabajtowy ffmpeg, dekodujemy nagranie wbudowanym w przeglądarkę
 * `decodeAudioData`, przepuszczamy przez `OfflineAudioContext` o częstotliwości 16 kHz
 * (co załatwia resampling i redukcję do mono) i sami składamy nagłówek WAV.
 */
import { tNow } from '@renderer/store/i18n-store'

const TARGET_SAMPLE_RATE = 16000

export interface RecordingResult {
  /** Zawartość gotowego pliku WAV. */
  wav: Uint8Array
  durationSeconds: number
}

export class VoiceRecorder {
  private stream: MediaStream | null = null
  private recorder: MediaRecorder | null = null
  private chunks: Blob[] = []
  private analyser: AnalyserNode | null = null
  private liveContext: AudioContext | null = null

  get isRecording(): boolean {
    return this.recorder?.state === 'recording'
  }

  /** @throws gdy użytkownik odmówi dostępu do mikrofonu albo urządzenia nie ma */
  async start(): Promise<void> {
    if (this.isRecording) return

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      })
    } catch (error) {
      throw new Error(describeMicrophoneError(error))
    }

    // Osobny kontekst tylko po to, żeby rysować poziom sygnału w trakcie mówienia.
    this.liveContext = new AudioContext()
    const source = this.liveContext.createMediaStreamSource(this.stream)
    this.analyser = this.liveContext.createAnalyser()
    this.analyser.fftSize = 256
    source.connect(this.analyser)

    this.chunks = []
    this.recorder = new MediaRecorder(this.stream)
    this.recorder.ondataavailable = (event) => {
      if (event.data.size > 0) this.chunks.push(event.data)
    }
    this.recorder.start(200)
  }

  /**
   * Aktualne poziomy sygnału (0–255) do rysowania fali.
   *
   * Typ zawęża bufor do `ArrayBuffer` (a nie `ArrayBufferLike`), bo Web Audio nie przyjmuje
   * widoków opartych na `SharedArrayBuffer`.
   */
  readLevels(target: Uint8Array<ArrayBuffer>): void {
    if (this.analyser) this.analyser.getByteFrequencyData(target)
    else target.fill(0)
  }

  /** Kończy nagranie i zwraca gotowy WAV. `null`, gdy nic nie nagrano. */
  async stop(): Promise<RecordingResult | null> {
    const recorder = this.recorder
    if (!recorder || recorder.state === 'inactive') {
      this.release()
      return null
    }

    const finished = new Promise<void>((resolve) => {
      recorder.onstop = () => resolve()
    })
    recorder.stop()
    await finished

    const blob = new Blob(this.chunks, { type: recorder.mimeType })
    this.release()

    if (blob.size === 0) return null
    return encodeToWav(await blob.arrayBuffer())
  }

  /** Przerywa nagranie bez transkrypcji. */
  cancel(): void {
    if (this.recorder?.state === 'recording') this.recorder.stop()
    this.chunks = []
    this.release()
  }

  private release(): void {
    for (const track of this.stream?.getTracks() ?? []) track.stop()
    this.stream = null
    this.recorder = null
    this.analyser = null
    void this.liveContext?.close()
    this.liveContext = null
  }
}

async function encodeToWav(compressed: ArrayBuffer): Promise<RecordingResult | null> {
  const decodeContext = new AudioContext()
  let decoded: AudioBuffer
  try {
    decoded = await decodeContext.decodeAudioData(compressed)
  } finally {
    void decodeContext.close()
  }

  if (decoded.duration === 0) return null

  // OfflineAudioContext o docelowej częstotliwości robi resampling i redukcję do mono za nas.
  const frames = Math.ceil(decoded.duration * TARGET_SAMPLE_RATE)
  const offline = new OfflineAudioContext(1, frames, TARGET_SAMPLE_RATE)
  const source = offline.createBufferSource()
  source.buffer = decoded
  source.connect(offline.destination)
  source.start()

  const rendered = await offline.startRendering()
  return {
    wav: buildWav(rendered.getChannelData(0), TARGET_SAMPLE_RATE),
    durationSeconds: decoded.duration,
  }
}

/** Składa 16-bitowy WAV PCM. Nagłówek ma stałe 44 bajty. */
function buildWav(samples: Float32Array, sampleRate: number): Uint8Array {
  const bytesPerSample = 2
  const dataBytes = samples.length * bytesPerSample
  const buffer = new ArrayBuffer(44 + dataBytes)
  const view = new DataView(buffer)

  const writeAscii = (offset: number, text: string): void => {
    for (let index = 0; index < text.length; index++) {
      view.setUint8(offset + index, text.charCodeAt(index))
    }
  }

  writeAscii(0, 'RIFF')
  view.setUint32(4, 36 + dataBytes, true)
  writeAscii(8, 'WAVE')
  writeAscii(12, 'fmt ')
  view.setUint32(16, 16, true) // długość bloku fmt
  view.setUint16(20, 1, true) // PCM bez kompresji
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * bytesPerSample, true) // bajtów na sekundę
  view.setUint16(32, bytesPerSample, true) // wyrównanie bloku
  view.setUint16(34, 8 * bytesPerSample, true)
  writeAscii(36, 'data')
  view.setUint32(40, dataBytes, true)

  let offset = 44
  for (const sample of samples) {
    // Przycięcie chroni przed przepełnieniem przy próbkach spoza zakresu [-1, 1].
    const clamped = Math.max(-1, Math.min(1, sample))
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true)
    offset += bytesPerSample
  }

  return new Uint8Array(buffer)
}

function describeMicrophoneError(error: unknown): string {
  const name = (error as { name?: string }).name
  if (name === 'NotAllowedError') return tNow('voice.micDenied')
  if (name === 'NotFoundError') return tNow('voice.micNotFound')
  if (name === 'NotReadableError') return tNow('voice.micBusy')
  return error instanceof Error ? error.message : tNow('voice.micGeneric')
}

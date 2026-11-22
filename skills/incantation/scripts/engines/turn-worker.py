# End-of-turn check (docs/spec/0001, S5.8): Pipecat's Smart Turn v3.2 (BSD-2-Clause,
# Whisper Tiny encoder, int8 ONNX for CPU) hears from the voice itself whether
# the person sounds finished, so a pause mid-thought does not end the turn.
#
# Started as `python -I turn-worker.py <model>`, with the model path the
# installer pinned. Protocol on stdin/stdout: writes the magic TRN1 once
# loaded; then for each request, a little-endian uint32 sample count and that
# many 16 kHz int16 samples (the turn so far), and answers one float32: the
# chance it is done. It reads and writes pipes only, and opens no connection.
# Whisper's log-mel features are computed here with numpy, as transformers'
# WhisperFeatureExtractor(chunk_length=8) makes them.
import onnxruntime as ort

ort.disable_telemetry_events()

import os
import struct
import sys

import numpy as np

RATE, SECONDS, N_FFT, HOP, MELS = 16000, 8, 400, 160, 80
MAX = RATE * SECONDS


def mel_filters():
    # Slaney-style mel scale and area normalisation, 0 to 8 kHz, as Whisper uses.
    def hz_to_mel(f):
        f = np.asarray(f, dtype=np.float64)
        lin = f / (200.0 / 3)
        log = 15.0 + np.log(np.maximum(f, 1e-10) / 1000.0) / (np.log(6.4) / 27.0)
        return np.where(f >= 1000.0, log, lin)

    def mel_to_hz(m):
        m = np.asarray(m, dtype=np.float64)
        lin = m * (200.0 / 3)
        log = 1000.0 * np.exp((np.log(6.4) / 27.0) * (m - 15.0))
        return np.where(m >= 15.0, log, lin)

    fft_freqs = np.linspace(0, RATE / 2, N_FFT // 2 + 1)
    mel_pts = mel_to_hz(np.linspace(hz_to_mel(0.0), hz_to_mel(RATE / 2), MELS + 2))
    fdiff = np.diff(mel_pts)
    ramps = mel_pts[:, None] - fft_freqs[None, :]
    lower = -ramps[:-2] / fdiff[:-1, None]
    upper = ramps[2:] / fdiff[1:, None]
    weights = np.maximum(0, np.minimum(lower, upper))
    weights *= (2.0 / (mel_pts[2 : MELS + 2] - mel_pts[:MELS]))[:, None]
    return weights  # (80, 201)


FILTERS = mel_filters()
WINDOW = 0.5 - 0.5 * np.cos(2 * np.pi * np.arange(N_FFT) / N_FFT)  # periodic Hann


def features(samples):
    x = samples.astype(np.float32) / 32768.0
    x = x[-MAX:]
    n = len(x)
    if n:
        x = (x - x.mean()) / np.sqrt(x.var() + 1e-7)  # zero mean, unit variance over the real samples
    x = np.concatenate([x, np.zeros(MAX - n, dtype=np.float32)])  # padded at the end, after normalising
    padded = np.pad(x, N_FFT // 2, mode="reflect")
    frames = np.lib.stride_tricks.sliding_window_view(padded, N_FFT)[::HOP]
    spec = np.abs(np.fft.rfft(frames * WINDOW, axis=-1)) ** 2  # (801, 201)
    mel = FILTERS @ spec[:-1].T  # (80, 800)
    log = np.log10(np.maximum(mel, 1e-10))
    log = np.maximum(log, log.max() - 8.0)
    return ((log + 4.0) / 4.0).astype(np.float32)[None]


def main():
    model = sys.argv[1]
    so = ort.SessionOptions()
    so.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
    so.inter_op_num_threads = 1
    so.intra_op_num_threads = 2
    so.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
    session = ort.InferenceSession(model, sess_options=so, providers=["CPUExecutionProvider"])
    out = sys.stdout.buffer
    inp = sys.stdin.buffer
    session.run(None, {"input_features": features(np.zeros(RATE, dtype=np.int16))})  # warm
    out.write(b"TRN1")
    out.flush()
    while True:
        head = inp.read(4)
        if len(head) < 4:
            return
        (n,) = struct.unpack("<I", head)
        if n > RATE * 600:
            return
        body = inp.read(n * 2)
        if len(body) < n * 2:
            return
        p = session.run(None, {"input_features": features(np.frombuffer(body, dtype="<i2"))})[0]
        out.write(struct.pack("<f", float(np.asarray(p).reshape(-1)[0])))
        out.flush()


if __name__ == "__main__":
    try:
        main()
    except (BrokenPipeError, KeyboardInterrupt):
        os._exit(0)

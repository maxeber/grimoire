# Echo canceller (docs/spec/0001, S5.8): WebRTC's AEC3 through the livekit
# package's AudioProcessingModule. Writes b"AEC1" once ready. Then, for each
# 1920 bytes in (30 ms of mic, then 30 ms of what was playing, both 16 kHz
# 16-bit mono), writes 960 bytes out: the mic with the echo taken out. Exits
# when stdin closes, so it ends with the listener. It reads and writes pipes
# only, and opens no connection.
import onnxruntime

onnxruntime.disable_telemetry_events()

import sys

from livekit import rtc

RATE, SUB = 16000, 160  # the module takes 10 ms frames
apm = rtc.AudioProcessingModule(echo_cancellation=True, high_pass_filter=True)
inp, out = sys.stdin.buffer, sys.stdout.buffer
out.write(b"AEC1")
out.flush()

while True:
    chunk = inp.read(1920)
    if len(chunk) < 1920:
        break
    mic, ref = chunk[:960], chunk[960:]
    cleaned = bytearray()
    for k in range(0, 960, SUB * 2):
        apm.process_reverse_stream(rtc.AudioFrame(ref[k : k + SUB * 2], RATE, 1, SUB))
        frame = rtc.AudioFrame(mic[k : k + SUB * 2], RATE, 1, SUB)
        apm.process_stream(frame)
        cleaned += bytes(frame.data)
    out.write(cleaned)
    out.flush()

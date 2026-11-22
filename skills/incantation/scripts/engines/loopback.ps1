# Everything the default speaker plays, as 16 kHz mono 16-bit PCM on stdout,
# for the echo canceller's reference (docs/spec/0001, S5.8). WASAPI loopback,
# shared mode, through COM interop compiled here: nothing to install. Writes the
# magic LBK1 once capture runs. While nothing plays, Windows sends no packets and
# this writes nothing; the listener pads the gap with silence. The samples go to
# stdout only and are never written to a file.
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;

[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumeratorCo {}

[ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator {
  [PreserveSig] int EnumAudioEndpoints(int flow, int mask, out IntPtr devices);
  [PreserveSig] int GetDefaultAudioEndpoint(int flow, int role, out IMMDevice dev);
}

[ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice {
  [PreserveSig] int Activate(ref Guid iid, int ctx, IntPtr p, [MarshalAs(UnmanagedType.IUnknown)] out object o);
}

[ComImport, Guid("1CB9AD4C-DBFA-4c32-B178-C2F568A703B2"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioClient {
  [PreserveSig] int Initialize(int share, int flags, long bufDur, long period, IntPtr fmt, IntPtr session);
  [PreserveSig] int GetBufferSize(out uint n);
  [PreserveSig] int GetStreamLatency(out long l);
  [PreserveSig] int GetCurrentPadding(out uint p);
  [PreserveSig] int IsFormatSupported(int m, IntPtr f, out IntPtr c);
  [PreserveSig] int GetMixFormat(out IntPtr f);
  [PreserveSig] int GetDevicePeriod(out long d, out long m);
  [PreserveSig] int Start();
  [PreserveSig] int Stop();
  [PreserveSig] int Reset();
  [PreserveSig] int SetEventHandle(IntPtr h);
  [PreserveSig] int GetService(ref Guid iid, [MarshalAs(UnmanagedType.IUnknown)] out object o);
}

[ComImport, Guid("C8ADBD64-E71E-48a0-A4DE-185C395CD317"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioCaptureClient {
  [PreserveSig] int GetBuffer(out IntPtr data, out uint frames, out uint flags, out long pos, out long qpc);
  [PreserveSig] int ReleaseBuffer(uint frames);
  [PreserveSig] int GetNextPacketSize(out uint n);
}

public static class Loopback {
  static void Check(int hr, string what) { if (hr < 0) throw new Exception(what + " 0x" + hr.ToString("X8")); }

  public static void Run() {
    var en = (IMMDeviceEnumerator)new MMDeviceEnumeratorCo();
    IMMDevice dev; Check(en.GetDefaultAudioEndpoint(0, 0, out dev), "endpoint"); // eRender, eConsole
    Guid iidClient = typeof(IAudioClient).GUID; object o;
    Check(dev.Activate(ref iidClient, 23, IntPtr.Zero, out o), "activate"); // CLSCTX_ALL
    var client = (IAudioClient)o;
    IntPtr fmt; Check(client.GetMixFormat(out fmt), "format");
    int tag = Marshal.ReadInt16(fmt, 0), ch = Marshal.ReadInt16(fmt, 2), rate = Marshal.ReadInt32(fmt, 4), bits = Marshal.ReadInt16(fmt, 14);
    bool isFloat = tag == 3 || (tag == -2 && Marshal.ReadInt32(fmt, 24) == 3); // WAVE_FORMAT_IEEE_FLOAT, or EXTENSIBLE with its subformat
    if (!(isFloat && bits == 32) && bits != 16) throw new Exception("mix format " + tag + "/" + bits);
    Check(client.Initialize(0, 0x00020000, 2000000, 0, fmt, IntPtr.Zero), "init"); // shared, LOOPBACK, 200 ms
    Guid iidCap = typeof(IAudioCaptureClient).GUID;
    Check(client.GetService(ref iidCap, out o), "service");
    var cap = (IAudioCaptureClient)o;
    Check(client.Start(), "start");
    var out_ = Console.OpenStandardOutput();
    out_.Write(new byte[] { 76, 66, 75, 49 }, 0, 4); out_.Flush(); // LBK1
    double step = rate / 16000.0, pos = 0; // source frames per output sample; pos is into the next packet
    double acc = 0; int accN = 0;
    var outBuf = new MemoryStream();
    while (true) {
      uint size; Check(cap.GetNextPacketSize(out size), "packet");
      if (size == 0) { Thread.Sleep(5); continue; }
      IntPtr data; uint frames, flags; long p, q;
      Check(cap.GetBuffer(out data, out frames, out flags, out p, out q), "buffer");
      bool silent = (flags & 2) != 0;
      outBuf.SetLength(0);
      for (int i = 0; i < frames; i++) {
        double m = 0;
        if (!silent) {
          for (int c = 0; c < ch; c++) {
            int off = (i * ch + c) * (bits / 8);
            m += isFloat ? BitConverter.ToSingle(BitConverter.GetBytes(Marshal.ReadInt32(data, off)), 0) : Marshal.ReadInt16(data, off) / 32768.0;
          }
          m /= ch;
        }
        acc += m; accN++; pos += 1;
        if (pos >= step) { // box filter over the source frames of one output sample
          pos -= step;
          int s = (int)Math.Round(acc / accN * 32767);
          if (s > 32767) s = 32767; if (s < -32768) s = -32768;
          outBuf.WriteByte((byte)(s & 0xff)); outBuf.WriteByte((byte)((s >> 8) & 0xff));
          acc = 0; accN = 0;
        }
      }
      Check(cap.ReleaseBuffer(frames), "release");
      if (outBuf.Length > 0) { out_.Write(outBuf.GetBuffer(), 0, (int)outBuf.Length); out_.Flush(); }
    }
  }
}
'@
[Loopback]::Run()

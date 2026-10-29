This three-second silent teal clip is generated test media, not social content.
It exercises real muted H.264/fMP4 HLS decoding without calling an external CDN.
The browser fixture maps its fixed files to provider-shaped URLs. `clip.mp4` is
the same generated stream remuxed as progressive MP4 for Facebook playback tests.

Generated with FFmpeg's `color=c=teal:s=160x90:r=15:d=3` source, libx264 baseline,
one-second fMP4 HLS segments and no audio. No downloaded or user media is included.

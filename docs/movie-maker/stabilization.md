# Measured video stabilization

Movie Maker's **Anti-shake** analysis corrects measured horizontal and vertical camera shake. It does not claim rotation, perspective, zoom, optical lens correction or rolling-shutter/wobble removal. Gentle and Strong choose 0.35-second and 0.75-second motion-smoothing windows. This is an original local implementation, not a renamed zoom effect or a copy of Windows' proprietary stabilization engine.

The shared media service decodes the selected source trim. A dedicated worker matches luminance patches between successive frames, rejects inconsistent foreground matches with a global translation consensus, and estimates the image motion. Gaussian local-linear smoothing preserves steady intentional pans, including near the ends. Low-confidence pairs split the path, preventing smoothing across detected scene changes. The difference between the measured and smoothed paths becomes the actual corrective transform. The crop is calculated from those transforms to keep exposed source borders out of the picture.

The model stores these decisions as optional, versioned `clip.stabilization` data. Coordinates are normalized by decoded source dimensions and indexed in original source-frame time. The preview and offline exporter apply the same corrections. Trimming, speed changes and splitting retain the original analyzed source-time relationship; extending a trim beyond its analyzed region requires reanalysis for that added region. Relinking a different original disables the previous source's corrections. Applying or removing an analysis is an ordinary undoable project edit.

The dialogue presents progress, cancellation, measured confidence and the required crop before applying. Original media bytes are retained. Analysis reads at most 30 frames per second, uses a small luminance plane and one frame pair in flight, and accepts at most ten minutes of selected source per analysis. It refuses an unreliable result or an extreme crop instead of inventing a correction. Low texture, strong motion blur, dominant moving foregrounds, very large inter-frame jumps and rolling shutter can require a shorter selection or a different stabilizer.

The terminology distinguishes translation from richer motion models, as documented by OpenCV's primary [Global Motion Estimation reference](https://docs.opencv.org/4.x/d4/d2c/group__videostab__motion.html). OpenCV is not a dependency of this implementation.

## Evidence

`node --test tests/movie-maker/stabilization.test.ts` checks measured positive/negative translations, illumination changes, moving foreground rejection, blank frames, scene cuts, pan preservation, crop coverage, source-time interpolation, serialization, undo/redo and splitting.

`MOVIE_TEST_URL=http://127.0.0.1:5191 node tests/movie-maker/stabilization-browser.mjs` creates a real VP8 video with known translations, decodes it through the shared service, runs the worker analysis, exports the stabilized result, and measures actual motion in the decoded exported frames. It also checks monotonic progress, cancellation, original-byte preservation and matching preview/export pixels.

In the checked-in Chromium run, the source has 3.286-pixel RMS translation. Measured corrections reduce the known motion to 0.162 pixels (95.1% reduction); independently measured residual translation in decoded exported frames is 0.089 pixels. The measured correction needs a 1.048× crop, removing about 8.9% of image area. Preview/export mean absolute channel difference is 0.86/255. These are synthetic regression measurements, not performance guarantees for arbitrary handheld footage.

- [Verification report](stabilization-verification.json)
- [Original encoded camera shake](stabilization-before.webm)
- [Stabilized encoded result](stabilization-after.webm)

# Remaining differences from Lightroom desktop 10.0

The integrated application provides real local import, library, development, manual masks/retouch, versions, XMP, backups and photographic export. It does **not** satisfy the complete assignment's equivalence matrix. The application and its documentation identify unavailable functions instead of simulating them.

## Reference and interaction fidelity

Exact Advanced workspace geometry/platform/DPI is unverified. The implemented dark layout uses provisional dimensions and the documented control order. Default/Classic workspace presets are not exposed without verified layouts. Full shortcut customization, arbitrary panel docking, all reference context menus, color-label renaming, complete preset/profile management, adaptive mask copying, mask-only/full range overlays, guided perspective and synchronized comparison/panning remain incomplete. Folder navigation, filmstrip scaling and keyboard crop affordances need further large-library/accessibility evaluation.

## Color, precision, formats and performance

The working space is linear sRGB Float32. Arbitrary ICC transforms, Display P3/Adobe RGB/ProPhoto working/export spaces, a camera-profile collection, Adobe process equivalence, scene-linear unclipped sensor storage, HDR display/PQ/HLG/gain-map output and display calibration are not implemented. LibRaw supplies genuine independent 16-bit RAW development; model/compression coverage beyond the exact fixtures is unverified. No claim extends from a synthetic DNG to an entire manufacturer family, ProRAW, X-Trans, burst or pixel-shift variant.

TIFF support is uncompressed chunky strips with the documented grayscale/RGB(A) sample types; compressed/tiled/CMYK/arbitrary-profile variants require another decoder. Non-interlaced PNG16 is handled natively in the documented sRGB variants. Browser HEIF/AVIF/JXL decoding is conditional and SDR/8-bit; native high-bit-depth/HDR preservation and encoders for AVIF/JXL are absent. DNG SDK conversion/linear-HDR DNG generation, PSB composites, non-RGB/8 PSD and missing compatibility composites need verified adapters. Source metadata remains in originals; complete EXIF/IPTC/XMP rewriting into rendered output is not implemented.

Limits are 24 megapixels, 256 MiB input files, 80 recipe history entries, 256 MiB ZIP backups and 32 MiB backup manifests. Original decoding and full export are not tiled. Multiple workers can consume substantial memory; ultra-large libraries/photos, GPU/device-loss fallbacks, mobile memory pressure and production batch budgets require further work. Thumbnail-analysis scores are transparent heuristics, not face/eye recognition or a quality verdict. No destructive culling action is automated.

Only browsers and fixtures named in verification reports are tested. The installed Firefox build failed to create a profile; it is an environment limitation, not a passing Firefox result. Physical color/display checks, assistive-technology testing and matched reference screenshot differences are not claimed.

## Additional engines, models and services

HDR alignment/deghosting/merge, panorama registration/projection/blending and HDR panoramas are not implemented. HDR merge and HDR display/output remain separate gaps. November 2026 Glow, Vectorscope and Projection are recorded in the backlog but not enabled. Local FFDNet AI denoise is implemented for opaque SDR RGB, including supported RAW after LibRaw development, with a separate TIFF16 result. It does not process camera sensor mosaics directly, reproduce Adobe's denoiser, or establish general real-camera quality. Camera-specific noise models, automatic noise estimation and HDR/wide-gamut/transparent inference remain gaps. AI reconstruction/sharpening/enlargement, semantic search, subject/sky/object/people/landscape segmentation, depth estimation/refinement, occlusion-aware lens blur and real distraction cleanup still require validated implementations.

Generative removal/expansion/prompt edits, Open Eyes and image-to-video need a declared local model or configured provider, provenance and tested cancellation/variations. Reference early-access status is retained in the matrix. Clone and heal are manual tools, not substitutes for these models. No private image uploads occur for absent features.

Video playback/edit/trim/transcode/audio preservation requires a verified container+codec pipeline. Tethering needs a supported camera bridge with session/reconnect behavior. Cloud backup, access-controlled sharing/revocation/comments and C2PA Content Credentials need real service implementations. Lightroom Classic catalog migration and Adobe AI/profile data round trips need separately tested adapters. Image Editor interoperability currently uses RGB/8 native projects; high-bit-depth interchange is unavailable there.

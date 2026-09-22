# Free-trial introduction video

`/free` shows Fraser's optional introduction above the qualifying questionnaire. The questionnaire runs independently of media loading and playback; no watching requirement or eligibility change was added.

- Source supplied by Fraser: `VSL Attemp 1 SubSeq.mp4`, 133.03 seconds, square 1920 × 1920.
- Hosted in the existing Cloudflare Stream account, UID `a477463e8f44255aeca4c1cc0e203b11`.
- Customer playback domain: `customer-qn21p6ogmlqlhcv4.cloudflarestream.com` (already allowed by the site's frame CSP).
- Stream's player selects playback quality. The local poster loads first; Stream is contacted only when the visitor clicks Play. English auto-generated captions are enabled by default. The section shows only the video and an accessible play button, without surrounding headings, links or explanatory text. The local text transcript remains available at `/media/free-trial/intro-v1-transcript.txt`.
- `public/content/free-trial-vsl.json` controls the video, poster and transcript. The player accepts only a Stream UID and local media paths; it cannot embed an arbitrary URL.
- CoachCarter domains, project preview domains and localhost only. Explicit other-school query parameters hide the introduction.
- Video exposures use the existing `video_v1` funnel content version. Existing analytics consent requirements remain unchanged. A failed or disabled manifest falls back to `text_v1` unless the entry URL already carries video attribution.
- The video mentions a test within four months. The standalone transcript clarifies that later/no-test visitors can continue. The agreed questionnaire deliberately has no four-month cutoff; simplifying the surrounding copy does not change eligibility.

## Updating or rolling back

Upload a replacement to the existing Stream account, wait for `readyToStream`, generate/check captions, then update the manifest UID and versioned local poster/transcript. Verify playback on desktop/mobile and both questionnaire routes before publishing. Do not commit the original MP4 or service credentials. Keep cache versions current for changed JS/CSS.

To hide the video, set `enabled` to `false` in the manifest and deploy. This does not disable or change the questionnaire. The unrelated `/test-booked` media manifest remains unchanged.

# Manual chat voice

Voice Settings has independent account-synced Dictation and Read aloud groups.
Defaults: `openai/gpt-4o-mini-transcribe` for dictation, and
`mistralai/voxtral-mini-tts-2603` with `en_paul_neutral` for read aloud.
Alternatives are `openai/gpt-4o-transcribe`, and `x-ai/grok-voice-tts-1.0` with
its `eve`, `ara`, `rex`, `sal` and `leo` voices; a voice is valid only for its
own model. Invalid saved settings require repair, not a silent fallback.
OpenRouter choices persist under the `speech:openrouter` namespace; older `speech`
records stay stored untouched and are never reinterpreted as OpenRouter choices.
Paid settings freeze at server admission; every segment of one read-aloud uses
the first segment's frozen model/voice. Opening Settings cancels local audio,
and choosing a voice does not make a paid preview request.

## Dictation

Only an explicit mic action acquires microphone access. Recording shows actual
local levels, a timer and separate Cancel/Stop controls, capped at2min/10MiB.
Stop makes one transcription request and inserts its result once into the
correct editable draft, preserving typed text. Sending is blocked during
recording/transcription. Review/edit the transcript and explicitly Send.

Native browser capture formats are decoded locally and normalized to mono16kHz,
16-bit PCM WAV using Web Audio. This is encoding, not browser speech inference.
The server accepts only the canonical WAV layout and derives its two-minute
ceiling from actual PCM samples, never a browser-asserted duration. Unsupported
encoding or oversized audio fails before paid work; nothing is truncated to fit.

Cancel, chat/account navigation and unmount release tracks, audio contexts,
buffers and URLs and ignore late results. Raw recordings are transient, never
saved as R2 chat attachments. Missing permissions, insecure context or unsupported
MediaRecorder is an explicit unavailable state, not a browser-service fallback.
Starting dictation stops read-aloud playback, not a native chat reply.

## Read aloud

Use the quiet speaker on a complete committed fully loaded assistant reply.
There is no autoplay or realtime conversation. Prose is split into ordered
bounded segments; fenced code and raw link destinations are skipped. No silent
truncation: a failed segment stops later segments and reports failure.

Stop read-aloud, Escape, navigation/account change and unmount cancel local
playback/pending work and release resources. Overlay Escape dismisses the overlay
first. Audio Stop never calls Pi Stop. Provider work already accepted can still
incur charges; replay is a new explicit paid operation. AI-voice and replay-cost
disclosure stays in Voice Settings, not routinely beneath every reply.

## Development-only OpenRouter setup

The browser calls authenticated same-origin multipart transcription/binary speech
routes. The server chooses saved models/voices and fixed OpenRouter audio paths.
Mutations require exact same Origin, owned chat IDs and durable one-attempt
admission. Duplicate/uncertain UUIDs cannot trigger another paid request. The
application makes one attempt, follows no redirects and performs no provider
retry; upstream routing, fallback and data handling follow OpenRouter settings,
not request headers. Reported seconds/tokens and estimated characters stay separate
from chat context counters; unknown prices remain Unknown/Partial. An operation's
Unknown usage record must persist before its paid request, then upgrade with
available results. Attribution failure never authorizes a provider retry.

Audio is disabled in production, which loads no audio credential. Development
sends Bearer-authenticated requests to
`https://openrouter.ai/api/v1/audio/transcriptions` (multipart,
`response_format=json`) and `https://openrouter.ai/api/v1/audio/speech` (JSON,
`response_format=mp3`, validated binary response). OpenRouter selects upstream
provider routing from the model; application code does not pin or override it.

Development starts without a voice key: a missing private profile, stage entry,
or empty/missing stage key disables voice only. Voice requests return a setup
error without contacting OpenRouter. Supplied malformed profiles, unsafe files,
and invalid nonempty keys still fail validation. Production remains audio-disabled.
To enable voice, create the dedicated private file `~/.alchemy/profiles/default/openrouter.json` (or the same relative path
under `ALCHEMY_HOME`). It must be a current-user-owned regular file no larger
than 64KiB, mode0600, and not a symlink. Example format; replace the placeholder
yourself and never commit or paste an actual key:

```json
{
  "format": "alchemy.profile/v1",
  "provider": "OpenRouter",
  "values": {
    "stages": {
      "dev_local": {
        "apiKey": "<development-openrouter-api-key>"
      }
    }
  }
}
```

Add an independent `dev` entry for cloud development if needed; the stage must
match exactly. Never add production credentials. Local startup reads only
`.env.dev`; cloud launch uses the selected stage, and `prod` loads nothing. The
key is bound server-side as a Worker secret for nonproduction stages only, never
written to a stage/browser env file. Startup validates the file locally; it does
not create a key, provision provider access, or make an audio request. Profile
metadata checks do not prove remote key validity, credit or model eligibility.

**Blast radius:** the development key is a normal OpenRouter API key, not a
Cloudflare Run token, and the application cannot restrict which upstream
provider OpenRouter routes to. Treat the file as a full provider credential;
revoke or rotate it directly at OpenRouter if it leaks. Never reuse a
production credential here.

## User-owned acceptance

After explicit setup, verify actual native model/voice eligibility, multipart and
binary delivery, microphone capability/permissions, Stop/Cancel/navigation races,
typed-draft preservation, no automatic Send, long chunk playback/code skipping,
backend duplicate/rate rejection, real unit attribution and billing/cancellation
behavior. Test archived read-aloud separately from blocked new chat sends.
Source checks and anonymous visual fixtures do not establish any of these live
provider, microphone, authentication or deployed outcomes.

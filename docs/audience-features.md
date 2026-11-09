# Share cards and the daily challenge

David approved the first audience features on 9 November 2026: “go”, following the recommendation to start with fact-check cards and then the daily challenge.

Quote pages offer **Make a fact-check card**. The browser creates a PNG carrying the scoped claim, verdict, explanation, source comparison when available, citation, usage note, verification date and canonical evidence URL. No server rasterizer, image library, new service or new account is needed. Long text increases the image height; a quote too large for one usable image gets an explicit fallback to the existing copy/share controls, never a silent truncation. The normal link previews continue to use the existing static social image.

`tools/template.js:shareCardData` derives the card verdict and explanation from the same ClaimReview and FAQ as the page. Do not classify all disputed records as false, strip uncertainty, or turn a modern translation into public-domain text on a share card.

`/challenge/` offers three researched claims a day. Its three answers distinguish supported attribution, misquotes/misattribution and incomplete evidence. Dates change at midnight in America/New_York. Selection is deterministic and uses distinct authors. The dated fragment in a shared result opens the same set; score shares contain no answers. Progress is stored locally for 30 days, and blocked storage does not prevent playing.

## Editorial maintenance

The 18 questions in `data/challenge-questions.json` are drawn from reviewed quote pages. Each pins the exact scoped claim, effective rating and human-selected answer. A change to its claim or rating stops the build and calls for editorial review. This prevents a later correction from silently changing a question's meaning while retaining an old answer.

Edition `v1` is frozen: do not reorder, add or remove its questions to refresh the daily pool, because already shared dated sets and saved answers must keep their meaning. A larger pool needs a new edition with the old edition still addressable. Explanations and source notes may improve with the underlying records; if a correction changes an answer, explicitly handle the affected saved/dated question rather than bypassing the gate.

## Measurement

Uses the existing GoatCounter integration only. Event names are fixed, no leading slash: `card-preview`, `card-download`, `card-share`, `card-link-copy`, `card-arrival`, `challenge-start`, `challenge-complete`, `challenge-share`, `challenge-score-download`, `challenge-arrival`, `challenge-return-7d`. No quote text, user-supplied strings, individual answers or player identifier is attached. Local previews and Do-Not-Track browsers do not emit these events. Blocked analytics never blocks the product.

The seven-day event is a device-local indication that a player completed a challenge seven days earlier and returned today. It is an aggregate signal, not a cross-device retention cohort. Arrivals from shared links carry an allowlisted `via` parameter while canonical URLs remain unchanged. Image-only sharing without the accompanying link cannot reliably be attributed.

## Validation and release

Run `node --test tools/audience.test.js`, then the normal full build, scan and review-spine checks. Browser-check dark/light themes, mobile/desktop layouts, PNG exports, keyboard dialog controls, resumed/finished challenges, dated result links and blocked storage. Generators own the committed pages. This is a generator feature branch, not a content-wave branch.

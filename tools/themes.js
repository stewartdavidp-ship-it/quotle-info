'use strict';
/*
 * themes.js — the CONTROLLED vocabulary of intent themes used to make the verified corpus
 * discoverable by goal ("quotes about resilience for a leadership offsite"). One fixed list so
 * tags stay consistent and pages are clusterable. Consumed by:
 *   - workflows/tag-themes.js  (the enum the tagging agent must choose from)
 *   - tools/build-themes.js    (generates /themes/ + /themes/{slug}/ + /themes.json)
 *   - tools/build-search.js    (theme entries in the universal search index)
 * A record carries its tags as record.themes = ['resilience', ...] (slugs from THIS list only).
 * To add a theme: append here, re-run the tagging workflow (or hand-tag), rebuild. Never rename a
 * slug in place once live — that breaks /themes/{slug} URLs; add a new one and retire the old.
 */
const THEMES = [
  { slug: 'resilience',  label: 'Resilience',  blurb: 'Enduring hardship, bouncing back, and refusing to stay down.' },
  { slug: 'courage',     label: 'Courage',     blurb: 'Facing fear, taking the risk, acting in spite of the odds.' },
  { slug: 'leadership',  label: 'Leadership',  blurb: 'Leading people, carrying responsibility, setting direction.' },
  { slug: 'change',      label: 'Change',      blurb: 'Transformation, adapting, and letting the old give way.' },
  { slug: 'growth',      label: 'Growth',      blurb: 'Getting better, learning by doing, becoming who you could be.' },
  { slug: 'failure',     label: 'Failure',     blurb: 'Mistakes, setbacks, and what they teach.' },
  { slug: 'success',     label: 'Success',     blurb: 'Achievement, winning, and what it really costs.' },
  { slug: 'creativity',  label: 'Creativity',  blurb: 'Imagination, making art, and where ideas come from.' },
  { slug: 'wisdom',      label: 'Wisdom',      blurb: 'Insight, judgment, and knowing what matters.' },
  { slug: 'knowledge',   label: 'Knowledge',   blurb: 'Learning, education, and the pursuit of understanding.' },
  { slug: 'truth',       label: 'Truth',       blurb: 'Honesty, facts, and the courage to face them.' },
  { slug: 'justice',     label: 'Justice',     blurb: 'Fairness, rights, and standing against wrong.' },
  { slug: 'freedom',     label: 'Freedom',     blurb: 'Liberty, independence, and the right to choose.' },
  { slug: 'love',        label: 'Love',        blurb: 'Affection, devotion, and the bonds between people.' },
  { slug: 'friendship',  label: 'Friendship',  blurb: 'Connection, loyalty, and the company we keep.' },
  { slug: 'kindness',    label: 'Kindness',    blurb: 'Compassion, generosity, and treating others well.' },
  { slug: 'gratitude',   label: 'Gratitude',   blurb: 'Thankfulness and appreciating what you have.' },
  { slug: 'happiness',   label: 'Happiness',   blurb: 'Joy, contentment, and the good life.' },
  { slug: 'purpose',     label: 'Purpose',     blurb: 'Meaning, calling, and why we do what we do.' },
  { slug: 'time',        label: 'Time',        blurb: 'Impermanence, the present moment, and how we spend our days.' },
  { slug: 'mortality',   label: 'Mortality',   blurb: 'Death, legacy, and living in its light.' },
  { slug: 'hope',        label: 'Hope',        blurb: 'Optimism and faith that things can be better.' },
  { slug: 'work',        label: 'Work',        blurb: 'Effort, discipline, craft, and the dignity of labor.' },
  { slug: 'simplicity',  label: 'Simplicity',  blurb: 'Less is more, focus, and cutting to what counts.' },
  { slug: 'doubt',       label: 'Doubt',       blurb: 'Skepticism, questioning, and thinking for yourself.' },
  { slug: 'power',       label: 'Power',       blurb: 'Influence, authority, and how it is used.' },
  { slug: 'character',   label: 'Character',   blurb: 'Integrity, virtue, and who you are when no one is watching.' },
  { slug: 'humility',    label: 'Humility',    blurb: 'Modesty, perspective, and knowing your limits.' },
];

const THEME_SLUGS = THEMES.map((t) => t.slug);
const THEME_BY_SLUG = Object.fromEntries(THEMES.map((t) => [t.slug, t]));
const isTheme = (s) => Object.prototype.hasOwnProperty.call(THEME_BY_SLUG, s);

module.exports = { THEMES, THEME_SLUGS, THEME_BY_SLUG, isTheme };

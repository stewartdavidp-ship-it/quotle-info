# Quotle game fields: brief

You are filling in the clue fields the Quotle game needs for verified quotes from quotle.info. In Quotle,
a player sees a quote and guesses who said it. After each wrong guess the game compares the guessed
author with the real one on gender, category and period. A hint and a location are unlocked as help.

For EACH input quote, output one object:
{ "slug": <input slug>, "gender", "category", "period", "difficulty", "hint", "location", "year" }

- **gender:** "Male" or "Female". If the author is neither, use null and explain in "note".
- **category:** EXACTLY one of Speech, Literature, Philosophy, Science, Activism, Business, Art, Film, Music,
  Sports. It's what the author is mainly known for, and it's the SAME for every quote by that author.
  - Politicians and leaders: Speech.
  - Novelists, poets, essayists, diarists and most writers: Literature.
  - Philosophers and religious thinkers: Philosophy.
- **period:** EXACTLY one of Ancient, 1200s, 1300s, 1400s, 1500s, 1600s, 1700s, 1800s, 1900s, 2000s.
  - The century the author is mainly active in, the same for every quote by that author.
  - Anything before 1200 is "Ancient".
  - "1900s" means 1900–1999.
- **difficulty:** integer 2–9. How hard is it for a typical American adult to name this author from this
  quote? 2–4 = famous line, famous author. 5–6 = famous author, less famous line. 7–8 = known author
  but an obscure line. 9 = hard. The current game skews 6–8, with very few below 5.
- **hint:** ONE sentence, ≤ 110 characters, in the friendly tone of "smart friend at a dinner party".
  - NEVER include the author's name, initials or the title of their most famous work.
  - Make it a true, specific fact: about the author ("She chaired the UN committee that drafted the
    Universal Declaration of Human Rights.") or about this quote's occasion ("He made this speech at
    Rice University about the space program.").
  - Use "He"/"She"/"They".
- **location:** where the words were said or written, in the game's format:
  - "City, Country", or "City, State, USA" for the US, e.g. "Rome, Italy", "Concord, Massachusetts, USA",
    "Washington, D.C., USA", "London, England".
  - Use just "Country" if the city is unknown.
- **year:**
  - when the words were said or written: an exact year if known ("1963"), else a decade ("1960s");
  - ancient dates as "64 CE" / "400 BCE";
  - use the input's dateCreated/source when given.

Use the input fields (author line, source line, dateCreated); they come from researched records. When
"knownAuthor" is present, COPY its gender, category and period exactly: the game already uses them.
Don't search the web. If a fact isn't solid, write a hint you are sure of instead.

Write the output as a JSON array to the path you are given. Nothing else in the file.

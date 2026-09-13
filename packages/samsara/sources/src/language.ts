/**
 * A script detector, not a language detector — and the field it fills says so.
 *
 * `ItemDraft.languageGuess` is documented as "what the source or a cheap detector
 * claimed. Not authoritative." This is the cheap detector, and it is deliberately
 * cheaper than it could be: a real one would need a model, a model costs tokens,
 * and the extract stage in Phase 2 is going to read every one of these items with
 * a real model anyway. Paying twice for the same judgement is the kind of
 * thoroughness that shows up on a bill.
 *
 * Shared by every adapter rather than copied into each, because the one thing
 * worse than a weak heuristic is two weak heuristics that disagree and produce
 * two different `languageGuess` values for the same sentence harvested from two
 * sources — which is a difference downstream code would reasonably read as signal.
 */

/**
 * Thai script means Thai; nothing else is written in it. Vietnamese is Latin, so
 * it is identified by the letters and stacked diacritics no other Latin-script
 * language uses (`ă â ê ô ơ ư đ`, and the `Ạ`–`ỹ` block) — which is a narrower
 * test than it first looks, and the narrowness is the point.
 *
 * **It will not fire on `bánh mì ngon quá`.** Every accent in that phrase is plain
 * Latin-1, shared with Spanish, Portuguese and Italian; nothing in it is
 * Vietnamese-specific. An earlier version of this comment claimed the diacritics
 * were "present in almost any real Vietnamese sentence", which is true of
 * sentences and false of the four-word captions this detector will mostly be
 * handed. A test written with a realistic caption is what disagreed.
 *
 * Widening the class to cover Latin-1 accents would make the detector fire on
 * Spanish and report it as Vietnamese, which is worse than the gap: a wrong
 * `languageGuess` is a claim, a null one is an admission. This is also why an
 * adapter should prefer the source's own language field when it has one and fall
 * back to this only when it does not.
 *
 * Everything else returns `null` rather than defaulting to `"en"`. "Probably
 * English" is a claim, and an unsupported claim stored in a column is worse than
 * an admitted gap: the gap can be filled later by something that actually knows.
 */
export function guessLanguage(text: string): string | null {
  if (/[฀-๿]/.test(text)) return "th"
  if (/[Ạ-ỹăâêôơưđĂÂÊÔƠƯĐ]/.test(text)) return "vi"
  if (/[぀-ヿ]/.test(text)) return "ja"
  if (/[가-힯]/.test(text)) return "ko"
  if (/[一-鿿]/.test(text)) return "zh"
  return null
}

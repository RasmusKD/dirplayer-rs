//! Host-supplied text corrections, applied when a script assigns a member's
//! text. The page names exact strings to replace; nothing else is touched, and
//! the cast's own data on disk is never modified.
//!
//! Used for typos in the game's own localised strings that the publisher never
//! fixed and never can (Bitfrost closed in 2014).
use std::cell::RefCell;

thread_local! {
    static REPLACEMENTS: RefCell<Vec<(String, String)>> = const { RefCell::new(Vec::new()) };
}

pub fn set_replacements(pairs: Vec<(String, String)>) {
    REPLACEMENTS.with(|r| *r.borrow_mut() = pairs);
}

/// Returns the corrected text, or the input unchanged when nothing matches.
/// Exact whole-string match only: a substring rule would be a foot-gun on
/// text the game builds up piece by piece.
pub fn apply(text: &str) -> Option<String> {
    REPLACEMENTS.with(|r| {
        r.borrow()
            .iter()
            .find(|(from, _)| from == text)
            .map(|(_, to)| to.clone())
    })
}

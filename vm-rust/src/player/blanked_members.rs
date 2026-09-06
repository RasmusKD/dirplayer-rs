//! Members whose text the renderer skips.
//!
//! Set from JS by the host page (see `set_blanked_members`). Kept here rather
//! than hard-coded so the knowledge of WHICH members stays with the page that
//! knows the movie, and the VM keeps a general mechanism.

use std::cell::RefCell;

thread_local! {
    static BLANKED: RefCell<Vec<String>> = RefCell::new(Vec::new());
}

pub fn set_blanked(names: Vec<String>) {
    BLANKED.with(|b| *b.borrow_mut() = names);
}

/// True when this member's text should render as nothing. Name match is
/// case-insensitive, matching Director's own name lookups.
pub fn is_blanked(name: &str) -> bool {
    if name.is_empty() {
        return false;
    }
    let lower = name.to_lowercase();
    BLANKED.with(|b| b.borrow().iter().any(|n| n == &lower))
}

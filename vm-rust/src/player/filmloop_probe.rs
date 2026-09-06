//! Counters for diagnosing why a film loop is not animating. Read them from
//! JS via `dirplayer_getFilmLoopDump`. Cheap enough to leave in: two adds per
//! frame loop tick.
use std::cell::{Cell, RefCell};
use std::collections::BTreeMap;

thread_local! {
    static TICKS: Cell<u64> = const { Cell::new(0) };
    static LAST_ACTIVE: Cell<u32> = const { Cell::new(0) };
    static ADVANCES: Cell<u64> = const { Cell::new(0) };
    static RESETS: Cell<u64> = const { Cell::new(0) };
    static LAST_ADV: Cell<(i32, i32, u32, u32)> = const { Cell::new((0, 0, 0, 0)) };
    static LAYOUT: RefCell<String> = const { RefCell::new(String::new()) };
    static STAGE_RECT: Cell<(i32, i32, i32, i32)> = const { Cell::new((0, 0, 0, 0)) };
    static INNER_LAYOUT: RefCell<String> = const { RefCell::new(String::new()) };
    static TRACES: RefCell<BTreeMap<(u32, i32), String>> = RefCell::new(BTreeMap::new());
    static DEPTH: Cell<u32> = const { Cell::new(0) };
}

pub fn note_tick(active: u32) {
    TICKS.with(|t| t.set(t.get() + 1));
    LAST_ACTIVE.with(|a| a.set(active));
}

pub fn note_advance(cast_lib: i32, member_num: i32, from: u32, to: u32) {
    ADVANCES.with(|a| a.set(a.get() + 1));
    LAST_ADV.with(|l| l.set((cast_lib, member_num, from, to)));
}

pub fn last_advanced() -> (i32, i32, u32, u32) {
    LAST_ADV.with(|l| l.get())
}

pub fn note_reset() {
    RESETS.with(|r| r.set(r.get() + 1));
}

pub fn stats() -> (u64, u32, u64, u64) {
    (
        TICKS.with(|t| t.get()),
        LAST_ACTIVE.with(|a| a.get()),
        ADVANCES.with(|a| a.get()),
        RESETS.with(|r| r.get()),
    )
}

/// What the renderer actually computed for a film loop's children this frame.
/// Written by render_filmloop_from_channel_data, read from JS.
pub fn set_layout(s: String) {
    LAYOUT.with(|l| *l.borrow_mut() = s);
}

pub fn layout() -> String {
    let (l, t, r, b) = STAGE_RECT.with(|s| s.get());
    format!("stage({},{},{},{}) {}", l, t, r, b, LAYOUT.with(|l| l.borrow().clone()))
}

/// Where the film loop's offscreen is drawn on the stage.
pub fn set_stage_rect(rect: (i32, i32, i32, i32)) {
    STAGE_RECT.with(|s| s.set(rect));
}

/// Film loops nest: the credits creature's walk cycle is a loop inside the
/// loop. Depth 0 writes the outer trace, deeper writes the inner one, so both
/// are readable at once.
pub fn depth() -> u32 {
    DEPTH.with(|d| d.get())
}

pub fn push_depth() {
    DEPTH.with(|d| d.set(d.get() + 1));
}

pub fn pop_depth() {
    DEPTH.with(|d| d.set(d.get().saturating_sub(1)));
}

pub fn set_inner_layout(s: String) {
    INNER_LAYOUT.with(|l| *l.borrow_mut() = s);
}

pub fn inner_layout() -> String {
    INNER_LAYOUT.with(|l| l.borrow().clone())
}

/// One trace per (nesting depth, member), so every level of a nest is
/// readable at once instead of the deepest overwriting the rest.
pub fn set_trace(depth: u32, member_num: i32, line: String) {
    TRACES.with(|t| {
        t.borrow_mut().insert((depth, member_num), line);
    });
}

pub fn traces() -> String {
    TRACES.with(|t| {
        t.borrow()
            .iter()
            .map(|((d, m), line)| format!("[d{} m{}] {}", d, m, line))
            .collect::<Vec<_>>()
            .join("
")
    })
}

thread_local! {
    /// Off by default. The layout trace costs a `format!` per film loop child
    /// per frame plus a full-string clone, and nothing reads it unless someone
    /// is debugging. Turn it on from JS with `dirplayer_setFilmLoopTrace(true)`
    /// before reproducing, then read `dirplayer_getFilmLoopTraces()`.
    static TRACING: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
}

pub fn set_tracing(on: bool) {
    TRACING.with(|c| c.set(on));
}

pub fn tracing_enabled() -> bool {
    TRACING.with(|c| c.get())
}

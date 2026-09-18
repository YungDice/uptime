// Desktop entry point. All the real setup lives in lib.rs so that the iOS and
// Android targets, which link the library rather than running a binary, share
// exactly the same code path.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    uptime_lib::run()
}

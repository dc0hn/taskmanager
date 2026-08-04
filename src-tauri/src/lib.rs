use std::io::Write;
use tauri::Manager;

/// Write a snapshot of the whole profile to a fixed path in the app data directory.
///
/// The narrowest useful shape for this, deliberately. The frontend hands over CONTENTS
/// and nothing else — it cannot name a path, so there is no argument here that could be
/// pointed somewhere it should not go, and no need for a broad filesystem grant to cover
/// the one file the app actually writes.
///
/// Durability comes from fsync-then-rename, in that order, and the order is the point.
/// `rename` alone buys atomic VISIBILITY — a reader sees the old file or the new one,
/// never half of either — but not durability against power loss: the rename can be
/// journalled while the temp file's data blocks are still sitting in the page cache,
/// which after a hard crash leaves a snapshot that is present, correctly named, and
/// empty. Syncing the file before the rename, and the directory after it, is what makes
/// the file's contents and its name both survive.
///
/// One generation is kept behind the current file, because the failure that matters is
/// not a torn write but a snapshot taken of state that had already gone wrong — and
/// overwriting the last good copy with it is exactly the loss a snapshot exists to
/// prevent.
#[tauri::command]
fn write_snapshot(app: tauri::AppHandle, contents: String) -> Result<String, String> {
    // A profile is JSON of plans and counters. Tens of megabytes means something has
    // gone wrong upstream, and refusing is better than filling a disk.
    const MAX_BYTES: usize = 64 * 1024 * 1024;
    if contents.len() > MAX_BYTES {
        return Err(format!(
            "snapshot is {} bytes, over the {} byte limit",
            contents.len(),
            MAX_BYTES
        ));
    }

    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("no app data directory: {e}"))?;

    write_rotating(&dir, &contents).map(|p| p.to_string_lossy().into_owned())
}

/// The write itself, separated from the command so it can be tested without a Tauri
/// process. Takes the directory rather than resolving one, which is the only reason a
/// test can point it at a temporary path.
fn write_rotating(dir: &std::path::Path, contents: &str) -> Result<std::path::PathBuf, String> {
    std::fs::create_dir_all(dir)
        .map_err(|e| format!("could not create {}: {e}", dir.display()))?;

    let current = dir.join("almanac-snapshot.json");
    let previous = dir.join("almanac-snapshot.prev.json");
    let temp = dir.join("almanac-snapshot.json.tmp");

    {
        let mut f =
            std::fs::File::create(&temp).map_err(|e| format!("write failed: {e}"))?;
        f.write_all(contents.as_bytes())
            .map_err(|e| format!("write failed: {e}"))?;
        // The data is on the platter before the name points at it. Without this the
        // rename can land first and the contents never arrive.
        f.sync_all().map_err(|e| format!("sync failed: {e}"))?;
    }

    if current.exists() {
        // Best effort: losing the previous generation is not a reason to throw away a
        // good new snapshot.
        let _ = std::fs::rename(&current, &previous);
    }
    std::fs::rename(&temp, &current).map_err(|e| format!("rename failed: {e}"))?;

    // And the rename itself. Directory metadata is cached like anything else, so without
    // this the file can be durable under a name that did not survive. Best effort: some
    // filesystems refuse to sync a directory handle, and failing the whole snapshot over
    // that would be worse than the weaker guarantee.
    if let Ok(d) = std::fs::File::open(dir) {
        let _ = d.sync_all();
    }

    Ok(current)
}

#[cfg(test)]
mod tests {
    use super::write_rotating;

    /// A scratch directory under the OS temp dir, removed on drop.
    struct Scratch(std::path::PathBuf);

    impl Scratch {
        fn new(name: &str) -> Self {
            let dir = std::env::temp_dir().join(format!("almanac-test-{name}"));
            let _ = std::fs::remove_dir_all(&dir);
            Scratch(dir)
        }
    }

    impl Drop for Scratch {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn writes_a_snapshot_and_creates_the_directory() {
        let s = Scratch::new("writes");
        let path = write_rotating(&s.0, "{\"a\":1}").expect("write");
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "{\"a\":1}");
    }

    #[test]
    fn keeps_one_generation_behind() {
        // The failure this guards against is not a torn write but a snapshot taken of
        // state that had already gone wrong. Overwriting the last good copy with it is
        // the loss the snapshot exists to prevent.
        let s = Scratch::new("rotates");
        write_rotating(&s.0, "first").expect("first");
        write_rotating(&s.0, "second").expect("second");

        assert_eq!(
            std::fs::read_to_string(s.0.join("almanac-snapshot.json")).unwrap(),
            "second"
        );
        assert_eq!(
            std::fs::read_to_string(s.0.join("almanac-snapshot.prev.json")).unwrap(),
            "first"
        );
    }

    #[test]
    fn leaves_no_temp_file_behind() {
        // A stray .tmp would be mistaken for a snapshot by anyone looking in the folder.
        let s = Scratch::new("no-temp");
        write_rotating(&s.0, "x").expect("write");
        assert!(!s.0.join("almanac-snapshot.json.tmp").exists());
    }

    #[test]
    fn the_written_file_reads_back_byte_for_byte() {
        // The snapshot was write-only, so nothing had ever asserted it round-trips. A
        // backup you cannot read is a backup in name.
        let s = Scratch::new("roundtrip");
        let json = r#"{"format":"almanac.export","records":{"dp:plan:2026-07-30":{}}}"#;
        let path = write_rotating(&s.0, json).expect("write");
        assert_eq!(std::fs::read_to_string(&path).unwrap(), json);
    }

    #[test]
    fn both_generations_are_readable_after_two_writes() {
        // The reason to keep a generation is to restore from it, which means it has to be
        // readable and it has to be the older one.
        let s = Scratch::new("generations");
        write_rotating(&s.0, "older").expect("first");
        write_rotating(&s.0, "newer").expect("second");
        assert_eq!(
            std::fs::read_to_string(s.0.join("almanac-snapshot.json")).unwrap(),
            "newer"
        );
        assert_eq!(
            std::fs::read_to_string(s.0.join("almanac-snapshot.prev.json")).unwrap(),
            "older"
        );
    }

    #[test]
    fn overwrites_rather_than_appending() {
        let s = Scratch::new("truncates");
        write_rotating(&s.0, "a-long-first-snapshot").expect("first");
        write_rotating(&s.0, "short").expect("second");
        assert_eq!(
            std::fs::read_to_string(s.0.join("almanac-snapshot.json")).unwrap(),
            "short"
        );
    }
}


/// Read the snapshot back, so the second copy is usable from inside the app.
///
/// The snapshot was write-only, which made it a backup in name. Restoring meant quitting,
/// finding the file in Finder, opening it in an editor, copying the whole thing and
/// pasting it into the import box — at exactly the moment someone is least equipped to go
/// path-hunting. `importAll` already takes JSON text and already validates every record,
/// so this is the only piece that was missing.
///
/// `previous` selects the generation kept behind the current file, which is what you want
/// when the current one turns out to be a snapshot of already-broken state.
///
/// Same shape as the writer: no path argument. The frontend asks for "the snapshot" or
/// "the one before it" and gets text back.
#[tauri::command]
fn read_snapshot(app: tauri::AppHandle, previous: bool) -> Result<String, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("no app data directory: {e}"))?;
    let name = if previous {
        "almanac-snapshot.prev.json"
    } else {
        "almanac-snapshot.json"
    };
    let path = dir.join(name);
    if !path.exists() {
        return Err(format!("no snapshot at {}", path.display()));
    }
    std::fs::read_to_string(&path).map_err(|e| format!("could not read {}: {e}", path.display()))
}

/// Hand a link from a note to the default browser.
///
/// The webview must never navigate. It is the app — following a link inside it would
/// replace the calendar with a web page and there is no back button to return from,
/// so the only safe way to open anything is to give it to the operating system and
/// stay put.
///
/// `vet` is the whole security boundary and it is a strict allowlist, not a filter of
/// known-bad. `open` will happily launch an application, open a document, or act on a
/// custom scheme registered by anything installed, so the question is not "is this
/// string dangerous" but "is this one of the two things we meant to support". Notes
/// are free text and can be pasted from anywhere, which makes them exactly the kind of
/// input that should not reach a shell-adjacent API unexamined.
#[tauri::command]
fn open_external(url: String) -> Result<(), String> {
    let target = vet(&url)?;
    std::process::Command::new("open")
        // Stops a URL from being read as an option. The scheme check already makes a
        // leading dash impossible; this holds even if that check is ever loosened.
        .arg("--")
        .arg(&target)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("could not open the link: {e}"))
}

/// Accept `http://` and `https://` URLs, and nothing else whatsoever.
fn vet(url: &str) -> Result<String, String> {
    const MAX: usize = 2048;
    let trimmed = url.trim();

    if trimmed.len() > MAX {
        return Err("that link is too long to open".into());
    }

    // Whitespace and control characters cannot appear in a URL, and their presence
    // means the string is not one thing — it is a line that happens to start like a
    // link. Refuse rather than opening the part before the space.
    if trimmed.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return Err("that link contains spaces or control characters".into());
    }

    // Case-insensitive on the scheme only. `HTTPS://` is a valid URL; the rest of the
    // string is left exactly as written, because paths and query strings are
    // case-sensitive and lowercasing them would open a different page.
    let lower = trimmed.to_ascii_lowercase();
    if !(lower.starts_with("http://") || lower.starts_with("https://")) {
        return Err("only http and https links can be opened".into());
    }

    // A scheme with no host — "https://" alone, or "https:///path" — is not something
    // to hand onward.
    let rest = &trimmed[lower.find("//").map(|i| i + 2).unwrap_or(0)..];
    if rest.is_empty() || rest.starts_with('/') {
        return Err("that link has no address".into());
    }

    Ok(trimmed.to_string())
}

#[cfg(test)]
mod link_tests {
    use super::vet;

    #[test]
    fn accepts_ordinary_meeting_links() {
        for url in [
            "https://zoom.us/j/1234567890?pwd=abc",
            "https://meet.google.com/abc-defg-hij",
            "https://teams.microsoft.com/l/meetup-join/19%3ameeting",
            "http://localhost:3000/standup",
        ] {
            assert!(vet(url).is_ok(), "rejected {url}");
        }
    }

    #[test]
    fn refuses_every_scheme_but_http_and_https() {
        // The point of the allowlist. `open` acts on all of these, and a note is text
        // that can be pasted from anywhere.
        for url in [
            "file:///Users/someone/.ssh/id_rsa",
            "ftp://example.com/x",
            "mailto:someone@example.com",
            "zoommtg://zoom.us/join?confno=1",
            "javascript:alert(1)",
            "/Applications/Calculator.app",
            "-e",
            "",
        ] {
            assert!(vet(url).is_err(), "accepted {url}");
        }
    }

    #[test]
    fn refuses_a_line_that_merely_begins_like_a_link() {
        assert!(vet("https://example.com and then rm -rf /").is_err());
        assert!(vet("https://example.com\nopen -a Calculator").is_err());
        assert!(vet("https://exa\tmple.com").is_err());
    }

    #[test]
    fn refuses_a_scheme_with_no_host() {
        assert!(vet("https://").is_err());
        assert!(vet("https:///etc/passwd").is_err());
    }

    #[test]
    fn accepts_an_uppercase_scheme_without_touching_the_path() {
        // Paths and query strings are case-sensitive: lowercasing the whole URL would
        // open a different page, which is a wrong answer rather than a refusal.
        assert_eq!(
            vet("HTTPS://example.com/CaseSensitive?T=1").unwrap(),
            "HTTPS://example.com/CaseSensitive?T=1"
        );
    }

    #[test]
    fn trims_surrounding_whitespace_rather_than_refusing_it() {
        assert_eq!(vet("  https://example.com  ").unwrap(), "https://example.com");
    }

    #[test]
    fn refuses_something_far_too_long() {
        let long = format!("https://example.com/{}", "a".repeat(4096));
        assert!(vet(&long).is_err());
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    // ONE INSTANCE, ALWAYS.
    //
    // Two windows share one localStorage with no coordination between them: the last
    // write to a key wins, the two undo stacks diverge, and both reconcile loops fight
    // over the same day stats — each recomputing a day the other has just changed. The
    // second launch focuses the existing window instead.
    .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
      use tauri::Manager;
      if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.set_focus();
      }
    }))
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      write_snapshot,
      read_snapshot,
      open_external
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
